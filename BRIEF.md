# Project Brief: Web Reverse Inspector (网页特效与界面逆向 & PPTX 双向复刻引擎)

> **文档说明**：本文件为本项目的**实时工程蓝图与规格说明书**（当前版本：`v1.5`）。根据工作区规则，每次修改代码前均须先阅读本文档，修改完成后须同步更新本文档。

## 1. 项目目标
开发一款基于 Chrome Manifest V3 的纯客户端常驻侧边栏（SidePanel）扩展（原生 ES Modules 免打包）。支持三大核心闭环工作流：
1. **网页特效与界面逆向**：通过“DOM 元素/动效吸管”、“4 秒动态分镜录制”或“局部自由框选截图”捕获网页组件与交互特效，提取真实布局图层结构、精简 HTML、过滤后的 Computed CSS、`@keyframes`、样式变化极值及高清截图 / 2×2 动态分镜图。
2. **PPTX 文件 95%+ 复刻（上传 `.pptx` → Prompt / 1:1 HTML）**：本地上传 `.pptx` 文件，零后端纯前端解压 OOXML 并沿 `Theme → SlideMaster → SlideLayout → Slide` 四级继承链提取精确坐标、颜色变换、字体、矢量形状、表格、图表、内嵌图片、动画与备注，一键生成 **95%+ 复刻 Prompt** 与 **1:1 单文件 HTML5 演示稿**（支持 Sandbox 实时翻页预览与纯净 `.html` 导出），并可接入本地已登录的 ChatGPT / Gemini 网页套餐或自备 API Key（BYOK）流式生成/精修。
3. **HTML 演示稿确认 → 可编辑 `.pptx` 高保真转换导出（HTML ⇄ PPTX 闭环）**：在 Sandbox 预览确认任意 HTML 演示稿（本地 1:1 渲染稿、AI 流式改写/新建稿或网页逆向单页稿）无误后，通过隔离探针读取浏览器真实排版坐标、富文本、渐变、圆角、阴影、表格与 2x 超清 SVG/Canvas 图层，零依赖本地打包输出标准可编辑 `.pptx` 文件。

## 2. 标准工程目录结构
```text
web-reverse-inspector/
├── manifest.json               # Manifest V3 核心配置 v1.5.0 (含 default_locale 与 __MSG_*__ 国际化)
├── _locales/                   # Chrome 原生扩展清单多语言包 (en / zh_CN)
├── README.md / README_EN.md    # 中英双语开源说明文档（核心能力、架构图、快速安装与技术边界）
├── CHANGELOG.md                # 中英双语版本演进说明 (v1.0.0 ~ v1.5.0)
├── LICENSE                     # MIT 开源许可证
├── .gitignore                  # Git 忽略规则
├── GEMINI.md                   # 工作区规则（含中文规范、纯客户端红线、Shadow DOM 隔离与 BRIEF 同步要求）
├── BRIEF.md                    # 实时项目规格说明书（本文件）
├── sidepanel/
│   ├── index.html              # 常驻侧边栏主界面（顶部中/英一键切换、双模式工作台、通道与模型选择栏、调试 5 标签页、输出与 Sandbox 导出栏）
│   ├── sidepanel.css           # 侧边栏样式表（深色/浅色自适应主题、语言切换按钮、PPTX 上传区及导出按钮样式）
│   └── sidepanel.js            # 状态管理、中英双语热切换与持久化、Schema v2 配置迁移、PPTX 解析与 HTML/PPTX 双向导出、流式渲染
├── content/
│   ├── inspector.js            # Shadow DOM 吸管（双语横幅）、空遮罩/ShadowRoot 穿透、选区全图层扫描、CSS/Keyframes 提取
│   ├── recorder.js             # 4 秒多节点动态交互录制器（双语录制角标 + MutationObserver + rAF + 4 帧分镜抓拍）
│   └── cropper.js              # Shadow DOM 十字准星拖拽选区遮罩（双语提示条，联动全图层布局扫描）
├── background/
│   ├── service-worker.js       # 核心消息总线（双语通道状态与回退通知）、OffscreenCanvas 裁剪与 2×2 分镜拼接、统一流式调度
│   ├── router-web-chatgpt.js   # ChatGPT 网页版零侵入 DOM 桥接、UI 模型切换与递归 Markdown 提取
│   ├── router-web-gemini.js    # Gemini 网页版 UI 模型切换、DOM 桥接、锁定态检测与 StreamGenerate RPC 兜底
│   └── router-byok-api.js      # Google AI Studio (Gemini API) 与 OpenAI 原生 API 多模态 SSE 直连
└── utils/
    ├── i18n.js                 # 零依赖中英双语词典与 DOM 热切换引擎（185 组中英 Key + 浏览器语言自动探测）
    ├── zip-lite.js             # 零依赖纯 JS ZIP 解压与打包引擎（DecompressionStream / CompressionStream + CRC-32）
    ├── pptx-parser.js          # OOXML 四级继承链 (.pptx) 高精度解析引擎
    ├── pptx-html-renderer.js   # 1:1 等比缩放单文件 HTML5 演示稿渲染与导出器（支持中英双语播放控制栏）
    ├── html-slide-extractor.js # Sandbox 隔离环境 postMessage DOM 真实排版测量探针（多页/富文本/表格/2x SVG 光栅化）
    ├── pptx-exporter.js        # 严格遵循 ECMA-376 Schema 顺序的纯前端 OOXML .pptx 生成器
    ├── prompt-compiler.js      # 网页布局/分镜 Prompt 编译器 & PPTX 95%+ 复刻 Prompt 编译器
    └── style-filter.js         # 核心 CSS 白名单、默认简写噪点过滤与跨域样式表 @keyframes 提取
```

