# 真实 Core 模型能力读取适配器

`inspectCoreModel(core: CoreModelView, request: CoreInspectionRequest): CoreInspectionResult`

把已初始化的 Cubism Core 参数快照与已读取的 CDI / physics / exp3 / motion3 JSON 转成首批冻结的 `ModelInspectionInput`，再交给已合并的 `buildModelCapabilityProfile` 校验。模块不加载 PIXI、不读文件、不算哈希、不写 Core、不访问网络。

## 调用方职责

- 负责 Core 生命周期：调用本模块时必须已初始化；卸载后不可再传入。
- 负责读取 JSON 并做原始文件大小限制；本模块只接收已解析对象。
- 负责提供不透明内容签名（`request.modelSignature`）；不能用路径冒充。
- `request.overrides` 原样进入首批 profile 校验；非法 override 会映射为 `invalid-profile`。

## Core 读取

只读取 `core.parameters` 的 `count / ids / minimumValues / maximumValues / defaultValues`：

- `count` 为 0..4096 的整数；
- 四个数组长度必须恰好等于 `count`；
- ID 非空且唯一；数值有限；`min <= default <= max`；
- 接受普通数组、typed array 或任意对象式 ArrayLike；
- getter 抛错或不完整读取返回 `invalid-core`，不向调用方抛出；
- 零参数合法，能力由 profile builder 全部降级为 `unsupported`；
- 不修改 Core，不在输出中保留 Core 数组引用。

## metadata 转换

输入是已解析 JSON。请求与 `metadata` 包装层拒绝未知字段；CDI/physics/exp3/motion3 文档本身允许 Cubism 标准中不消费的字段。

- **CDI**：读取 `Parameters[].Id/Name`。Id 非空唯一，Name 必须为字符串；空白 Name 不写入 label。未知 Core 的 CDI Id 忽略，不伪造参数。
- **physics**：汇总 `PhysicsSettings[].Output[].Destination` 中 `Target=Parameter` 的 `Id` 为物理输出。兼容 `Destination` 为单个对象或对象数组（真实 DS 样本使用单对象）。其它 Target 不作为参数输出；未知 Id 只影响是否命中真实 Core 参数。
- **expressions**：每个资源为 `{ name, json }`。读取 `Parameters[].Id/Value/Blend`，Blend 仅 Add/Multiply/Overwrite 且原样保留；name 唯一；空 Parameters 合法。
- **motions**：每个资源为 `{ group, index, json }`。读取 `Curves[]`，Target 仅 Parameter/Model/PartOpacity；只有 Parameter 曲线进入 `parameterIds` 并按首次出现去重；`group#index` 唯一。
- **限制**：资源总数（expressions + motions）最多 1024；单份文档规范化 JSON 最多 8 MiB。原始文件字节上限由调用方/测试采集器在读取前另行执行。

## 输出与错误

成功返回 `{ ok: true, input }`，其中 `input` 是全新数组/对象，overrides 也会浅拷贝；修改返回值不会污染 Core 或 metadata 输入。

失败返回结构化 issues，三类代码：

- `invalid-core`：Core 快照不可读或范围非法；
- `invalid-metadata`：请求/元数据结构非法、资源超限、JSON 不可序列化；
- `invalid-profile`：既有 profile builder 拒绝输出（签名、override、资源等），message 保留原 builder 错误码，path 保留 builder 的逻辑路径。

相同输入结果确定，不使用时间或随机值。

## 测试支撑

`app/tests/support/model-inspection-fixture.cjs` 是仅 Node 使用的采集器：验证任务内 manifest 的逐文件 SHA、引用与内容签名，以有界重试初始化真实 Core/MOC，读取真实资源，并在测试结束时释放。renderer 纯模块不引入 fs。
