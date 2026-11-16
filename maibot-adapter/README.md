# Uta 桌面宠物 × MaiBot 适配器

这个插件让 Uta 和 MaiBot 连起来：

- 你在 Uta 的气泡输入框里说话，MaiBot 会像收到一条私聊一样正常回复；
- MaiBot 处理消息时，Uta 会进入“思考”状态；
- MaiBot 对这条私聊的回复会显示在 Uta 气泡里，并按 Uta 的语音设置朗读；
- 其他聊天平台（QQ、微信等）的回复不会进入 Uta 气泡，也不会被朗读。

通信只在本机回环地址上进行。Uta 绑定到 MaiBot 后，双方自动校验凭据，无需手动填写令牌。

## 你需要准备

- 能正常运行的 MaiBot（插件 SDK 2.x）；
- 带 MaiBot 适配器的 Uta 桌面包；
- 把 Uta 的桌宠绑定到“MaiBot 适配器”。没有绑定的话，Uta 会拒绝插件发来的状态和回复。

## 安装插件

1. 找到 Uta 安装目录里的 `resources\maibot-adapter` 文件夹（分享 ZIP 里也有同名文件夹）。
2. 把整个 `maibot-adapter` 文件夹复制到 MaiBot 的 `plugins` 目录里；建议改名为 `uta-maibot-adapter`。
3. 重启 MaiBot，在插件列表里确认“Uta 桌面宠物适配器”已加载。升级 Uta 时请使用同一版本随包提供的适配器。
4. 插件会在本机启动 `http://127.0.0.1:8524`，这是 Uta 默认连接的地址。可以在 `config.toml` 里改端口，但要和 Uta 设置里的地址保持一致。

## 绑定 Uta

第一次使用：

1. 启动 Uta，进入首次引导的“选择宿主”步骤。
2. 选择“MaiBot 适配器”，按提示继续完成引导。
3. 引导结束会把这只桌宠固定绑定到 MaiBot。

如果这只桌宠已经绑定了别的平台：

在快捷设置或「连接与会话」中点选「MaiBot 适配器」。

绑定完成后，在 Uta 设置里确认“MaiBot 适配器”的服务地址是 `http://127.0.0.1:8524`（默认值）。

## 使用

- 在 Uta 的气泡输入框里输入文字，按发送；MaiBot 的回复会回到 Uta 气泡。
- MaiBot 的回复文字过长时会自动分段，Uta 会拼成一条消息显示。
- MaiBot 回发给 Uta 私聊的图片和表情包会显示在气泡和消息记录中。图文回复先显示文字，再显示图片。图片支持 PNG、JPEG、GIF 和 WebP，每条回复最多四张，每张最多 1 MiB。消息记录优先保留较新的图片。
- Uta 气泡可输入文字，暂无附件发送入口。
- 可以在 Uta 私聊里让 MaiBot 查当前模型支持什么、切换情绪、播放预设或动作，也可以让它从表情包库找一张图发到桌宠。模型切换后，工具会重新读取能力。
- 如果 Uta 暂时没开，MaiBot 仍然正常工作，只是这次回复不会出现在桌宠里。
- 私聊按桌宠的数据目录隔离，同一只桌宠重启后可继续原来的会话。新版日常数据保留原私聊身份。引用原消息的回复固定送往原请求实例；旧版 Uta 缺少数据目录标识时使用实例隔离。

## 配置

`config.toml`：

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `bridge.host` | `127.0.0.1` | 只允许本机回环地址 |
| `bridge.port` | `8524` | 与 Uta 的“MaiBot 服务地址”一致 |
| `runtime.endpoint_file` | 空 | 开发/测试时手动指定 Uta 端点文件；普通使用留空 |
| `runtime.timeout_seconds` | `4.0` | 单条指令超时 |
| `chat.reflect_all_chats` | `false` | 是否让桌宠也显示其他平台“正在处理”的状态；只同步状态，不转发正文 |
| `chat.user_nickname` | `桌宠主人` | Uta 私聊在 MaiBot 里显示的昵称 |

## 遇到问题

**Uta 里显示 MaiBot 适配器离线**

- 确认 MaiBot 正在运行，且插件已加载；
- 在本机浏览器访问 `http://127.0.0.1:8524/health` 可检查插件是否在监听。桌宠显示在线还需要配对校验通过且消息网关就绪；
- 如果端口在监听但桌宠仍离线，确认两端已一起更新，并检查 MaiBot 读取的 Uta 端点是否属于已绑定的桌宠；
- 如果端口被别的程序占用，改 `bridge.port`，同时改 Uta 里的服务地址。

**能发消息，但桌宠没有回复**

- 打开 Uta 设置 → “关于与诊断”，确认“平台绑定”显示的是 MaiBot；
- 如果显示“独立待机”或其他平台，按上面的“绑定 Uta”重新绑定；
- 查看 MaiBot 日志里有没有 `[Uta]` 开头的提示。

**MaiBot 里有回复，但 Uta 没显示**

- 只有发给“Uta 私聊”的回复才会进入气泡；MaiBot 在其他聊天里的回复不会串进来；
- 确认 Uta 没有关闭，且桌宠窗口没有被其他程序完全遮挡。

**提示没有找到 Uta 运行时端点**

- 先启动 Uta，并确认桌宠已绑定到 MaiBot；
- 普通安装会自动寻找 `%APPDATA%\uta\host-pets\maibot\runtime-endpoint.json`；
- 开发测试时可以在 `[runtime] endpoint_file` 里手动指定端点文件，避免连接到日常实例。

## 给开发者

插件只依赖 Python 标准库和 `maibot_sdk`，不需要额外安装包。

```bash
D:/Frankenstein/MaiBot/.venv/Scripts/python.exe -m unittest discover -s tests -v
```

测试使用内存端点，不会写入或连接日常 Uta 数据目录。插件入口是 `plugin.py`，配置模型是 `UtaAdapterConfig`，Uta 运行时协议为 v2 信封（`meta.hostId = "maibot"`）。

`GET /health` 是只读诊断入口。`GET /v1/ready` 和 `POST /v1/input/text`、`/v1/input/screenshot`、`/v1/sync/model` 要求 `Authorization: Bearer`。入站凭据是以 Uta 运行时令牌为密钥、以 `uta:maibot:http-ingress:v1` 为消息计算的 HMAC-SHA256 十六进制摘要。凭据缺失或不匹配返回 `401`。已鉴权的就绪探测在消息网关可用时返回 `200`，否则返回 `503`。手动指定的 Uta 端点缺失时停止配对，避免连接到其他桌宠。

MaiBot 回推媒体时向 Uta 的 `POST /maibot-media` 发送带运行时 Bearer 凭据的 v2 信封。`chat_image` 负载包含 `base64` 和 `description`，信封带 MaiBot 宿主、会话及事件 ID。Uta 根据图片签名判定 MIME 类型，并按事件 ID 去重。

适配器声明 `uta_deskpet_get_capabilities`、`uta_deskpet_set_emotion`、`uta_deskpet_set_preset`、`uta_deskpet_play_animation` 和 `uta_deskpet_send_emoji`，仅在 `uta` 平台的私聊可用。角色工具以 `GET /context?hostId=maibot` 查询已绑定桌宠，再向同一个端点发送带 `modelRevision` 的指令。配对或模型变化时，工具会返回失败。表情包工具调用 MaiBot 的表情包库，通过 `/maibot-media` 投递。工具成功表示 Uta 接收了请求。
