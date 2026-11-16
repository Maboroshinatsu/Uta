# Antigravity：蓝色组件与语音代表页

状态：用户已授权本项实施，桌面会话待启动；仅A01代表页，不接真实设置/窗口。当前目录/base/branch/profile/契约hash在 `.uta-task/assignment.json`；先运行 `node scripts/task-handoff.mjs preflight`。

## 开始

在Antigravity打开 `D:/Frankenstein/Uta-Workspace/tasks/antigravity-blue-settings-page` 为项目根，另开本任务会话。先读AGENTS、本文、`docs/contracts/first-wave-v1.md`、`docs/design/blue-block-design-spec.md`、settings-ux-proposal保存语义和现有线框。保持当前gemini-3.8-flash-high；不改账号/全局插件，不开子Agent，不调用桌宠MCP，不另开CLI开发任务。

开发任务通过文件交接，与Uta产品插件无关。若旧插件在桌面自动触发日常桌宠/要求全局配置修改，记录现象交主控，不自行停用全局插件。工作区是协作隔离，并不是插件权限沙箱。

## 交付范围

保留蓝色大色块，做可复用Vue组件、tokens、语音代表页及独立浏览器预览。不得只交静态好看截图。沿用Vue3/CSS，不装UI库，不改产品入口。

允许：

- `app/src/renderer/components/settings-v2/**`（仅基础组件/语音代表页，其他领域不扩功能）
- `app/src/renderer/settings-preview/**`
- `app/settings-preview.html`、`app/settings-preview.vite.config.ts`
- `app/tests/blue-settings-page.test.cjs`
- `docs/design/blue-settings-page/**`（交互说明和不含个人数据的截图）
- `docs/workflow/results/blue-settings-page.md`、`docs/workflow/progress/blue-settings-page.md`

禁止改：electron-vite.config、正式index入口、SettingsPanel、main/preload/store、shared契约、package.json/lock、模型资产、总台账和另一任务。新preview config使用已有vite/plugin-vue；独立预览不加载Electron/adapter/Live2D。生产路由整合留给主控。

## 行为与验收

语音页分播报/输入，完整实现播报代表流；输入页可明确标注后续实现，不能伪造完整STT。左侧六域导航展示真实信息层级，非语音页可给“本批仅语音代表页”的说明，不制作虚假功能。

使用VoicePreviewFixture/voicePreview合成数据；可新增本任务mock数据。无真实密钥字段存储、网络、文件、音频或设备调用。顶部持续标记“开发预览·模拟数据·不会保存到Uta”，模拟保存只留内存，刷新丢失。

必须实现：

1. 蓝色完整侧栏/页头，与图标呼应；浅/深主题、文字层级、稳定留白；不靠小字号塞内容。
2. 总开关、当前provider摘要、配置编辑/取消、endpoint/model校验、音量、明确的模拟测试与模拟保存。
3. 每provider独立draft；测试不保存；保存才改mock已保存快照；取消恢复当前provider已保存值。
4. 测试中改字段/取消/切provider让旧回包失效；可以选择模拟失败并局部重试，输入不丢；禁连example.invalid。
5. 有键盘焦点、标签、可读错误；composition期间Enter不提交；busy状态不重复触发。
6. 深浅主题、1280×720与1024×640浏览器视口；窄布局/长名称/多行错误；reduced-motion。系统125/150%缩放若未真实验证，写待验证，不能用截图缩放冒充。

## 开发与检查

当前worktree/app单独 `npm ci --no-audit --no-fund`；不共享node_modules/out。新增preview使用独立vite config，限定127.0.0.1、端口9292、strictPort，端口被占用就报告，不停其他进程。建议命令 `npm exec vite -- --config settings-preview.vite.config.ts --host 127.0.0.1 --port 9292 --strictPort`（由本任务实际验证）。build用同配置独立outDir `out/settings-preview`，不要emptyOutDir到产品out根。

根目录 `node scripts/check-first-wave-contracts.cjs`；app内 `node --test tests/blue-settings-page.test.cjs`、`npm run typecheck`、`npm run build`，另跑实际preview构建命令。行为测试可抽出纯draft controller供node:test验证，测试不能只匹配源码；不要为测试新增重复实现。

通过桌面自身浏览器能力检查预览；如果不可用，仍完成组件/逻辑/构建，把GUI未验证列清楚，禁止伪造截图。至少截图：浅色默认、深色、编辑校验失败、模拟失败后重试、窄窗。截图不能出现真实个人设置。

## 交接与停止

progress每阶段记录已做、当前、下一步、commit、检查、页面地址、进程exe/PID/创建时间/端口及清理状态。每次续接先读progress、本地status和实际git，不重置现场。一个目录同时只开一个Antigravity开发会话。

结果列base/head、命令与退出码、真实GUI/系统缩放分别是否测试、遗留问题。阶段性commit；最终提交本任务文件后根目录 `node scripts/task-handoff.mjs submit`，回复结果路径和SHA。该回执不代表主控已验收。

完成后只补本项状态/失败用例和UI细节，不自行迁移六页、开独立产品窗口、接新设置store或改live2d。主控不在线时留待审产物；公共接口有问题先写请求，不造竞争接口。
