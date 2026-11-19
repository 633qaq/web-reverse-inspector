/**
 * @file utils/prompt-compiler.js
 * @description 复刻 Prompt 编译器：结合「区域布局图层清单 + 4格动态分镜故事板 (Motion Storyboard) + DOM/Canvas 动效录制数据」，
 * 指导 AI 同时精准还原布局排版与 WebGL / Canvas / Scroll / Pointer 高级交互动画。
 */

import { filterComputedStyles } from './style-filter.js';

/**
 * 系统级指令 (System Instruction)
 * 注意：此处刻意不出现三个反引号，避免侧边栏把指令文本误识别为 html 代码块
 */
export const REVERSE_SYSTEM_INSTRUCTION = `你是一名资深创意前端工程师（Creative Technologist & WebGL/CSS 动效专家），任务是 1:1 复刻一个网页区域的界面布局与动态交互特效。

依据：
1. 用户附带的原网页截图或【2×2 四格动态分镜故事板图 (Motion Storyboard Frame #1 → #4)】：视觉构图、光影材质与连续动画过程以图片为准。
2. 从原网页真实 DOM 采集的【图层结构】与【动效录制数据】：元素位置、真实文案、字号、颜色、圆角以及滚动/鼠标状态变化以数据为准。

核心准则：
1. 界面布局与真实文案（严禁篡改）：
   - 必须 100% 原样保留采集数据中的真实文案（例如主标题 "Genie 4"、副标题 "A new generation of world simulation"、胶囊按钮 "Read blog"、顶部导航栏 "Google DeepMind / Models / Research / Science / About / Build with Gemini / Try Gemini"），严禁自行改名（如改成 "Tidal Glass"）或删减导航栏！
   - 严格还原元素对齐方式与字体风格（例如居中无衬线大标题必须水平+垂直居中于视口正中央，不得挪到左下角或改为衬线斜体）。
2. 动态交互与 Canvas/WebGL 特效（关键）：
   - 若随附的是【2×2 四格动态分镜图】或数据中存在全屏/大尺寸 <canvas>，你必须仔细对比 Frame #1 → #2 → #3 → #4 的画面变化，使用原生 WebGL Fragment Shader (GLSL) 或 Canvas 2D 球面折射渲染管线完整还原分镜图中的交互特效！
   - 严格注意滚动转场的初始态与终态方向（严禁写反）：初始未滚动时（scroll = 0）为「全屏展开的清晰场景，主标题、副标题与按钮全部居中显示」；向下滚动时（scroll: 0 → 1），全屏画面才向屏幕正中央 vec2(0.0, 0.0) 平滑收缩凝聚为一颗「3D 悬浮玻璃水晶球」（背景大光圈虚化变暗，副标题与按钮随滚动平滑淡出隐藏，主标题保留在水晶球正中央）。
   - 鼠标移动时（pointermove）：在光标处产生高折射率「液态玻璃球面/鱼眼折射透镜」（内部折射出第二重世界纹理，边缘带桶形畸变、RGB 色散与菲涅尔高光，并伴随偏心深色遮罩球切口与文字产生遮罩反色互动）。
3. 纯净性约束：禁止把采集数据中的选择器名称、坐标百分比、色号字符串或帧标签当成网页 UI 文字渲染到页面上；禁止臆造原网页截图中不存在的科技仪表盘外框或参数面板。

输出格式：
1. 先用 4～8 行简明列出你从「分镜截图 + 图层数据」中识别出的：① 视觉层级结构；② 鼠标交互与滚动转场动画机制。
2. 随后输出一个完整闭合的 html 代码块（单文件内聚 HTML5 + CSS3 + WebGL Shader / Canvas 交互 JS，无需外部构建工具，打开即可直接体验完整的鼠标透镜折射与滚轮转场动画）。`;

const KIND_LABEL = {
  media: '媒体/画布',
  control: '可点击控件',
  text: '文字',
  surface: '色块/容器'
};

function pruneText(str = '', maxLen = 1500) {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + `\n/* ... 已截断，原长度 ${trimmed.length} 字符 */`;
}

