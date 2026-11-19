# Changelog / 版本更新说明

All notable changes to **Web Reverse Inspector** are documented in this file (Bilingual: 简体中文 / English).

---

## [v1.5.0] - 2026-11-19

### 🇨🇳 简体中文说明
**全扩展中英双语运行界面上线：支持 Chrome 自动语言匹配与侧边栏右上角一键实时热切换（简体中文 ⇄ English）。**

- **新增**：Chrome 扩展清单原生国际化（`_locales/en/messages.json`、`_locales/zh_CN/messages.json`，`manifest.json` 升级至 `1.5.0` 并配置 `default_locale: "en"`），Chrome 扩展管理页与工具栏提示按浏览器语言自动显示中文或英文。
- **新增**：零依赖统一双语词典与热切换引擎（`utils/i18n.js`，185 组严格对称中英词条，含浏览器语言自动探测与 `{var}` 插值校验）。
- **新增**：侧边栏右上角新增 **`EN / 中文`** 切换按钮，点击后毫秒级热更新全界面文案、模型菜单、PPTX 页码选择、Sandbox 提示与通道状态，并持久化至 `chrome.storage.local`。
- **升级**：目标网页注入的 Shadow DOM 提示横幅（`inspector.js` / `recorder.js` / `cropper.js`）、后台通道状态与回退通知（`service-worker.js`）以及 1:1 HTML 演示稿底部控制条（`pptx-html-renderer.js`）全部支持中英双语联动（并顺手修正 `inspector.js` 录制横幅中一处 `2 秒` 旧文案为 `4 秒`）。

### 🇺🇸 English Release Notes
**Full Bilingual Runtime UI: Auto-detects Chrome language with an instant top-bar `EN / 中文` live toggle.**

- **Added**: Native Chrome manifest localization (`_locales/en/messages.json` and `_locales/zh_CN/messages.json`; bumped `manifest.json` to `1.5.0` with `default_locale: "en"`).
- **Added**: Zero-dependency bilingual dictionary & live DOM i18n engine (`utils/i18n.js`, 185 strictly matched ZH/EN keys with browser language auto-detection).
- **Added**: Top-right **`EN / 中文`** toggle button in the SidePanel for instant zero-reload language switching persisted to `chrome.storage.local`.
- **Improved**: Full bilingual support across injected Shadow DOM capture banners (`inspector.js`, `recorder.js`, `cropper.js`), Service Worker channel status/fallback messages (`service-worker.js`), and 1:1 HTML slide deck player controls (`pptx-html-renderer.js`).

---

## [v1.4.0] - 2026-11-19

### 🇨🇳 简体中文说明
**重大里程碑：打通「HTML 演示稿预览确认 → 高保真可编辑 `.pptx` 一键导出」完整闭环，并正式开源公开发布。**

- **新增**：零依赖原生 ZIP 打包器（`utils/zip-lite.js` -> `buildZipArchive`），基于浏览器原生 `CompressionStream('deflate-raw')` 与标准 IEEE CRC-32，支持 UTF-8 文件名与媒体自动走 `STORE` 防膨胀。
- **新增**：Sandbox DOM 真实排版测量探针（`utils/html-slide-extractor.js`），通过 `postMessage` 安全跨沙箱采集多页演示稿真实计算坐标与样式，不污染用户复制或导出的纯净 `.html` 代码：
  - 支持 `.ppt-slide`、`.reveal .slides > section`、`.slide`、`section` 等多页与单页演示稿；
  - 自动冻结动画并消除预览缩放，精确反算旋转元素中心坐标；
  - 完整解析嵌套 `rgba()` 线性/径向渐变、外阴影、单边装饰色条、胶囊 Badge、原子文本容器（零重影）、合并单元格表格、`object-fit` 图片裁剪，以及 `<svg>` / `<canvas>` 的 **2x 超清透明底 PNG** 光栅化。
- **新增**：严格遵循 ECMA-376 Schema 顺序的纯前端 `.pptx` 生成引擎（`utils/pptx-exporter.js`），支持原生可编辑文本/富文本 Run（含 `<a:latin>` + `<a:ea>` 防中文退化）、形状/渐变/圆角/阴影/旋转、原生合并表格、CRC-32 媒体去重与演讲者备注，兼容 PowerPoint / WPS / Keynote 零报错打开。
- **新增**：在侧边栏 **Sandbox 预览栏** 与 **PPTX 工作台** 新增 **【📊 确认并导出 `.pptx`】** 与纯净 **【📥 `.html`】** 导出入口及详细元素统计反馈。
- **验证**：通过 43 项 Node.js 导出 → 反向解析往返闭环测试（`ALL_PPTX_ROUNDTRIP_TESTS_PASSED`）与全项目语法静态校验。
- **完善**：升级 `manifest.json` 至 `1.4.0`，补全中英双语文档（`README.md`、`README_EN.md`、`CHANGELOG.md`）与 `MIT LICENSE`。

### 🇺🇸 English Release Notes
**Major Milestone: Completed the end-to-end "Verify HTML Slide Deck in Sandbox → One-Click Export Editable `.pptx`" loop and published as an open-source release.**

