/**
 * @file utils/i18n.js
 * @description 零依赖纯原生 ES Module 中英双语国际化词典与热切换引擎（供 SidePanel 与 Service Worker 共用）
 */

export const MESSAGES = {
  zh: {
    // 顶部栏与设置抽屉
    historyToggleTitle: '本地历史记录与多页拼合',
    langToggleBtn: 'EN',
    langToggleTitle: 'Switch UI to English / 切换为英文界面',
    themeToggleTitle: '切换深色/浅色主题',
    settingsToggleTitle: '配置 API Key、自定义 Base URL 与导出选项',
    channelSelectTitle: '选择大模型驱动通道',
    channelWebChatgpt: '🌐 ChatGPT Web 套餐',
    channelWebGemini: '🌐 Gemini Web 套餐',
    channelByokGemini: '🔑 Google AI Studio (BYOK)',
    channelByokOpenai: '🔑 OpenAI / 兼容 API (BYOK)',
    statusBadgeTitle: '点击刷新通道连通状态',
    statusChecking: '检测中...',
    statusLocalReady: '本地就绪',
    statusInitSync: '正在同步本地会话与配置状态...',
    statusReadyFallbackDetail: '可直接点击采集按钮抓取网页特效',
    modelLabel: '🧠 模型',
    modelSelectTitle: '选择当前通道使用的具体大模型版本',
    customModelPlaceholder: '输入自定义模型名称 (如 GPT-6.2 Astra Max / deepseek-chat)',
    modelChatgptAstra: 'GPT-6.2 Astra (Max · 旗舰推荐)',
    modelChatgptAuto: '默认 (推荐模型集)',
    modelGeminiArgon: '4 Argon · Code & analysis (编程与分析)',
    modelGeminiCarbon: '4 Carbon · Most complex work (最高复杂度)',
    modelGeminiHydrogen: '4 Hydrogen · Everyday help (日常帮助)',
    modelGemini31Pro: '3.1 Pro · Detailed research (深度研究)',
    modelGemini35Flash: '3.5 Flash-Lite · Quick answers (快速回答)',
    modelGeminiAuto: '跟随网页端当前模型',
    modelCustomOption: '✏️ 自定义模型...',
    modelCustomIdOption: '✏️ 自定义模型 ID...',

    drawerTitle: '🔑 BYOK 密钥、Base URL 与导出配置',
    drawerClose: '收起 ✕',
    labelGeminiKey: 'Google AI Studio Key (Gemini API)',
    labelOpenaiKey: 'OpenAI / 兼容 API Key (DeepSeek / OpenRouter / Ollama)',
    labelOpenaiBaseUrl: '自定义 API Base URL（选填，留空默认官方 OpenAI）',
    openaiBaseUrlPlaceholder: 'https://api.openai.com/v1 或 https://api.deepseek.com/v1',
    labelExportOptions: '📊 .pptx 导出偏好设置',
    exportModeNative: '标准原生可编辑（推荐）',
    exportModeHybrid: '视觉混合保真（毛玻璃 2x 融合 + 可编辑字）',
    fontSafeMapLabel: '开启跨平台安全字体映射（防换电脑折行跑版）',
    saveToastDefault: '自动持久化至 chrome.storage.local',
    saveToastSaved: '✅ 已保存至本地存储',
    saveConfigBtn: '保存并检测',

    // 历史记录抽屉
    historyDrawerTitle: '🕘 本地历史记录 (最近 25 条)',
    historyMergeBtn: '🧩 拼合多页演示稿',
    historyClearBtn: '清空',
    historyEmpty: '暂无历史记录。每次网页捕获、PPTX 解析、AI 生成或 HTML 导入都会自动保存于此。',
    historyRestoreBtn: '恢复',
    historyDeleteBtn: '删除',
    historyRestoredStatus: '✅ 已从本地历史恢复：{title}',
    historyMergeNeedMore: '⚠️ 请先勾选至少 1 条包含 HTML 或截图的历史记录',
    historyMergedOk: '✅ 已将 {count} 条记录拼合为多页 HTML 演示稿，预览确认后可直接导出多页 .pptx',
    historyClearedOk: '🗑️ 已清空本地历史记录',

    // 工作台模式
    workbenchModeLabel: '工作台模式',
    stageTag: 'v2.0 · 全能复刻 & HTML ⇄ PPTX',
    wbTabWeb: '🌐 网页逆向',
    wbTabPptx: '📽️ PPTX 复刻',
    wbTabHtml: '📄 HTML → PPTX',

    // HTML 直接转 PPTX 工作台
    htmlDropTitleHtml: '点击上传或拖入 <code>.html</code> 演示稿',
    htmlDropSub: '支持 Claude / Cursor / DeepSeek 生成的任意单文件 HTML，预览改字后一键转可编辑 .pptx',
    htmlPastePlaceholder: '或直接粘贴完整 HTML 演示稿源码 (<!DOCTYPE html>...)...',
    htmlLoadPreviewBtn: '👁️ 载入 Sandbox 预览',
    htmlDirectExportBtn: '📊 一键转可编辑 .pptx',
    htmlEmptyWarn: '⚠️ 请先拖入 .html 文件或粘贴 HTML 源码',
    htmlLoadedOk: '✅ 已载入 HTML 演示稿 ({chars} chars)，可点击「✏️ 改字」「↗ 大屏」确认后导出 .pptx',

    // AI 自定义改稿指令框
    directiveLabel: '🎯 AI 定制改稿 / 换风格指令（选填，留空即 1:1 原样复刻）',
    directivePlaceholder: '例如：保留原版式与配色，把文案替换为我的《2026 Q4 产品复盘》大纲...',
    chipExact: '1:1 原样',
    chipRewrite: '套版换文案',
    chipLightBiz: '浅色商务风',
    chipConcise: '精简提炼',
    chipRewritePrompt: '保持原有版式结构、字号层级与视觉精致度，将页面文案改写为一份高管汇报风格的精炼示例（保留可替换占位数据）。',
    chipLightBizPrompt: '保留原版式与信息层级，将整体配色切换为高级清爽的现代商务浅色风（纯白/浅灰底 + 科技蓝主色 + 深岩灰正文）。',
    chipConcisePrompt: '保留原页面视觉与布局骨架，精简压缩冗长正文为高密度的要点短句与醒目核心数字。',

    // 网页采集按钮
    btnInspectorTitle: '吸管抓取特效',
    btnInspectorSub: 'DOM + CSS + Keyframes',
    btnRecorderTitle: '录制 4 秒动态分镜',
    btnRecorderSub: '2×2 四格过程截图 + 极值',
    btnCropperTitle: '局部框选截图',
    btnCropperSub: '高清 Canvas 视觉裁剪',
    btnHybridTitle: '混合模式（DOM+截图）',
    btnHybridSub: '95% 还原度全量逆向',
    runMockBtn: '🧪 一键测试流式逆向生成 (Mock 3D 全息卡片样本)',
    stopStreamBtn: '⏹ 停止',
    stopStreamTitle: '中止当前流式输出',

    // PPTX 复刻工作台
    pptxDropTitleHtml: '点击上传或拖入 <code>.pptx</code> 文件',
    pptxDropSub: '纯客户端解析 OOXML 四级继承链（母版/主题色/坐标/图片/表格/动画）',
    pptxNotLoaded: '未加载文件',
    pptxReuploadBtn: '重新上传',
    pptxSlideSelectTitle: '选择目标幻灯片',
    pptxScopeSelectTitle: '复刻范围',
    pptxScopeSingle: '仅当前页',
    pptxScopeAll: '整份演示文稿',
    pptxPreviewTitle: '1:1 HTML 演示稿',
    pptxPreviewSub: '按原比例/字体/媒体渲染',
    pptxPromptTitle: '生成 95%+ Prompt',
    pptxPromptSub: '输出精确参数复刻指令',
    pptxAiTitle: 'AI 流式生成/精修',
    pptxAiSub: '发送至上方已选大模型',
    pptxHtmlTitle: '导出 .html 演示稿',
    pptxHtmlSub: '单文件离线翻页放映',
    pptxExportBannerTitle: '📊 确认当前预览 → 导出可编辑 .pptx 文件',
    pptxExportBannerBadge: '原生文本/形状/表格 + 2x SVG',
    pptxExportBannerTitleAttr: '将当前 Sandbox 预览确认无误的 HTML 演示稿无损转换为可编辑 .pptx 文件',

    // 调试特征预览区
    debugTitle: '🔍 底层采集特征预览',
    captureNotStarted: '未采集',
    debugTabVisual: '视觉截图',
    debugTabLayout: '布局结构',
    debugTabHtml: 'HTML 骨架',
    debugTabCss: 'CSS & 关键帧',
    debugTabDelta: '4s 极值与分镜',
    screenshotEmptyDefault: '点击上方任意采集按钮或上传 .pptx 文件查看捕获特征',
    screenshotImgAlt: '局部截图预览',
    debugLayoutEmpty: '// 尚未采集选区或 PPT 布局结构',
    debugHtmlEmpty: '// 尚未捕获 DOM 节点',
    debugCssEmpty: '// 尚未提取 Computed CSS 与 @keyframes',
    debugDeltaEmpty: '// 尚未录制 4 秒动态交互极值',
    debugDeltaNoRecordNote: '当前模式未启用 4 秒动态分镜录制，可点击【🎬 录制 4 秒动态分镜】采集',

    // 输出区与 Sandbox
    tabPromptBtn: '📝 逆向提示词',
    tabSandboxBtn: '👁️ Sandbox 实时渲染预览',
    copyImageBtn: '📸 复制截图',
    copyImageTitle: '一键复制捕获的高清局部截图到剪贴板，可直接 Ctrl+V 粘贴给 AI',
    copyCodeBtn: '复制代码',
    copyCodeTitle: '仅复制提取出的单文件 HTML 预览代码',
    copyPromptBtn: '📋 一键复制 Prompt',
    copyPromptTitle: '一键复制完整结构化逆向 Prompt',
    copyNoImage: '⚠️ 暂无截图',
    copyImageOk: '✅ 截图已复制!',
    copyFail: '❌ 复制失败',
    copyEmpty: '⚠️ 暂无内容',
    copyTextOk: '✅ 已复制!',
    placeholderTitle: '等待捕获网页特效或上传 .pptx 文件',
    placeholderDescHtml:
      '支持三种 95%+ 复刻闭环：<br />1. <b>网页逆向</b>：全图层布局扫描 + 4 秒四格动态分镜 + 高清截图<br />2. <b>PPTX 复刻</b>：本地四级 OOXML 解析 + 95%+ Prompt + 1:1 HTML 演示稿<br />3. <b>HTML 转 PPTX</b>：Sandbox 预览确认无误后一键导出原生可编辑 .pptx',
    sandboxStatusDefault: '安全隔离沙箱 (`iframe[sandbox="allow-scripts"]`)',
    sandboxEditBtn: '✏️ 改字',
    sandboxEditBtnActive: '✅ 改字中',
    sandboxEditTitle: '开启后可直接在预览画面中点击修改任意文字，导出 .pptx/.html 自动同步',
    sandboxEditEnabledStatus: '✏️ 已开启在线改字（共 {count} 处文本可直接点击编辑），改完点导出 .pptx 即可生效',
    sandboxEditDisabledStatus: '已退出在线改字模式，修改内容已保留在当前预览中',
    sandboxFullscreenBtn: '↗ 大屏',
    sandboxFullscreenTitle: '在新标签页全屏大视野检视当前 HTML 演示稿',
    sandboxDownloadHtmlBtn: '📥 .html',
    sandboxDownloadHtmlTitle: '下载当前预览的纯净单文件 .html',
    sandboxExportPptxBtn: '📊 导出 .pptx',
    sandboxExportPptxTitle: '确认当前预览无误后，一键高保真转换为可编辑 .pptx 文件',
    refreshSandboxTitle: '重新挂载 Sandbox 预览',
    sandboxPromptModeStatus: '当前输出为「发给 AI 的复刻 Prompt」，请连同截图发给 AI 生成代码（或配置 API Key 直连生成）',
    sandboxPromptModeBodyHtml:
      '当前为 <b>复刻 Prompt 提取模式</b>（不含虚假拼凑代码）。<br/>请点击右上角 <b>【📸 复制截图】+【📋 一键复制 Prompt】</b> 发送给 AI 编程工具生成 1:1 代码，<br/>或在右上角 ⚙️ 配置 API Key 由模型直接生成代码后在此实时预览。',
    sandboxMountedStatus: '已实时挂载单文件预览 ({chars} chars) · 确认无误可一键导出 .pptx',

    // 运行时交互文案
    modeInspectorLabel: '🎯 吸管抓取',
    modeRecorderLabel: '🎬 4s 动态分镜',
    modeCropperLabel: '📸 局部截图',
    modeHybridLabel: '🔗 混合模式',
    hintStartInspector: '🎯 已在当前网页开启 Shadow DOM 吸管，请移动鼠标并点击目标元素（Esc 取消）',
    hintStartRecorder: '🎬 请先在网页中点击目标区域，随后将自动开启 4 秒动态分镜录制',
    hintStartCropper: '📸 已在当前网页开启十字准星截图遮罩，请按住左键拖拽框选区域（Esc 取消）',
    hintStartHybrid: '🔗 混合全量模式已开启：请在网页点击目标组件（自动抓取 DOM+CSS+局部截图）',
    hintStartDefault: '请在网页中选择目标元素',
    hintStartFail: '启动采集失败: {error}',
    hintStartFailDefault: '请刷新目标网页后重试',
    hintRestrictedMock: '当前页面受限，已自动回退至 Mock 样本演示',
    hintCaptureSuspect: '⚠️ 已采集，但截图几乎是纯色，可能没拍到视频/画布画面。建议等画面加载后重新采集',
    hintCaptureReady: '✅ 已采集 {target}，正在生成...',
    hintCaptureCancelled: '已取消网页采集操作',
    badgeSolidColorWarn: ' · ⚠️ 截图 {share}% 为单一颜色',
    streamAbortedNote: '\n\n[⏹ 已手动中止流式生成]',
    swTimeoutError: '请求后台 Service Worker 超时',
    swNoResponse: 'Service Worker 未响应',
    swEmptyResponse: '空响应',

    // PPTX 交互与导出反馈
    pptxOnlyPptxWarn: '⚠️ 请上传标准的 .pptx 格式文件',
    pptxParsingStatus: '⏳ 正在本地解析 {file} (Theme / 母版 / 版式 / 图层)...',
    pptxNoSlidesErr: '未在文件中解析到任何幻灯片页面',
    pptxMetaSummary: '📽️ {file} ({count}页 · {ratio})',
    pptxSlideOption: '第 {num} 页: {title}',
    pptxDebugBadge: '📽️ {file} · 第 {num}/{total} 页 ({ratio})',
    pptxDebugVisualHint:
      '已直接解析 .pptx 底层 OOXML 数据（含 Theme 色板、母版装饰层、{count} 个图层对象），请切换到「布局结构」或「👁️ Sandbox 实时渲染预览」查看 1:1 效果',
    pptxDebugElementsComment: '// 本页共解析 {count} 个对象\n',
    pptxParsedOk: '✅ 已高精度解析 {file}（共 {count} 页，{ratio}）',
    pptxParseFail: '❌ PPTX 解析失败: {error}',
    pptxSendingAi: '🤖 正在通过 {channel} 生成 PPT 复刻代码...',
    pptxSendAiFail: '发送失败: {error}',
    pptxNoHtmlToExport: '⚠️ 当前没有可导出的 HTML 演示稿，请先上传 .pptx 或让 AI 生成 HTML 代码',
    pptxHtmlExported: '✅ 已导出纯净单文件 HTML 演示稿 ({kb} KB)',
    pptxNeedSandboxHtml: '⚠️ 请先在 Sandbox 生成并预览 HTML 演示稿，确认无误后再导出 .pptx',
    pptxSandboxNoHtml: '暂无可转换的 HTML 演示稿',
    pptxExportingBtn: '⏳ 正在转换 .pptx...',
    pptxExportingBanner: '⏳ 正在测量真实排版并打包可编辑 .pptx...',
    pptxExportingDetail: '⏳ 正在逐页读取 Sandbox 真实排版坐标、富文本、渐变、表格与 2x 矢量图层...',
    pptxStatSlides: '{n} 页',
    pptxStatTextBoxes: '{n} 文本框',
    pptxStatShapes: '{n} 形状',
    pptxStatTables: '{n} 原生表格',
    pptxStatMedia: '{n} 图片/2x矢量',
    pptxStatNotes: '{n} 备注',
    pptxExportWarnPrefix: ' · 提示：{warn}',
    pptxExportOkDetail: '✅ 已导出 {file} ({kb} KB · {stats}){warn}',
    pptxExportOkSandbox: '✅ 已转换导出 {slides} 页可编辑 .pptx ({kb} KB)',
    pptxExportFailDetail: '❌ 导出 .pptx 失败: {error}',
    pptxExportFailSandbox: '❌ 转换失败: {error}',

    // Service Worker 状态与回退通知
    swReadyByokGeminiBadge: 'Gemini API 就绪',
    swNeedByokGeminiBadge: '需配置 Gemini Key',
    swReadyByokGeminiDetail: '已就绪：Google AI Studio ({model}) 多模态直连',
    swNeedByokGeminiDetail: '请点击右上角 ⚙️ 填入 Google AI Studio Key（未填将自动使用离线编译器）',
    swReadyByokOpenaiBadge: 'OpenAI API 就绪',
    swNeedByokOpenaiBadge: '需配置 OpenAI Key',
    swReadyByokOpenaiDetail: '已就绪：OpenAI ({model}) 多模态直连',
    swNeedByokOpenaiDetail: '请点击右上角 ⚙️ 填入 OpenAI API Key（未填将自动使用离线编译器）',
    swChatgptWebReady: 'ChatGPT Web 就绪',
    swChatgptCookieReady: 'ChatGPT Cookie 就绪',
    swChatgptNeedLogin: 'ChatGPT 需登录',
    swChatgptCookieDetail: '当前模型: {model} · 检测到本地 chatgpt.com 登录态',
    swChatgptNeedLoginDetail: '目标模型: {model} · 未检测到 chatgpt.com 登录态，请先登录或切换 BYOK',
    swGeminiWebReady: 'Gemini Web 就绪',
    swGeminiCookieReady: 'Gemini Cookie 就绪',
    swGeminiNeedLogin: 'Gemini 需登录',
    swGeminiCookieDetail: '当前模型: {model} · 检测到本地 Google 登录态',
    swGeminiNeedLoginDetail: '目标模型: {model} · 未检测到 gemini.google.com 登录态，请先登录或切换 BYOK',
    swModelDetail: '当前模型: {model} · {reason}',
    swDefaultReadyBadge: '就绪',
    swDefaultReadyDetail: '双模态采集与元提示词编译器已就绪',
    swNoActiveTab: '未找到当前活动网页标签页',
    swRestrictedPage: '浏览器系统内部页不支持注入 DOM 吸管，已自动为您切换为内置 3D 全息卡片样本',
    swInjectRestricted: '页面注入受限 ({error})',
    swFallbackByokMissing: '当前选择了 BYOK 通道但尚未配置 {keyName}',
    swFallbackNoticeWeb: '未调用模型（{reason}）。下方是可直接发给 AI 的复刻 Prompt，请连同截图一起发送{suspect}',
    swFallbackSuspect: '；⚠️ 截图几乎是纯色，可能没拍到视频/画布画面，建议等画面加载后重新采集',
    swFallbackNoticeCustom: '未调用模型（{reason}）。已输出纯净复刻 Prompt，可直接一键复制给外部 AI',
    swStreamInterrupted: '\n\n> ⚠️ **流式传输中断**：{error}'
  },

  en: {
    // Top bar & settings drawer
    historyToggleTitle: 'Local History & Multi-Slide Merge',
    langToggleBtn: '中文',
    langToggleTitle: '切换为简体中文界面 / Switch UI to Chinese',
    themeToggleTitle: 'Toggle Dark / Light theme',
    settingsToggleTitle: 'Configure API keys, custom Base URL & export options',
    channelSelectTitle: 'Select AI model channel',
    channelWebChatgpt: '🌐 ChatGPT Web Session',
    channelWebGemini: '🌐 Gemini Web Session',
    channelByokGemini: '🔑 Google AI Studio (BYOK)',
    channelByokOpenai: '🔑 OpenAI / Compatible API (BYOK)',
    statusBadgeTitle: 'Click to refresh channel status',
    statusChecking: 'Checking...',
    statusLocalReady: 'Local Ready',
    statusInitSync: 'Syncing local sessions and configuration...',
    statusReadyFallbackDetail: 'Click any capture button below to inspect web effects',
    modelLabel: '🧠 Model',
    modelSelectTitle: 'Select the model for the active channel',
    customModelPlaceholder: 'Enter custom model name (e.g. GPT-6.2 Astra Max / deepseek-chat)',
    modelChatgptAstra: 'GPT-6.2 Astra (Max · Recommended)',
    modelChatgptAuto: 'Default (Recommended set)',
    modelGeminiArgon: '4 Argon · Code & analysis',
    modelGeminiCarbon: '4 Carbon · Most complex work',
    modelGeminiHydrogen: '4 Hydrogen · Everyday help',
    modelGemini31Pro: '3.1 Pro · Detailed research',
    modelGemini35Flash: '3.5 Flash-Lite · Quick answers',
    modelGeminiAuto: 'Follow current web model',
    modelCustomOption: '✏️ Custom model...',
    modelCustomIdOption: '✏️ Custom model ID...',

    drawerTitle: '🔑 BYOK Keys, Base URL & Export Settings',
    drawerClose: 'Close ✕',
    labelGeminiKey: 'Google AI Studio Key (Gemini API)',
    labelOpenaiKey: 'OpenAI / Compatible Key (DeepSeek / OpenRouter / Ollama)',
    labelOpenaiBaseUrl: 'Custom API Base URL (Optional, defaults to OpenAI)',
    openaiBaseUrlPlaceholder: 'https://api.openai.com/v1 or https://api.deepseek.com/v1',
    labelExportOptions: '📊 .pptx Export Preferences',
    exportModeNative: 'Standard Native Editable (Recommended)',
    exportModeHybrid: 'Hybrid Visual Fidelity (2x FX Surface + Editable Text)',
    fontSafeMapLabel: 'Enable cross-OS safe font mapping (prevents wrapping shifts)',
    saveToastDefault: 'Stored locally in chrome.storage.local',
    saveToastSaved: '✅ Saved locally',
    saveConfigBtn: 'Save & Check',

    // History drawer
    historyDrawerTitle: '🕘 Local History (Last 25 Items)',
    historyMergeBtn: '🧩 Merge Selected Slides',
    historyClearBtn: 'Clear',
    historyEmpty: 'No history yet. Web captures, PPTX parses, AI outputs, and HTML imports are saved locally here.',
    historyRestoreBtn: 'Restore',
    historyDeleteBtn: 'Del',
    historyRestoredStatus: '✅ Restored from history: {title}',
    historyMergeNeedMore: '⚠️ Select at least 1 history item with HTML or screenshot first',
    historyMergedOk: '✅ Merged {count} items into a multi-slide HTML deck — preview & export to .pptx!',
    historyClearedOk: '🗑️ Cleared local history',

    // Workbench mode
    workbenchModeLabel: 'Workbench Mode',
    stageTag: 'v2.0 · Full Reverse & HTML ⇄ PPTX',
    wbTabWeb: '🌐 Web Reverse',
    wbTabPptx: '📽️ PPTX Clone',
    wbTabHtml: '📄 HTML → PPTX',

    // Direct HTML -> PPTX workbench
    htmlDropTitleHtml: 'Click to upload or drop an <code>.html</code> deck',
    htmlDropSub: 'Supports any single-file HTML from Claude / Cursor / DeepSeek — preview, edit text & export .pptx',
    htmlPastePlaceholder: 'Or paste full HTML slide code directly (<!DOCTYPE html>...)...',
    htmlLoadPreviewBtn: '👁️ Load into Sandbox',
    htmlDirectExportBtn: '📊 Convert to .pptx',
    htmlEmptyWarn: '⚠️ Drop an .html file or paste HTML source code first',
    htmlLoadedOk: '✅ Loaded HTML deck ({chars} chars). Use [✏️ Edit] / [↗ Full] then export .pptx',

    // Custom AI directive box
    directiveLabel: '🎯 Custom AI Rewrite / Style Directive (Optional; blank = exact 1:1)',
    directivePlaceholder: 'e.g., Keep exact layout & palette, replace copy with my Q4 Product Review...',
    chipExact: '1:1 Exact',
    chipRewrite: 'Swap Copy',
    chipLightBiz: 'Light Biz',
    chipConcise: 'Tighten Copy',
    chipRewritePrompt: 'Keep the exact layout grid, typography hierarchy, and polish, while rewriting the copy into an executive summary deck.',
    chipLightBizPrompt: 'Keep the exact layout structure, but restyle the color palette into a crisp light corporate theme (white/slate canvas, tech blue accent, dark slate text).',
    chipConcisePrompt: 'Preserve the visual layout while tightening verbose text into scannable bullet points and bold KPI callouts.',

    // Web capture buttons
    btnInspectorTitle: 'Element Inspector',
    btnInspectorSub: 'DOM + CSS + Keyframes',
    btnRecorderTitle: 'Record 4s Storyboard',
    btnRecorderSub: '2×2 Motion Frames + Deltas',
    btnCropperTitle: 'Region Screenshot',
    btnCropperSub: 'HD Canvas Marquee Crop',
    btnHybridTitle: 'Hybrid (DOM + Crop)',
    btnHybridSub: '95% Full-Layer Reverse',
    runMockBtn: '🧪 Test Streaming Reverse (Mock 3D Holographic Card)',
    stopStreamBtn: '⏹ Stop',
    stopStreamTitle: 'Abort active stream',

    // PPTX workbench
    pptxDropTitleHtml: 'Click to upload or drop a <code>.pptx</code> file',
    pptxDropSub: 'Client-side 4-level OOXML parser (Master / Theme / Coords / Media / Tables / Timing)',
    pptxNotLoaded: 'No file loaded',
    pptxReuploadBtn: 'Replace file',
    pptxSlideSelectTitle: 'Select target slide',
    pptxScopeSelectTitle: 'Replication scope',
    pptxScopeSingle: 'Current Slide',
    pptxScopeAll: 'Entire Deck',
    pptxPreviewTitle: '1:1 HTML Deck',
    pptxPreviewSub: 'Exact ratio / fonts / media',
    pptxPromptTitle: '95%+ Prompt',
    pptxPromptSub: 'Exact-spec replication prompt',
    pptxAiTitle: 'AI Stream Refine',
    pptxAiSub: 'Send to selected AI model',
    pptxHtmlTitle: 'Export .html Deck',
    pptxHtmlSub: 'Offline single-file player',
    pptxExportBannerTitle: '📊 Confirm Preview → Export Editable .pptx',
    pptxExportBannerBadge: 'Native Text/Shapes/Tables + 2x SVG',
    pptxExportBannerTitleAttr: 'Convert the verified Sandbox HTML deck into a native editable .pptx file',

    // Debug preview
    debugTitle: '🔍 Captured Feature Inspector',
    captureNotStarted: 'Idle',
    debugTabVisual: 'Screenshot',
    debugTabLayout: 'Layout',
    debugTabHtml: 'HTML Tree',
    debugTabCss: 'CSS & Anim',
    debugTabDelta: '4s Storyboard',
    screenshotEmptyDefault: 'Click any capture button above or upload a .pptx file to inspect raw data',
    screenshotImgAlt: 'Cropped screenshot preview',
    debugLayoutEmpty: '// No captured region or PPT layout yet',
    debugHtmlEmpty: '// No captured DOM nodes yet',
    debugCssEmpty: '// No extracted Computed CSS or @keyframes yet',
    debugDeltaEmpty: '// No 4-second motion deltas recorded yet',
    debugDeltaNoRecordNote: '4s storyboard recording was not used in this capture. Click [🎬 Record 4s Storyboard] to capture motion.',

    // Output & Sandbox
    tabPromptBtn: '📝 Reverse Prompt',
    tabSandboxBtn: '👁️ Sandbox Live Preview',
    copyImageBtn: '📸 Copy Image',
    copyImageTitle: 'Copy HD screenshot to clipboard (paste directly into AI chat via Ctrl+V)',
    copyCodeBtn: 'Copy HTML',
    copyCodeTitle: 'Copy only the extracted single-file HTML code',
    copyPromptBtn: '📋 Copy Prompt',
    copyPromptTitle: 'Copy full structured reverse prompt',
    copyNoImage: '⚠️ No image',
    copyImageOk: '✅ Image copied!',
    copyFail: '❌ Copy failed',
    copyEmpty: '⚠️ Nothing to copy',
    copyTextOk: '✅ Copied!',
    placeholderTitle: 'Ready to capture web effects or upload a .pptx file',
    placeholderDescHtml:
      'Three 95%+ replication workflows:<br />1. <b>Web Reverse</b>: Full-layer layout scan + 4s 2×2 storyboard + HD crop<br />2. <b>PPTX Replicate</b>: 4-level OOXML parser + 95%+ Prompt + 1:1 HTML5 deck<br />3. <b>HTML → PPTX</b>: Verify deck in Sandbox and export native editable .pptx',
    sandboxStatusDefault: 'Isolated Sandbox (`iframe[sandbox="allow-scripts"]`)',
    sandboxEditBtn: '✏️ Edit',
    sandboxEditBtnActive: '✅ Editing',
    sandboxEditTitle: 'Click any text inside preview to edit directly before exporting .pptx/.html',
    sandboxEditEnabledStatus: '✏️ Live edit ON ({count} editable text regions) — changes sync automatically to .pptx/.html export',
    sandboxEditDisabledStatus: 'Live edit OFF — your text edits remain preserved in the preview',
    sandboxFullscreenBtn: '↗ Full',
    sandboxFullscreenTitle: 'Open clean HTML deck in a full-size browser tab for inspection',
    sandboxDownloadHtmlBtn: '📥 .html',
    sandboxDownloadHtmlTitle: 'Download clean single-file .html deck',
    sandboxExportPptxBtn: '📊 Export .pptx',
    sandboxExportPptxTitle: 'Convert verified Sandbox preview into an editable .pptx file',
    refreshSandboxTitle: 'Remount Sandbox preview',
    sandboxPromptModeStatus: 'Prompt-only mode: copy Screenshot + Prompt to any AI, or configure an API Key for live preview',
    sandboxPromptModeBodyHtml:
      'Currently in <b>Prompt Extraction Mode</b> (zero fabricated placeholder code).<br/>Click <b>[📸 Copy Image] + [📋 Copy Prompt]</b> to send to your AI tool,<br/>or click ⚙️ to configure an API key / web session for live Sandbox preview.',
    sandboxMountedStatus: 'Live preview mounted ({chars} chars) · Ready to export .pptx',

    // Runtime hints
    modeInspectorLabel: '🎯 Inspector',
    modeRecorderLabel: '🎬 4s Storyboard',
    modeCropperLabel: '📸 Cropper',
    modeHybridLabel: '🔗 Hybrid',
    hintStartInspector: '🎯 Shadow DOM Inspector active: hover to preview, click to capture (Esc to cancel)',
    hintStartRecorder: '🎬 Step 1: Click the target area on the page to start 4s motion storyboard recording',
    hintStartCropper: '📸 Crosshair Cropper active: drag to select a region (Esc to cancel)',
    hintStartHybrid: '🔗 Hybrid mode active: click target component (captures DOM + CSS + HD crop)',
    hintStartDefault: 'Select target element on the active page',
    hintStartFail: 'Failed to start capture: {error}',
    hintStartFailDefault: 'Please refresh the target tab and try again',
    hintRestrictedMock: 'Restricted browser page — switched to built-in Mock 3D Card sample',
    hintCaptureSuspect: '⚠️ Captured, but screenshot is mostly a single solid color (video/canvas may not be painted yet). Try again after loading.',
    hintCaptureReady: '✅ Captured {target}, generating...',
    hintCaptureCancelled: 'Page capture cancelled',
    badgeSolidColorWarn: ' · ⚠️ {share}% solid color',
    streamAbortedNote: '\n\n[⏹ Stream aborted by user]',
    swTimeoutError: 'Background Service Worker request timed out',
    swNoResponse: 'Service Worker did not respond',
    swEmptyResponse: 'Empty response',

    // PPTX runtime & export
    pptxOnlyPptxWarn: '⚠️ Please upload a standard .pptx file',
    pptxParsingStatus: '⏳ Parsing {file} locally (Theme / Master / Layout / Shapes)...',
    pptxNoSlidesErr: 'No slides found in this .pptx file',
    pptxMetaSummary: '📽️ {file} ({count} slides · {ratio})',
    pptxSlideOption: 'Slide {num}: {title}',
    pptxDebugBadge: '📽️ {file} · Slide {num}/{total} ({ratio})',
    pptxDebugVisualHint:
      'Parsed raw .pptx OOXML locally (Theme palette, Master shapes, {count} layers). Switch to [Layout] or [👁️ Sandbox Live Preview] to inspect 1:1 output.',
    pptxDebugElementsComment: '// Parsed {count} elements on this slide\n',
    pptxParsedOk: '✅ Parsed {file} ({count} slides, {ratio})',
    pptxParseFail: '❌ PPTX parse failed: {error}',
    pptxSendingAi: '🤖 Streaming PPT replication code via {channel}...',
    pptxSendAiFail: 'Dispatch failed: {error}',
    pptxNoHtmlToExport: '⚠️ No HTML deck available to export. Upload a .pptx or generate HTML via AI first.',
    pptxHtmlExported: '✅ Exported clean single-file HTML deck ({kb} KB)',
    pptxNeedSandboxHtml: '⚠️ Preview an HTML deck in Sandbox first, then export to .pptx',
    pptxSandboxNoHtml: 'No HTML deck available to convert',
    pptxExportingBtn: '⏳ Converting .pptx...',
    pptxExportingBanner: '⏳ Measuring live layout & packaging editable .pptx...',
    pptxExportingDetail: '⏳ Measuring real Sandbox coordinates, rich text, gradients, tables & 2x SVG rasters...',
    pptxStatSlides: '{n} slides',
    pptxStatTextBoxes: '{n} text boxes',
    pptxStatShapes: '{n} shapes',
    pptxStatTables: '{n} tables',
    pptxStatMedia: '{n} images/2x SVGs',
    pptxStatNotes: '{n} notes',
    pptxExportWarnPrefix: ' · Note: {warn}',
    pptxExportOkDetail: '✅ Exported {file} ({kb} KB · {stats}){warn}',
    pptxExportOkSandbox: '✅ Exported {slides} editable .pptx slides ({kb} KB)',
    pptxExportFailDetail: '❌ .pptx export failed: {error}',
    pptxExportFailSandbox: '❌ Export failed: {error}',

    // Service Worker status & fallback
    swReadyByokGeminiBadge: 'Gemini API Ready',
    swNeedByokGeminiBadge: 'Gemini Key Needed',
    swReadyByokGeminiDetail: 'Ready: Google AI Studio ({model}) multimodal direct stream',
    swNeedByokGeminiDetail: 'Click ⚙️ to add a Google AI Studio Key (falls back to offline compiler when empty)',
    swReadyByokOpenaiBadge: 'OpenAI API Ready',
    swNeedByokOpenaiBadge: 'OpenAI Key Needed',
    swReadyByokOpenaiDetail: 'Ready: OpenAI ({model}) multimodal direct stream',
    swNeedByokOpenaiDetail: 'Click ⚙️ to add an OpenAI API Key (falls back to offline compiler when empty)',
    swChatgptWebReady: 'ChatGPT Web Ready',
    swChatgptCookieReady: 'ChatGPT Cookie Ready',
    swChatgptNeedLogin: 'ChatGPT Login Needed',
    swChatgptCookieDetail: 'Model: {model} · Local chatgpt.com session cookie detected',
    swChatgptNeedLoginDetail: 'Target: {model} · No chatgpt.com session detected. Sign in or switch to BYOK.',
    swGeminiWebReady: 'Gemini Web Ready',
    swGeminiCookieReady: 'Gemini Cookie Ready',
    swGeminiNeedLogin: 'Gemini Login Needed',
    swGeminiCookieDetail: 'Model: {model} · Local Google session cookie detected',
    swGeminiNeedLoginDetail: 'Target: {model} · No gemini.google.com session detected. Sign in or switch to BYOK.',
    swModelDetail: 'Model: {model} · {reason}',
    swDefaultReadyBadge: 'Ready',
    swDefaultReadyDetail: 'Dual-modal capture and prompt compiler ready',
    swNoActiveTab: 'No active browser tab found',
    swRestrictedPage: 'Browser internal pages block content scripts; switched to built-in 3D holographic card sample',
    swInjectRestricted: 'Page injection restricted ({error})',
    swFallbackByokMissing: 'BYOK channel selected but {keyName} is not configured',
    swFallbackNoticeWeb: 'Model skipped ({reason}). Pure replication prompt is ready below — copy along with the screenshot{suspect}',
    swFallbackSuspect: '; ⚠️ Screenshot is mostly a single color (video/canvas may not have rendered yet)',
    swFallbackNoticeCustom: 'Model skipped ({reason}). Clean replication prompt is ready to copy into any external AI',
    swStreamInterrupted: '\n\n> ⚠️ **Stream interrupted**: {error}'
  }
};

