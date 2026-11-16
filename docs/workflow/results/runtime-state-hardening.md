# 会话与说话状态收尾修复

Owner：Codex。base `476f1cf6530fbf5449fae5ab840f82518c341057`；实现提交 `ac5d162ecd24804a9f8bd29c3de69a17fb93a91c`。分支 task/codex/runtime-state-hardening，profile=codex-runtime-state-hardening。

## 实现

- RuntimeCommandController 统一可见会话/宿主变化的收尾：结束旧流并保留历史、清语音缓冲/去重、取消 TTS 与气泡脉冲、复位 thinking/speaking 和待播动画；连接健康变化不会重复复位，非当前宿主的绑定不扰动画面。
- 聊天/语音内部流键纳入 host/session/requestId，避免重复请求 ID 串台；无 requestId 的临时回复与字面 inline 请求区分。超时结束遗留流并丢弃不完整语音；正常流拼接、replace/done 和 legacy 指令维持兼容。
- CompanionDirector 独立查询真实活动流，通知在流前/流中插入时都不能因 agentWorkingState 已回 idle 而提前关口型。
- AgentPresentationController 增加 dispose，舞台卸载接入；重置会话时清表现状态和该会话的旁白节流，旧看门狗/旁白不再延迟写入。

## 验证

- 现有 npm test：253/253 通过（新增一项旁白/看门狗卸载测试）。
- 新增 runtime-state-hardening.test.cjs：6/6 通过，使用真实 RuntimeCommandController、SessionScope、ReplySpeechTracker、chat Pinia store、AgentPresentationController 和 CompanionDirector，模型 I/O/时钟/TTS 出口替换为桩。
- 相关控制器组合检查 28/28，通过类型检查；日志位于仓库外 operations/project-review-20261022/runtime-state-*.log。
- 新测试总注册交 Codex 集成工作区处理。构建和真实页面检查在三任务合并候选上执行；当前不声称已完成实际音频试听或日常 ZIP 验收。

## 现场与限制

没有启动本任务 Uta 实例，没有改用户数据、模型资源、插件安装或日常入口。自己的 app/node_modules 来自独立 npm ci，无目录链接。跨模块自动回归不等于真实音频和图形验收，后续合并候选须检查接线与画面。
