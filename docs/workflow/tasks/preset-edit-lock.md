# 工坊编辑锁的外部预设入口修复

Owner：Qoder；主控 Codex 审查合并。本批已授权实施，不需要重复请用户确认。模型必须 DeepSeek-Flash，max 思考，1,000,000 token 上下文；不能自动降档。任务目录/分支/base/profile 读 operations/assignments/qoder-preset-edit-lock.json。

目标：presetEditingLocked=true 时，外部 triggerPresetOrGroup（精确预设、分组、情绪 fallback）及 handleControlAction 的 preset/精确 set 预设入口不得改变预览、slider/control、活动预设和计时器。解除锁后正常。handlePresetTrigger 现有拒绝行为保持。工坊用户主动预览/步预览有明确入口并保持可用；用户手动滑杆/控件编辑不要一刀切禁掉。

允许修改仅 app/src/renderer/composables/usePresetController.ts、app/tests/preset-edit-lock.test.cjs 和 docs/workflow/results/preset-edit-lock.md。只读其他相关文件。不要改 app/package.json，总测试注册由 Codex 集成；不要改 DeskpetStage、CompanionDirector、chat/store、SettingsPanel、main/preload 或迁移存储。

先核对所有 applyPresetByEntry 的调用者与预览入口，选择最小集中判定避免旁路。新增真实调用控制器的行为测试，检查锁中无副作用、无锁正常、分组/情绪 fallback/控件 preset/set、显式工坊预览能工作。禁止只用正则断言实现。

不调用 Uta MCP、不启动应用、不全局安装插件、不读取个人设置/端点/密钥；Shell 未开放时不要反复试探，测试和提交可由 Codex 在交付后执行。直接实现并返回确切 diff/测试计划；不得自行合并或发布。其他 Agent 同时修运行状态和设置诊断，严格遵守文件边界。
