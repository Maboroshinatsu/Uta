# 桌面首批交付：主控审查与集成

日期：2026-10-23。结论：**两项均在主控修正后通过源码集成验收**。不是新ZIP发布，不是完整Q04/C02完成，也不是生产设置/Live2D新链路已接线。

## 候选与范围

| 任务 | 冻结base | 实际审查head | 结果 |
| --- | --- | --- | --- |
| Qoder：模型能力识别纯模块 | edca60b8f7f31dbbac4d607a4bb4e6ca64102bfe | 0814bfd1bea3467525420dea931c01bdd9b730ad | 56项行为测试通过；明确shared类型项目范围后接受 |
| Antigravity：蓝色组件与语音代表页 | 同上 | de6325788912a3b58901e5e14a6089ab74cb7c93 | 原7项控制器测试通过；真实页面暴露生命周期/测试状态问题，主控修正后接受 |

两Worker实际head、branch、clean状态、允许路径和三个契约hash均核对；没有改main或共享契约。桌面思考/上下文实际生效档位未独立验证，不从报告推断后端上限。

主控集成区：`D:/Frankenstein/Uta-Workspace/tasks/codex-desktop-wave1-review`，profile `codex-desktop-wave1-review`，工作区独立npm ci。主控修正提交：`608cf72`。所有最终merge head以实际Git与operations记录为准。

## 主控发现与修正

1. **切页丢失草稿与内存保存值**：原App用v-if销毁VoiceSettingsPage，controller随之重建；浏览器已复现修改模型后切页返回恢复默认。改为保持该页面实例，新增真实App/SFC挂载测试验证未保存/已保存值跨页保留及取消恢复。
2. **测试pending状态没有及时显示**：原handleTest等Promise结束才sync，导致loading/取消入口缺失。现在启动即sync，显示取消，取消/切provider/关总开关均使旧结果失效；已保存后再编辑会清除旧成功提示。
3. **save-error越过类型**：补齐状态联合，移除as any状态绕过。
4. **标签与IME边界**：SettingsRow关联input/range id，输入错误有aria-invalid/describedby，Enter兼顾composition标记与229；补键盘焦点。
5. **共享类型项目范围**：把src/shared/**/*.ts明确纳入web composite include，直接导入契约，删除临时声明转发；不复制类型。
6. **导航范围漂移**：保留Bento视觉，将记忆/技能等占位恢复既定六领域，不把可选视觉方向变成新增产品功能。
7. **可读性**：抽查发现浅色muted约3.33:1、深色muted约3.06:1、深色蓝按钮白字约3.65:1；提高文字/状态配色并采用主题前景token。抽查不是完整WCAG审计。
8. **测试未纳入常规脚本**：主控统一注册两Worker与页面回归用例，避免后续npm test漏跑。

Qoder提出的两个语义问题已裁决：未确认override不覆盖健康标准映射，符合冻结优先级；零范围暂沿用needs-calibration/ambiguous，不为本批扩共享枚举。真实模型签名、资源加载和渲染接线仍未实施。

## 视觉决定

本轮用户确认在Antigravity桌面已采用新的Bento方向，主控保留；旧蓝色大块规范仅作历史参考。见 [当前视觉决定](../../design/bento-design-decision.md)。不以旧色块面积拒收新布局。

## 实际验证

| 检查 | 主控结果 |
| --- | --- |
| 冻结契约类型与fixture | 通过，3个预期非法shape仍被拒绝 |
| 原Qoder行为用例 | 56/56通过 |
| 语音控制器（含主控补充） | 9/9通过 |
| 真实App/SFC页面回归 | 3/3通过：跨页保留、pending/cancel/旧结果、label/error/IME |
| npm test集成 | **356/356通过**，日志在operations/desktop-wave1-app-tests.log |
| npm run typecheck | node/web通过 |
| npm run build默认TEMP | 失败：esbuild删除系统Temp文件Access is denied，已复现Worker报告 |
| npm run build任务内TEMP/TMP | 通过；仅该构建进程使用app/node_modules/.uta-review-tmp |
| 独立预览vite build | 通过，out/settings-preview；CSS最后修正后已重新构建 |
| 浏览器真实操作 | 跨页草稿保留、模拟失败→重试成功且仍未保存、pending状态、标签、深浅主题通过 |

没有为了“全绿”删除默认TEMP失败记录，没有改系统权限/全局环境。CJS Vite与旧Cubism脚本构建提示仍存在；本批没有升级依赖或渲染器。

未运行本轮插件套件（未改插件或宿主链路）、真实音频、Windows125/150%缩放、真实Live2D新参数写入或新ZIP。浏览器预览检查不替代上述验收。

## 进程、数据与下一步

本轮只启动独立浏览器预览，未启动产品Electron、未触碰日常profile/stable、未安装插件。预览地址 `http://127.0.0.1:9292/settings-preview.html`；实际PID/创建时间/命令在operations/desktop-wave1-review/preview-process.json，清理前核实身份，不能按历史PID盲停。

主目录三个既有脏规划文件保留；blue-block-design-spec显示脏状态但归一化Git内容hash与HEAD相同，仍不覆盖其现场。两Worker原分支保留原交付SHA，主控修正只在集成分支，不强推/重置其桌面现场。

下一批建议先冻结统一设置读写与窗口接口，或推进模型能力读取适配与表现仲裁的独立设计；需另建任务与确切契约，不自动在旧任务分支追加。Codex仍决定合并，日常提升仍需独立ZIP解压exe验收。