function toKebab(key) {
  return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * 解析截图 Data URL，提取标准 Base64 数据与 MIME 类型
 */
export function parseScreenshotDataUrl(dataUrl = '') {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return { hasValidBitmap: false, mimeType: '', base64Data: '', dataUrl: '' };
  }

  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) {
    return { hasValidBitmap: false, mimeType: '', base64Data: '', dataUrl };
  }

  return {
    hasValidBitmap: true,
    mimeType: match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase(),
    base64Data: match[2],
    dataUrl
  };
}

/**
 * 将单个布局条目格式化为可读文本
 */
function formatLayoutEntry(entry, index) {
  const isBackground = entry.kind === 'media' && entry.coverage >= 0.8;
  const label = isBackground ? '全屏背景媒体/画布' : KIND_LABEL[entry.kind] || entry.kind;
  const textPart = entry.text ? ` "${entry.text}"` : '';
  const box = entry.box || {};

  let pos = `左 ${box.l}%，上 ${box.t}%，宽 ${box.w}%，高 ${box.h}%（元素实际 ${entry.px?.w}×${entry.px?.h}px）`;
  if (entry.align) pos += `，${entry.align}`;
  if (entry.fixed) pos += `，position: ${entry.fixed}`;

  const lines = [`${index}. [${label}] <${entry.tag}> ${entry.sel}${textPart}`, `   - 位置：${pos}`];

  const styleText = Object.entries(entry.style || {})
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${toKebab(k)}: ${v}`)
    .join('; ');
  if (styleText) lines.push(`   - 样式：${styleText}`);

  if (entry.media) {
    const mediaText = Object.entries(entry.media)
      .filter(([, v]) => v !== '' && v !== false && v != null)
      .map(([k, v]) => `${k}: ${v === true ? '是' : v}`)
      .join('; ');
    if (mediaText) lines.push(`   - 媒体：${mediaText}`);
  }

  if (entry.motion && entry.motion.length) {
    lines.push(`   - 动效：${entry.motion.join('; ')}`);
  }

  return lines.join('\n');
}

/**
 * 将区域布局采集结果格式化为「从背景到前景」的图层清单
 */
export function formatLayoutSection(layout) {
  if (!layout || !Array.isArray(layout.elements) || layout.elements.length === 0) {
    return '（未采集到布局数据，请以截图和下方 HTML / CSS 为准）';
  }

  const header = `选区内识别到 ${layout.elements.length} 个可见元素${
    layout.truncated ? '（已保留核心元素）' : ''
  }，按「背景媒体/画布 → 色块容器 → 前景文字与控件（阅读顺序）」排列：`;

  const body = layout.elements.map((entry, i) => formatLayoutEntry(entry, i + 1)).join('\n');
  return `${header}\n\n${body}`;
}

/**
 * 汇总动效、录制极值、4格动态分镜与 Canvas/WebGL 交互规范
 */
function buildMotionSection(capture = {}) {
  const lines = [];
  const elements = capture.layout?.elements || [];

  for (const entry of elements) {
    if (entry.motion && entry.motion.length) {
      const label = entry.text ? ` "${entry.text.slice(0, 24)}"` : '';
      lines.push(`- ${entry.sel}${label}：${entry.motion.join('; ')}`);
    }
  }

  const rootStyles = filterComputedStyles(capture.computedStyles?.root || {});
  if (rootStyles.transition) lines.push(`- 选区根节点：transition: ${rootStyles.transition}`);
  if (rootStyles.animation) lines.push(`- 选区根节点：animation: ${rootStyles.animation}`);

  const uniqueLines = Array.from(new Set(lines)).slice(0, 20);
  const keyframes = (capture.keyframes || '').trim();

  const deltas = capture.interactionDeltas;
  const recordedChange =
    deltas &&
    deltas.changed !== false &&
    deltas.extremes &&
    Object.keys(deltas.extremes).length > 0;

  const hasCanvas =
    elements.some((e) => e.tag === 'canvas' || e.tag?.includes('-canvas')) ||
    (deltas?.canvasLayers && deltas.canvasLayers.length > 0);
  const hasBackgroundVideo = (capture.layout?.backgroundMedia || []).some((m) => m.tag === 'video');

  const out = [];

  // 1. 若存在 4 格动态分镜故事板，优先输出分镜时间轴说明
  if (capture.isStoryboard && Array.isArray(capture.storyboardLabels)) {
    out.push(
      `### 🎬 四格动态分镜时间轴 (Motion Storyboard Frame #1 → #4)\n随附图片是一张按 2×2 排列的 4 秒连续交互过程抓拍图：\n${capture.storyboardLabels
        .map((lbl, idx) => `- **分镜 #${idx + 1}**：\`${lbl}\``)
        .join('\n')}\n- **分镜复刻要求**：请仔细对比分镜 #1（初始全屏态）、#2/#3（鼠标移动时的局部球面透镜折射/多场景混合态）、#4（滚轮触发后的收缩成球/转场态），完整还原画面中的所有动态过渡！`
    );
  }

  // 2. CSS Transition / Animation 列表
  if (uniqueLines.length > 0) {
    out.push('### CSS 计算样式中检测到的过渡与变换：\n' + uniqueLines.join('\n'));
  }

  // 3. 4 秒动态交互录制数据
  if (deltas) {
    const metaSummary = `- 录制时长：\`${deltas.durationMs || 4000}ms\`（采样 \`${deltas.sampleCount || 0}\` 帧，鼠标移动事件 \`${
      deltas.pointerMoveCount || 0
    }\` 次，最大滚动位移 \`ΔY = ${deltas.scrollDeltaY || 0}px\`）`;

    if (recordedChange) {
      out.push(
        `### 录制期间捕获的 DOM/CSS 状态变化 (Initial → Peak)：\n${metaSummary}\n\`\`\`json\n${pruneText(
          JSON.stringify(deltas.extremes, null, 2),
          1600
        )}\n\`\`\``
      );
    } else {
      out.push(`### 录制统计：\n${metaSummary}`);
    }
  }

  if (keyframes) {
    out.push(`### 关联 @keyframes：\n\`\`\`css\n${pruneText(keyframes, 1500)}\n\`\`\``);
  }

  // 4. 针对 Canvas / WebGL 交互舞台的专项复刻指令
  if (hasCanvas) {
    out.push(`### ⚡ Canvas / WebGL 实时交互舞台实现要求（核心特效）
选区底层包含全屏或大尺寸 \`<canvas>\`（如 WebGL / Shader 画布），其核心动画绘制在 Canvas 内部而非普通 CSS 属性上。请务必结合截图/四格分镜图实现以下交互效果：
1. **鼠标跟随球面折射透镜 (Liquid Glass Refraction Lens)**：
   - 监听 \`mousemove\` / \`pointermove\`（带阻尼平滑插值 Lerp），在鼠标位置周围绘制一个平滑跟随的球面/鱼眼折射透镜区域。
   - 透镜内部折射显现**第二重世界场景纹理**（如霓虹雨夜街景 vs 车内人物窗景），并在透镜边缘实现球面法线桶形畸变（Barrel Distortion）、色散高光（Chromatic Aberration / Rim Specular）以及滑过中央大标题时的文字遮罩反色互动。
2. **滚轮驱动的全屏 → 3D 水晶球收缩转场 (Scroll-Driven World Orb Transition)**：
   - 监听 \`wheel\` / \`scroll\` 滚动进度 \`progress ∈ [0, 1]\`：
   - 当 \`progress\` 从 \`0\` 过渡到 \`1\` 时，底层全屏画面逐渐高斯模糊并压暗（\`blur + brightness\`），同时主体可视域从全屏平滑收缩凝聚为屏幕正中央一颗带有立体球面高光与内部流光纹理的 **3D 悬浮玻璃水晶球 (World Orb)**；
   - 与此同时，副标题与胶囊按钮（如 \`Read blog\`）随 \`progress\` 增加平滑淡出（\`opacity: 1 -> 0\`, \`translateY\`），而主标题（如 \`Genie 4\`）始终居中悬浮在水晶球正中央！`);
  }

  if (hasBackgroundVideo) {
    out.push(
      '- **背景视频层**：选区包含全屏 `<video>`，若上文采集到了有效 `src` URL，请直接使用 `<video autoplay muted loop playsinline>` 加载；若叠加了 Canvas 特效，请将视频或双场景画布纹理接入 WebGL / Canvas 渲染管线。'
    );
  }

  if (!hasCanvas && !hasBackgroundVideo && uniqueLines.length === 0 && !recordedChange && !keyframes) {
    out.push('未检测到 Canvas 画布或显著 CSS 动画，请按截图还原静态布局与常规按钮悬停反馈。');
  }

  return out.join('\n\n');
}