## 3. 核心模块当前技术规范

### 模块 A：网页双模态特征采集层 (`content/` & `utils/style-filter.js`)
1. **DOM 拾取与选区全图层布局扫描 (`inspector.js`)**：
   - 独立 `Shadow DOM` 高亮框与信息胶囊，实时标注元素标识符、尺寸及特效标识（`Transition` / `Anim` / `Glass` / `3D/Transform` / `ShadowDOM` / `Canvas/Media`）。
   - **空遮罩穿透与 Web Components 支持**：自动穿透纯透明覆盖层并聚合包含前景 UI 与背景画布的复合容器（`resolveCompositeContainer`），深度穿透 `open shadowRoot` 提取折叠 HTML（采集上限 2200 字符，编译阶段剪枝至 1500 字符）。
   - **全图层布局扫描 (`scanRegionLayout`)**：不依赖 hit-test，遍历选区内所有可见元素（含 `pointer-events: none` 的背景 `<video>` 及其 `<source>` URL、`<canvas>`、`fixed/sticky` 导航栏、标题文本，以及向下聚合内部子元素真实背景色/圆角的按钮控件），按「背景媒体/画布 → 色块容器 → 前景文字与控件」输出相对位置百分比、尺寸、对齐方式与样式。
   - **CSS 降噪与跨域样式提取 (`style-filter.js`)**：通过 `isNoisyBrowserDefault()` 过滤默认简写噪点；遍历同源与 ShadowRoot 样式表提取 `@keyframes`，跨域样式表交由后台并发 `fetch` 解析。
2. **4 秒动态交互与分镜录制 (`recorder.js`)**：
   - **4 秒多节点联动录制**：`MutationObserver` + `rAF` 监控最多 55~70 个交互节点、鼠标轨迹及 `scrollDeltaY`；仅上报真实变化，无变化时不编造 3D 参数。
   - **2×2 动态分镜故事板**：在 `150ms`、`1400ms`、`2650ms`、`3850ms` 抓拍并由 `service-worker.js` 拼接为带时间、鼠标位置与滚动位移标注的 2×2 四格动态分镜 PNG。
3. **局部自由框选截图 (`cropper.js` & `service-worker.js`)**：
   - 独立 `Shadow DOM` 十字准星拖拽选区；释放后同步触发 `scanRegionLayout`，后台 `captureVisibleTab` + `OffscreenCanvas` 裁剪高清 PNG，并校验主色占比 >90% 纯色异常告警。

### 模块 B：PPTX 解析与 1:1 演示稿渲染引擎 (`utils/zip-lite.js`, `utils/pptx-parser.js`, `utils/pptx-html-renderer.js`)
1. **零依赖 ZIP 解压与打包 (`zip-lite.js`)**：
   - 解压：基于浏览器原生 `DecompressionStream('deflate-raw')` 与 Central Directory 偏移/大小解析，兼容 PowerPoint / WPS 的 Data Descriptor 压缩条目与 UTF-8 文件名。
   - 打包 (`buildZipArchive`)：内置标准 IEEE CRC-32 查找表，对 XML 自动采用 `CompressionStream('deflate-raw')`，对已压缩图片自动使用 `STORE`，写入带 UTF-8 标志位（`0x0800`）的标准 Local Header / Central Directory / EOCD。
