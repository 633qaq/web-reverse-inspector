# Project Brief: Web Reverse Inspector (网页特效与界面逆向 & PPTX 双向复刻引擎)

> **文档说明**：本文件为本项目的**实时工程蓝图与规格说明书**（当前版本：`v2.0`）。根据工作区规则，每次修改代码前均须先阅读本文档，修改完成后须同步更新本文档。

## 1. 项目目标
开发一款基于 Chrome Manifest V3 的纯客户端常驻侧边栏（SidePanel）扩展（原生 ES Modules 免打包），支持完整中英双语运行界面与 Prompt 输出，打通三大核心闭环工作流：
1. **网页特效与界面逆向**：通过“DOM 元素/动效吸管”、“4 秒动态分镜录制”、“局部框选截图”以及浏览器右键菜单与全局快捷键（`Alt+Shift+I` / `Alt+Shift+C`），提取真实布局图层结构、精简 HTML、过滤后的 Computed CSS、`@keyframes`、样式变化极值及高清截图 / 2×2 动态分镜图，结合去偏置通用双语 Prompt 编译器与用户自定义改稿指令，支持 Web 套餐自动贴图或 BYOK 自定义接口直连流式生成。
2. **PPTX 文件 95%+ 复刻（上传 `.pptx` → Prompt / 1:1 HTML）**：本地上传 `.pptx` 文件，零后端纯前端解压 OOXML 并沿 `Theme → SlideMaster → SlideLayout → Slide` 四级继承链提取精确坐标、颜色变换、字体、矢量形状、表格、柱状/折线/饼图、内嵌图片、动画与备注，一键生成 95%+ 复刻 Prompt（支持自定义改稿/换风格指令）与 1:1 单文件 HTML5 演示稿。
3. **HTML 演示稿预览确认 / 在线改字 → 可编辑 `.pptx` 高保真转换导出（HTML ⇄ PPTX 闭环）**：支持本地 1:1 渲染稿、AI 流式改写稿、历史多页拼合稿，以及在「📄 HTML → PPTX」工作台直接拖入/粘贴的任意第三方 `.html` 演示稿；在 Sandbox 实时预览（支持 **✏️ 在线改字** 与 **↗ 新标签页大屏检视**）确认无误后，可选「标准原生可编辑」或「视觉混合保真」及「跨平台安全字体映射」，零依赖本地打包输出标准可编辑 `.pptx` 文件。

## 2. 标准工程目录结构
```text
web-reverse-inspector/
├── manifest.json               # Manifest V3 核心配置 v2.0.0（icons / _locales / contextMenus / commands）
├── assets/
│   ├── icons/                  # 16 / 32 / 48 / 128px 官方高分抗锯齿 PNG 扩展图标
│   └── hero-banner.svg         # GitHub 开源仓库视觉横幅
├── _locales/                   # Chrome 原生扩展清单多语言包 (en / zh_CN)
├── README.md / README_EN.md    # 中英双语开源说明文档（含视觉横幅、架构图、快速安装与技术边界）
├── CHANGELOG.md                # 中英双语版本演进说明 (v1.0.0 ~ v2.0.0)
├── LICENSE                     # MIT 开源许可证
├── .gitignore                  # Git 忽略规则
├── GEMINI.md                   # 工作区规则（含中文规范、纯客户端红线、Shadow DOM 隔离与 BRIEF 同步要求）
├── BRIEF.md                    # 实时项目规格说明书（本文件）
├── sidepanel/
│   ├── index.html              # 三工作台主界面（网页逆向 / PPTX 复刻 / HTML→PPTX、改稿指令框、历史抽屉、默认折叠调试区、Sandbox 工具栏）
│   ├── sidepanel.css           # 深色/浅色自适应主题与全控件样式
│   └── sidepanel.js            # 状态管理、226 词条双语热切换、IndexedDB 历史与多页拼合、Sandbox 改字/大屏/导出协调
├── content/
│   ├── inspector.js            # Shadow DOM 吸管（双语横幅）、空遮罩/ShadowRoot 穿透、选区全图层扫描、CSS/Keyframes 提取
│   ├── recorder.js             # 4 秒多节点动态交互录制器（双语录制角标 + MutationObserver + rAF + 4 帧分镜抓拍）
│   └── cropper.js              # Shadow DOM 十字准星拖拽选区遮罩（双语提示条，联动全图层布局扫描）
├── background/
│   ├── service-worker.js       # 核心消息总线、右键菜单与全局快捷键、OffscreenCanvas 裁剪与 2×2 分镜拼接、统一流式调度
│   ├── router-web-chatgpt.js   # ChatGPT Web 零侵入 DOM 桥接、自动截图贴图、UI 模型切换与双语状态
│   ├── router-web-gemini.js    # Gemini Web UI 模型切换、自动截图贴图、DOM 桥接、双语状态与 RPC 兜底
│   └── router-byok-api.js      # Google AI Studio 与 OpenAI-Compatible（支持自定义 Base URL 与本地 Ollama）多模态直连
└── utils/
    ├── i18n.js                 # 零依赖中英双语词典与 DOM 热切换引擎（226 组中英 Key + 浏览器语言自动探测）
    ├── history-store.js        # 原生 IndexedDB 本地历史记录库（最近 25 条）与 CSS 作用域隔离多页演示稿拼合器
    ├── zip-lite.js             # 零依赖纯 JS ZIP 解压与打包引擎（DecompressionStream / CompressionStream + CRC-32）
    ├── pptx-parser.js          # OOXML 四级继承链 (.pptx) 高精度解析引擎
    ├── pptx-html-renderer.js   # 1:1 等比缩放单文件 HTML5 演示稿生成器（柱状/折线/饼图 SVG + 双语播放条）
    ├── html-slide-extractor.js # Sandbox 排版测量探针（多页/富文本/表格/2x SVG + 在线改字 + 纯净 HTML 回传 + 混合光栅化）
    ├── pptx-exporter.js        # 严格遵循 ECMA-376 的 OOXML .pptx 生成器（支持跨平台安全字体映射与扩展预设几何）
    ├── prompt-compiler.js      # 去偏置通用中英双语复刻 Prompt 编译器（支持网页 & PPTX + 自定义改稿指令）
    └── style-filter.js         # 核心 CSS 白名单、默认简写噪点过滤与跨域样式表 @keyframes 提取
```

