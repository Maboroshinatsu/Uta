# 本机开发与发布操作

受众：Codex 主控与执行任务的 Agent。先读项目 AGENTS.md。以下命令均从项目或任务目录运行，不覆盖全局 APPDATA。

## 新建任务

```powershell
node scripts/workspace.mjs new qoder session-reset
node scripts/workspace.mjs status
```

主控先写好任务单再创建任务。脚本从 main 的确定提交创建分支和 worktree，生成仓库外 operations/assignments 记录，不自动启动 Agent，也不安装依赖。执行会话在新任务的 app 中运行 npm ci，读取分配记录中的环境变量。

当前这一任务在主控建立规则时已创建，因此有自己的交付记录；不要重复执行 new 创建同名分支。

## 开发环境

默认 `npm run dev` 按源码目录生成固定的 dev profile。若要多个平台进程指向同一个任务实例，显式使用分配表中的相同环境（下面路径仅示例）：

```powershell
$env:UTA_PROFILE = 'qoder-session-reset'
$env:UTA_USER_DATA_DIR = 'D:\Frankenstein\Uta-Workspace\runtime\profiles\qoder-session-reset'
$env:UTA_RUNTIME_DIR = $env:UTA_USER_DATA_DIR
$env:UTA_ENDPOINT_FILE = Join-Path $env:UTA_RUNTIME_DIR 'runtime-endpoint.json'
cd app
npm run dev
```

profile 和路径必须有效。路径使用绝对路径，profile 只允许小写字母、数字、连字符、下划线。Windows 按实际目录校验大小写和目录联接。日常的数据与运行目录须一起使用。仅显式设置端点时，hooks 文件跟随端点目录。同时配置运行目录时，端点必须在该目录中。

宿主插件需要从同一启动环境继承上述变量，或通过平台支持的独立配置指定目标。四平台 UI 对会话级环境的支持仍须分别验收，不要把源码测试通过当成已验证平台隔离。Codex MCP 已添加这些变量的转发声明；既有宿主进程不一定自动继承终端后设的变量。

```powershell
# 从仓库根目录查询明确环境，输出不含 token
node scripts/doctor.mjs stable
node scripts/doctor.mjs qoder-session-reset
```

非日常实例不注册全局快捷键、不自动导入旧模型、不开放麦克风权限。它使用自己的语音配置；不复制日常云服务凭据。跨页面的持久设置统一尚待单独实施，本轮只隔离不同环境。

## Live2D 构建资源

在 `app` 执行 `npm run assets:prepare`，从 Live2D 官方 SDK 和 AIRI 使用的 Hiyori 来源补齐运行文件。下载按 `scripts/live2d-assets.json` 中固定的 SHA256 校验，缓存位于忽略的 `app/.cache/live2d/`。Vite 的开发和构建入口也会执行同一准备函数，CI 在测试前显式准备资源。

已有本机文件不覆盖；缺失文件可从校验后的缓存恢复。只提取清单中的运行文件和模型原始说明，不提取 `.can3`、`.cmo3`。Hiyori 的 `deskpet-adapter.json`、`deskpet-presets.json` 属于源码，仍由 Git 跟踪。更新下载版本时同步修改清单并验证独立目录中的构建和模型启动。

取消 Git 跟踪不删除本机资源，也不清除旧提交。首次公开可从完成提交导出不带 `.git` 的源码快照，再在新仓库建立初始提交；本地开发仓库保留历史。

## 图标资源

应用标识统一引用 `app/src/renderer/public/uta-icon.svg`。修改源图后，在 `app` 目录执行 `npm run icon`，生成窗口和托盘 PNG、应用目录与仓库根目录的多尺寸 ICO，再执行 `npm run build`。生成文件与源图一起提交，不直接编辑 PNG 或 ICO。

Windows 打包配置使用 `src/renderer/public/icon.ico`；窗口与托盘使用同目录的 PNG。设置页、标题栏、首次引导和页面图标直接使用同一 SVG。

## Windows 打包

```powershell
cd app
npm run typecheck
npm test
npm run test:plugin
npm run dist
npm run verify:windows -- --candidate
```

`npm run dist` 在一次构建中生成 `app/release/Uta-<版本>-win-x64.zip` 和 `Uta-Setup-<版本>.exe`。每个文件有同名 `.manifest.json`，共同的 `SHA256SUMS.txt` 记录两个文件的 SHA256。清单和包内 `resources/app.asar` 的 `out/build-info.json` 使用同一份提交、版本与构建时间。安装包使用 NSIS，允许选择目录，卸载保留用户数据；当前未配置代码签名。

只需要 ZIP 时运行 `npm run dist:zip`。明确启用 `UTA_SHARE_PACKAGE=1` 且提供有分发许可的 `UTA_DS_MODEL_DIR` 时，只能走该 ZIP 入口，分享包使用 `Uta-<版本>-share-win-x64.zip`，另带 DS 模型和署名。运行环境与来源也可通过受限 IPC `utaAPI.getEnvironmentInfo()` 查询。

