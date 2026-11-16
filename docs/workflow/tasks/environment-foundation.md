# 开发环境隔离与 ZIP 发布基础

Owner：Codex。状态：已验收合并；ZIP 解压版已登记并切换为日常实例。

## 目标

开发与日常实例不串写；日常交付为解压运行的 Uta.exe；各平台可读到一致规则。

## 范围

允许修改 profile 解析、运行时/客户端端点路径、相关 hooks 文件路径、主进程初始化、ZIP 打包与本机开发管理脚本、对应测试和文档。跨页面设置存储迁移、现有角色业务缺陷、自动调用其他平台不在本任务内。

## 开发现场

基础提交：`094c0b35994aa2bc87155ac4b149c961e4ca78f4`。本机任务分配表位于仓库外 operations/assignments。

工作分支：`task/codex/environment-foundation`。

工作目录：`D:/Frankenstein/Uta-Workspace/tasks/codex-environment-foundation`。

profile：`codex-environment-foundation`。个人设置、token、日志、模型不入 Git。

## 验收

1. 未打包源码默认进入与工作目录绑定的开发 profile；ZIP 中 exe 默认使用正式 profile，显式测试 profile 仍可覆盖。
2. 独立 profile 的 userData、端点、hooks、模型迁移及快捷键不影响日常实例。
3. 显式端点失效不得回退；设置冲突明确失败；端点发布失败关闭监听。
4. 类型检查、app/插件相关回归、生产构建通过；ZIP 解压后的 exe 在独立 profile 下真实启动并通过认证健康检查。
5. 交付记录确切提交、测试、产物路径、当前阶段限制和下一步。由 Codex 集成。
