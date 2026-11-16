每个平台一只桌宠
================

这里每个 .bat 会启动一只独立的桌宠，只绑定文件名对应的 agent 平台。
它们使用各自的数据目录，互不覆盖：

  Uta-Codex.bat              -> %LOCALAPPDATA%\Uta-Pets\codex
  Uta-DeepSeek-Harness.bat   -> %LOCALAPPDATA%\Uta-Pets\harness
  Uta-Qoder.bat              -> %LOCALAPPDATA%\Uta-Pets\qoder
  Uta-Antigravity.bat        -> %LOCALAPPDATA%\Uta-Pets\antigravity
  Uta-Claude-Code.bat        -> %LOCALAPPDATA%\Uta-Pets\claude-code
  Uta-ZCode.bat              -> %LOCALAPPDATA%\Uta-Pets\zcode
  Uta-OpenCode.bat           -> %LOCALAPPDATA%\Uta-Pets\opencode

第一次启动某个脚本时，仍会显示首次引导（角色、语音等），但平台已经固定。
一个平台的所有聊天会共用同一只桌宠；其他平台不会影响它。

如果只想先看看界面，仍然双击外面的 Try-Uta.bat，它不会绑定任何平台。
要换平台：在对应桌宠的“设置 -> 关于与诊断”里解除平台绑定，然后重新打开引导；
或者直接关掉这只桌宠，改用另一个平台的启动脚本（数据会各自保留）。

同一个平台不要同时启动两只桌宠：该平台只会连接最后发布端点的那一只。
要换角色/配置，请先退出这只，再重新启动。
