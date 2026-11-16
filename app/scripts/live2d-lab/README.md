# Live2D 参数与动作实验（开发用途）

先标定，再编排；用真实画面反驳参数名带来的猜测。本工具需要已构建的 Uta、Electron 和本地模型。它会复制模型，创建临时 appData/profile/runtime，不连接日常端点，不改模型源文件。不要把此工具或 app/out 称为日常发行版。

在 app 目录启动，Windows 使用 Start-Process 并将 stdout/stderr 重定向到文件，避免 Electron 因调用工具结束而阻塞。示例中的模型目录和结果目录需替换为本轮路径：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath '.\node_modules\electron\dist\electron.exe' -ArgumentList @('scripts/live2d-lab/launch.cjs','--model-dir','D:\local-model-copy','--output','D:\lab-results') -WindowStyle Hidden -RedirectStandardOutput 'D:\lab-stdout.log' -RedirectStandardError 'D:\lab-stderr.log'
```

结果目录 `runtime.json` 记录本次 PID/临时根目录和 renderer 错误；不含端点凭据。窗口模型加载后，以 UTF-8 将下列对象写入结果目录 `request.json`，完成后读 `response.json`。每次等待前一请求完成，避免覆盖请求；长 sweep 的 `progress.json` 会逐项更新。只对本工具创建的隔离窗口操作。

1. `{"command":"install"}`：等目标模型独立上台后安装试验钩子，保存 `rig-info.json`。冻结原生 motion、视线与其他无关输入，保留物理演算。能力档案缺失时，以 `lab-sha256:` 标记实验副本的资源指纹。
2. `{"command":"sweep","name":"body","settleMs":1500,"cases":[{"label":"neutral-a","parameters":{}},{"label":"neutral-b","parameters":{}},{"label":"AngleX=-12","parameters":{"AngleX":-12}},{"label":"return","parameters":{}}]}`：每项至少等三帧，再等待指定的物理稳定时间。记录读数帧、截图期间的帧范围、物理前输入、渲染值和物理输出。帧不推进时当前请求会报错。只使用实际清单中存在且不越界的数值。
3. case 默认 `mode: "input"`，在物理前写入，后续 Uta 层仍可能修改请求值，用于识别覆盖；`mode: "output"` 在物理后直接覆盖请求值，仅用于识别底层变形，不能据此声称正式播放链路已生效。
4. 条件依赖实验需在每个 case 重复完整上下文（例如手部开关与其余关节）。与同上下文的 reference 比较，不能把整条手臂出现产生的像素变化记到某个手腕参数上。
5. `analyze.py <结果子目录>` 用 Pillow 输出像素变化和可读联系表。先检查重复基线/回归基线和截图中的气泡、眨眼、服饰等干扰；像素计数只用于筛选，不能代表自然程度，也不能把单一姿态无变化判为参数永远无效。
6. `{"command":"record","name":"candidate-a","fps":15,"duration":12,"code":"..."}`：code 在本地实验 renderer 内执行；可调用 `window.live2dLab.animate(fn)`，fn 每帧接收秒数并返回参数对象。它适合试验，不替代最终 Cubism 动作和所有权验收。

全部结论须绑定 `rig-info.json` 的模型资源签名。已有试验钩子不支持重新 install 来复原正常播放；结束标定后退出此进程，在干净实例用生产播放器验收循环、停止、打断、视线和静态控件冲突。退出仅需在结果目录写入 `quit.flag`。保留数据但再次使用同一输出目录时先移走旧 quit.flag；正在运行的输出目录禁止复用。

交付区分三层：已收到数值、已在画面观察到影响、动作已通过动态比较。初筛未观察到变化的参数、物理输出、分隔符和本轮未测项分别保留，不合并成“无效参数”。原生动作曲线仅在用户明确授权复用时才可用；这次独立编排不使用它们。

对照时读取Pinia运行时的 gazeFollowEnabled、idleActionsEnabled 和 hoverFadeEnabled；只写 localStorage 的历史键可能被规范设置覆盖。2026-11-02已修正关闭视线后瞄准画布中心而非零偏移的行为。头固定对照须读取渲染前AngleX/Y/Z，不能只检查动作JSON。默认完整头身动作不可代替“头固定、身体仍可见”的对照。