/**
 * 对捕获的原始特征包进行清洗与 Token 剪枝
 */
export function sanitizeAndPrunePayload(capturePayload = {}) {
  const rawStyles = capturePayload.computedStyles || {};
  const cleanedRootStyles = rawStyles.root
    ? filterComputedStyles(rawStyles.root)
    : filterComputedStyles(rawStyles);

  return {
    captureMode: capturePayload.captureMode || 'hybrid',
    pageUrl: capturePayload.pageUrl || 'Unknown URL',
    pageTitle: capturePayload.pageTitle || '',
    tagName: capturePayload.tagName || 'region',
    boundingBox: capturePayload.boundingBox || { width: 0, height: 0, dpr: 1 },
    html: pruneText(capturePayload.html || '', 1500),
    stylesJson: pruneText(JSON.stringify(cleanedRootStyles, null, 2), 1800),
    imageInfo: parseScreenshotDataUrl(capturePayload.screenshotBase64 || '')
  };
}

/**
 * 编译生成复刻请求包
 */
export function compileReversePrompt(capturePayload = {}) {
  const pruned = sanitizeAndPrunePayload(capturePayload);
  const box = pruned.boundingBox;

  let screenshotLine = '未采集到截图，请以布局数据为准。';
  if (pruned.imageInfo.hasValidBitmap) {
    if (capturePayload.isStoryboard) {
      screenshotLine =
        '已采集【2×2 四格动态分镜故事板图 (Motion Storyboard Frame #1 → #4)】（请与本 Prompt 一并发送给 AI，重点对照 4 格画面还原鼠标交互与滚动转场动画）。';
    } else if (capturePayload.screenshotSuspect) {
      const share = Math.round((capturePayload.visualPalette?.dominantShare || 0) * 100);
      screenshotLine = `已采集，但截图中单一颜色占比约 ${share}%，可能没有拍到视频 / 画布画面。请结合布局数据与动效要求实现。`;
    } else {
      screenshotLine = '已采集原网页高清局部截图（请与本 Prompt 一同提供给 AI）。';
    }
  }

  const userPrompt = `请 1:1 复刻以下网页区域的界面布局与动态交互特效。

## 来源与上下文
- 页面：${pruned.pageTitle ? `${pruned.pageTitle} ` : ''}\`${pruned.pageUrl}\`
- 选区尺寸：${box.width} × ${box.height} px（DPR ${box.dpr || 1}）
- 视觉参考图：${screenshotLine}

## 一、图层结构（从背景到前景）
${formatLayoutSection(capturePayload.layout)}

## 二、动效、录制极值与 Canvas/WebGL 交互规范
${buildMotionSection(capturePayload)}

## 三、补充参考：选区根节点 \`${pruned.tagName}\` 的计算样式
\`\`\`json
${pruned.stylesJson}
\`\`\`

## 四、补充参考：原始 HTML 结构（已穿透 Web Components，仅用于理解层级）
\`\`\`xml
${pruned.html || '<!-- 无 -->'}
\`\`\``;

  const combinedPromptForWeb = `${REVERSE_SYSTEM_INSTRUCTION}\n\n---\n\n${userPrompt}`;

  return {
    systemInstruction: REVERSE_SYSTEM_INSTRUCTION,
    userPrompt,
    combinedPromptForWeb,
    imageInfo: pruned.imageInfo,
    prunedSummary: pruned
  };
}

