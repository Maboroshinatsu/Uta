# Uta — Live2D 模型适配规范 v1

> **这份文档是给 AI 看的。**
> 想让自己的 Live2D 模型响应桌宠的情绪和动作，你不需要懂代码：
> 把**这份文档全文** + **[能力清单](#第一步导出模型能力清单)** 一起发给任意 AI（Claude / ChatGPT / DeepSeek 均可），
> 让它生成 `deskpet-adapter.json`，放进模型目录即可。
>
> 提示词可以直接用：
> *"这是 MaiBot Deskpet 的模型适配规范和我模型的能力清单，请按规范为我的模型生成 deskpet-adapter.json，只输出 JSON。"*

---

## 为什么需要适配

桌宠向模型下达的是**抽象指令**（"开心""挥手"），而每个 Live2D 模型的图层、参数命名、动作分组都是作者自己定的：

| | Hiyori（官方示例） | ariu（VTube Studio 模型） |
|---|---|---|
| 动作组 | `Idle` `Tap` `Flick` `FlickUp`… 7 组 | **没有任何动作组** |
| 表情 | 没有注册表情 | 目录里有 10 个 `.exp3.json`，但**都没注册**进 `model3.json` |
| 微笑参数 | `ParamEyeLSmile` / `ParamEyeRSmile` | 不存在，只有 `ParamMouthForm` |
| 脸红参数 | `ParamCheek` | 不存在 |
| 自定义参数 | — | `aixin`（爱心眼）`qqy`（圈圈眼）`heilian`（黑化） |

基础头眼身体跟随和参数叠加由 Uta 自动识别。`deskpet-adapter.json` 用于指定模型独有的表情、动作、部件，以及覆盖自动识别结果：**桌宠语义 → 这个模型的具体表情/动作/参数**。

没有这个文件也能加载模型，并根据实际能力提供基础跟随、口型和通用状态表现；有专属动作时可以继续补充适配。

### 自动适配的范围

- 读取真实参数清单、同名 VTS 配置与物理输入/输出关系，识别头、眼、身体实际使用的输入；明确的 VTS 绑定也支持自定义参数名。
- 将识别结果交给同一套参数层：姿态偏移叠加跟随，眼球区分待机偏移与表演朝向，眼睑保留自动眨眼。过渡和释放使用同一规则，避免把偏移重复存进模型下一帧的基线。
- 物理由头部驱动身体时保留原有联动；存在独立身体输入时才分别驱动。多个候选无法区分时保留未解析通道，不按作者、模型名称或不明参数编号猜测。
- 已有显式 `focus` 配置优先，显式 `null` 继续禁用对应轴。切换模型后重新建立参数规则，不继承上一个模型的自定义通道含义。

这不等于自动理解所有道具、手势或情绪，也不能仅凭文件结构保证每个动作自然。缺少可确认的绑定时，仍可能需要少量显式配置。

### 资源识别与操作入口

- 参数和部件以当前 Core 的真实 ID 为准；CDI 中只有分组用途的容器不生成可操作部件。当前模型在 `model3.json` 声明的 CDI、物理和姿态资源优先，声明的表情与动作不受目录兜底扫描深度限制。
- 显式控件优先；目录表情按 `Add`、`Multiply`、`Overwrite` 与真实默认值转换为控件目标。未知参数与无操作的 `Add 0` / `Multiply 1` 不占用通道。混合表情按参数剔除已识别的水印项，保留脸红等其他功能。
- 控件按完整操作去重。共享参数但目标不同、多个参数的组合操作、同名但不同部件的操作都保留。资源文件保留模型相对路径；同名表情仅允许通过无歧义的别名或完整文件路径引用，模型清单中的注册名也可用。
- 滑块优先采用已确认的 focus、标准参数与 VTS 绑定，分组名含“物理”不再单独构成排除理由；实际物理输出、底层常驻参数和已由控件管理的参数仍排除。署名文本不当成功能名，无法确定名称时回退参数 ID。
- 原生动作保留真实的 `group` / `index`，包括 `group: ""`；界面优先显示文件标签。场景动作保留并标注。能力接口列出可用的长动作，临时 MCP 编排仍有 12 秒上限，超长片段会明确拒绝；可在模型动作库或预设中使用。
- 关闭控件时按 Core 参数表或 SDK 索引接口恢复默认值，包括非零和负默认值；不依赖可选的 `getParameterDefaultValueById` 包装方法。

### 循环播放

循环预设的首步 `durationMs` 只用于首次进入；后续每轮末帧直接接首帧，不再插入末帧到首帧的过渡，也不等待一次首步入场时长。首步明确设置的 `holdMs` 仍保留。多步循环导出使用同一条时间线；原生动作由 SDK 连续循环且不逐轮淡入，单步绑定原生动作也支持循环。若首尾姿态不同，直接衔接会产生跳变，需在动作本身安排好首尾姿态。

### ⚠️ 一个必须知道的坑

Cubism 运行时对**不存在的参数 ID 是静默接受**的 —— 写进去不报错、也没有任何效果。
动作组名写错同样只是静默不播。所以**适配写错的表现是"完全没反应"，而不是报错**。

正因为如此，桌宠内置了加载时校验（见[第四步](#第四步校验)）。**先看校验报告，再检查实际画面；参数存在不代表动作效果已经验收。**

---

## 第一步：导出模型能力清单

这是整个流程最关键的一步，也是唯一必须在桌宠里做的操作。

**为什么必须这样做**：参数 ID 存在 `.moc3` 二进制文件里。`.cdi3.json` 会列出参数清单，但它是**可选文件**，很多模型（包括 ariu）根本没有。所以光靠读模型文件，AI 无法可靠地知道你的模型有哪些参数 —— 必须从运行时拿。

1. 把模型文件夹放进 `deskpet-app/src/renderer/public/models/`
2. 启动桌宠，在设置面板（⚙ → 显示 → Live2D 模型）里选中你的模型
3. 按 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> 打开开发者工具，切到 Console
4. 输入并回车：

```js
deskpetInspectModelFacts()
```

5. 复制输出的 JSON。它长这样：

```jsonc
{
  "schemaVersion": 1,
  "modelSignature": "uta-live2d-assets-v1:...",
  "modelUrl": "./models/your_model/your_model.model3.json",
  "motionGroups": { "Idle": 3, "Tap": 2 },
  "parameters": [                                         // 真实存在的参数
    { "id": "ParamAngleX",     "min": -30, "max": 30, "defaultValue": 0 },
    { "id": "ParamMouthForm",  "min": -1,  "max": 1,  "defaultValue": 0 },
    { "id": "ParamMouthOpenY", "min": 0,   "max": 1,  "defaultValue": 0 }
  ],
  "expressions": [                                        // 已注册表情及实际写入方式
    { "name": "smile", "parameters": [{ "id": "ParamMouthForm", "value": 1, "blend": "Add" }] }
  ],
  "unregisteredExpressions": ["同目录可用、但未写进 model3 的 exp3 名"],
  "motions": [                                            // 每条动作的结构事实，不代表语义已验收
    {
      "group": "Tap", "index": 1, "durationMs": 2100, "loop": true,
      "curveTargets": {
        "Parameter": { "curveCount": 33, "targetIds": ["ParamAngleX"] },
        "Model": { "curveCount": 0, "targetIds": [] },
        "PartOpacity": { "curveCount": 2, "targetIds": ["PartArmA", "PartArmB"] }
      }
    }
  ],
  "parts": [{ "id": "PartArmA", "name": "左臂" }],
  "poseGroups": [["PartArmA", "PartArmB"]],
  "bindings": {                                           // adapter 原始绑定
    "idleMotions": ["Idle"],
    "lipSync": { "mouthOpenParam": "ParamMouthOpenY", "gain": 1 },
    "focusSource": "adapter",
    "baseParameters": {},
    "hiddenParts": [],
    "hiddenDrawables": [],
    "emotions": {},
    "animations": {},
    "controls": {}
  },
  "resolved": {                                           // 应用实际生效的控件与常驻参数
    "baseParameters": {},
    "controls": [{
      "id": "hat", "label": "帽子", "category": "outfit",
      "parameters": {}, "active": false, "source": "adapter",
      "defaultActive": false, "hiddenParts": [], "shownParts": []
    }]
  },
  "diagnostics": []                                       // 缺失资源、参数争用和待画面验收项
}
```

**只有出现在这份清单里的参数、表情、动作和部件名才能写进 adapter。** 这是硬约束。`unregisteredExpressions` 里的同目录 `.exp3.json` 也可以直接引用。`diagnostics` 里的 `missing-*` 是结构错误，必须先处理；`motion-semantic-needs-review` 只说明还需要看画面，不能当作动作语义已经成立。

`deskpetInspectModelFacts()` 在应用内模型加载完成后调用，会带上有效控件、部件、pose 组和未注册表情；如果它返回 `null`（性能 profile 没有建立），再用旧的 `deskpetInspectModel()` 兜底。旧入口仍保留，但不再是首选。

动作的时长、循环和曲线目标只能证明它“驱动了什么”，不能证明它视觉上就是“挥手”；`motion-semantic-needs-review` 必须按语义逐项看画面确认。

### 内置适配与本地覆盖

适配现在有两条来源，按以下顺序解析：

1. 模型目录里的 `deskpet-adapter.json`：本地文件，永远优先，适合用户/AI 修改。
2. 程序内置适配目录：按模型的 `modelSignature` 精确匹配，随程序版本发布；目前包含已验证的大肥鱼 adapter。
3. 自动草稿/空适配：没有本地或内置匹配时使用。

内置适配**不会按文件夹名或模型名猜测**；模型签名变化后自动跳过内置适配，回退到本地或草稿。`deskpetInspectModelFacts()` 的 `source.adapter` 会标明 `deskpet-adapter`、`builtin-adapter` 或 `runtime-defaults`。

内置适配只能提供静态绑定（情绪、控件、idle、focus、隐藏网格、口型），不能补回缺失的模型资源。模型仍需完整导入；动作/表情文件缺失时内置适配也不会凭空产生它们。

---

## 第二步：文件位置与格式

文件名固定为 `deskpet-adapter.json`，放在**与 `.model3.json` 同一个目录**：

```
public/models/your_model/
├── your_model.model3.json
├── your_model.moc3
└── deskpet-adapter.json      ← 放这里
```

### 完整字段说明

```jsonc
{
  "version": 1,                      // 必填，固定为 1
  "modelId": "your_model",           // 选填，标识用
  "name": "角色名",                   // 选填，日志里显示

  // ── 待机动作 ──────────────────────────────
  // 选填。空闲一段时间后随机播放其中一个组。
  // 不写则按组名猜（含 idle/neutral/normal/stand/wait 的组）。
  // 模型没有动作组就留空数组。
  "idleMotions": ["Idle"],

  // ── 口型同步 ──────────────────────────────
  // 选填。默认 { "mouthOpenParam": "ParamMouthOpenY", "gain": 1 }
  // 你的模型张嘴参数不叫这个名字时**必须**声明，否则说话时嘴不动。
  "lipSync": {
    "mouthOpenParam": "ParamMouthOpenY",
    "gain": 1.0                      // 幅度缩放，0.1~4；嘴张太大就调小
  },

  // ── 底层常驻参数与部件隐藏（去水印/初始修正）──
  // 选填。桌宠会自动扫描模型目录下的 .exp3.json / .cdi3.json / .vtube.json，
  // 识别出"去除水印 / shuiyin"等开关并自动写入底层；你也可以在这里显式覆盖。
  // 底层参数常驻生效，绝不会因为 6 秒情绪回退或控件重置而失效。
  "baseParameters": {
    "Paramheadxy": 30
  },
  "hiddenParts": [],

  // 选填。按 drawable ID 隐藏网格。适合“只作蒙版源、不该显示”的黑块/占位网格：
  // 只跳过正常绘制，仍保留它给眼镜等部件做蒙版裁剪的能力。ID 可在模型编辑器
  // 或运行时检查工具里看到；写错不会报错，只会在 Console 里提示找不到。
  "hiddenDrawables": [],

  // ── 鼠标视线/头部跟随 ──────────────────────
  // 选填。默认写标准 ParamAngle / ParamEyeBall；VTS 模型常把面捕映射到
  // 自定义控制器（AngleX/Y/Z、PositionX/Y/Z），在这里显式指定。
  // headScale/bodyScale 是参数在满偏时的值；eyeScale 是视线倍率。
  "focus": {
    "headXParam": "AngleX",
    "headYParam": "AngleY",
    "headZParam": "AngleZ",
    "headScale": 30,
    "eyeXParam": "ParamEyeBallX",
    "eyeYParam": "ParamEyeBallY",
    "eyeScale": 1,
    "invertEyeX": true,
    "bodyXParam": "PositionX",
    "bodyYParam": "PositionY",
    "bodyScale": 30
  },

  // ── 持久模型控件（服饰/发型/道具/特效开关）──
  // 选填。桌宠会自动从 .exp3.json / .cdi3.json 中提取按键/发型/外套/道具等控件，
  // 并上报给 AI（麦麦可通过 set_deskpet_control 工具自行理解和切换，用户也可在设置面板点击切换）。
  // 如果你想自定义控件名称或组合多个参数，可在此显式声明：
  "controls": {
    "戴帽子": {
      "label": "戴帽子",
      "category": "outfit",
      "defaultActive": false,
      "parameters": { "ParamHat": 1 }
    }
  },

  // ── 情绪映射 ──────────────────────────────
  // 内置情绪键（可以只写一部分）：
  //   happy sad angry surprise embarrassed thinking shy curious confused neutral idle
  // 也接受自定义键（如 "wink"）：桌宠会把你声明的键上报给插件，
  // AI 之后就能用 set_deskpet_emotion 触发它
  "emotions": {
    "happy": {
      "expression": "smile",         // 选填，已注册的表情名或同目录下的 .exp3.json 文件名
      "motion": { "group": "Tap", "index": 1 },   // 选填，index 默认 0
      "parameters": {                // 选填，参数 ID → 目标值
        "ParamMouthForm": 1
      }
    }
  },

  // ── 语义动作映射 ──────────────────────────
  // 键必须是这 8 个之一，可以只写一部分：
  //   wave jump spin sit sleep wake dance cheer
  // 只支持 motion（动作组），没有动作组的模型整段留空 {}
  "animations": {
    "wave": { "motion": { "group": "Tap", "index": 1 } }
  }
}
```

### 三层状态栈（去水印 / 控件 / 情绪互不干扰）

桌宠内部维护了**三层参数合成栈**（优先级：`baseParameters` < `controls` < `emotions`）：

1. **底层常驻层（`baseParameters` / `hiddenParts` / `hiddenDrawables`）**：用于永久隐藏作者水印、蒙版源占位网格或修正初始姿态（桌宠会自动识别常见的 `shuiyin` / `去除水印` 表情和参数）。
2. **持久控件层（`controls`）**：如穿脱外套、戴帽子、换马尾、拿手柄/麦克风等开关。开启后持续保持，不会在 6 秒后自动消失；互斥的预设控件（如两种冲突的发型）在切换时会自动关闭前一个。
3. **瞬态情绪层（`emotions`）**：如 `happy`、`angry` 等对话表情，会在 **6 秒后自动切回 `neutral`**。回退时只释放情绪层参数，绝不会冲掉底层的去水印参数或已开启的服饰/发型控件。

### 三种映射手段的取舍

| 手段 | 前提 | 效果 | 说明 |
|---|---|---|---|
| `expression` | 已注册进 `model3.json` 或同目录下存在 `.exp3.json` | 最好，未注册的 `.exp3.json` 会被桌宠自动内联为参数 | 见[常见坑 1](#1-exp3-文件存在但用不了) |
| `motion` | 模型有 `Motions` 动作组 | 最生动，全身动作 | 播放期间内置眨眼会暂停（Cubism 标准行为） |
| `parameters` | 参数在清单里 | 保底方案，静态定格 | 任何模型都能用 |

**没有动作组也没有注册表情的模型（这很常见）** → 只用 `parameters` 也能做出可辨识的情绪，见下面的极简示例。

### 关于取值范围

`parameters` 的值会被钳制到模型声明的 `[min, max]`。写超了不报错，但校验会警告。
按清单里的 `min`/`max` 取值：想"完全张开"就写 `max`，想"回归默认"就写 `default`（通常是 0）。

### 关于恢复默认

非中性情绪会在 **6 秒后自动切回 `neutral`**。所以：

- 桌宠会在情绪回退时自动把情绪层参数恢复到 `controls` / `baseParameters` / 模型自身的 `default` 值。
- `expression` 不需要（也没法）用参数去抵消：切到不带 `expression` 的情绪（含 `neutral`）时，桌宠会自动把上一个表情淡出。

---

## 第三步：映射建议

9 种情绪的语义，以及在只有参数可用时的通用做法（参数名请替换成你模型清单里的真实 ID）：

| 情绪 | 语义 | 常见参数做法 |
|---|---|---|
| `happy` | 开心、笑 | 嘴角上扬（`ParamMouthForm` 正向）、眼睛微笑参数、脸红 |
| `sad` | 难过、失落 | 嘴角下压（负向）、眉毛下垂（`ParamBrow*Y` 负向）、眼睛半闭 |
| `angry` | 生气、不满 | 眉毛内压（`ParamBrow*Angle`/`*Form`）、嘴角下压 |
| `surprise` | 惊讶 | 眼睛睁大（`ParamEye*Open` 取 max）、嘴张开 |
| `thinking` | 思考、犹豫 | 眉毛微抬、视线偏移、嘴形中性 |
| `shy` | 害羞 | 脸红 max、眼睛微笑、嘴角轻扬 |
| `curious` | 好奇、疑问 | 单侧眉抬、头微倾（`ParamAngleZ`） |
| `neutral` | 中性（**复位用**） | 把上面所有参数写回 default |
| `idle` | 待机 | 通常与 `neutral` 相同 |

8 种语义动作：`wave` 挥手、`jump` 跳跃、`spin` 转身、`sit` 坐下、`sleep` 睡觉、`wake` 醒来、`dance` 跳舞、`cheer` 欢呼。
模型的动作组通常是 `Tap` / `Flick` 这类交互命名而非语义命名 —— **凭观感就近映射即可**，多个语义动作复用同一个组完全没问题。

### 极简示例：没有动作组、没有注册表情的模型

```jsonc
{
  "version": 1,
  "name": "示例角色",
  "idleMotions": [],
  "lipSync": { "mouthOpenParam": "ParamMouthOpenY", "gain": 1 },
  "emotions": {
    "happy":    { "parameters": { "ParamMouthForm": 1,    "ParamBrowLY": 0.3, "ParamBrowRY": 0.3 } },
    "sad":      { "parameters": { "ParamMouthForm": -1,   "ParamBrowLY": -0.5, "ParamBrowRY": -0.5 } },
    "angry":    { "parameters": { "ParamMouthForm": -0.7, "ParamBrowLForm": -1, "ParamBrowRForm": -1 } },
    "surprise": { "parameters": { "ParamEyeLOpen": 1,     "ParamEyeROpen": 1, "ParamMouthOpenY": 0.8 } },
    "neutral":  { "parameters": { "ParamMouthForm": 0,    "ParamBrowLY": 0, "ParamBrowRY": 0,
                                  "ParamBrowLForm": 0,    "ParamBrowRForm": 0 } }
  },
  "animations": {}
}
```

完整参考实现见仓库里 Hiyori 的适配文件：
`deskpet-app/src/renderer/public/models/hiyori_pro_zh/hiyori_pro_zh/runtime/deskpet-adapter.json`

---

## 第四步：校验

把 `deskpet-adapter.json` 放好后，在桌宠里**重新选一次该模型**（或按 <kbd>Ctrl</kbd>+<kbd>R</kbd> 重载），
然后看开发者工具 Console。

**通过时：**

```
[Deskpet] Adapter 校验通过：角色名（情绪 9 项，动作 8 项）
```

**有问题时**会逐条列出，例如：

```
[Deskpet] Adapter 校验：角色名
  ✗ emotions.shy: 参数 "ParamCheek" 在该模型里不存在（写入会被静默丢弃）
  ✗ emotions.happy: 动作组 "Tap" 不存在，可用的组：Idle, Motion01
  ✗ animations.wave: 动作组 "Idle" 只有 3 条动作，index 5 越界
  ✗ emotions.angry: 表情 "mad" 用不了 —— 该模型的 .model3.json 里没有 Expressions 段
  ! emotions.sad: 参数 "ParamMouthForm" 的值 -2 超出模型范围 [-1, 1]，会被钳制
  ! lipSync.mouthOpenParam: 参数 "ParamMouthOpenY" 在该模型里不存在，口型同步不会有效果
```

把报错原文再发给 AI 让它修正即可。校验器只检查"名字和范围对不对"，**观感好不好还得你自己看** ——
在 Console 里逐项预览（走的是与真实指令完全相同的代码路径）：

```js
deskpetTestEmotion('happy')     // 预览情绪，6 秒后自动回 neutral
deskpetTestEmotion('shy')
deskpetTestAnimation('wave')    // 预览语义动作
```

传了没映射的名字会直接告诉你，不会静默没反应。
也可以直接跟麦麦说"你现在很生气"，看它调用工具后的表现。

---

## 常见坑

### 1. exp3 文件存在但用不了

VTube Studio 导出的模型经常是这样：目录里一堆 `.exp3.json`，但 `.model3.json` 里**没有 `Expressions` 段**。
Uta 会扫描磁盘表情，将适配器引用的未注册表达式内联为参数目标，并自动生成可操作控件。SDK 原生 `expression` 播放仍需要模型清单注册；同名文件应使用完整模型相对路径，避免歧义。

手动适配时还可以：

- **改用 `parameters`**：打开那个 `.exp3.json`，把里面的参数 ID 和值直接抄进 `parameters`。
  例如 `爱心眼.exp3.json` 内容是 `{"Id": "aixin", "Value": 1.0}` → 写 `"parameters": { "aixin": 1 }`。
  ⚠️ 但要确认 `aixin` 出现在能力清单里（自定义参数通常在）。
- **注册进 model3.json**：在 `FileReferences` 里加一段（注意 `Name` 是你之后在 adapter 里引用的名字）：

  ```jsonc
  "FileReferences": {
    "Moc": "...", "Textures": [ ... ],
    "Expressions": [
      { "Name": "aixin", "File": "爱心眼.exp3.json" },
      { "Name": "heilian", "File": "黑化.exp3.json" }
    ]
  }
  ```

### 2. 动作组名大小写敏感

`Idle` ≠ `idle`。必须与能力清单里的 `motionGroups` 键名完全一致，包括空字符串或组名中的空格；不要自行补组名或修剪它。

### 3. index 从 0 开始

`"motionGroups": { "Tap": 2 }` 意味着合法 index 只有 `0` 和 `1`。

### 4. 眨眼 / 呼吸不用管

桌宠使用 Cubism 内置的眨眼和呼吸系统，**不要在 adapter 里写 `ParamEyeLOpen` 之类的持续动画**。
眨眼依赖 `.model3.json` 的 `Groups` 里的 `EyeBlink` 声明：

```jsonc
"Groups": [
  { "Target": "Parameter", "Name": "EyeBlink", "Ids": ["ParamEyeLOpen", "ParamEyeROpen"] },
  { "Target": "Parameter", "Name": "LipSync",  "Ids": ["ParamMouthOpenY"] }
]
```
没有 `EyeBlink` 组的模型不会自动眨眼 —— 补上这段即可（这是改模型文件，不是改 adapter）。

在 `surprise` 里把 `ParamEye*Open` 设成 max 是可以的（一次性定格），内置眨眼下一次会接管回去。

### 5. 参数改了没反应

大概率是名字写错 —— 回到[第一步](#第一步导出模型能力清单)重新导出清单核对。记住：**错的参数名不会报错**。

---

## 附：VTube Studio 模型

Uta 导入 VTS 模型时会额外读取模型根目录的 `.vtube.json`、`Exp3/*.exp3.json` 和 `Animation/*.motion3.json`：

- 把未注册进 `.model3.json` 的表情和动作注册进来；
- 根据 `.vtube.json` 的 `ParameterSettings` 生成 `focus` 草稿（`FaceAngleX/Y/Z → AngleX/Y/Z`、`PositionX/Y/Z` 等）；
- 生成 `deskpet-adapter.json` 草稿；如果角色包里已经带了适配文件，则保留原文件不覆盖。

导入后仍可以用本规范显式覆盖任何字段。

## 附：JSON Schema

`docs/deskpet-adapter.schema.json` 提供了机器可校验的 schema，可在编辑器里加一行引用获得自动补全：

```jsonc
{
  "$schema": "../../../../../../docs/deskpet-adapter.schema.json",
  "version": 1
}
```

（`$schema` 字段会被桌宠忽略，路径按你的模型目录层级调整；不加也完全没问题。）
