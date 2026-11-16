# 先看这里

这是一个可以直接试用的 Uta 桌宠分享包，里面带了两套模型和 MaiBot 适配器。

## 第一步：打开桌宠

1. 把 ZIP 解压到一个自己找得到的文件夹（不要在压缩包里直接双击）。
2. 双击 `Uta.exe`。
3. 按首次引导选一个角色：
   - **DS 鼠控版**：带表情、动作和可调部件；
   - **Hiyori**：通用备选。
4. 如果暂时不接任何宿主，可以在引导里跳过，桌宠会独立待机。

第一次运行 Windows 可能提示“已保护你的电脑”，这是未签名测试包的正常提示；选择“更多信息 → 仍要运行”。

## 第二步：只在需要时接入 MaiBot

不用 MaiBot 的话，到这里就可以开始用了。

要用 MaiBot 的话：

1. 找到 Uta 安装目录里的 `resources\maibot-adapter` 文件夹。
2. 把整个文件夹复制到 MaiBot 的 `plugins` 目录，建议改名为 `uta-maibot-adapter`。
3. 重启 MaiBot，确认插件列表里的“Uta 桌面宠物适配器”已加载。
4. 回到 Uta，在“设置 → 连接与会话 → 切换平台”里选“MaiBot 适配器”。如果已经绑定了其他平台，直接在这里切换即可，旧平台会断开、桌宠会重新加载。
5. 确认 Uta 设置里的“MaiBot 服务地址”是 `http://127.0.0.1:8524`（默认值）。

绑定后，在 Uta 的气泡输入框里发一句话，MaiBot 就会像收到私聊一样回复。详细说明和排查见 `MAIBOT-ADAPTER.md`。

## 如果也要用 DeepSeek Harness

Uta 现在可以从首次引导里直接安装 DSH 插件，不需要自己敲 `dsh plugin`：

1. 先安装并打开一次 DeepSeek Harness，让它创建 `%USERPROFILE%\.dsh\profiles\desktop`。
2. **完全退出 DeepSeek Harness**（不是只关窗口；托盘里也要退出）。
3. 在 Uta 首次引导的宿主步骤选择“DeepSeek Harness”。
4. 如果 Uta 没自动找到 DSH，点“选择 DSH 程序”选 `DeepSeek Harness.exe`；如果数据目录不在默认位置，点“选择 DSH 数据目录”选 `.dsh` 文件夹。
5. 点“安装 Uta 插件”。Uta 会先备份 DSH 的 desktop profile，再调用 DSH 自带 CLI 安装；失败会自动恢复。
6. 重新打开 DeepSeek Harness，并新开一个会话。

DSH 运行中 Uta 不会改写它的配置；安装前请务必完全退出。

## 隐私

- 所有 MaiBot 通信只走本机 `127.0.0.1`，不需要账号密码，也不会开放到局域网。
- 这个包里没有附带任何人的聊天记录、设置、语音密钥或宿主配置。
- MaiBot 在 QQ、微信等其他聊天里的回复不会进入桌宠；只有发给 Uta 私聊的回复会显示和朗读。

## 模型与授权

- **DS 鼠控版**：署名链为上善无形「溟月」→ ZipZipPipe 女仆鲸鱼娘 → 氵六青 Live2D 化；参考项目 `Andersen216/dsh-whale-girl-live2d`。采用 CC BY-NC-SA 4.0（署名—非商业—相同方式共享）。本分享包经打包发起人确认已取得附带许可；再分发请保留 `DS-MODEL-NOTICE.md` 和模型目录中的署名，禁止商业使用，并遵守相同方式共享条款。
- **Hiyori**：Live2D 官方示例模型，使用受示例模型条款约束，详见 `THIRD_PARTY_LICENSES.md`。
- **Uta 自有源码**：MIT，详见 `LICENSE-Uta.txt`；模型及 Live2D Core 保留独立许可。

## 遇到问题

**桌宠没有出现**

- 检查是不是被其他窗口挡住，或从系统托盘打开 Uta；
- 右键托盘图标可以退出，再重新打开。

**Uta 里显示 MaiBot 离线**

- 确认 MaiBot 正在运行，插件已加载；
- 用浏览器打开 `http://127.0.0.1:8524/health`，正常会返回一段带 `"ok": true` 的内容；
- 端口被占用时，改插件 `config.toml` 里的端口，并同步修改 Uta 里的服务地址。

**MaiBot 能回复，但桌宠没收到**

- 打开“设置 → 关于与诊断”，确认“平台绑定”显示的是 MaiBot；
- 只有发给 Uta 私聊的回复会进桌宠，其他聊天不会。

**想彻底卸载**

- 右键托盘图标退出 Uta，删除解压出来的程序文件夹；
- 如果不需要保留设置，可以再删除 `%APPDATA%\uta`。删除前请确认里面没有你想留的聊天记录或密钥。