2. **OOXML 四级继承解析 (`pptx-parser.js`)**：
   - 完整解析 `Theme → SlideMaster → SlideLayout → Slide` 继承链，自动保留母版与版式非占位装饰图层（`showMasterSp !== "0"`）与页脚/页码字段。
   - 实现 ECMA-376 主题色映射（`clrMap`/`clrMapOvr`）与颜色修饰器演算（`lumMod`、`lumOff`、`tint`、`shade`、`satMod`、`alpha`）及线性角度/径向渐变计算。
   - 支持 `<p:grpSp>` 组合图形递归坐标映射、`<a:prstGeom>` 预设形状与 `<a:custGeom>` 自定义矢量路径、图片裁剪 `srcRect`、表格 `<a:tbl>`（含合并单元格）、图表 `<c:chart>` 数据摘要、切页 `<p:transition>`、动画 `<p:timing>` 与演讲者备注。
3. **1:1 HTML5 演示稿生成器 (`pptx-html-renderer.js`)**：
   - 按原 PPT 尺寸比例（如 `1280×720`）通过视口等比缩放舞台居中渲染，锁死字体、坐标与比例；内嵌全部 `ppt/media/*` Base64 图片、SVG 矢量路径/图标与柱状图表，支持键盘 `←/→/Space` 翻页、选页跳转、演讲者备注抽屉、全屏放映与基础入场动画。

### 模块 C：HTML 演示稿 → 高保真可编辑 `.pptx` 转换引擎 (`utils/html-slide-extractor.js`, `utils/pptx-exporter.js`)
1. **Sandbox 真实排版测量探针 (`html-slide-extractor.js`)**：
   - 仅在 `sandboxFrame.srcdoc` 渲染预览时无侵入附加探针脚本（用户复制或导出的 `.html` 源码保持 100% 纯净）；通过 `postMessage` + 唯一 `requestId` + 20 秒超时保护采集每页真实排版。
   - 自动识别 `.ppt-slide`、`.reveal .slides > section`、`.slide`、`[data-slide]`、`section` 等多页结构及单页演示稿；临时冻结动画并消除 `.stage-scaler` 预览缩放以还原 1:1 逻辑像素坐标（含旋转元素中心反算、单边装饰线拆分、胶囊 Badge 独立识别、原子文本容器零重影提取与卡片文字合一）。
   - 支持嵌套括号 `linear-gradient` / `radial-gradient` / `box-shadow` 完整解析、`<table>` 完整合并矩阵（`colspan/rowspan`）、`<img>` `object-fit: cover/contain` 裁剪计算，以及 `<svg>` / `<canvas>` 的 **2x 超清透明底 PNG** 光栅化。
2. **原生 OOXML `.pptx` 生成器 (`pptx-exporter.js`)**：
   - 严格按 ECMA-376 子元素顺序生成完整合规的 `.pptx` 结构（含 `[Content_Types].xml`、`_rels`、`docProps`、`presentation`、`theme`、`slideMaster`、`slideLayout`、`slides`、按需 `notesMaster`/`notesSlides` 及 CRC-32 媒体去重 `ppt/media/*`）。
   - 精确换算：`px × 9525 = EMU`、`fontSizePx × 75 = sz`、CSS 渐变角 `((deg - 90 + 360) % 360) × 60000 = ang`（与 `pptx-parser.js` 100% 互逆）、同时写入 `<a:latin>` / `<a:ea>` / `<a:cs>` 防止中文退化，并对单行无框文本轻微放宽防 DirectWrite 意外折行。

### 模块 D：复刻 Prompt 编译器 (`utils/prompt-compiler.js`)
- **网页复刻 (`compileReversePrompt`)**：以图层结构与真实动效/分镜为核心，禁止篡改文案与臆造不存在的特效。
- **PPTX 复刻 (`compilePptxPrompt`)**：支持 `single`（仅当前页）与 `all`（整份演示文稿），输出精确主题色板、字体方案、画布基准尺寸及各图层百分比/px 坐标、颜色、段落与 Run 排版、表格矩阵、图表系列与动画列表。

### 模块 E：无服务端双轨模型路由器与侧边栏面板 (`background/`, `sidepanel/`)
1. **轨道 1：官方 Web 套餐零侵入 DOM 桥接**：ChatGPT Web (`GPT-6.2 Astra` 等) 与 Gemini Web (`4 Argon` 等) 通过官网标签页 `MAIN` 上下文切换官方模型下拉菜单并流式读取回复（Gemini 在 `auto` 且无输入框时支持 `StreamGenerate` RPC 兜底）。
2. **轨道 2：BYOK 多模态 SSE 直连 (`router-byok-api.js`)** 与 **离线纯净回退 (`service-worker.js`)**：支持网页逆向与 PPTX 复刻两类任务共用统一的 `dispatchCompiledPromptStream()` 调度管道。
3. **常驻侧边栏 (`sidepanel/`)**：提供「🌐 网页捕获逆向」与「📽️ PPTX 文件复刻 (95%+)」双模式切换；Sandbox 预览栏与 PPTX 操作区均提供 **【📊 确认并导出 `.pptx`】** 与 **【📥 导出 `.html`】** 一键闭环出口，并输出详尽的元素统计与边界提示。

