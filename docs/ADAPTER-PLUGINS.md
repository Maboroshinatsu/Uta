# 声明式适配器插件

Uta 的 HTTP 类适配器不再写死在设置面板里，而是由插件清单驱动。插件**只有配置和 HTTP 路由描述，不包含可执行代码**；Uta 用通用执行器发请求，因此加载第三方插件不会获得文件/命令执行权限。

## 目录

```
%APPDATA%\uta\adapters\
└── my-adapter\
    └── uta-adapter.json
```

- 插件目录名只用于定位，真正的 ID 取清单里的 `id`。
- Uta 启动时扫描该目录；目前修改清单后需要重启 Uta 才能生效。
- 设置 → 平台与伴侣适配器 → **插件目录** 可以直接打开这个目录。

## 最小清单

```json
{
  "schemaVersion": 1,
  "id": "my-adapter",
  "name": "我的适配器",
  "version": "0.1.0",
  "category": "adapter",
  "description": "连接本地自建服务",
  "capabilities": {
    "statusEvents": true,
    "assistantText": true,
    "sendInput": true,
    "cancelTurn": false,
    "characterTools": true,
    "sessionSelection": false
  },
  "baseUrlSetting": "baseUrl",
  "settings": [
    {
      "key": "baseUrl",
      "type": "text",
      "label": "服务地址",
      "default": "http://127.0.0.1:8600"
    }
  ],
  "routes": {
    "health": { "method": "GET", "path": "/health" },
    "text": {
      "method": "POST",
      "path": "/user_message",
      "body": {
        "text": "$text",
        "source": "uta_bubble",
        "timestamp": "$now"
      }
    }
  },
  "healthOkKey": "ok"
}
```

## 字段

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 目前固定为 `1` |
| `id` | 小写字母/数字/`.`/`_`/`-`，2-40 字符；不能与内置插件重名 |
| `category` | 固定 `adapter` |
| `capabilities` | 六个布尔值必须齐全；设置面板会据此展示能力 |
| `baseUrlSetting` | 必须指向 `settings` 里的一个 text/password 字段 |
| `settings` | 最多 20 个字段，类型支持 `text` / `password` / `number` / `boolean` / `select` |
| `routes.health` | 必填，健康检查 |
| `routes.text` | 必填，桌宠气泡文本发送 |
| `routes.screenshot` | 可选，截图发送 |
| `routes.emotions` | 可选，情绪清单同步 |
| `routes.controls` | 可选，模型控件/预设同步 |
| `healthOkKey` | 可选；响应 JSON 中该字段为真才算健康。不填则只看 HTTP 状态 |

### 请求体占位符

`routes.*.body` 中可用的占位符：

- `$text`：气泡文本
- `$base64`：截图 base64
- `$emotions`：情绪数组
- `$controls`：控件数组
- `$presets`：预设数组
- `$now`：当前时间戳（毫秒）
- `$requestId`：本次请求 ID

占位符可以单独作为字符串（保留数组/数字类型），也可以嵌在字符串里，例如 `"request_id": "uta-$now"`。

## 加载状态

- 清单合法 → 显示为已加载，可被选择并出现在“当前实时绑定”中；
- 清单缺失、JSON 损坏、校验失败或 ID 冲突 → 仍在设置里显示，但标为**未加载**且不可选择；
- 清单文件上限 64KB，最多扫描 50 个插件目录。

## 内置插件

MaiBot、AstrBot 使用同一套清单机制，随应用内置：

- MaiBot 使用 `http://127.0.0.1:8524`。主进程为内置适配器发送已鉴权的就绪检查和写入请求。详见 [MaiBot 适配器](../maibot-adapter/README.md)。
- 新版运行时端点附带 `profileId`（私有端点路径的 SHA-256）和 `stableData`（由应用数据归属判定）。MaiBot 据此维持数据目录的私聊身份，日常数据沿用旧身份。入站消息引用保留原端点，流式回复使用同一端点快照。没有这些字段的旧端点采用实例隔离。
- AstrBot 使用 `http://127.0.0.1:8526`。主进程用独立于 MaiBot 的配对凭据访问 `/v1/ready`、`/v1/input/text` 和 `/v1/sync/model`。配套插件从 AstrBot 原生私聊回传文本与图片。

需要接入其他本地服务时，不需要改代码：按本规范在插件目录新增一个 `uta-adapter.json` 即可。旧的内置“自定义 Webhook”已移除。

## 安全边界

- 不加载 JS/可执行文件，插件不能执行命令或读写任意文件；
- 只允许 `http://` / `https://` 基础地址和清单内的固定路径；
- 第三方清单由渲染层再次做 schema 校验，主进程只负责读取 JSON（限 64KB）；
- 设置值保存在本机 localStorage；不要把长期有效的敏感令牌写进插件设置，除非接受本机明文存储。