只能提升干净、已验收提交的包。打包入口拒绝未提交源码，并在结束时再次核对提交与工作区，防止打包期间源码变化。打包脚本不自动提升日常版本、不修改平台插件配置。

## Windows 自动验收

在 `app` 中用 Node.js 22.12 或更新版本安装依赖。运行 `npm run typecheck`、`npm test` 和 `npm run test:plugin`，覆盖双 DSH 实例与会话切换、历史容量和重启、模型导入及动作曲线导出。运行 `npm run build` 后执行 `npm run verify:windows`，在独立数据目录中启动真实 Electron，检查旧消息和回执读取、本机桥到渲染进程的通知写盘、重启，以及构建后的模型检查工作线程。

Windows 工作流运行同一套检查。普通分支推送与 PR 只检查源码。手动运行默认勾选 `candidate`，同时生成 ZIP 和 NSIS 安装包，核对 SHA256、提交信息、说明文件和连接器，解压 ZIP 后验证模型加载、历史读取、通知和重启。安装包在一次性的 GitHub 托管 Windows runner 中静默安装到临时目录，执行同样的运行检查后卸载；`verify:windows -- --installer` 拒绝在本机和自托管 runner 上运行，避免修改日常安装记录。

两种包验证通过后上传到 `Uta-windows-x64` Actions 附件，保留 14 天。推送 `v<app/package.json 版本>` 标签触发相同构建；标签、应用与锁文件版本必须一致。只有构建、ZIP 和安装版检查全部通过，独立的 Release job 才获得 `contents: write`，重新核对校验清单后创建 Release 并上传两个包、来源清单和 SHA256 清单。含连字符的预发布版本标为 prerelease。已存在的 Release 不自动覆盖，避免同一版本附件被静默替换。

打包页面的 IPC 文件 URL 校验按解码后的文件路径比较。Windows 短路径中的 `~` 在 Node 生成的 URL 中可能写成 `%7E`，Chromium 保留 `~`；逐字比较 URL pathname 会拒绝自己的页面。host、登记窗口和主 frame 仍须匹配，其他页面不可获权。

查看云端结果用 `https://github.com/Maboroshinatsu/Uta/actions/workflows/windows-check.yml`。首次验证使用手动构建，不为测试创建公开版本标签。自动检查仍不代替真实宿主、麦克风、旧数据升级和 Live2D 观感验收。

## 集成验收与提升

将 ZIP 解压到本次专用的候选目录，保留上一版本。先使用独立 integration profile 启动该目录中的 Uta.exe，核对 profile、主进程 PID、认证健康检查、模型加载、角色工具与数据隔离。检查期间使用候选实例的私有端点。

本机 Frankenstein 工作区可能带有 Windows Low 完整性标记，解压包会继承它，导致 Electron 主进程或渲染进程在启动时退出。发布准备时先检查 `icacls`；确有此情况，只对**已经核对为本次 artifacts 内的候选目录**恢复 Medium 完整性（包括该包内资源），不修改父工作区和平台目录，不把这个操作作为开发隔离机制。用户在普通目录解压不一定遇到此问题；日常启动脚本不自动改权限。

通过后在关闭相关实例的短窗口内备份现有日常设置。备份应包含 Local Storage、Session Storage 与窗口/语音等配置；模型另行盘点，本轮不移动日常用户模型。备份不入 Git。设置迁移需要额外验证，不因包启动成功而宣称完成。

Codex 核对解压包与清单的 SHA256，记录验收证据，再把稳定入口写入仓库外 `operations/stable.json`：

```json
{
  "exe": "D:/Frankenstein/Uta-Workspace/artifacts/<提交SHA>-<构建编号>/Uta.exe",
  "commit": "<已验收提交SHA>",
  "archiveSha256": "<压缩包SHA256>",
  "verifiedAt": "<时间>"
}
```

该登记由 Codex 执行，不是每个平台各自登记。`start-uta.bat` 读取此记录，只启动 artifacts 下的 Uta.exe，并清除调用终端的开发 profile 与端点变量。用户也可以直接双击该 exe；不要从带有开发环境变量的命令行把它当作日常实例启动。

记录上一份 stable.json 和数据备份。升级失败时，停止本次实例后恢复上一条入口；有存储格式变化时也要恢复匹配的数据。没有验收记录的构建只能叫候选。

## 插件产物

`npm run plugin:build` 构建通用宿主与 DSH；Qoder、Antigravity 另有各自打包脚本。它们只生成任务区产物。全局安装由 Codex 统一执行并记录来源版本，禁止执行任务时顺手修改宿主全局配置。

旧版本未加载新共享目录契约时，不能视为已具备新隔离能力。各平台都应做一次“测试实例停掉后不命中日常实例”的真实验证，再开放并行连接。
