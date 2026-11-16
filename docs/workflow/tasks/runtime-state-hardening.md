# 会话与说话状态收尾修复

Owner：Codex。首批运行正确性任务，用户已授权规划后实施。基线、分支、profile 以 operations/assignments/codex-runtime-state-hardening.json 为准。

目标：可见会话/宿主切换时结束旧聊天流，清 ReplySpeechTracker 缓冲/去重，取消旧 TTS 和通知脉冲，复位 thinking/speaking；新会话复用 requestId 不拼旧正文。历史消息保留，同一会话正常增量/replace/final 去重不回归。非活动宿主的 session_bind 不扰动当前画面。

统一宿主变更与显式/隐式会话绑定的收尾入口；仅连接状态更新不当作切宿主。流式开始使旧通知脉冲失效；流中插入通知也不能让脉冲到时关闭仍活动的回复。旁白/看门狗增加 dispose 并接卸载。保持 legacy 指令兼容；不清全部历史掩盖问题。

允许：DeskpetStage.vue、runtime-command-controller.ts、agent-presentation-controller.ts、reply-speech.ts、stores/chat.ts、useCompanionDirector.ts、必要相关测试/本任务结果。优先使用现有 tts.cancel，不改 TTS 服务实现。禁止修改预设控制器、设置诊断组件、main/preload、持久设置迁移或其他任务源码。

验收：组合回归覆盖 A→B 复用 requestId、旧分片拒绝、手切宿主与连接状态更新、通知脉冲前/中插入流、空 done/watchdog、取消音频和计时器、卸载后无写入。应用/插件/类型检查/构建由 Codex 统一执行。交付 docs/workflow/results/runtime-state-hardening.md，含 base/head、测试与未验证 GUI/音频限制。