## 3. 核心模块当前技术规范

### 模块 A：网页双模态采集与浏览器快捷入口 (`content/`, `background/service-worker.js`, `utils/style-filter.js`)
1. **Shadow DOM 吸管、4 秒动态分镜与框选截图**：完整保留全图层扫描（`scanRegionLayout`）、开放 `shadowRoot` 穿透、4 帧 2×2 动态分镜拼接、主色占比 >90% 纯色告警及跨域 `@keyframes` 提取，全部网页内浮层横幅同步支持中英双语。
2. **原生快捷入口**：提供网页右键菜单（混合逆向 / 4 秒分镜 / 框选截图，随语言自动刷新）与全局快捷键（`Alt+Shift+I` 开启混合吸管、`Alt+Shift+C` 开启框选截图），触发时自动展开侧边栏。

### 模块 B：PPTX 四级解析与 1:1 演示稿渲染 (`utils/zip-lite.js`, `utils/pptx-parser.js`, `utils/pptx-html-renderer.js`)
1. **零依赖 ZIP 解压与打包 (`zip-lite.js`)**：对称支持 `DecompressionStream('deflate-raw')` 解压与 `CompressionStream('deflate-raw')` / `STORE` + IEEE CRC-32 打包。
2. **OOXML 四级继承解析 (`pptx-parser.js`)**：`Theme → SlideMaster → SlideLayout → Slide` 完整色板与色彩修饰器演算、组坐标递归、矢量几何、合并表格、图表摘要、动画与备注。
3. **1:1 HTML5 演示稿渲染 (`pptx-html-renderer.js`)**：支持柱状图、多系列折线/面积图、饼图/环形图原生 SVG 渲染及中英双语播放器控制栏。

### 模块 C：HTML 演示稿在线微调 → 高保真可编辑 `.pptx` 转换引擎 (`utils/html-slide-extractor.js`, `utils/pptx-exporter.js`)
1. **Sandbox 测量与在线改字 (`html-slide-extractor.js`)**：
   - 支持 `WRI_EDIT_MODE_REQ`（页面文本节点启用 `contenteditable` 在线改字）、`WRI_CLEAN_HTML_REQ`（剥离探针与编辑样式回传纯净 HTML）与 `WRI_EXPORT_SLIDES_REQ`（采集真实逻辑坐标）。
   - 支持 `native`（标准原生可编辑）与 `hybrid`（对含 `backdrop-filter` / `filter` / `clip-path` 的装饰底板做 2x 透明 PNG 光栅化 + 叠放原生可编辑文本框）两种导出模式。
