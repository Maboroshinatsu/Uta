# Uta 交接现场

## 1. 仓库与版本

- 主源码 `D:/Frankenstein/Uta`，分支 `main`，本轮修复基线 `24b34ef`；公开仓库基线 `5c24717`，两者文件树一致。检查提交用 `git log -12 --oneline`，检查现场用 `git status --short --branch`。已有 18 项语音及宿主相关未提交文件继续保留，不纳入本轮发布。
- 用户授权将源码公开到 `https://github.com/Maboroshinatsu/Uta` 并按实际情况重写 README。公开版使用已提交源码的无历史快照，发布用独立仓库为 `D:/Frankenstein/.codex/publications/Uta`；本地主仓库的历史和在途改动保留。远端核对用 `git -C D:/Frankenstein/.codex/publications/Uta ls-remote origin refs/heads/main`，源码对应提交用该仓库的 `git config --get uta.sourceCommit` 查询。
- Core、Hiyori 素材及编辑工程共 21 个文件取消 Git 跟踪，本机文件按 SHA256 核对保持原样。Uta 自有的 Hiyori 适配与预设 JSON 仍跟踪。开发和构建按 `app/scripts/live2d-assets.json` 固定来源、SHA256 下载 Core 与 Hiyori 运行文件；已有文件不覆盖，缓存不入 Git。操作见 [Live2D 构建资源](OPERATIONS.md#live2d-构建资源)。
- 宿主安装与升级：Codex 检测及安装实时读取所选程序路径，连接器为 `0.2.5`，MCP 缓存入口与状态上报版本一致。DSH 连接器为 `0.5.7`，安装同时核对版本、依赖来源与实际链接；更新失败恢复配置和原链接。同一 DSH 数据目录的安装锁由所有 Uta profile 共用，目录联接也视为同一目标；未确认结束的安装须显式解除阻断。OpenCode 手动安装指南包含插件及 MCP 两份文件。
- 用户要求参考 AIRI 的构建与发布方式，取消第三方资源跟踪，不申请授权或对外联系。本轮进一步授权 GitHub 自动构建 ZIP 与安装版；不改日常设置、不改写已有 Git 历史。
- 应用标识统一使用用户指定的 SVG，唯一源图为 `app/src/renderer/public/uta-icon.svg`。窗口、托盘和 Windows 打包资源已重新生成；设置导航、关于页、标题栏、首次引导及页面图标均引用同一源图。生成入口见 [图标资源](OPERATIONS.md#图标资源)。本轮不更新日常 ZIP。
- DeepSeek TTS 使用官方 `POST /v1/tools/tts`，支持海星与暗潮两种音色，沿用现有密钥加密、播报队列与口型链路。设置页隐藏该服务不支持的模型、语速、风格控件。整段音频收完后播放，未接入 WebSocket 流式播放。接入与使用说明见 [README](../../README.md#语音与模型)。
- 已核对本机 DSH `0.2.1-rc.5` 和官方源码 `39163dd`：官方语音模块仅提供识别，没有 TTS 服务方法。Uta 在各宿主下均单独配置 DeepSeek 密钥，不读取 DSH 凭据，也不需要 TTS 专属连接器。[官方语音模块说明](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/experimental/speech-to-text/README.md)
- DSH 连接按实例和会话登记，同一角色工具调用的子动作沿用调用会话。运行桥只为已投递的事件确认重复，拒绝过时状态，允许近期遗漏的独立通知重试。媒体超限回执增加了有界排空。
- 可见消息与完成回执分别限额。旧 v1 历史可读，保存时按字节保留较新的消息，超长记录带截断标记。开发与日常实例按 Windows 实际目录隔离。
- 模型检查在工作线程完成。重复资源只校验一次，每个候选限制清单引用量。损坏的来源适配文件不会取代已有配置。工坊导出包含控件独占参数，原生循环启动失败后恢复待机。
- Electron 锁定在 `45.2.3`。Windows 工作流覆盖类型、应用与插件回归、构建、隔离启动和重启。`npm run dist` 使用同一构建生成 ZIP 和 NSIS，并输出两份来源清单及 `SHA256SUMS.txt`；`dist:zip` 保留单独 ZIP 入口。手动 `candidate` 默认生成并验证两个包、上传 14 天附件；`v*` 标签须匹配应用及锁文件版本，全部通过后才发布 Release，预发布版本标为 prerelease。流程见 [本机开发与发布操作](OPERATIONS.md)。
- 开工前已有宿主语音和 MCP 宿主识别改动。语音只访问登记的实例，桌宠与连接器分别核对会话，随原有未提交语音功能保存在工作区。主线提交独立。
- 本地日常 `0.3.0-beta.1` ZIP 的构建清单仍指向 `31ef14c`；本轮云端构建不提升日常入口。安装和卸载验证只允许一次性的 GitHub 托管 runner。

## 3. 验证状态

- 双包与版本标签回归 9 项通过，覆盖双包来源和 SHA256、仅 ZIP、脏源码、打包期间源码变化、错误参数，以及标签和锁文件两处版本一致性。该回归使用受控构建工具，不代替真实 electron-builder 产物检查。版本检查使用 Node 解析 JSON，避免 PowerShell `ConvertFrom-Json` 拒绝 npm 锁文件的空字符串根包键。
- 首次云端构建已生成 ZIP 和安装包，但 ZIP 运行检查发现设置 IPC 的页面校验将 Windows 短路径中的 `%7E` 与 Chromium 的 `~` 误判为不同页面。真实 Electron ASAR 探针复现后，文件 URL 改为按 `fileURLToPath` 解码后的路径比较，HTTP 路径、host、登记窗口和主 frame 约束保留；回归覆盖等价转义、其他页面、外部 host 和编码斜线。首次失败未上传附件。
- 本轮设置 IPC、双窗与文档回归 33 项通过，两套类型检查通过。相同短路径下的真实 Electron ASAR 探针确认修复前拒绝、修复后允许自己的页面，主 frame 身份一致；探针使用独立数据，未启动或修改日常实例。
- 公开源码的 Windows CI 已通过（包括真实资源下载与隔离 Electron）；双包构建的云端结果以 [Windows verification 运行记录](https://github.com/Maboroshinatsu/Uta/actions/workflows/windows-check.yml)为准。检查发布仓库的 `git config --get uta.workflowRun` 与 `git config --get uta.ciStatus` 可查询本轮验证地址与结论，不将一次性运行状态写死在文档中。
- 含在途宿主语音的工作区通过两套类型检查；应用回归 1493 项通过、6 项跳过。资源准备新增 7 项回归，覆盖本机文件与预设保留、校验失败、缺失条目、缓存修复、坏缓存重下、下载失败/超限和目标路径校验。本轮未改插件，137 项插件回归沿用本次开源复核结果。
- 从暂存源码生成不含第三方资源的独立目录，独立 `npm ci`、真实下载校验 19 个运行文件、类型检查与应用回归 1485 项通过、6 项跳过。构建及真实 Electron 隔离启动、Hiyori 加载、历史读取、消息写盘与重启通过。独立目录不含 `.can3`、`.cmo3`，两份自有适配配置保留；工作区 21 个本机资源文件的 SHA256 未变化。
- 安装回归使用临时宿主目录，验证 Codex 路径即时生效、旧连接器更新、DSH 同版本换目录、更新结果核对、失败后原链接恢复、跨 profile 及目录联接互斥、超时阻断及损坏锁处理。模拟 CLI 不代替真实宿主安装验收。
- 本机 DSH 官方 CLI 在一次性 DSH_HOME 中完成本地测试插件 `0.0.1 → 0.0.2` 更新，实际链接切到新目录；临时目录已清理。这验证命令可用于升级，不代表真实宿主中的工具握手及画面验收完成。
- 源 SVG 与用户指定文件的 SHA256 一致；两份 ICO 字节一致，均含 16、24、32、48、64、128、256 像素的完整 PNG 图层。真实 Electron 独立目录验证标题栏、设置导航、关于页与首次引导图标加载和比例，测试实例已退出。
- DeepSeek 回归覆盖两种音色的官方请求字段、分块音频完整收集、缺密钥与错误音色、空音频与非音频响应、HTTP 错误脱敏和断流失败，以及服务切换时的配置与密钥隔离。
- 真实 Electron 独立数据目录下通过设置页切换、两种音色选项、不支持控件隐藏、密钥加密落盘、试听 IPC 到本机模拟服务、音频播放结束、刷新后恢复音色、切回其他服务恢复控件。测试实例已退出；未使用真实 DeepSeek Key，未改日常数据。探测运行进程用 `Get-Process -Name Uta,electron -ErrorAction SilentlyContinue`。

## 4. 已知未修问题

- 不同模型的参数联动、长原生动作的 MCP 临时预览时限和目录兜底扫描深度仍有约束。第三方模型观感需按实际模型确认。
- Qoder、Antigravity、Claude Code 的目录识别修复仍在原有未提交代码中，公开快照的自动安装入口会误报资源缺失，README 指引手动安装。宿主语音识别在途实现同样未纳入首版；不得在公开 README 中宣称可复用 DSH 识别服务。
- 取消跟踪只影响当前提交，已有历史仍含第三方文件。本地历史保留，GitHub 首次公开使用当前提交导出的无历史源码快照。Core、Hiyori 和其他模型保留独立条款及署名，不归入 Uta 的 MIT 许可。AIRI 构建参考见 [配置](https://github.com/moeru-ai/airi/blob/v0.15.1/apps/stage-tamagotchi/electron.vite.config.ts)。

## 6. 下一步建议

- 在隔离的真实宿主配置中验收连接器从旧目录升级、Codex 路径选择和 MCP 握手；日常宿主配置及程序入口保持用户现有状态。现有打包版不会随源码提交更新。
- 在真实 DSH 中打开两个实例，重载连接器后检查选定会话的文本和语音入口。后续按 [Windows 自动验收](OPERATIONS.md#windows-自动验收)检查候选包。

## 7. 未核实项

- DeepSeek 真实付费 API 的音质、服务延迟与账号权限；此次试听只验证本机模拟音频的完整链路。主线提交只包含本轮 TTS 与相应说明，已有宿主语音识别和开源发布条件的未提交改动单独保留。
- 真实 DSH 麦克风识别、日常数据升级、独占全屏与多屏表现。标签发布路径保留待实际版本发布时验证；本轮不为测试创建 Release。
- 本轮隔离构建不会替换既有日常程序。交接历史见 [上一轮现场](archive/HANDOFF-chat-display-20261108.md)。
