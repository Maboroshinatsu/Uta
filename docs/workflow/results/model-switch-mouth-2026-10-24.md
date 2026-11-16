# 模型切换时隔离口型尾状态

日期：2026-10-24
功能基线：main `12d6efe`（任务单记录的代码起点 `c00f49d` 已在该基线中）
状态：完成并已验证；按任务要求本轮到此停止。

## 复现

先新增回归并在修复前运行。测试真实驱动 `useStageRenderLoop` 的 RAF，并调用 loader 的真实 `setModelLipSync`，Core 替身记录模型 ID、参数、值和释放顺序。

- 模型 A 说话后进入正常收口尾段，再替换成空闲模型 B：修复前 B 的 `ParamMouthB` 收到 A 的旧尾值 `0.2543222993`；B 原始默认值为 `0.6`，且当时没有说话。
- 同一模型把 mouth 参数从 A 改成 B：修复前旧参数仍停在 `0.6640890188`，没有交还到它自己的默认 `0.25`。
- 活动 TTS 切换时，RAF 继续用 A 的平滑值计算 B，而不是从当前音频输入与 B 的绑定接管；修复前新绑定断言失败。

## 实现

只改 `useStageRenderLoop.ts`、新 RAF 回归和 app 测试清单。

- 嘴部平滑状态按模型对象与 `mouthOpenParam` 绑定。绑定改变时，若旧模型仍存活，就通过既有 `setModelLipSync(old, oldParam, 0, false)` 释放；若 `destroyed === true`，不再访问旧 Core。观察到模型为 `null` 时也清理本地绑定，并仅对仍存活的旧模型释放。
- 空闲切换将新绑定的局部电平置为 0，不向 B 写一个人为的 0，因此 B 保留自己的表情/默认值。活动 TTS/流式说话则从当帧输入接管，保留播放器或文本时钟，不重播、不重置。
- 流式文本时钟现在不依赖模型是否存在，每帧照常推进；短暂 model-null 不会重启说话时钟。
- `lastMouthVal` 保持归一化输入值 `[0,1]`。模型或参数更换时重采当前输入；静音时从 0 起。`gain` 只是每帧输出乘数，不作为绑定键：同模型调 gain 时保留归一化平滑；测试验证新 gain 应用于该归一化值，而不是旧 Core raw 值。新绑定的输入会先做有限值检查与 `[0,1]` 限幅。
- 未改 TTS 播放器、公开设置、mixer 契约、main/preload、模型文件或正式数据；没有进入持续 owner 或新表现引擎。

## 验证

- 新增 8 项 composable RAF 行为测试：旧收口尾隔离；旧模型仍存活时经既有 API 释放；活动音频换模型后从当前采样及新 gain 接管；同模型换 mouth 参数释放旧 ID；A→null→B 且 A 已销毁时不读 Core、流式时钟继续及文本增长；普通语音结束保留收口并恢复模型默认值；输入限幅；同模型 gain 调整仍在归一化空间平滑。
- `node --test tests/stage-mouth-binding.test.cjs`：8 通过，0 失败。
- `npm test`：744 项，739 通过、5 跳过、0 失败。
- `npm run typecheck`：node/web 通过。
- `npm run build`：通过。Vite 提示 CJS API 弃用及 Cubism Core script 没有 `type="module"`，不影响本次构建成功。
- 最终 Electron 验收使用 profile `model-switch-mouth-20261024`、本地静音 PCM 与实际 TTS→stage→Core 路径。从内置 Hiyori 切到 DS 时，Audio id 保持 1，实例数仍为 1，播放时间从 `0.358577s` 继续到 `1.062553s`；新 DS Core 在有声段开口约 `1.0`。PCM 静音段 `currentTime=4.032812s` 时，连续 8 个 Core 样本最大开度 `0.000565`，而 speechActive 仍为 true；6.53s 有声段恢复开口；Audio 自然结束后 speechActive 变为 false。59 个冻结 DS 文件 hash 不变。
- PCM 音量为 0，服务只绑定 `127.0.0.1`。这验证播放时钟与真实 Core 参数接线，不声称人工听感、外部宿主握手或网络欠载场景通过。

## 现场与保护项

- 日志和脚本在 `D:/Frankenstein/Uta-Workspace/operations/model-switch-mouth-2026-10-24/`：`scoped-tests.log`、`app-tests.log`、`typecheck.log`、`build.log`、`electron-verify.log`、`results.json`、`process-switch.json`、`verify.mjs`。
- Electron 进程 `25652`（`2026-10-24T13:30:03.7263156+08:00`）已退出；9312/9313 无监听，临时 endpoint 文件已移除。本轮未停止原开发实例。
- 接管前四份受保护文档 hash 再核对一致；正式 AppData/DS 模型/stable/日常 exe/ZIP 未改。
- 最终全套测试首次在受限运行时因临时目录 `realpath` 的 EPERM 与 localhost EACCES 报失败；按正常受控审批重跑后通过，未修改全局权限。