/**
 * PPTX 95%+ 复刻系统级指令
 * （同样不出现连续三个反引号，避免离线展示 Prompt 时误触发 Sandbox 提取）
 */
export const PPTX_SYSTEM_INSTRUCTION = `你是一名顶级的演示文稿视觉设计师与前端工程师，任务是根据从 .pptx (OOXML) 底层提取的四级样式继承数据，对目标幻灯片进行 95% 以上还原度的 1:1 复刻。

输入数据说明：
- 所有坐标百分比 (l%, t%, w%, h%) 与参考像素均直接来自 .pptx 底层 EMU 测量数据，并已完成 Theme -> SlideMaster -> SlideLayout -> Slide 四级继承与色板运算。

复刻规则：
1. 严格还原画布比例（如 16:9 1280×720）与所有元素的位置、宽高、旋转角、层叠顺序（母版装饰层 → 版式层 → 幻灯片内容层）。
2. 必须 100% 保留原始真实文案、列表符号、表格单元格内容与图表数值，严禁删改或自行编造文案。
3. 严格还原全部精确 HEX/RGBA 色值、渐变角度、圆角大小、边框、投影以及每段文字的字号 (pt)、字体、字重与颜色。
4. 严禁添加原 PPT 数据中不存在的毛玻璃、发光粒子或装饰性参数标签。

输出要求：
1. 先输出清晰的【逐页 PPT 复刻拆解规范】（含配色板、字体层级、版式布局、各图层参数与动画顺序，可直接用于 PowerPoint / WPS / Gamma / Cursor 制作）。
2. 再给出一个完整闭合的 html 代码块：单文件响应式等比缩放 HTML5 演示稿，支持左右键盘翻页与全屏放映。`;