export function normalizeLang(lang) {
  if (!lang) return detectDefaultLang();
  return String(lang).toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function detectDefaultLang() {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getUILanguage === 'function') {
      const uiLang = chrome.i18n.getUILanguage();
      if (uiLang) return uiLang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    }
  } catch (_err) {
    // ignore
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.language) {
      return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    }
  } catch (_err) {
    // ignore
  }
  return 'zh';
}

/**
 * 翻译指定 key，支持 {varName} 占位插值
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 * @param {'zh' | 'en'} [lang]
 * @returns {string}
 */
export function t(key, vars = {}, lang = 'zh') {
  const locale = normalizeLang(lang);
  const dict = MESSAGES[locale] || MESSAGES.zh;
  let text = dict[key] ?? MESSAGES.zh[key] ?? key;
  if (vars && typeof vars === 'object') {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v ?? ''));
    }
  }
  return text;
}

/**
 * 批量将 DOM 中标注了 data-i18n* 属性的静态元素热切换为目标语言
 * @param {ParentNode} root
 * @param {'zh' | 'en'} lang
 */
export function applyDomI18n(root, lang = 'zh') {
  const locale = normalizeLang(lang);
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }
  if (!root || typeof root.querySelectorAll !== 'function') return;

  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key, {}, locale);
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const key = el.getAttribute('data-i18n-html');
    if (key) el.innerHTML = t(key, {}, locale);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.setAttribute('title', t(key, {}, locale));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', t(key, {}, locale));
  });
  root.querySelectorAll('[data-i18n-alt]').forEach((el) => {
    const key = el.getAttribute('data-i18n-alt');
    if (key) el.setAttribute('alt', t(key, {}, locale));
  });
}
