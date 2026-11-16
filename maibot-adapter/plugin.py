"""Uta × MaiBot 适配器。

Uta 桌面宠物和 MaiBot 之间只走本机回环：

- Uta -> MaiBot：Uta 气泡输入通过本插件在 127.0.0.1:8524 提供的 HTTP 入口，
  注入成一条独立的「Uta」私聊消息，由 MaiBot 正常生成回复。
- MaiBot -> Uta：该私聊的回复通过 Uta 运行时桥（v2 信封 + Bearer token）
  以流式 rp_reply 写回桌宠气泡；收到消息时同步 thinking 状态。

不读取、不转发其他聊天平台的消息正文。可以选择只同步「正在工作」状态，
但回复始终只回给 Uta 自己的会话。
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from maibot_sdk import Field, HookHandler, MaiBotPlugin, MessageGateway, PluginConfigBase, Tool
from maibot_sdk.types import ErrorPolicy, HookMode, HookOrder, ToolParameterInfo, ToolParamType

PLUGIN_VERSION = "0.4.0"

GATEWAY_NAME = "uta"
PLATFORM = "uta"
ACCOUNT_ID = "uta-desktop"
SCOPE = "local"
USER_ID = "uta-user"

UTA_HOST_ID = "maibot"
RUNTIME_SESSION = "uta-maibot"
RUNTIME_PROTOCOL_VERSION = "2.0"

MAX_INPUT_CHARS = 4000
MAX_REPLY_CHARS = 20000
REPLY_CHUNK_CHARS = 480
MAX_IMAGE_BYTES = 6 * 1024 * 1024
MAX_REPLY_IMAGE_BYTES = 1024 * 1024
MAX_REPLY_IMAGES = 4
MAX_BODY_BYTES = 8 * 1024 * 1024
MAX_HEADER_BYTES = 32 * 1024
HTTP_TIMEOUT_SECONDS = 4.0
AUTH_CONTEXT = b"uta:maibot:http-ingress:v1"
READY_PATH = "/v1/ready"
TEXT_PATH = "/v1/input/text"
SCREENSHOT_PATH = "/v1/input/screenshot"
MODEL_PATH = "/v1/sync/model"
WRITE_PATHS = {TEXT_PATH, SCREENSHOT_PATH, MODEL_PATH}


class PluginCoreConfig(PluginConfigBase):
    __ui_label__ = "插件"
    __ui_icon__ = "package"
    __ui_order__ = 0

    enabled: bool = Field(default=True, description="是否启用插件")
    config_version: str = Field(default="0.1.0", description="配置版本")


class BridgeConfig(PluginConfigBase):
    __ui_label__ = "Uta 入口"
    __ui_icon__ = "plug"
    __ui_order__ = 1

    host: str = Field(default="127.0.0.1", description="只允许本机回环地址")
    port: int = Field(default=8524, description="Uta 的「MaiBot 服务地址」默认端口")


class RuntimeConfig(PluginConfigBase):
    __ui_label__ = "Uta 运行时"
    __ui_icon__ = "activity"
    __ui_order__ = 2

    endpoint_file: str = Field(
        default="",
        description="手动指定 Uta 的 runtime-endpoint.json；留空则自动寻找日常实例的 MaiBot 绑定端点",
    )
    timeout_seconds: float = Field(default=HTTP_TIMEOUT_SECONDS, description="单条指令的超时时间")


class ChatConfig(PluginConfigBase):
    __ui_label__ = "对话"
    __ui_icon__ = "message-circle"
    __ui_order__ = 3

    reflect_all_chats: bool = Field(
        default=False,
        description="是否让桌宠也显示其他聊天平台正在处理（只同步状态，不转发正文）",
    )
    user_nickname: str = Field(default="桌宠主人", description="Uta 私聊在 MaiBot 里显示的用户昵称")


class UtaAdapterConfig(PluginConfigBase):
    plugin: PluginCoreConfig = Field(default_factory=PluginCoreConfig)
    bridge: BridgeConfig = Field(default_factory=BridgeConfig)
    runtime: RuntimeConfig = Field(default_factory=RuntimeConfig)
    chat: ChatConfig = Field(default_factory=ChatConfig)


def _clean_text(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    text = value.replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(
        ch
        for ch in text
        if ch == "\n" or ch == "\t" or (ord(ch) >= 0x20 and ord(ch) != 0x7F)
    )
    text = text.strip()
    return text[:limit]


def _extract_message_text(message: Dict[str, Any]) -> str:
    parts: List[str] = []
    raw = message.get("raw_message")
    if isinstance(raw, list):
        for component in raw:
            if not isinstance(component, dict):
                continue
            if component.get("type") == "text":
                value = component.get("data")
                if isinstance(value, str) and value:
                    parts.append(value)
    text = "".join(parts).strip()
    return text


def _extract_reply_images(message: Dict[str, Any]) -> List[Dict[str, str]]:
    raw = message.get("raw_message")
    components = list(raw) if isinstance(raw, list) else []
    segment = message.get("message_segment")
    if isinstance(segment, dict):
        if segment.get("type") == "seglist" and isinstance(segment.get("data"), list):
            components.extend(segment["data"])
        else:
            components.append(segment)

    images: List[Dict[str, str]] = []
    seen = set()
    for component in components:
        if not isinstance(component, dict) or component.get("type") not in ("image", "emoji"):
            continue
        encoded = component.get("binary_data_base64") or component.get("data")
        if not isinstance(encoded, str):
            continue
        encoded = encoded.strip()
        if encoded.startswith("data:"):
            encoded = encoded.partition(",")[2]
        if not encoded or len(encoded) > (MAX_REPLY_IMAGE_BYTES + 2) // 3 * 4:
            continue
        try:
            binary = base64.b64decode(encoded, validate=True)
        except ValueError:
            continue
        if not binary or len(binary) > MAX_REPLY_IMAGE_BYTES:
            continue
        fingerprint = hashlib.sha256(binary).digest()
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        description = _clean_text(component.get("description"), 160)
        images.append({
            "base64": base64.b64encode(binary).decode("ascii"),
            "description": description or ("表情包" if component["type"] == "emoji" else "图片"),
        })
        if len(images) >= MAX_REPLY_IMAGES:
            break
    return images


def _split_reply(text: str, limit: int = REPLY_CHUNK_CHARS) -> List[str]:
    """按换行、空格、硬切三个优先级分块，保证每块不超过 Uta 的单条上限。"""
    if len(text) <= limit:
        return [text]
    chunks: List[str] = []
    remaining = text
    while remaining:
        if len(remaining) <= limit:
            chunks.append(remaining)
            break
        window = remaining[:limit]
        cut = window.rfind("\n")
        if cut < limit // 2:
            cut = window.rfind(" ")
        if cut < limit // 2:
            cut = limit
        chunks.append(remaining[:cut])
        remaining = remaining[cut:]
        if remaining.startswith("\n") or remaining.startswith(" "):
            remaining = remaining[1:]
    return [chunk for chunk in chunks if chunk.strip()]


def _is_loopback_host(host: str) -> bool:
    return host.strip().lower() in {"127.0.0.1", "localhost", "::1"}


def _appdata_dir() -> str:
    appdata = os.environ.get("APPDATA", "").strip()
    if appdata:
        return appdata
    home = os.path.expanduser("~")
    if sys.platform == "darwin":
        return os.path.join(home, "Library", "Application Support")
    return os.environ.get("XDG_CONFIG_HOME", os.path.join(home, ".config"))


def _endpoint_candidates(override: str) -> List[str]:
    if override and override.strip():
        return [override.strip()]
    for env_name in ("UTA_ENDPOINT_FILE", "DESKPET_ENDPOINT_FILE"):
        value = os.environ.get(env_name, "").strip()
        if value:
            return [value]
    appdata = _appdata_dir()
    return [
        os.path.join(appdata, "uta", "host-pets", UTA_HOST_ID, "runtime-endpoint.json"),
        os.path.join(appdata, "uta", "runtime-endpoint.json"),
    ]


class _NoRuntimeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        return None


# 保持运行时令牌留在指定的回环端点。
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRuntimeRedirect())


def _http_json(
    method: str,
    url: str,
    token: str,
    payload: Optional[Dict[str, Any]] = None,
    timeout: float = HTTP_TIMEOUT_SECONDS,
) -> Tuple[int, Dict[str, Any]]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    data: Optional[bytes] = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with _OPENER.open(request, timeout=timeout) as response:
            raw = response.read(1024 * 1024)
            parsed = json.loads(raw.decode("utf-8")) if raw else {}
            return int(response.status), parsed if isinstance(parsed, dict) else {}
    except urllib.error.HTTPError as exc:
        try:
            raw = exc.read(256 * 1024)
            parsed = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            parsed = {}
        finally:
            exc.close()
        return int(exc.code), parsed if isinstance(parsed, dict) else {}


class UtaRuntimeClient:
    """向 Uta 运行时桥发送 v2 指令；找不到端点时静默降级。"""

    def __init__(
        self,
        endpoint_file: str = "",
        logger: Optional[logging.Logger] = None,
        timeout: float = HTTP_TIMEOUT_SECONDS,
    ) -> None:
        self.endpoint_file = endpoint_file
        self.logger = logger or logging.getLogger("uta.maibot-adapter")
        self.timeout = max(1.0, float(timeout))
        self.instance_id = uuid.uuid4().hex
        self._last_bind_warning = 0.0

    def read_endpoint(self) -> Optional[Dict[str, Any]]:
        for path in _endpoint_candidates(self.endpoint_file):
            try:
                if not os.path.isfile(path):
                    continue
                with open(path, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            port = data.get("port")
            token = data.get("token")
            if isinstance(port, int) and 0 < port < 65536 and isinstance(token, str) and token:
                data["endpointFile"] = path
                return data
        return None

    def has_endpoint(self) -> bool:
        return self.read_endpoint() is not None

    def _envelope(
        self,
        command: Dict[str, Any],
        event_id: str,
        session_id: str = RUNTIME_SESSION,
    ) -> Dict[str, Any]:
        return {
            "protocolVersion": RUNTIME_PROTOCOL_VERSION,
            "meta": {
                "hostId": UTA_HOST_ID,
                "hostInstanceId": self.instance_id,
                "sessionId": session_id,
                "eventId": event_id,
                "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            },
            "command": command,
        }

    async def send_command(
        self,
        command: Dict[str, Any],
        event_id: str,
        session_id: str = RUNTIME_SESSION,
        route: str = "/command",
        target: Optional[Dict[str, Any]] = None,
    ) -> bool:
        envelope = self._envelope(command, event_id, session_id)
        for attempt in range(2):
            endpoint = target if target is not None else self.read_endpoint()
            if not endpoint:
                return False
            url = f"http://127.0.0.1:{endpoint['port']}{route}"
            try:
                status, body = await asyncio.to_thread(
                    _http_json,
                    "POST",
                    url,
                    endpoint["token"],
                    envelope,
                    self.timeout,
                )
            except Exception as exc:
                self.logger.debug(f"[Uta] 运行时请求失败: {exc}")
                status, body = 0, {}
            if status == 0 and attempt == 0:
                continue
            if status == 401 and attempt == 0:
                continue
            if status == 403:
                self._warn_binding()
                return False
            if status == 200 and body.get("ok") is True and body.get("accepted", True) is not False:
                return True
            if status == 503:
                self.logger.debug("[Uta] 桌宠窗口当前不可用，跳过本条指令")
                return False
            self.logger.debug(f"[Uta] 指令被拒绝: status={status} body={body}")
            return False
        return False

    async def read_model_context(self, target: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        try:
            status, body = await asyncio.to_thread(
                _http_json, "GET", f"http://127.0.0.1:{target['port']}/context?hostId=maibot",
                target["token"], None, self.timeout,
            )
        except (OSError, ValueError):
            return None
        model = body.get("modelContext")
        if status != 200 or body.get("characterAvailable") is not True or not isinstance(model, dict):
            return None
        if model.get("ready") is not True or not isinstance(model.get("revision"), str) or not model["revision"]:
            return None
        return model

    def _warn_binding(self) -> None:
        now = time.monotonic()
        if now - self._last_bind_warning < 60.0:
            return
        self._last_bind_warning = now
        self.logger.warning(
            "[Uta] 桌宠没有绑定到「MaiBot 适配器」，运行时拒绝了指令。"
            "请在 Uta 设置 → 连接 → 宿主中选择 MaiBot 并绑定。"
        )

    async def hello(self) -> bool:
        return await self.send_command(
            {
                "command": "hello",
                "sdkVersion": f"uta-maibot-adapter/{PLUGIN_VERSION}",
                "capabilities": [
                    "statusEvents",
                    "assistantText",
                    "streamingReply",
                    "sessionBinding",
                    "characterTools",
                ],
                "label": "MaiBot",
            },
            event_id=f"hello-{self.instance_id[:16]}",
        )

    async def agent_state(
        self,
        state: str,
        *,
        event_id: Optional[str] = None,
        session_id: str = RUNTIME_SESSION,
        label: str = "",
        target: Optional[Dict[str, Any]] = None,
    ) -> bool:
        command: Dict[str, Any] = {"command": "agent_state", "state": state}
        if label:
            command["label"] = label[:80]
        return await self.send_command(
            command,
            event_id=event_id or f"state-{uuid.uuid4().hex}",
            session_id=session_id,
            target=target,
        )

    async def send_reply(self, message_id: str, text: str, images: Optional[List[Dict[str, str]]] = None,
                         *, target: Optional[Dict[str, Any]] = None) -> bool:
        cleaned = _clean_text(text, MAX_REPLY_CHARS)
        if not cleaned and not images:
            return True
        target = target if target is not None else self.read_endpoint()
        if target is None:
            return False
        request_id = "mb-" + hashlib.sha256(message_id.encode("utf-8")).hexdigest()[:24]
        chunks = _split_reply(cleaned) if cleaned else []
        for index, chunk in enumerate(chunks):
            ok = await self.send_command(
                {
                    "command": "rp_reply",
                    "text": chunk,
                    "streaming": True,
                    "done": False,
                    "requestId": request_id,
                },
                event_id=f"{request_id}-{index}",
                target=target,
            )
            if not ok:
                return False
        text_delivered = bool(chunks) and await self.send_command(
            {"command": "rp_reply", "text": "", "streaming": True, "done": True, "requestId": request_id},
            event_id=f"{request_id}-end",
            target=target,
        )
        images_delivered = True
        any_delivered = text_delivered
        for index, image in enumerate(images or []):
            delivered = await self.send_command(
                {"command": "chat_image", **image}, event_id=f"{request_id}-image-{index}", route="/maibot-media",
                target=target,
            )
            images_delivered = images_delivered and delivered
            any_delivered = any_delivered or delivered
        if any_delivered:
            await self.agent_state(
                "completed",
                event_id=f"{request_id}-complete",
                target=target,
            )
        return (not chunks or text_delivered) and images_delivered


class UtaWebhookServer:
    """给 Uta 内置 MaiBot 适配器使用的本机回环 HTTP 入口。"""

    def __init__(
        self,
        plugin: "UtaMaiBotAdapter",
        host: str,
        port: int,
        logger: logging.Logger,
    ) -> None:
        self.plugin = plugin
        self.host = host
        self.port = port
        self.logger = logger
        self._server: Optional[asyncio.AbstractServer] = None

    @property
    def address(self) -> Tuple[str, int]:
        return self.host, self.port

    async def start(self) -> None:
        self._server = await asyncio.start_server(
            self._handle_client,
            self.host,
            self.port,
            limit=MAX_HEADER_BYTES,
        )
        sockets = self._server.sockets or []
        if sockets:
            self.port = int(sockets[0].getsockname()[1])
        self.logger.info(f"[Uta] 本机入口已监听 http://{self.host}:{self.port}")

    async def stop(self) -> None:
        server = self._server
        self._server = None
        if server is None:
            return
        server.close()
        try:
            await asyncio.wait_for(server.wait_closed(), timeout=2.0)
        except Exception:
            pass

    def _authenticated_endpoint(self, authorization: str) -> Optional[Dict[str, Any]]:
        if not authorization.startswith("Bearer ") or self.plugin._uta is None:
            return None
        endpoint = self.plugin._uta.read_endpoint()
        if endpoint is None:
            return None
        expected = hmac.new(endpoint["token"].encode("utf-8"), AUTH_CONTEXT, hashlib.sha256).hexdigest()
        return endpoint if hmac.compare_digest(authorization[7:].encode("utf-8"), expected.encode("ascii")) else None

    async def _handle_client(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        try:
            header_bytes = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=5.0)
            header_text = header_bytes.decode("utf-8", errors="replace")
            lines = header_text.split("\r\n")
            request_line = lines[0].strip().split() if lines else []
            if len(request_line) < 2:
                await self._send(writer, 400, {"ok": False, "error": "bad request"})
                return
            method = request_line[0].upper()
            path = request_line[1].split("?")[0]

            headers: Dict[str, str] = {}
            for line in lines[1:]:
                if ":" in line:
                    key, value = line.split(":", 1)
                    headers[key.strip().lower()] = value.strip()

            if method == "OPTIONS":
                await self._send(writer, 204, {}, extra_headers={"Access-Control-Max-Age": "600"})
                return

            target = None
            if path == READY_PATH or path in WRITE_PATHS:
                target = self._authenticated_endpoint(headers.get("authorization", ""))
                if target is None:
                    await self._send(writer, 401, {"ok": False, "error": "unauthorized"})
                    return

            try:
                content_length = int(headers.get("content-length", "0") or "0")
            except ValueError:
                await self._send(writer, 400, {"ok": False, "error": "invalid content-length"})
                return
            if content_length < 0 or content_length > MAX_BODY_BYTES:
                await self._send(writer, 413, {"ok": False, "error": "payload too large"})
                return
            body_bytes = b""
            if content_length:
                body_bytes = await asyncio.wait_for(reader.readexactly(content_length), timeout=15.0)

            status, payload = await self._dispatch(method, path, body_bytes, target)
            await self._send(writer, status, payload)
        except Exception as exc:
            self.logger.debug(f"[Uta] HTTP 请求处理失败: {exc}")
            try:
                await self._send(writer, 500, {"ok": False, "error": "internal error"})
            except Exception:
                pass
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

    async def _send(
        self,
        writer: asyncio.StreamWriter,
        status: int,
        payload: Dict[str, Any],
        *,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> None:
        reason = {
            200: "OK",
            204: "No Content",
            400: "Bad Request",
            401: "Unauthorized",
            404: "Not Found",
            405: "Method Not Allowed",
            413: "Payload Too Large",
            500: "Internal Server Error",
            503: "Service Unavailable",
        }.get(status, "OK")
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload else b""
        headers = [
            f"HTTP/1.1 {status} {reason}",
            "Access-Control-Allow-Origin: *",
            "Access-Control-Allow-Methods: GET, POST, OPTIONS",
            "Access-Control-Allow-Headers: Content-Type",
            "Cache-Control: no-store",
            "Connection: close",
            f"Content-Length: {len(body)}",
        ]
        if payload:
            headers.append("Content-Type: application/json; charset=utf-8")
        for key, value in (extra_headers or {}).items():
            headers.append(f"{key}: {value}")
        writer.write("\r\n".join(headers).encode("utf-8") + b"\r\n\r\n" + body)
        await writer.drain()

    async def _dispatch(
        self,
        method: str,
        path: str,
        body_bytes: bytes,
        target: Optional[Dict[str, Any]],
    ) -> Tuple[int, Dict[str, Any]]:
        if path == "/health":
            if method != "GET":
                return 405, {"ok": False, "error": "method not allowed"}
            return 200, self.plugin.health_payload()

        if path == READY_PATH:
            if method != "GET":
                return 405, {"ok": False, "error": "method not allowed"}
            ready = self.plugin._active and self.plugin._gateway_ready
            return (200 if ready else 503), {"ok": ready}

        if path not in WRITE_PATHS:
            return 404, {"ok": False, "error": "not found"}
        if method != "POST":
            return 405, {"ok": False, "error": "method not allowed"}
        if target is None:
            return 401, {"ok": False, "error": "unauthorized"}

        try:
            payload = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except Exception:
            return 400, {"ok": False, "error": "invalid json"}
        if not isinstance(payload, dict):
            return 400, {"ok": False, "error": "body must be an object"}

        if path == TEXT_PATH:
            text = _clean_text(payload.get("text"), MAX_INPUT_CHARS)
            if not text:
                return 400, {"ok": False, "error": "text is required"}
            routed = await self.plugin.inject_text(text, str(payload.get("request_id") or ""), target)
            if not routed:
                return 503, {"ok": False, "error": "MaiBot 消息网关未就绪"}
            return 200, {"ok": True, "routed": True}

        if path == SCREENSHOT_PATH:
            image = payload.get("image")
            if not isinstance(image, str) or not image.strip():
                return 400, {"ok": False, "error": "image is required"}
            try:
                routed = await self.plugin.inject_screenshot(image, target)
            except ValueError as exc:
                return 400, {"ok": False, "error": str(exc)}
            if not routed:
                return 503, {"ok": False, "error": "MaiBot 消息网关未就绪"}
            return 200, {"ok": True, "routed": True}

        self.plugin.update_model_context(
            payload.get("emotions"),
            payload.get("controls"),
            payload.get("presets"),
        )
        return 200, {"ok": True}


class UtaMaiBotAdapter(MaiBotPlugin):
    """MaiBot 侧的双向桥：Uta 私聊输入 + 运行时状态/回复。"""

    config_model = UtaAdapterConfig

    def __init__(self) -> None:
        super().__init__()
        self._active = False
        self._gateway_ready = False
        self._webhook: Optional[UtaWebhookServer] = None
        self._uta: Optional[UtaRuntimeClient] = None
        self._bg_tasks: set[asyncio.Task[Any]] = set()
        self._model_emotions: List[str] = []
        self._model_controls: List[Dict[str, str]] = []
        self._model_presets: List[Dict[str, str]] = []
        self._reply_targets: Dict[str, Dict[str, Any]] = {}
        self._input_targets: Dict[str, Dict[str, Any]] = {}

    def _log(self) -> logging.Logger:
        try:
            return self.ctx.logger
        except Exception:
            return logging.getLogger("uta.maibot-adapter")

    def get_components(self) -> List[Dict[str, Any]]:
        components = super().get_components()
        for component in components:
            if component["type"] == "TOOL":
                # MaiBot reads scope from the declaration, outside the SDK's nested metadata.
                component["chat_scope"] = "private"
                component["metadata"]["platforms"] = [PLATFORM]
        return components

    def _spawn(self, coro: Any) -> None:
        try:
            task = asyncio.create_task(coro)
        except RuntimeError:
            return
        self._bg_tasks.add(task)
        task.add_done_callback(self._bg_tasks.discard)

    def _build_uta_client(self) -> UtaRuntimeClient:
        return UtaRuntimeClient(
            endpoint_file=self.config.runtime.endpoint_file,
            logger=self._log(),
            timeout=self.config.runtime.timeout_seconds,
        )

    async def _set_gateway_ready(self, ready: bool) -> bool:
        try:
            await self.ctx.gateway.update_state(
                GATEWAY_NAME,
                ready=ready,
                platform=PLATFORM,
                account_id=ACCOUNT_ID,
                scope=SCOPE,
                metadata={"protocol": "uta-local"},
            )
            self._gateway_ready = ready
            return True
        except Exception as exc:
            self._gateway_ready = False
            self._log().warning(f"[Uta] 无法更新消息网关状态: {exc}")
            return False

    async def on_load(self) -> None:
        self._active = True
        self._uta = self._build_uta_client()
        host = self.config.bridge.host
        if not _is_loopback_host(host):
            host = "127.0.0.1"
        port = int(self.config.bridge.port)
        self._webhook = UtaWebhookServer(self, host, port, self._log())
        try:
            await self._webhook.start()
        except Exception as exc:
            self._webhook = None
            self._log().error(
                f"[Uta] 无法监听 {host}:{port}：{exc}。"
                "请关闭占用该端口的程序，或在插件配置里改端口，并在 Uta 设置里同步修改服务地址。"
            )
        await self._set_gateway_ready(True)
        self._spawn(self._uta.hello())

    async def on_unload(self) -> None:
        self._active = False
        self._reply_targets.clear()
        self._input_targets.clear()
        for task in list(self._bg_tasks):
            task.cancel()
        self._bg_tasks.clear()
        if self._webhook is not None:
            await self._webhook.stop()
            self._webhook = None
        await self._set_gateway_ready(False)
        self._uta = None

    async def on_config_update(self, scope: str, config_data: Dict[str, Any], version: str) -> None:
        del config_data, version
        if scope != "self" or not self._active:
            return
        host = self.config.bridge.host if _is_loopback_host(self.config.bridge.host) else "127.0.0.1"
        port = int(self.config.bridge.port)
        if self._webhook is not None and self._webhook.address == (host, port):
            self._uta = self._build_uta_client()
            return
        if self._webhook is not None:
            await self._webhook.stop()
        self._webhook = UtaWebhookServer(self, host, port, self._log())
        try:
            await self._webhook.start()
        except Exception as exc:
            self._webhook = None
            self._log().error(f"[Uta] 无法在 {host}:{port} 重启入口: {exc}")
        self._uta = self._build_uta_client()

    def health_payload(self) -> Dict[str, Any]:
        runtime = self._uta.has_endpoint() if self._uta is not None else False
        return {
            "ok": True,
            "service": "maibot-adapter",
            "version": PLUGIN_VERSION,
            "platform": PLATFORM,
            "gatewayReady": bool(self._active and self._gateway_ready),
            "runtimeEndpoint": runtime,
            "emotions": len(self._model_emotions),
            "controls": len(self._model_controls),
            "presets": len(self._model_presets),
        }

    def _build_message(
        self,
        components: List[Dict[str, Any]],
        request_id: str,
        target: Dict[str, Any],
    ) -> Dict[str, Any]:
        nickname = _clean_text(self.config.chat.user_nickname, 40) or "桌宠主人"
        message_id = f"uta-{uuid.uuid4().hex}"
        # MaiBot returns the target user id even for outbound messages with no reply anchor.
        scope = target.get("profileId")
        if isinstance(scope, str) and re.fullmatch(r"[0-9a-f]{64}", scope):
            user_id = USER_ID if target.get("stableData") is True else f"{USER_ID}-{scope[:32]}"
        else:
            identity = hmac.new(target["token"].encode("utf-8"), b"uta:maibot:recipient:v1", hashlib.sha256).hexdigest()[:32]
            user_id = f"{USER_ID}-{identity}"
        self._reply_targets.pop(user_id, None)
        self._reply_targets[user_id] = dict(target)
        if len(self._reply_targets) > 32:
            self._reply_targets.pop(next(iter(self._reply_targets)))
        self._input_targets[message_id] = dict(target)
        if len(self._input_targets) > 512:
            self._input_targets.pop(next(iter(self._input_targets)))
        return {
            "message_id": message_id,
            "timestamp": f"{time.time():.3f}",
            "platform": PLATFORM,
            "account_id": ACCOUNT_ID,
            "scope": SCOPE,
            "message_info": {
                "user_info": {
                    "user_id": user_id,
                    "user_nickname": nickname,
                    "user_cardname": None,
                },
                "group_info": None,
                "additional_config": {"uta_request_id": request_id[:64]},
            },
            "raw_message": components,
            "is_mentioned": False,
            "is_at": False,
            "is_emoji": False,
            "is_picture": len(components) > 0 and components[0].get("type") == "image",
            "is_command": False,
            "is_notify": False,
            "session_id": "",
        }

    async def _ensure_gateway_ready(self) -> bool:
        if self._gateway_ready:
            return True
        return await self._set_gateway_ready(True)

    async def inject_text(self, text: str, request_id: str, target: Dict[str, Any]) -> bool:
        if not self._active or not await self._ensure_gateway_ready():
            return False
        message = self._build_message([{"type": "text", "data": text}], request_id, target)
        try:
            accepted = await self.ctx.gateway.route_message(
                GATEWAY_NAME,
                message,
                external_message_id=message["message_id"],
                dedupe_key=request_id or message["message_id"],
            )
        except Exception as exc:
            self._log().warning(f"[Uta] 注入消息失败: {exc}")
            return False
        return bool(accepted)

    async def inject_screenshot(self, image: str, target: Dict[str, Any]) -> bool:
        if not self._active or not await self._ensure_gateway_ready():
            return False
        value = image.strip()
        if value.startswith("data:") and "," in value:
            value = value.split(",", 1)[1]
        try:
            binary = base64.b64decode(value, validate=False)
        except Exception as exc:
            raise ValueError("image must be base64") from exc
        if not binary:
            raise ValueError("image is empty")
        if len(binary) > MAX_IMAGE_BYTES:
            raise ValueError("image is too large")
        component = {
            "type": "image",
            "data": "",
            "hash": hashlib.sha256(binary).hexdigest(),
            "binary_data_base64": base64.b64encode(binary).decode("ascii"),
        }
        message = self._build_message([component], "", target)
        try:
            accepted = await self.ctx.gateway.route_message(
                GATEWAY_NAME,
                message,
                external_message_id=message["message_id"],
                dedupe_key=message["message_id"],
            )
        except Exception as exc:
            self._log().warning(f"[Uta] 注入截图失败: {exc}")
            return False
        return bool(accepted)

    def update_model_context(
        self,
        emotions: Any,
        controls: Any,
        presets: Any,
    ) -> None:
        if isinstance(emotions, list):
            self._model_emotions = [
                _clean_text(item, 32) for item in emotions if _clean_text(item, 32)
            ][:64]
        if isinstance(controls, list):
            self._model_controls = [
                {
                    "id": _clean_text(item.get("id"), 64),
                    "label": _clean_text(item.get("label"), 64),
                }
                for item in controls
                if isinstance(item, dict) and _clean_text(item.get("id"), 64)
            ][:200]
        if isinstance(presets, list):
            self._model_presets = [
                {
                    "id": _clean_text(item.get("id"), 64),
                    "label": _clean_text(item.get("label"), 64),
                }
                for item in presets
                if isinstance(item, dict) and _clean_text(item.get("id"), 64)
            ][:200]

    def _tool_scope_error(self, context: Dict[str, Any]) -> str:
        if context.get("platform") != PLATFORM or context.get("group_id"):
            return "此工具只在 Uta 私聊中可用。"
        if not self._active or self._uta is None:
            return "Uta 适配器尚未连接。"
        if str(context.get("user_id") or "") not in self._reply_targets:
            return "当前私聊的 Uta 实例已失效，请在目标桌宠重新发起会话。"
        return ""

    async def _run_character_tool(
        self, operation: str, name: str, context: Dict[str, Any], *, loop: bool = False,
    ) -> Dict[str, Any]:
        error = self._tool_scope_error(context)
        runtime = self._uta
        if error or runtime is None:
            return {"success": False, "error": error}
        target = self._reply_targets.get(str(context.get("user_id") or ""))
        model = await runtime.read_model_context(target) if target else None
        if not target or not model or self._uta is not runtime or not self._active:
            return {"success": False, "error": "Uta 未配对、角色未就绪或模型正在切换。"}

        emotions = {item.casefold(): item for item in model.get("emotions", [])}
        animations = {item.casefold(): item for item in model.get("animations", [])}
        groups = model.get("presetGroups", [])
        presets = {item.casefold(): item for group in groups for item in [group["group"], *group["presets"]]}
        if operation == "list":
            capabilities = {
                "model": model["modelName"], "emotions": list(emotions.values()),
                "preset_groups": groups, "animations": list(animations.values()),
            }
            return {"success": True, "content": json.dumps(capabilities, ensure_ascii=False), **capabilities}

        key = _clean_text(name, 120).casefold()
        if operation == "animation" and key in animations:
            command = {"command": "play_animation", "name": animations[key], "loop": loop is True}
        elif operation == "emotion" and key in emotions:
            command = {"command": "set_emotion", "emotion": emotions[key]}
        elif operation in {"emotion", "preset"} and key in presets:
            command = {"command": "set_preset", "preset": presets[key], "mode": "revert"}
        else:
            return {"success": False, "error": "当前模型没有这个情绪、预设或动作，请先查询 Uta 模型能力。"}

        if not await runtime.send_command(
            {**command, "modelRevision": model["revision"]}, f"tool-{uuid.uuid4().hex}", target=target,
        ):
            return {"success": False, "error": "Uta 未接受指令，请检查连接并重新查询当前模型能力。"}
        return {"success": True, "content": "Uta 已接收角色指令。"}

    @Tool(
        "uta_deskpet_get_capabilities",
        description="查看当前 Uta 角色支持的情绪、预设分组和动作名称。",
    )
    async def tool_get_capabilities(self, **context: Any) -> Dict[str, Any]:
        return await self._run_character_tool("list", "", context)

    @Tool(
        "uta_deskpet_set_emotion",
        description="让 Uta 表现指定情绪。可使用当前模型的基础情绪或命名预设。",
        parameters=[ToolParameterInfo(name="emotion", param_type=ToolParamType.STRING, description="情绪或预设名称", required=True)],
    )
    async def tool_set_emotion(self, emotion: str, **context: Any) -> Dict[str, Any]:
        return await self._run_character_tool("emotion", emotion, context)

    @Tool(
        "uta_deskpet_set_preset",
        description="让 Uta 播放当前模型的预设分组或具体预设，结束后恢复原状态。",
        parameters=[ToolParameterInfo(name="preset", param_type=ToolParamType.STRING, description="预设或分组名称", required=True)],
    )
    async def tool_set_preset(self, preset: str, **context: Any) -> Dict[str, Any]:
        return await self._run_character_tool("preset", preset, context)

    @Tool(
        "uta_deskpet_play_animation",
        description="播放当前 Uta 模型支持的动作。默认播放一次。",
        parameters=[
            ToolParameterInfo(name="animation", param_type=ToolParamType.STRING, description="动作名称", required=True),
            ToolParameterInfo(name="loop", param_type=ToolParamType.BOOLEAN, description="是否循环播放", required=False),
        ],
    )
    async def tool_play_animation(self, animation: str, loop: bool = False, **context: Any) -> Dict[str, Any]:
        return await self._run_character_tool("animation", animation, context, loop=loop)

    @Tool(
        "uta_deskpet_send_emoji",
        description="从 MaiBot 的表情包库按描述查找，发送到 Uta 私聊的气泡和消息记录。",
        parameters=[ToolParameterInfo(name="description", param_type=ToolParamType.STRING, description="表情包描述", required=True)],
    )
    async def tool_send_emoji(self, description: str, **context: Any) -> Dict[str, Any]:
        error = self._tool_scope_error(context)
        runtime = self._uta
        if error or runtime is None:
            return {"success": False, "error": error}
        target = self._reply_targets.get(str(context.get("user_id") or ""))
        if not target:
            return {"success": False, "error": "找不到已配对的 Uta。"}
        query = _clean_text(description, 160)
        if not query:
            return {"success": False, "error": "请输入表情包描述。"}
        try:
            result = await self.ctx.emoji.get_by_description(query)
            if not isinstance(result, dict) or result.get("success") is not True:
                return {"success": False, "error": "MaiBot 表情包库查询失败。"}
            emoji = result.get("emoji")
            if not emoji:
                fallback = await self.ctx.emoji.get_random(count=1)
                candidates = fallback.get("emojis", []) if isinstance(fallback, dict) else []
                emoji = candidates[0] if candidates else None
        except Exception:
            return {"success": False, "error": "MaiBot 表情包库不可用。"}
        if not isinstance(emoji, dict):
            return {"success": False, "error": "MaiBot 表情包库没有可发送的图片。"}
        images = _extract_reply_images({"raw_message": [{
            "type": "emoji", "binary_data_base64": emoji.get("base64"), "description": emoji.get("description"),
        }]})
        if not images:
            return {"success": False, "error": "表情包为空或超过 1 MiB。"}
        if self._uta is not runtime or not self._active:
            return {"success": False, "error": "Uta 配对已变化，请重试。"}
        if not await runtime.send_command(
            {"command": "chat_image", **images[0]}, f"tool-image-{uuid.uuid4().hex}",
            route="/maibot-media", target=target,
        ):
            return {"success": False, "error": "Uta 未接收表情包，请检查配对或图片格式。"}
        return {"success": True, "content": "Uta 已接收表情包。"}

    @HookHandler(
        "chat.receive.before_process",
        name="uta_inbound_state",
        mode=HookMode.OBSERVE,
        order=HookOrder.EARLY,
        error_policy=ErrorPolicy.LOG,
    )
    async def observe_inbound(self, message: Optional[Dict[str, Any]] = None, **kwargs: Any) -> None:
        del kwargs
        if not self._active or not isinstance(message, dict) or self._uta is None:
            return
        platform = str(message.get("platform") or "")
        if platform != PLATFORM and not self.config.chat.reflect_all_chats:
            return
        info = message.get("message_info") or {}
        user = info.get("user_info") or {}
        target = self._reply_targets.get(str(user.get("user_id") or "")) if platform == PLATFORM else None
        if platform == PLATFORM and target is None:
            return
        message_id = str(message.get("message_id") or uuid.uuid4().hex)
        event_id = "think-" + hashlib.sha256(message_id.encode("utf-8")).hexdigest()[:24]
        self._spawn(
            self._uta.agent_state(
                "thinking",
                event_id=event_id,
                label="MaiBot",
                target=target,
            )
        )

    @MessageGateway(
        "duplex",
        name=GATEWAY_NAME,
        platform=PLATFORM,
        account_id=ACCOUNT_ID,
        scope=SCOPE,
        description="Uta 桌面宠物双向消息网关",
    )
    async def uta_gateway(
        self,
        message: Optional[Dict[str, Any]] = None,
        route: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        del route, metadata, kwargs
        if not isinstance(message, dict):
            return {"success": True}
        message_id = str(message.get("message_id") or uuid.uuid4().hex)
        text = _extract_message_text(message)
        images = _extract_reply_images(message)
        delivered = not (text or images)
        if (text or images) and self._active and self._uta is not None:
            info = message.get("message_info") or {}
            additional = info.get("additional_config") or {}
            user_id = str(additional.get("platform_io_target_user_id") or "")
            reply_to = str(message.get("reply_to") or "")
            target = self._input_targets.get(reply_to) if reply_to else self._reply_targets.get(user_id)
            if target is not None:
                delivered = await self._uta.send_reply(message_id, text, images, target=target)
        return {
            "success": bool(delivered),
            "external_message_id": message_id,
            "metadata": {"utaDelivered": bool(delivered)},
        }


def create_plugin() -> UtaMaiBotAdapter:
    return UtaMaiBotAdapter()