function describeFill(fill) {
  if (!fill || fill.type === 'none') return '无填充 (transparent)';
  if (fill.type === 'solid') return `纯色 ${fill.color}`;
  if (fill.type === 'gradient') return `渐变 ${fill.css}`;
  if (fill.type === 'image') return `图片填充 (${fill.mediaPath || '内嵌图片'})`;
  return '默认';
}

function formatSlideForPrompt(slide, isCompact = false) {
  const lines = [];
  lines.push(`### 第 ${slide.slideNumber} 页：${slide.title}`);
  lines.push(`- 背景：${describeFill(slide.background)}`);
  if (slide.transition) {
    lines.push(`- 切页动画：${slide.transition.effect} (speed: ${slide.transition.speed})`);
  }
  if (slide.notes) {
    lines.push(`- 演讲者备注：${pruneText(slide.notes, 240)}`);
  }

  const elements = slide.elements || [];
  if (elements.length === 0) {
    lines.push('- 图层：空页面');
    return lines.join('\n');
  }

  lines.push(`- 图层清单（共 ${elements.length} 个对象，按母版 → 版式 → 内容由底向上排列）：`);
  const limit = isCompact ? 18 : 60;

  elements.slice(0, limit).forEach((el, idx) => {
    const b = el.box || {};
    const posStr = `位置 l=${b.lPct}%, t=${b.tPct}%, w=${b.wPct}%, h=${b.hPct}% (${b.xPx},${b.yPx} ${b.wPx}×${b.hPx}px${
      b.rotDeg ? `, 旋转 ${b.rotDeg}°` : ''
    })`;
    const layerTag = el.fromLayer === 'master' ? '[母版]' : el.fromLayer === 'layout' ? '[版式]' : '[页面]';

    if (el.type === 'shape') {
      const geom = el.geometry?.kind === 'custom' ? '自定义矢量路径' : el.geometry?.prst || 'rect';
      const radiusNote =
        el.geometry?.prst === 'roundRect' && el.geometry?.adjRatio != null
          ? ` (圆角比例 ${Math.round(el.geometry.adjRatio * 1000) / 10}%)`
          : '';
      const borderStr = el.line && el.line.widthPx > 0 ? `; 边框: ${el.line.widthPx}px ${el.line.dash} ${el.line.color}` : '';
      const shadowStr = el.shadow ? `; 阴影: ${el.shadow}` : '';
      const animStr = el.animation ? `; 入场动画 #${el.animation.order}: ${el.animation.effectClass} (${el.animation.durationMs}ms)` : '';
      lines.push(`  ${idx + 1}. ${layerTag} [图形:${geom}${radiusNote}] ${el.name} | ${posStr}`);
      lines.push(`     - 外观：填充 ${describeFill(el.fill)}${borderStr}${shadowStr}${animStr}`);

      if (el.text && el.text.plainText) {
        const pList = (el.text.paragraphs || [])
          .filter((p) => (p.text || '').trim())
          .slice(0, isCompact ? 5 : 16);
        lines.push(`     - 文本 (垂直对齐:${el.text.vAlign})：`);
        for (const p of pList) {
          const r0 = p.runs?.[0]?.style || {};
          const styleHint = `${r0.fontFamily || 'sans-serif'} ${r0.fontSizePt || 14}pt${r0.bold ? ' Bold' : ''}${
            r0.italic ? ' Italic' : ''
          } ${r0.color || ''} | align=${p.style?.align || 'left'}`;
          const bullet = p.style?.bullet ? `${p.style.bullet} ` : '';
          lines.push(`       * "${bullet}${p.text.replace(/\n/g, ' / ')}"  [${styleHint}]`);
        }
      }
    } else if (el.type === 'image') {
      lines.push(`  ${idx + 1}. ${layerTag} [图片] ${el.name} (${el.mediaPath || 'embedded'}) | ${posStr}`);
      if (el.crop) {
        lines.push(`     - 裁剪：L=${el.crop.l}% T=${el.crop.t}% R=${el.crop.r}% B=${el.crop.b}%`);
      }
    } else if (el.type === 'table') {
      lines.push(`  ${idx + 1}. ${layerTag} [表格] ${(el.rows || []).length}行 × ${(el.colWidthPcts || []).length}列 | ${posStr}`);
      (el.rows || []).slice(0, isCompact ? 4 : 12).forEach((row, rIdx) => {
        const cellTexts = (row.cells || [])
          .filter((c) => !c.mergedSkip)
          .map((c) => `"${(c.text?.plainText || '').replace(/\n/g, ' ')}"`);
        lines.push(`     - 行${rIdx + 1}: [ ${cellTexts.join(' | ')} ]`);
      });
    } else if (el.type === 'chart') {
      lines.push(`  ${idx + 1}. ${layerTag} [图表:${el.chart?.chartKind || 'chart'}] "${el.name}" | ${posStr}`);
      (el.chart?.series || []).slice(0, 4).forEach((s) => {
        lines.push(`     - 系列 ${s.name}: 分类[${s.categories.join(', ')}] 数值[${s.values.join(', ')}]`);
      });
    }
  });

  if (elements.length > limit) {
    lines.push(`  ... 其余 ${elements.length - limit} 个次要元素已省略`);
  }

  return lines.join('\n');
}