- **Added**: Zero-dependency native ZIP archiver (`utils/zip-lite.js` -> `buildZipArchive`) using browser-native `CompressionStream('deflate-raw')`, IEEE CRC-32, UTF-8 entry flags, and automatic `STORE` mode for compressed images.
- **Added**: Sandboxed real-layout DOM measurement probe (`utils/html-slide-extractor.js`) communicating via `postMessage` without polluting exported `.html` code:
  - Auto-detects multi-slide decks (`.ppt-slide`, `.reveal .slides > section`, `.slide`, `section`) and single-page decks;
  - Freezes animations, reverses preview scaling, and recovers exact unrotated bounding boxes for rotated elements;
  - Extracts nested `rgba()` linear/radial gradients, box shadows, accent borders, badge pills, de-duplicated atomic text boxes, merged `<table>` grids (`colspan`/`rowspan`), `object-fit` image crops, and **2x crisp transparent PNG** rasters for `<svg>` and `<canvas>`.
- **Added**: Strict ECMA-376 OOXML `.pptx` exporter (`utils/pptx-exporter.js`) generating native editable shapes, multi-run rich text (`<a:latin>` + `<a:ea>`), gradients with reversible angle mapping, merged tables, CRC-32 deduplicated media, and speaker notes—opening cleanly in PowerPoint, WPS Office, and Keynote.
- **Added**: One-click **Export `.pptx`** and clean **`.html`** actions in both the Sandbox preview toolbar and PPTX workbench, with export summary stats.
- **Verified**: Passed 43 automated Node.js export → re-parse round-trip assertions and full syntax verification.
- **Docs**: Bumped `manifest.json` to `1.4.0` and added bilingual docs (`README.md`, `README_EN.md`, `CHANGELOG.md`) and `MIT LICENSE`.

---

## [v1.3.0] - 2026-11-18

### 🇨🇳 简体中文
- 新增纯客户端 `.pptx` 上传解析工作台：零依赖 ZIP 解压（`utils/zip-lite.js`）+ OOXML 四级继承解析（`utils/pptx-parser.js`：`Theme → SlideMaster → SlideLayout → Slide`）。
- 新增 1:1 单文件交互式 HTML5 演示稿渲染与离线导出（`utils/pptx-html-renderer.js`）。
- 扩展 `utils/prompt-compiler.js` 支持单页/整份 95%+ PPTX 复刻 Prompt 编译，并与双轨 AI 流式通道打通。

### 🇺🇸 English
- Added local `.pptx` upload workbench with zero-dependency ZIP extraction (`utils/zip-lite.js`) and 4-level OOXML inheritance parsing (`utils/pptx-parser.js`).
- Added 1:1 single-file interactive HTML5 slide deck renderer and offline exporter (`utils/pptx-html-renderer.js`).
- Extended `utils/prompt-compiler.js` with `compilePptxPrompt()` for single-slide and full-deck 95%+ replication prompts integrated with the streaming AI router.

---

## [v1.2.0] - 2026-11-17

### 🇨🇳 简体中文
- 动态交互录制升级为 **4 秒多节点联动录制 + 2×2 四格动态分镜故事板 PNG**。
- ChatGPT Web 与 Gemini Web 通道升级为零侵入 DOM 桥接（彻底移除 `fetch` Monkey-Patch），新增顶部常驻最新模型下拉菜单（GPT-6 / Gemini 4 系列）及锁定态检测。

### 🇺🇸 English
- Upgraded motion recording to **4-second multi-node tracking + 2×2 dynamic storyboard PNG** composition.
- Upgraded ChatGPT Web and Gemini Web bridges to non-invasive DOM interaction with top-bar latest model selection (GPT-6 / Gemini 4 series) and lock-state detection.

---

## [v1.1.0] - 2026-11-16

### 🇨🇳 简体中文
- 单节点吸管升级为选区全图层布局扫描（`scanRegionLayout`）与开放 Web Components `shadowRoot` 穿透。
- 移除所有伪造的 3D 极值与假代码兜底，改为布局优先、严格防臆造的复刻 Prompt 编译；新增主色占比 >90% 纯色截图告警。

### 🇺🇸 English
- Upgraded inspector with full-region multi-layer layout scanning (`scanRegionLayout`) and open `shadowRoot` piercing.
- Removed synthetic fallback data in favor of layout-first anti-hallucination prompts and added solid-color (>90%) screenshot anomaly alerts.

---

## [v1.0.0] - 2026-11-15

### 🇨🇳 简体中文
- 初始版本：Chrome Manifest V3 常驻侧边栏骨架、Shadow DOM 吸管与框选截图、Computed CSS / `@keyframes` 降噪提取、BYOK 多模态直连与安全 Sandbox 实时预览。

### 🇺🇸 English
- Initial release: Chrome Manifest V3 SidePanel shell, Shadow DOM inspector & region cropper, filtered CSS / `@keyframes` extractor, BYOK multimodal SSE streaming, and sandboxed live preview.