---

## 4. 演进记录 & 当前已知限制

### 4.1 关键演进（v1.0 → v1.5）
1. **v1.0 → v1.1**：单节点拾取升级为选区全图层扫描 + Web Components 穿透；移除编造的 3D 极值与假兜底代码；新增纯色截图告警。
2. **v1.1 → v1.2**：2 秒录制升级为 4 秒多节点录制 + 2×2 四格动态分镜；Web 通道升级为零侵入 DOM 桥接与最新模型选择器（GPT-6 / Gemini 4 系列）。
3. **v1.2 → v1.3**：新增纯客户端 `.pptx` 上传解析引擎（零依赖 ZIP + OOXML 四级继承）、95%+ PPT 复刻 Prompt 编译器与 1:1 单文件 HTML 演示稿渲染导出，并修正调试区 `4s 极值与分镜` 标签文案。
4. **v1.3 → v1.4**：打通 **HTML 演示稿预览确认 → 高保真可编辑 `.pptx` 一键转换导出** 闭环；在 `zip-lite.js` 中补全原生 ZIP 打包，新增 Sandbox DOM 排版测量探针 `html-slide-extractor.js` 与严格合规 OOXML 生成器 `pptx-exporter.js`，公开发布至 GitHub（`633qaq/web-reverse-inspector`）。
5. **v1.4 → v1.5（本次更新）**：新增 **全扩展中英双语运行界面切换（简体中文 ⇄ English）**——补全 Chrome 原生 `_locales/en` 与 `_locales/zh_CN` 清单多语言、统一词典引擎 `utils/i18n.js`（185 组中英 Key + 浏览器语言自动探测）、侧边栏右上角 `EN / 中文` 毫秒级热切换并持久化，覆盖 SidePanel 全 UI、Service Worker 状态/回退提示、目标网页 Shadow DOM 吸管/录制/框选横幅及 1:1 HTML 演示稿播放控制栏。

### 4.2 当前已知限制与待优化项
1. **桌面 PowerPoint / WPS 软件进程无法直接读取或原地改写（第 1 点边界）**：受限于浏览器沙箱及纯客户端 MV3 架构红线，当前通过文件上传与文件导出形成完整闭环；若未来需直接操作桌面运行中的 PPT 进程，需引入 Native Messaging 本地宿主或 Office Add-in。
2. **HTML → `.pptx` 格式协议物理边界**：
   - `backdrop-filter` 实时毛玻璃、复杂 `clip-path`、WebGL 实时交互、CSS `@keyframes` 循环动画与 JS 点击交互在 `.pptx` 规范中无 1:1 动态等价物（静态外观通过原生半透明层或 2x 光栅化保真，动态交互不会保留）。
   - `.pptx` 仅写入字体名称，若打开文件的电脑未安装对应网页字体，Office / WPS 会按系统规则替换，可能带来细微字宽差异。
   - 受浏览器跨域安全限制，若 AI 生成的 HTML 引用了未开放 CORS 的外链网络图片，Canvas 无法离线抓取其像素；Base64 内嵌图、内联 SVG、Canvas 及开放 CORS 的图片均可 100% 离线打包。
3. **Web 通道暂未自动附带图片上传**：ChatGPT Web / Gemini Web 目前向页面输入框仅注入文本 Prompt，图片仍需通过【📸 复制截图】手动粘贴。
4. **复杂 PPT 高级对象边界**：导入解析侧对内置图表目前支持渲染简化 SVG 柱状图与数据摘要，复杂组合图表、SmartArt 复杂拓扑、音视频内嵌与 WPS 私有扩展 XML 标签尚无法 100% 映射；`prompt-compiler.js` 中网页模式的 `<canvas>` 提示仍有球面折射案例倾向。
5. **实机校验范围**：`zip-lite.js` 打包、`pptx-exporter.js` 导出与 `pptx-parser.js` 反向解析已完成 Node.js 43 项往返闭环验证及探针语法编译校验，真实桌面 Microsoft PowerPoint / WPS Office 打开渲染效果仍需在用户实机中验证。