/**
 * 将解析后的 PPTX 文档编译为 95%+ 还原度复刻 Prompt
 * @param {object} pptxDoc parsePptxBuffer 返回的数据模型
 * @param {{ scope?: 'single'|'all', slideIndex?: number }} [options]
 */
export function compilePptxPrompt(pptxDoc, options = {}) {
  if (!pptxDoc || !Array.isArray(pptxDoc.slides) || pptxDoc.slides.length === 0) {
    throw new Error('缺少有效的 PPTX 解析数据');
  }

  const scope = options.scope === 'all' ? 'all' : 'single';
  const slideIndex = Math.max(0, Math.min(pptxDoc.slides.length - 1, options.slideIndex || 0));
  const targetSlides = scope === 'all' ? pptxDoc.slides : [pptxDoc.slides[slideIndex]];
  const isCompact = targetSlides.length > 6;

  const tColors = pptxDoc.theme?.colors || {};
  const tFonts = pptxDoc.theme?.fonts || {};

  const colorList = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']
    .filter((k) => tColors[k])
    .map((k) => `${k}: ${tColors[k]}`)
    .join(' | ');

  const slidesSection = targetSlides.map((s) => formatSlideForPrompt(s, isCompact)).join('\n\n---\n\n');

  const userPrompt = `请根据以下从 .pptx 文件底层解析出的精确工程参数，1:1 复刻${
    scope === 'all' ? `整份演示文稿（共 ${targetSlides.length} 页）` : `第 ${targetSlides[0].slideNumber} 页幻灯片`
  }：

## 一、全局演示文稿规格与主题系统
- 文件名：\`${pptxDoc.fileName}\`
- 画布尺寸：\`${pptxDoc.stageW} × ${pptxDoc.stageH} px\`（比例 \`${pptxDoc.ratioLabel}\`）
- 主题色板：${colorList}
- 主题字体：标题 [${tFonts.majorEa || ''} / ${tFonts.majorLatin || ''}]，正文 [${tFonts.minorEa || ''} / ${tFonts.minorLatin || ''}]

## 二、逐页精确图层与排版参数
${slidesSection}`;

  const combinedPromptForWeb = `${PPTX_SYSTEM_INSTRUCTION}\n\n---\n\n${userPrompt}`;

  return {
    systemInstruction: PPTX_SYSTEM_INSTRUCTION,
    userPrompt,
    combinedPromptForWeb,
    imageInfo: { hasValidBitmap: false, mimeType: '', base64Data: '', dataUrl: '' }
  };
}

