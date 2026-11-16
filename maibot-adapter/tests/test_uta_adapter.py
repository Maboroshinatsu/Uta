"""Uta-MaiBot 适配器单元测试。

运行方式（使用 MaiBot 自带的 Python 环境，确保加载真实 maibot_sdk）：
    D:/Frankenstein/MaiBot/.venv/Scripts/python.exe -m unittest discover -s tests -v
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import plugin as adapter  # noqa: E402


class FakeLogger:
    def __init__(self) -> None:
        self.records: List[tuple[str, str]] = []

    def debug(self, message: str, *args: Any, **kwargs: Any) -> None:
        self.records.append(("debug", str(message)))

    def info(self, message: str, *args: Any, **kwargs: Any) -> None:
        self.records.append(("info", str(message)))

    def warning(self, message: str, *args: Any, **kwargs: Any) -> None:
        self.records.append(("warning", str(message)))

    def error(self, message: str, *args: Any, **kwargs: Any) -> None:
        self.records.append(("error", str(message)))

    def messages(self, level: str) -> List[str]:
        return [text for kind, text in self.records if kind == level]


class FakeGateway:
    def __init__(self) -> None:
        self.states: List[Dict[str, Any]] = []
        self.routed: List[Dict[str, Any]] = []

    async def update_state(self, name: str, **kwargs: Any) -> bool:
        self.states.append({"name": name, **kwargs})
        return True

    async def route_message(
        self,
        name: str,
        message: Dict[str, Any],
        **kwargs: Any,
    ) -> bool:
        self.routed.append({"name": name, "message": message, **kwargs})
        return True


class FakeContext:
    def __init__(self) -> None:
        self.logger = FakeLogger()
        self.gateway = FakeGateway()


def make_plugin() -> adapter.UtaMaiBotAdapter:
    plugin = adapter.create_plugin()
    plugin.set_plugin_config(plugin.build_default_config())
    plugin._set_context(FakeContext())
    return plugin


class FakeRuntime:
    def __init__(self) -> None:
        self.states: List[str] = []
        self.replies: List[tuple[str, str]] = []
        self.images: List[Dict[str, str]] = []

    async def agent_state(self, state: str, **kwargs: Any) -> bool:
        self.states.append(state)
        return True

    async def send_reply(self, message_id: str, text: str, images: List[Dict[str, str]], *, target: Dict[str, Any]) -> bool:
        self.replies.append((message_id, text))
        self.images.extend(images)
        return True


class RuntimeHandler(BaseHTTPRequestHandler):
    server_version = "FakeUta/1.0"

    def do_GET(self) -> None:  # noqa: N802
        if getattr(self.server, "redirect_context", False):
            self.server.queries.append((self.path, self.headers.get("Authorization")))  # type: ignore[attr-defined]
            self.send_response(307)
            self.send_header("Location", "/different-target")
            self.end_headers()
            return
        if self.path != "/context?hostId=maibot":
            self._reply(200, {"ok": True})
            return
        self.server.queries.append((self.path, self.headers.get("Authorization")))  # type: ignore[attr-defined]
        if self.server.deny:  # type: ignore[attr-defined]
            self._reply(403, {"ok": False})
            return
        self._reply(200, {
            "ok": True, "characterAvailable": True, "modelContext": self.server.model_context,  # type: ignore[attr-defined]
        })

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            payload = {}
        self.server.requests.append(  # type: ignore[attr-defined]
            {
                "path": self.path,
                "auth": self.headers.get("Authorization", ""),
                "payload": payload,
            }
        )
        if self.server.deny:  # type: ignore[attr-defined]
            self._reply(403, {"ok": False, "error": "host-not-bound"})
            return
        self._reply(200, {"ok": True, "accepted": True})

    def _reply(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: Any) -> None:
        pass


class FakeUtaServer:
    def __init__(self) -> None:
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), RuntimeHandler)
        self.httpd.requests = []  # type: ignore[attr-defined]
        self.httpd.deny = False  # type: ignore[attr-defined]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def port(self) -> int:
        return int(self.httpd.server_address[1])

    @property
    def requests(self) -> List[Dict[str, Any]]:
        return self.httpd.requests  # type: ignore[attr-defined]

    def deny(self, enabled: bool) -> None:
        self.httpd.deny = enabled  # type: ignore[attr-defined]

    def start(self) -> "FakeUtaServer":
        self.thread.start()
        return self

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2.0)


def synthetic_endpoint(port: int, token: str = "test-token") -> Dict[str, Any]:
    return {"version": 2, "port": port, "token": token, "profile": "test"}


class ConfigTest(unittest.TestCase):
    def test_default_config_is_local_and_quiet(self) -> None:
        config = adapter.UtaAdapterConfig()
        self.assertEqual(config.bridge.host, "127.0.0.1")
        self.assertEqual(config.bridge.port, 8524)
        self.assertFalse(config.chat.reflect_all_chats)
        self.assertEqual(config.runtime.endpoint_file, "")

    def test_loopback_guard(self) -> None:
        self.assertTrue(adapter._is_loopback_host("127.0.0.1"))
        self.assertTrue(adapter._is_loopback_host("localhost"))
        self.assertFalse(adapter._is_loopback_host("0.0.0.0"))
        self.assertFalse(adapter._is_loopback_host("192.168.1.2"))

    def test_reply_split_respects_limit(self) -> None:
        text = "鲸鱼" * 600
        chunks = adapter._split_reply(text, 480)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= 480 for chunk in chunks))
        self.assertEqual("".join(chunks), text)


class EndpointDiscoveryTest(unittest.TestCase):
    def test_explicit_targets_do_not_fall_back_to_shared_endpoints(self) -> None:
        with mock.patch.dict(
            os.environ,
            {"APPDATA": "C:/fake-appdata", "UTA_ENDPOINT_FILE": "C:/env-endpoint.json"},
            clear=False,
        ):
            self.assertEqual(adapter._endpoint_candidates("C:/override.json"), ["C:/override.json"])
            self.assertEqual(adapter._endpoint_candidates(""), ["C:/env-endpoint.json"])
        with mock.patch.dict(os.environ, {"APPDATA": "C:/fake-appdata"}, clear=True):
            candidates = adapter._endpoint_candidates("")
        host_endpoint = os.path.join(
            "C:/fake-appdata", "uta", "host-pets", "maibot", "runtime-endpoint.json"
        )
        root_endpoint = os.path.join("C:/fake-appdata", "uta", "runtime-endpoint.json")
        self.assertEqual(candidates, [host_endpoint, root_endpoint])

    def test_read_endpoint_accepts_only_valid_port_and_token(self) -> None:
        payload = json.dumps({"port": 49152, "token": "secret-token"})
        with mock.patch.object(adapter.os.path, "isfile", side_effect=lambda path: path == "C:/endpoint.json"), \
                mock.patch("builtins.open", mock.mock_open(read_data=payload)):
            client = adapter.UtaRuntimeClient("C:/endpoint.json")
            endpoint = client.read_endpoint()
        self.assertIsNotNone(endpoint)
        self.assertEqual(endpoint["port"], 49152)
        self.assertEqual(endpoint["token"], "secret-token")

        with mock.patch.object(adapter.os.path, "isfile", side_effect=lambda path: path == "C:/endpoint.json"), \
                mock.patch("builtins.open", mock.mock_open(read_data=json.dumps({"port": "nope", "token": ""}))):
            client = adapter.UtaRuntimeClient("C:/endpoint.json")
            self.assertIsNone(client.read_endpoint())


class RuntimeClientTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.server = FakeUtaServer().start()
        self.logger = FakeLogger()

    async def asyncTearDown(self) -> None:
        self.server.stop()

    def client(self, endpoint: Dict[str, Any] | None = None) -> adapter.UtaRuntimeClient:
        client = adapter.UtaRuntimeClient("unused", logger=self.logger)
        client.read_endpoint = lambda: endpoint or synthetic_endpoint(self.server.port)  # type: ignore[method-assign]
        return client

    async def test_reply_uses_v2_envelope_bearer_and_streaming_chunks(self) -> None:
        client = self.client()
        text = "鲸鱼" * 400
        ok = await client.send_reply("message-1", text)
        self.assertTrue(ok)

        rp_requests = [
            item for item in self.server.requests
            if item["payload"].get("command", {}).get("command") == "rp_reply"
        ]
        self.assertGreaterEqual(len(rp_requests), 2)
        for item in self.server.requests:
            self.assertEqual(item["path"], "/command")
            self.assertEqual(item["auth"], "Bearer test-token")
            envelope = item["payload"]
            self.assertEqual(envelope["protocolVersion"], "2.0")
            self.assertEqual(envelope["meta"]["hostId"], "maibot")
            self.assertEqual(envelope["meta"]["sessionId"], adapter.RUNTIME_SESSION)
            self.assertTrue(envelope["meta"]["eventId"])
            self.assertTrue(envelope["meta"]["ts"].endswith("Z"))

        request_ids = {item["payload"]["command"]["requestId"] for item in rp_requests}
        self.assertEqual(len(request_ids), 1)
        chunk_requests = [
            item for item in rp_requests if not item["payload"]["command"]["done"]
        ]
        chunks = [item["payload"]["command"]["text"] for item in chunk_requests]
        self.assertEqual("".join(chunks), text)
        self.assertTrue(all(item["payload"]["command"]["streaming"] for item in rp_requests))
        done_requests = [
            item for item in rp_requests if item["payload"]["command"]["done"]
        ]
        self.assertEqual(len(done_requests), 1)
        self.assertEqual(done_requests[0]["payload"]["command"]["text"], "")
        final = self.server.requests[-1]["payload"]
        self.assertEqual(final["command"]["command"], "agent_state")
        self.assertEqual(final["command"]["state"], "completed")

    async def test_image_only_reply_uses_the_authenticated_media_route(self) -> None:
        image = {"base64": "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "description": "图片"}
        self.assertTrue(await self.client().send_reply("image-only", "", [image]))
        media, completed = self.server.requests
        self.assertEqual(media["path"], "/maibot-media")
        self.assertEqual(media["auth"], "Bearer test-token")
        self.assertEqual(media["payload"]["meta"]["sessionId"], adapter.RUNTIME_SESSION)
        self.assertEqual(media["payload"]["command"], {"command": "chat_image", **image})
        self.assertEqual(completed["payload"]["command"]["state"], "completed")

    async def test_host_not_bound_warns_once(self) -> None:
        self.server.deny(True)
        client = self.client()
        ok = await client.send_reply("message-2", "你好")
        self.assertFalse(ok)
        warnings = self.logger.messages("warning")
        self.assertEqual(len(warnings), 1)
        self.assertIn("绑定", warnings[0])
        await client.send_reply("message-3", "再试一次")
        self.assertEqual(len(self.logger.messages("warning")), 1)

    async def test_scoped_tools_discover_live_capabilities_and_send_supported_commands(self) -> None:
        plugin = make_plugin()
        plugin._active = True
        plugin._uta = self.client()
        plugin._reply_targets['test-user'] = plugin._uta.read_endpoint()
        context = {"platform": "uta", "user_id": "test-user"}
        tools = [component for component in plugin.get_components() if component["type"] == "TOOL"]
        self.assertEqual(len(tools), 5)
        for tool in tools:
            self.assertEqual(tool["chat_scope"], "private")
            self.assertEqual(tool["metadata"]["platforms"], ["uta"])

        self.server.httpd.queries = []
        self.server.httpd.model_context = {
            "modelName": "测试模型", "ready": True, "revision": "model-1",
            "emotions": ["happy"], "animations": ["Wave"],
            "presetGroups": [{"group": "开心", "emotion": "happy", "presets": ["微笑"]}],
        }
        self.assertFalse((await plugin.tool_get_capabilities(platform="qq"))["success"])
        self.assertFalse((await plugin.tool_play_animation("Wave", platform="uta", group_id="group"))["success"])
        self.assertEqual(self.server.httpd.queries, [])
        capabilities = await plugin.tool_get_capabilities(**context)
        self.assertEqual(capabilities["animations"], ["Wave"])
        self.assertEqual(self.server.httpd.queries[0], ("/context?hostId=maibot", "Bearer test-token"))
        self.assertTrue((await plugin.tool_set_emotion("happy", **context))["success"])
        self.assertTrue((await plugin.tool_set_preset("开心", **context))["success"])
        self.assertTrue((await plugin.tool_play_animation("wave", loop=True, **context))["success"])
        self.server.httpd.model_context.update(revision="model-2", animations=["Jump"])
        self.assertFalse((await plugin.tool_play_animation("Wave", **context))["success"])
        self.assertTrue((await plugin.tool_play_animation("Jump", **context))["success"])
        self.server.deny(True)
        self.assertFalse((await plugin.tool_set_emotion("happy", **context))["success"])
        self.assertEqual([item["payload"]["command"] for item in self.server.requests], [
            {"command": "set_emotion", "emotion": "happy", "modelRevision": "model-1"},
            {"command": "set_preset", "preset": "开心", "mode": "revert", "modelRevision": "model-1"},
            {"command": "play_animation", "name": "Wave", "loop": True, "modelRevision": "model-1"},
            {"command": "play_animation", "name": "Jump", "loop": False, "modelRevision": "model-2"},
        ])
        self.server.httpd.redirect_context = True
        self.server.httpd.queries.clear()
        self.assertFalse((await plugin.tool_get_capabilities(**context))["success"])
        self.assertEqual(self.server.httpd.queries, [("/context?hostId=maibot", "Bearer test-token")])

    async def test_emoji_tool_uses_maibot_library_and_authenticated_media(self) -> None:
        plugin = make_plugin()
        plugin._active = True
        plugin._uta = self.client()
        plugin._reply_targets['test-user'] = plugin._uta.read_endpoint()
        gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
        plugin.ctx.emoji = mock.Mock(
            get_by_description=mock.AsyncMock(return_value={"success": True, "emoji": None}),
            get_random=mock.AsyncMock(return_value={"success": True, "emojis": [{"base64": gif, "description": "猫"}]}),
        )
        self.assertFalse((await plugin.tool_send_emoji("猫", platform="qq"))["success"])
        plugin.ctx.emoji.get_by_description.assert_not_awaited()
        self.assertTrue((await plugin.tool_send_emoji("猫", platform="uta", user_id='test-user'))["success"])
        plugin.ctx.emoji.get_by_description.assert_awaited_once_with("猫")
        plugin.ctx.emoji.get_random.assert_awaited_once_with(count=1)
        media, = self.server.requests
        self.assertEqual(media["path"], "/maibot-media")
        self.assertEqual(media["auth"], "Bearer test-token")
        self.assertEqual(media["payload"]["command"], {"command": "chat_image", "base64": gif, "description": "猫"})

    async def test_missing_endpoint_is_silent(self) -> None:
        client = adapter.UtaRuntimeClient("unused", logger=self.logger)
        client.read_endpoint = lambda: None  # type: ignore[method-assign]
        ok = await client.send_reply("message-4", "你好")
        self.assertFalse(ok)
        self.assertEqual(self.server.requests, [])
        self.assertEqual(self.logger.messages("error"), [])


class WebhookServerTest(unittest.IsolatedAsyncioTestCase):
    AUTHORIZATION = "Bearer af1d38612b3bdbe5902e50c0bde3be55125d9195b2aeae3a168a52537cfeeebb"

    async def asyncSetUp(self) -> None:
        self.plugin = make_plugin()
        self.plugin._active = True
        self.plugin._gateway_ready = True
        self.runtime = mock.Mock(spec=adapter.UtaRuntimeClient)
        self.runtime.read_endpoint.return_value = synthetic_endpoint(49152)
        self.runtime.has_endpoint.return_value = True
        self.plugin._uta = self.runtime
        self.logger = FakeLogger()
        self.server = adapter.UtaWebhookServer(self.plugin, "127.0.0.1", 0, self.logger)
        await self.server.start()

    async def asyncTearDown(self) -> None:
        await self.server.stop()

    def fetch(
        self,
        path: str,
        *,
        method: str = "GET",
        payload: Any = None,
        raw: bytes | None = None,
        authorization: str | None = AUTHORIZATION,
    ) -> tuple[int, Dict[str, Any]]:
        url = f"http://127.0.0.1:{self.server.port}{path}"
        data = raw
        headers = {}
        if authorization is not None:
            headers["Authorization"] = authorization
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=3.0) as response:
                raw_body = response.read()
                return response.status, json.loads(raw_body.decode("utf-8")) if raw_body else {}
        except urllib.error.HTTPError as exc:
            try:
                raw_body = exc.read()
                return exc.code, json.loads(raw_body.decode("utf-8")) if raw_body else {}
            finally:
                exc.close()

    async def test_health_is_ok(self) -> None:
        status, body = await asyncio.to_thread(self.fetch, "/health", authorization=None)
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["service"], "maibot-adapter")
        self.assertEqual(body["platform"], "uta")

    async def test_ready_requires_current_pairing_and_gateway(self) -> None:
        status, _ = await asyncio.to_thread(self.fetch, "/v1/ready", authorization=None)
        self.assertEqual(status, 401)
        status, body = await asyncio.to_thread(self.fetch, "/v1/ready")
        self.assertEqual((status, body), (200, {"ok": True}))
        self.plugin._gateway_ready = False
        status, _ = await asyncio.to_thread(self.fetch, "/v1/ready")
        self.assertEqual(status, 503)
        self.runtime.read_endpoint.return_value = synthetic_endpoint(49152, token="different-token")
        status, _ = await asyncio.to_thread(self.fetch, "/v1/ready")
        self.assertEqual(status, 401)
        self.runtime.read_endpoint.return_value = None
        status, _ = await asyncio.to_thread(self.fetch, "/v1/ready")
        self.assertEqual(status, 401)

    async def test_all_writes_reject_invalid_credentials_and_legacy_routes(self) -> None:
        requests = {
            "/input/text": {"text": "hello"},
            "/input/screenshot": {"image": "aW1hZ2U="},
            "/sync/model": {"emotions": ["happy"]},
        }
        for path, payload in requests.items():
            for credential in (None, "Bearer test-token", "Bearer wrong"):
                with self.subTest(path=path, credential=credential):
                    status, _ = await asyncio.to_thread(
                        self.fetch, f"/v1{path}", method="POST", payload=payload, authorization=credential,
                    )
                    self.assertEqual(status, 401)
            status, _ = await asyncio.to_thread(self.fetch, path, method="POST", payload=payload)
            self.assertEqual(status, 404)
        self.assertEqual(self.plugin.ctx.gateway.routed, [])
        self.assertEqual(self.plugin._model_emotions, [])

    async def test_text_injection_uses_declared_gateway_identity(self) -> None:
        status, body = await asyncio.to_thread(
            self.fetch,
            "/v1/input/text",
            method="POST",
            payload={"text": "晚上好", "request_id": "uta-123"},
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["routed"])
        self.assertEqual(len(self.plugin.ctx.gateway.routed), 1)
        routed = self.plugin.ctx.gateway.routed[0]
        message = routed["message"]
        self.assertEqual(routed["name"], adapter.GATEWAY_NAME)
        self.assertEqual(routed["dedupe_key"], "uta-123")
        self.assertEqual(message["platform"], adapter.PLATFORM)
        self.assertEqual(message["account_id"], adapter.ACCOUNT_ID)
        self.assertEqual(message["scope"], adapter.SCOPE)
        self.assertEqual(message["raw_message"], [{"type": "text", "data": "晚上好"}])
        self.assertEqual(message["message_info"]["user_info"]["user_nickname"], "桌宠主人")
        self.assertFalse(message["is_picture"])

    async def test_screenshot_injection_carries_verified_bytes(self) -> None:
        raw = b"fake-png"
        status, body = await asyncio.to_thread(
            self.fetch,
            "/v1/input/screenshot",
            method="POST",
            payload={"image": base64.b64encode(raw).decode("ascii")},
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["routed"])
        message = self.plugin.ctx.gateway.routed[0]["message"]
        component = message["raw_message"][0]
        self.assertEqual(component["type"], "image")
        self.assertEqual(component["hash"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(base64.b64decode(component["binary_data_base64"]), raw)
        self.assertTrue(message["is_picture"])

    async def test_replies_and_tools_keep_the_authenticated_recipient_after_rebinding(self) -> None:
        first = self.runtime.read_endpoint.return_value
        status, _ = await asyncio.to_thread(self.fetch, "/v1/input/text", method="POST", payload={"text": "first"})
        self.assertEqual(status, 200)
        second = synthetic_endpoint(49153, token="second-test-token")
        self.runtime.read_endpoint.return_value = second
        authorization = "Bearer " + hmac.new(second["token"].encode(), adapter.AUTH_CONTEXT, hashlib.sha256).hexdigest()
        status, _ = await asyncio.to_thread(self.fetch, "/v1/input/text", method="POST", payload={"text": "second"}, authorization=authorization)
        self.assertEqual(status, 200)
        a, b = (event["message"]["message_info"]["user_info"]["user_id"] for event in self.plugin.ctx.gateway.routed)
        self.assertNotEqual(a, b)
        for recipient, target in [(a, first), (b, second)]:
            reply = {"message_id": recipient, "raw_message": [{"type": "text", "data": "reply"}],
                     "message_info": {"additional_config": {"platform_io_target_user_id": recipient}}}
            result = await self.plugin.uta_gateway(message=reply)
            self.assertTrue(result["metadata"]["utaDelivered"])
            self.runtime.send_reply.assert_awaited_with(recipient, "reply", [], target=target)
        self.runtime.send_reply.reset_mock()
        result = await self.plugin.uta_gateway(message={"message_id": "old", "raw_message": [{"type": "text", "data": "old reply"}]})
        self.assertFalse(result["metadata"]["utaDelivered"])
        self.runtime.send_reply.assert_not_awaited()

    async def test_model_context_is_stored(self) -> None:
        status, body = await asyncio.to_thread(
            self.fetch,
            "/v1/sync/model",
            method="POST",
            payload={
                "emotions": ["happy", "thinking"],
                "controls": [{"id": "c1", "label": "发饰"}],
                "presets": [{"id": "p1", "label": "开心"}],
            },
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(self.plugin._model_emotions, ["happy", "thinking"])
        self.assertEqual(self.plugin._model_controls[0]["id"], "c1")
        self.assertEqual(self.plugin._model_presets[0]["id"], "p1")

    async def test_bad_requests_are_rejected(self) -> None:
        status, _ = await asyncio.to_thread(
            self.fetch, "/v1/input/text", method="POST", raw=b"{not-json"
        )
        self.assertEqual(status, 400)
        status, _ = await asyncio.to_thread(
            self.fetch, "/v1/input/text", method="POST", payload={"text": "   "}
        )
        self.assertEqual(status, 400)
        status, _ = await asyncio.to_thread(self.fetch, "/nope")
        self.assertEqual(status, 404)
        status, _ = await asyncio.to_thread(self.fetch, "/health", method="POST", payload={})
        self.assertEqual(status, 405)

    async def test_options_cors(self) -> None:
        status, _ = await asyncio.to_thread(self.fetch, "/v1/input/text", method="OPTIONS", authorization=None)
        self.assertEqual(status, 204)


class HookAndGatewayTest(unittest.IsolatedAsyncioTestCase):
    async def test_profile_identity_preserves_history_and_referenced_reply_keeps_its_original_target(self) -> None:
        plugin = make_plugin()
        plugin._active = True
        plugin._uta = mock.Mock(spec=adapter.UtaRuntimeClient)
        a = {**synthetic_endpoint(49152), "profileId": "a" * 64, "stableData": True}
        b = {**synthetic_endpoint(49153, "new-token"), "profileId": "a" * 64, "stableData": True}
        c = {**synthetic_endpoint(49154, "dev-token"), "profileId": "b" * 64, "stableData": False}
        first = plugin._build_message([], "1", a)
        second = plugin._build_message([], "2", b)
        dev = plugin._build_message([], "3", c)
        user = lambda msg: msg["message_info"]["user_info"]["user_id"]
        self.assertEqual(user(first), adapter.USER_ID)
        self.assertEqual(user(first), user(second))
        self.assertNotEqual(user(first), user(dev))
        reply = {"message_id": "reply", "reply_to": first["message_id"],
                 "message_info": {"additional_config": {"platform_io_target_user_id": user(first)}},
                 "raw_message": [{"type": "text", "data": "reply"}]}
        result = await plugin.uta_gateway(message=reply)
        self.assertTrue(result["success"])
        plugin._uta.send_reply.assert_awaited_with("reply", "reply", [], target=a)
        plugin._uta.send_reply.reset_mock()
        unknown = await plugin.uta_gateway(message={**reply, "reply_to": "unknown-prior-request"})
        self.assertFalse(unknown["success"])
        plugin._uta.send_reply.assert_not_awaited()

    async def test_inbound_uta_message_sets_thinking(self) -> None:
        plugin = make_plugin()
        plugin._active = True
        runtime = FakeRuntime()
        plugin._uta = runtime  # type: ignore[assignment]
        plugin._reply_targets['test-user'] = {"token": "a", "port": 12345}
        await plugin.observe_inbound(
            message={"platform": "uta", "message_id": "m-1", "message_info": {"user_info": {"user_id": "test-user"}}}
        )
        await asyncio.sleep(0)
        self.assertEqual(runtime.states, ["thinking"])

    async def test_other_platform_is_ignored_by_default(self) -> None:
        plugin = make_plugin()
        plugin._active = True
        runtime = FakeRuntime()
        plugin._uta = runtime  # type: ignore[assignment]
        await plugin.observe_inbound(
            message={"platform": "qq", "message_id": "m-2"}
        )
        await asyncio.sleep(0)
        self.assertEqual(runtime.states, [])

        plugin.config.chat.reflect_all_chats = True
        await plugin.observe_inbound(
            message={"platform": "qq", "message_id": "m-3"}
        )
        await asyncio.sleep(0)
        self.assertEqual(runtime.states, ["thinking"])

    async def test_gateway_delivers_mixed_and_image_only_replies(self) -> None:
        plugin = make_plugin()
        plugin._active = True
        runtime = FakeRuntime()
        plugin._uta = runtime  # type: ignore[assignment]
        plugin._reply_targets['test-user'] = {"token": "a", "port": 12345}
        info = {"additional_config": {"platform_io_target_user_id": "test-user"}}
        gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
        result = await plugin.uta_gateway(
            message={
                "message_id": "reply-1",
                "message_info": info,
                "raw_message": [
                    {"type": "at", "data": {"target_user_id": "u1"}},
                    {"type": "text", "data": "你好呀"},
                    {"type": "emoji", "binary_data_base64": gif},
                ],
                "message_segment": {"type": "emoji", "data": f"data:image/gif;base64,{gif}"},
            }
        )
        self.assertTrue(result["success"])
        self.assertEqual(runtime.replies, [("reply-1", "你好呀")])
        self.assertEqual(runtime.images, [{"base64": gif, "description": "表情包"}])

        await plugin.uta_gateway(
            message={"message_id": "reply-2", "raw_message": [{"type": "image", "data": ""}]}
        )
        self.assertEqual(len(runtime.replies), 1)
        await plugin.uta_gateway(message={"message_id": "reply-3", "message_info": info, "message_segment": {"type": "image", "data": gif}})
        self.assertEqual(runtime.replies[-1], ("reply-3", ""))
        self.assertEqual(runtime.images[-1], {"base64": gif, "description": "图片"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
