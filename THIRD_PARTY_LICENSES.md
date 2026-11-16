# 第三方组件与素材授权声明

Uta 自身源码以 [MIT](LICENSE) 发布。本文件说明构建时获取的第三方运行时、示例模型与依赖，它们**不属于 Uta 源码的 MIT 授权范围**，各自适用下列条款。Core 和 Hiyori 素材不由 Git 跟踪；下载来源与校验值见 `app/scripts/live2d-assets.json`。

## Live2D Cubism Core

- 文件：`app/src/renderer/public/live2dcubismcore.min.js`
- 版权：Live2D Inc.，以所获取文件的原始版权声明为准。
- 授权：Live2D Proprietary Software License Agreement 中的 “Redistributable Code”。
- 协议：<https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html>
- 获取：Live2D 官方 Cubism SDK for Web `5-r.3`，构建时提取 Core，保留文件原始声明。

该文件是 Live2D 的专有可再分发代码，不是开源软件。分发 Uta 时不得将其重新许可为 MIT，也不得删除文件头部的版权与许可声明。

## Live2D 示例模型「桃濑日和 - PRO」

- 目录：`app/src/renderer/public/models/hiyori_pro_zh/`
- 版权与创作者：插画 Kani Biimu，模型 Live2D Inc.
- 授权：Live2D 示例素材授权条款，完整原文见同目录的 `ReadMe.txt`。
- 官方说明：<https://www.live2d.com/zh-CHS/download/sample-data/>
- 获取：沿用 AIRI 的 `https://dist.ayaka.moe/live2d-models/hiyori_pro_zh.zip` 下载源，仅提取运行文件及原始 `ReadMe.txt`。可编辑工程不纳入下载清单。Uta 适配与预设配置由 Git 单独维护。

根据随附 `ReadMe.txt`：

- 普通用户及小规模企业在同意授权协议的前提下可用于商业用途；
- 中/大规模企业只能用于非公开的内部试用；
- 使用前必须确认“无偿提供素材使用授权协议”中的授权类型、Live2D 原创角色等内容，并遵守“Live2D Cubism 示例模型的使用授权要求”。

示例模型仅用于演示与开发调试。若你要商业发行或再分发 Uta，请先自行确认上述条款；必要时替换或移除该示例模型。模型目录中的 `deskpet-adapter.json` 与 `deskpet-presets.json` 是 Uta 的适配配置，不属于 Live2D 示例素材。

## 用户自行安装的第三方模型（不随仓库分发）

Uta 支持用户把自带模型放进用户数据目录（Windows 下为 `%APPDATA%\uta\models\<模型名>\`）。这些模型**不包含在 Uta 源码仓库或安装包中**，其版权与授权由模型作者决定，Uta 只提供加载与适配能力。

以用户自行安装的「DS 鲸鱼娘」模型 `c_0120` 为例：

- 署名链：上善无形「溟月」→ ZipZipPipe 女仆鲸鱼娘 → 氵六青 Live2D 化；参考项目 `Andersen216/dsh-whale-girl-live2d`。
- 授权：Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International（CC BY-NC-SA 4.0）。
- 协议原文：<https://creativecommons.org/licenses/by-nc-sa/4.0/>
- 限制：禁止商业使用；再分发需署名并以相同方式共享；如要随 Uta 一起分发，需另行取得模型作者许可。

模型目录下的 `deskpet-adapter.json`、`deskpet-presets.json`、`MODEL-NOTICE.txt` 是用户本地适配配置与署名说明，不属于 Uta 仓库内容。仓库与普通发版包不会打包任何用户自装模型；请勿把模型文件提交到本仓库。

**分享包例外**：经打包发起人确认已取得模型作者许可的分享包，可以附带 `DS-control/c_0120`。这类包必须保留 `docs/releases/DS-MODEL-NOTICE.md`、模型目录内的 `MODEL-NOTICE.txt` 与上述署名，并继续遵守 CC BY-NC-SA 4.0（非商业、相同方式共享）；该许可不改变 Uta 仓库本身对该模型的不分发状态。

## 运行时与开发依赖

以下主要依赖通过 npm 安装。依赖与传递依赖分别保留其 MIT、BSD、ISC、Apache 等许可；发行包的 `THIRD-PARTY-NOTICES.txt` 收集锁文件中生产依赖的许可原文，Electron 与 Chromium 声明保留在程序目录：

- Electron 45
- Vue 3
- Pinia 2
- PixiJS 6（`@pixi/*` 系列，含 `@pixi/unsafe-eval`）
- pixi-live2d-display 0.4
- electron-vite 2
- electron-builder 26

## Uta 品牌与界面素材

`app/src/renderer/public/uta-icon.svg`、`icon.png`、`icon.ico`、`icon-tray.png` 以及 `models/sample_static/` 下的静态立绘由 Uta 项目提供，随 Uta 一同分发。

## 备注

本文件不是法律意见。若你计划将 Uta 用于商业发行，请同时核对 Live2D 的开发者授权（Cubism SDK 发布许可）与示例素材条款，并以 Live2D Inc. 的最新官方文本为准。

## 发布条件核对

Uta 支持用户导入任意模型，可能属于 Live2D 定义的可扩展应用。公开发布前须确认适用的 SDK 发布许可；个人或免费开源不自动代表获得此类别的许可豁免。参见 [SDK 发布许可](https://www.live2d.com/en/sdk/license/)。

Hiyori 素材保留独立授权与作者署名；发行包附带 `HIYORI-README.txt`。This content uses sample data owned and copyrighted by Live2D Inc.
