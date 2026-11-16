# DS 鼠控版：Live2D 验证与分发基准

登记：2026-10-23。用户指定此模型为后续Uta的基础/分发模型，并明确表示模型作者支持分发。依据是用户确认与目录现有MODEL-NOTICE.txt；未将其写成已独立核实全部上游授权链。该决定不要求再次申请同一项授权。

## 来源与署名

当前源目录：`C:/Users/Administrator/AppData/Roaming/uta/models/DS鼠控版`。仅用于本机定位，不应把用户名/本机路径写进最终用户分发清单。原模型和个人设置未修改。

原署名文件记录：角色形象由上善无形「溟月」，经ZipZipPipe女仆鲸鱼娘，到氵六青Live2D化；Live2D绑定、动作、表情作者为氵六青；参考项目名为Andersen216 / dsh-whale-girl-live2d。保留这些署名及原MODEL-NOTICE.txt，后续补来源链接时必须核实，不凭项目名捏造下载地址。

模型资产按 **CC BY-NC-SA 4.0** 管理：分发保留署名与许可链接、说明修改；仅用于非商业用途，改编版本按相同许可共享，不加额外限制。依据：[官方许可说明](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)。模型资产许可与Uta的GPL-3.0代码声明分别记录，不能把资产改标GPL或暗示作者为Uta背书。

## 冻结快照（仓库外）

- 位置：`D:/Frankenstein/Uta-Workspace/assets/ds-control-baseline-v1`。
- 主入口：`c_0120.model3.json`；依据model3声明收集引用资源与原署名，共59个文件，4,141,300字节。
- 内容签名：`8f6042a7ff5060b5f4f84684d49f3a4fd48e81270616124467baf0a8815341c9`。对排序后的资源相对路径/SHA256计算；不含署名文件与诊断产物。确切算法与逐文件hash见仓库外snapshot-ds-model.cjs/baseline-manifest.json，不能另用“MOC hash”当成同一签名。
- 声明44个表情、8组/8个motion、EyeBlink两个参数；LipSync组为空。
- 排除个人deskpet-presets/deskpet-adapter、VTube设置、历史备份、未引用图片。排除不表示这些文件无用，只是不把个人配置当公共模型能力或分发必需品。

快照复制时逐文件检查来源/目标内容hash与目录边界；模型资产没有入Git。MODEL-NOTICE原文未改。源目录有历史备份，无法从此次本机快照证明原始下载以来从未修改；本轮仅选择文件/复制，未修改模型引用资源。以后制作分发包需区分既有本地状态、本轮调整、后续修改。

## 已完成的真实 Core 检查

使用仓库所带Cubism Core 5.1.0读取快照MOC：**247个参数、92个parts、269个drawables**。结果在快照core-inspection.json；探针在operations/probe-ds-core.cjs。model/moc已释放，未渲染、未向正式桌宠发送控制指令。

| 参数 | min | max | default | 设计含义 |
| --- | ---: | ---: | ---: | --- |
| ParamMouthForm | -2 | 1 | -0.5 | 不对称范围，须分段归一化/还原，不能固定默认0 |
| ParamMouthOpenY | 0 | 1 | 0 | LipSync组为空不代表不存在开合能力 |

这不是自动映射全部已确认，也不是口型/动作的画面验收。下一步Qoder读取全部实际范围、CDI标签、物理输出及原生资源，保守输出能力。模型不是通用算法的唯一测试对象，私有参数不能凭名字擅自驱动。

## 后续发布检查单

1. 从冻结快照构造模型资源子包，保留原署名；新增Uta模型清单，写模型作者/来源、CC许可URL、用户确认分发的记录、实际修改与版本。最终包不带本机路径、个人预设或探针输出。
2. 如果随ZIP交付：在构建暂存目录放入模型与许可，并验证解压后的exe首启从包内资源复制到正确userData；不能覆盖已有同名模型/用户预设。代码接线、升级策略和哈希校验另开发布任务，本批没有实现。
3. 用独立集成profile检查全部引用资源、缺失/损坏降级、模型切换/卸载、物理与嘴部范围、动作结束释放、语音暂停和取消；视觉/音频验收后再做ZIP分发。
4. 保留本地快照与结果对应关系，禁止把“文件可读”或“HTTP accepted”写成实际画面已通过。目前日常Uta.exe及stable登记保持原版本。
