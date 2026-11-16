# 启动 Uta

将 Windows x64 ZIP 完整解压，双击 `Uta.exe`。首次引导可以跳过宿主，先用内置的 Hiyori Pro 或静态示例。

`Uta.exe` 读取 `%APPDATA%/uta`。升级时可保留旧程序目录，换回旧程序前先退出当前版本。普通 ZIP 可用 `Try-Uta.bat` 试用，每个解压目录对应一份独立试用数据。

要连接宿主，在 Uta 的「连接与会话」里安装或查看指引，重开宿主会话后确认能调用角色工具。多个宿主可分别用 `Pets` 中的启动器。随包的 MaiBot 后端需要在 MaiBot 中安装，步骤见 `MAIBOT-ADAPTER.md`。

文件名带 `-share-` 的分享包有额外内容，以包内的 `README-FIRST.md` 为准。程序与模型授权见 `LICENSE-Uta.txt` 和 `THIRD_PARTY_LICENSES.md`。
