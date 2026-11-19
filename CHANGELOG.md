# Changelog / 版本更新说明

All notable changes to **Web Reverse Inspector** are documented in this file (Bilingual: 简体中文 / English).

---

## [v1.5.0] - 2026-11-19

**对比链接 / Full Changelog**：[`v1.4.0...v1.5.0`](https://github.com/633qaq/web-reverse-inspector/compare/v1.4.0...v1.5.0)

### 🇨🇳 简体中文版本更新内容
**核心主题：全扩展中英双语运行界面正式上线（简体中文 ⇄ English 实时热切换 + Chrome 自动语言匹配）。**

#### ✨ 新增功能 (Added)
- **Chrome 原生扩展清单多语言包**：新增 `_locales/en/messages.json` 与 `_locales/zh_CN/messages.json`，升级 `manifest.json` 至 `1.5.0` 并配置 `default_locale: "en"`，Chrome 扩展管理页名称、简介与工具栏悬停提示随浏览器语言自动切换。
- **零依赖统一双语词典与 DOM 热切换引擎（`utils/i18n.js`）**：内置 **185 组** 严格对称的中英词条，首次启动自动检测 `chrome.i18n.getUILanguage()` / `navigator.language`，支持 `{var}` 模板插值与批量 `data-i18n*` 毫秒级无刷新切换。
- **侧边栏一键语言切换按钮**：在侧边栏右上角（`🌓` 主题切换左侧）新增 **`EN / 中文`** 切换按钮，点击后即时刷新全界面并持久化至 `chrome.storage.local`。

#### 🔧 改进与联动 (Improved)
- **SidePanel 全量动态文案双语化**（`sidepanel/index.html`、`sidepanel.css`、`sidepanel.js`）：覆盖通道选择器、模型下拉菜单、PPTX 页码/范围下拉框、调试 5 标签页、剪贴板按钮反馈、Sandbox 提示页以及 `.pptx` 导出统计报告。
- **后台服务与网页注入层双语联动**：
  - `background/service-worker.js`：顶部通道连通徽标、详情提示、受限页提示、BYOK 缺 Key 与离线回退通知按当前语言实时返回；
  - `content/inspector.js` / `content/recorder.js` / `content/cropper.js`：注入目标网页的独立 Shadow DOM 吸管横幅、4 秒动态分镜录制角标、十字准星框选横幅及 `Esc` 取消提示全面支持中英文；
  - `utils/pptx-html-renderer.js`：生成的 1:1 单文件 HTML5 演示稿底部翻页条、演讲者备注抽屉与全屏按钮自动适配中英文界面。
- **双语文档同步**：同步更新 `README.md`、`README_EN.md` 与工程蓝图 `BRIEF.md`。

#### 🐛 修复 (Fixed)
- 修正 `content/inspector.js` 在录制模式第一步提示横幅中残留的一处旧文案（“录制 2 秒”修正为准确的“录制 4 秒 / 4s motion storyboard”）。

#### ✅ 校验结果 (Verification)
- 全项目 16 个 `.js` 文件 `node --check` 语法校验通过；
- 185 组中英 Key 与全部 `{var}` 占位符 100% 匹配，84 处 HTML `data-i18n*` 与 123 处 JS 翻译调用零遗漏；
- Batch 5（PPTX 解析 10 项）与 Batch 6（HTML→PPTX 往返闭环 43 项）回归测试全部通过。

---

### 🇺🇸 English Release Notes
**Headline: Full Bilingual Runtime UI (English ⇄ 简体中文 instant live switch with automatic Chrome locale detection).**

#### ✨ Added
- **Native Chrome Manifest Localization**: Added `_locales/en/messages.json` and `_locales/zh_CN/messages.json`, bumped `manifest.json` to `1.5.0` with `default_locale: "en"` so extension name, description, and toolbar tooltip follow Chrome's UI language automatically.
- **Zero-Dependency Bilingual i18n Engine (`utils/i18n.js`)**: Ships **185 strictly matched** EN/ZH keys with automatic browser locale detection, placeholder interpolation, and instant `data-i18n*` live DOM updates.
- **Top-Bar Live Language Switcher**: Added an **`EN / 中文`** toggle button next to the theme switch in the SidePanel header; preference persists in `chrome.storage.local`.

#### 🔧 Improved
- **Full SidePanel Bilingual Coverage** (`sidepanel/index.html`, `sidepanel.css`, `sidepanel.js`): Localized channels, model selectors, PPTX slide/scope controls, 5 debug tabs, clipboard toasts, Sandbox placeholders, and `.pptx` export summaries.
- **End-to-End Runtime Propagation**:
  - `background/service-worker.js`: Channel readiness badges, fallback notices, and restricted-page messages dynamically follow active language;
  - `content/inspector.js`, `content/recorder.js`, `content/cropper.js`: Injected Shadow DOM banners (inspector, 4s storyboard recorder pill, crosshair cropper, `Esc` hints) switch cleanly between English and Chinese;
  - `utils/pptx-html-renderer.js`: Generated 1:1 HTML5 slide deck player controls (Notes, Fullscreen, Prev/Next) adapt automatically to the selected language.
- **Docs Synced**: Updated `README.md`, `README_EN.md`, and `BRIEF.md`.

#### 🐛 Fixed
- Fixed a stale "2s" label in the `content/inspector.js` recorder step-1 banner to accurately read "4s".

#### ✅ Verification
- All 16 `.js` modules passed `node --check`;
- Verified 100% EN/ZH key parity (185 keys), placeholder parity, 84 HTML `data-i18n*` attributes, and 123 JS translation calls;
- Passed all Batch 5 PPTX parsing tests (10/10) and Batch 6 HTML→PPTX round-trip assertions (43/43).

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