2. **原生 OOXML `.pptx` 生成 (`pptx-exporter.js`)**：
   - 严格遵守 ECMA-376 子元素顺序，精准互逆渐变角、CRC-32 图片去重、原生合并表格与演讲者备注；
   - 新增可开关的 **跨平台安全字体映射 (`resolveTypeface`)**（如 `PingFang SC / Noto Sans SC → Microsoft YaHei`、`Inter → Arial`、`JetBrains Mono → Consolas`），大幅减少换机折行跑版。

### 模块 D：去偏置双语 Prompt 编译器、双轨路由与历史记录 (`utils/prompt-compiler.js`, `utils/history-store.js`, `background/`)
1. **通用双语 Prompt 编译器 (`prompt-compiler.js`)**：彻底清除历史特定网站（Genie 4）硬编码案例偏置，支持中英双语系统指令与数据说明，并支持注入用户自定义改稿/换风格指令（带常用快捷芯片）。
2. **双轨 AI 路由器 (`router-web-*.js`, `router-byok-api.js`)**：
   - ChatGPT Web 与 Gemini Web 支持自动通过 `DataTransfer` / `ClipboardEvent('paste')` 附带截图/分镜图发送，并补全全部双语状态文案；
   - OpenAI BYOK 支持自定义 **API Base URL**（自动规范化 `/v1/chat/completions`，兼容 DeepSeek、OpenRouter、硅基流动及免 Key 本地 Ollama）。
3. **本地历史记录与多页拼合 (`history-store.js`)**：基于原生 `IndexedDB` 自动保存最近 25 条记录，支持一键恢复及多选拼合为 CSS 作用域隔离的多页 HTML 演示稿并导出多页 `.pptx`。

---

## 4. 演进记录 & 当前已知限制

### 4.1 关键演进（v1.0 → v2.0）
1. **v1.0 → v1.2**：Shadow DOM 吸管升级为选区全图层扫描 + Web Components 穿透 + 4 秒 2×2 动态分镜 + Web 零侵入 DOM 桥接与最新模型选择器。
2. **v1.3 → v1.4**：新增纯客户端 `.pptx` 四级继承解析、1:1 HTML 演示稿以及 **HTML 预览确认 → 原生可编辑 `.pptx`** 闭环，开源公开发布至 GitHub（`633qaq/web-reverse-inspector`）。
3. **v1.5**：补全 Chrome `_locales` 与侧边栏一键 `EN / 中文` 全链路双语热切换。
4. **v2.0（当前版本）**：全面落地产品与体验 10 项升级——Prompt 去偏置 + 双语化 + 自定义改稿指令框、Web 通道自动附带截图、BYOK 自定义 Base URL（兼容 DeepSeek/OpenRouter/Ollama）、第三工作台「📄 HTML → PPTX」直接导入、Sandbox 在线改字 + 新标签页大屏检视 + 混合视觉导出模式 + 安全字体映射、折线/饼图 SVG 渲染、IndexedDB 本地历史记录与多页拼合、默认折叠调试区、右键菜单/快捷键与官方 4 尺寸高清图标。

### 4.2 当前已知限制与待优化项
1. **桌面 PowerPoint / WPS 软件进程边界**：受纯客户端 Chrome 扩展架构约束，仍以 `.pptx` 文件上传与导出形成闭环，不直接读写桌面软件进程内存。
2. **Web 通道自动贴图受官网 DOM 迭代影响**：ChatGPT Web 与 Gemini Web 自动贴图采用标准 `DataTransfer` / `ClipboardEvent('paste')`，若官网改版拦截合成粘贴事件，将优雅降级为纯文本发送，用户仍可通过【📸 复制截图】手动粘贴。
3. **HTML → `.pptx` 格式协议物理边界**：动态交互脚本、循环 CSS 动画与实时 WebGL 交互在静态 `.pptx` 规范中无 1:1 动态等价物；未开放 CORS 的外链图片无法离线抓取打包。
4. **实机验证范围**：全部 17 个 `.js` 文件语法、226 组双语完整度、v2.0 34 项专项断言及 Batch 5/6 共 53 项解析与往返导出测试均已在 Node.js 通过；真实 Chrome 环境下的右键菜单、快捷键、Web 官网自动贴图及桌面 PowerPoint/WPS 打开效果仍需实机验证。
