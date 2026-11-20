/**
 * @file utils/prompt-compiler.js
 * @description 通用高保真复刻 Prompt 编译器（支持简体中文 / English 双语输出与自定义改稿指令）
 * 1. 网页逆向：结合「选区全图层结构 + 4格动态分镜故事板 + DOM/Canvas 录制数据」，彻底去案例偏置，严禁臆造或篡改真实文案。
 * 2. PPTX 复刻：基于 OOXML 四级继承链参数编译 95%+ 复刻 Prompt，并支持用户自定义改稿/换风格指令。
 */

import { filterComputedStyles } from './style-filter.js';

function isEnLang(lang) {
  return String(lang || '').toLowerCase().startsWith('en');
}

/**
 * 网页复刻系统级指令（中文 / 英文通用版，彻底去除历史特定网页案例偏置）
 * 注意：严禁出现连续三个反引号，避免离线展示 Prompt 时被侧边栏误识别为 html 代码块
 */
export const REVERSE_SYSTEM_INSTRUCTION = `你是一名资深创意前端工程师（UI / CSS / WebGL 动效专家），任务是 1:1 复刻目标网页区域的界面布局、视觉样式与真实动态交互特效。

依据：
1. 随附的原网页高清局部截图或【2×2 四格动态分镜故事板图 (Motion Storyboard Frame #1 → #4)】：构图、光影材质、视觉层次与连续动画过程以图片为准。
2. 从原网页真实 DOM 采集的【图层结构】与【动效录制数据】：元素相对位置、真实文案、字号、色值、圆角以及悬停/点击/滚动变化以数据为准。

核心准则：
1. 忠实还原界面布局与真实文案（严禁擅自篡改）：
   - 除非用户在「自定义修改要求」中明确指定替换内容，否则必须 100% 原样保留采集数据中的所有真实文案、导航项与按钮文本。
   - 严格还原各元素的相对位置、对齐方式、字体风格、圆角、阴影与视觉层级。
2. 忠实还原真实动态交互与 Canvas / WebGL 效果：
   - 若随附的是【2×2 四格动态分镜图】或检测到 \`<canvas>\` / 滚动 / 鼠标位移变化，必须客观对照 Frame #1 → #2 → #3 → #4 的真实画面演进与录制极值，使用原生 CSS / JS / Canvas 2D / WebGL 还原对应的真实交互动画。
   - 严禁假设或硬套原截图中不存在的特效形态（不要凭空编造未出现过的 3D 球体、折射滤镜、科技仪表盘或调试浮窗）。
3. 纯净性约束：
   - 严禁把采集数据中的 CSS 选择器名、百分比坐标、HEX 色号标注或分镜标签当成网页 UI 文字渲染出来。

输出格式：
1. 先用 4～8 行简明列出你从「截图/分镜 + 图层数据」中识别出的：① 视觉与布局层级；② 真实交互与动效机制。
2. 随后输出一个完整闭合的 html 代码块（单文件自包含 HTML5 + CSS3 + Vanilla JS，无需外部构建工具，打开即可直接预览体验）。`;

export const REVERSE_SYSTEM_INSTRUCTION_EN = `You are a senior Creative Frontend Engineer (UI / CSS / WebGL motion specialist). Your task is to faithfully replicate a target web region's layout, visual styling, and real interactive motion at 1:1 fidelity.

Inputs:
1. Attached HD cropped screenshot or [2x2 Motion Storyboard (Frame #1 -> #4)]: treat the image as ground truth for composition, lighting, visual hierarchy, and continuous animation states.
2. Extracted [Layer Hierarchy] and [Motion Recording Data] from live DOM: treat the data as ground truth for relative coordinates, exact copy, font sizes, colors, border radii, and hover/scroll state deltas.

Core Rules:
1. Faithful Layout & Copy (No Unrequested Rewrites):
   - Unless explicitly overridden in the "Custom Modification Directive", preserve 100% of the real copy, headings, navigation items, and button labels from the captured data.
   - Accurately reproduce alignment, relative positions, typography, radii, shadows, and visual stacking order.
2. Faithful Motion & Canvas/WebGL Replication:
   - When a [2x2 Motion Storyboard] or large <canvas> / scroll / pointer delta is present, objectively inspect Frame #1 -> #2 -> #3 -> #4 and reproduce the actual observed visual transitions using native CSS, JS, Canvas 2D, or WebGL.
   - Never hallucinate effects, sci-fi HUD frames, or decorative widgets that do not exist in the screenshot or DOM data.
3. Clean Output:
   - Never render raw CSS selectors, percentage coordinates, hex codes, or frame debug labels as visible page UI text.

Output Format:
1. Briefly summarize (4-8 lines): (1) visual & layout hierarchy; (2) real interaction & animation mechanics.
2. Output one complete self-contained html code block (single-file HTML5 + CSS3 + Vanilla JS, runnable directly without any build step).`;

export function getReverseSystemInstruction(lang = 'zh') {
  return isEnLang(lang) ? REVERSE_SYSTEM_INSTRUCTION_EN : REVERSE_SYSTEM_INSTRUCTION;
}

const KIND_LABEL_ZH = {
  media: '媒体/画布',
  control: '可点击控件',
  text: '文字',
  surface: '色块/容器'
};

const KIND_LABEL_EN = {
  media: 'Media/Canvas',
  control: 'Interactive Control',
  text: 'Text',
  surface: 'Surface/Container'
};

function pruneText(str = '', maxLen = 1500) {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + `\n/* ... truncated (original length ${trimmed.length} chars) */`;
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
function formatLayoutEntry(entry, index, lang = 'zh') {
  const en = isEnLang(lang);
  const kindMap = en ? KIND_LABEL_EN : KIND_LABEL_ZH;
  const isBackground = entry.kind === 'media' && entry.coverage >= 0.8;
  const label = isBackground
    ? en
      ? 'Full-bleed Background Media/Canvas'
      : '全屏背景媒体/画布'
    : kindMap[entry.kind] || entry.kind;
  const textPart = entry.text ? ` "${entry.text}"` : '';
  const box = entry.box || {};

  let pos = en
    ? `L=${box.l}%, T=${box.t}%, W=${box.w}%, H=${box.h}% (actual ${entry.px?.w}×${entry.px?.h}px)`
    : `左 ${box.l}%，上 ${box.t}%，宽 ${box.w}%，高 ${box.h}%（元素实际 ${entry.px?.w}×${entry.px?.h}px）`;
  if (entry.align) pos += en ? `, align=${entry.align}` : `，${entry.align}`;
  if (entry.fixed) pos += en ? `, position: ${entry.fixed}` : `，position: ${entry.fixed}`;

  const lines = [
    `${index}. [${label}] <${entry.tag}> ${entry.sel}${textPart}`,
    `   - ${en ? 'Position' : '位置'}：${pos}`
  ];

  const styleText = Object.entries(entry.style || {})
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${toKebab(k)}: ${v}`)
    .join('; ');
  if (styleText) lines.push(`   - ${en ? 'Styles' : '样式'}：${styleText}`);

  if (entry.media) {
    const mediaText = Object.entries(entry.media)
      .filter(([, v]) => v !== '' && v !== false && v != null)
      .map(([k, v]) => `${k}: ${v === true ? (en ? 'yes' : '是') : v}`)
      .join('; ');
    if (mediaText) lines.push(`   - ${en ? 'Media' : '媒体'}：${mediaText}`);
  }

  if (entry.motion && entry.motion.length) {
    lines.push(`   - ${en ? 'Motion' : '动效'}：${entry.motion.join('; ')}`);
  }

  return lines.join('\n');
}

/**
 * 将区域布局采集结果格式化为「从背景到前景」的图层清单
 */
export function formatLayoutSection(layout, lang = 'zh') {
  const en = isEnLang(lang);
  if (!layout || !Array.isArray(layout.elements) || layout.elements.length === 0) {
    return en
      ? '(No region layout entries captured; rely on the attached screenshot and HTML/CSS below.)'
      : '（未采集到布局数据，请以截图和下方 HTML / CSS 为准）';
  }

  const header = en
    ? `Detected ${layout.elements.length} visible elements in the region${
        layout.truncated ? ' (core elements retained)' : ''
      }, ordered from Background Media/Canvas -> Surfaces -> Foreground Text & Controls:`
    : `选区内识别到 ${layout.elements.length} 个可见元素${
        layout.truncated ? '（已保留核心元素）' : ''
      }，按「背景媒体/画布 → 色块容器 → 前景文字与控件（阅读顺序）」排列：`;

  const body = layout.elements.map((entry, i) => formatLayoutEntry(entry, i + 1, lang)).join('\n');
  return `${header}\n\n${body}`;
}

/**
 * 汇总动效、录制极值、4格动态分镜与通用 Canvas/WebGL 交互规范
 */
function buildMotionSection(capture = {}, lang = 'zh') {
  const en = isEnLang(lang);
  const lines = [];
  const elements = capture.layout?.elements || [];

  for (const entry of elements) {
    if (entry.motion && entry.motion.length) {
      const label = entry.text ? ` "${entry.text.slice(0, 24)}"` : '';
      lines.push(`- ${entry.sel}${label}: ${entry.motion.join('; ')}`);
    }
  }

  const rootStyles = filterComputedStyles(capture.computedStyles?.root || {});
  if (rootStyles.transition) {
    lines.push(`- ${en ? 'Root container' : '选区根节点'}: transition: ${rootStyles.transition}`);
  }
  if (rootStyles.animation) {
    lines.push(`- ${en ? 'Root container' : '选区根节点'}: animation: ${rootStyles.animation}`);
  }

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

  // 1. 4 格动态分镜时间轴（完全通用、去偏置）
  if (capture.isStoryboard && Array.isArray(capture.storyboardLabels)) {
    out.push(
      en
        ? `### 🎬 4-Frame Motion Storyboard Timeline (Frame #1 -> #4)\nThe attached image is a 2x2 grid captured across 4 seconds of live interaction:\n${capture.storyboardLabels
            .map((lbl, idx) => `- **Frame #${idx + 1}**: \`${lbl}\``)
            .join('\n')}\n- **Replication Requirement**: Carefully compare visual state changes across Frame #1 -> #2 -> #3 -> #4 (e.g., hover response, pointer tracking, scroll transitions, or Canvas/WebGL animation) and reproduce the exact observed transitions without inventing unrelated effects.`
        : `### 🎬 四格动态分镜时间轴 (Motion Storyboard Frame #1 → #4)\n随附图片是一张按 2×2 排列的 4 秒连续交互过程抓拍图：\n${capture.storyboardLabels
            .map((lbl, idx) => `- **分镜 #${idx + 1}**：\`${lbl}\``)
            .join('\n')}\n- **分镜复刻要求**：请客观对比 Frame #1 → #2 → #3 → #4 的真实画面演进（例如悬停反馈、指针跟随、滚动联动或画布动态渲染），严格按照四格画面中真实可见的变化还原动画，切勿凭空编造未出现的特效。`
    );
  }

  // 2. CSS Transition / Animation 列表
  if (uniqueLines.length > 0) {
    out.push(
      (en ? '### Detected CSS Transitions & Animations:\n' : '### CSS 计算样式中检测到的过渡与变换：\n') +
        uniqueLines.join('\n')
    );
  }

  // 3. 4 秒动态交互录制数据
  if (deltas) {
    const metaSummary = en
      ? `- Recording duration: \`${deltas.durationMs || 4000}ms\` (samples: \`${deltas.sampleCount || 0}\`, pointer moves: \`${
          deltas.pointerMoveCount || 0
        }\`, max scroll delta: \`ΔY = ${deltas.scrollDeltaY || 0}px\`)`
      : `- 录制时长：\`${deltas.durationMs || 4000}ms\`（采样 \`${deltas.sampleCount || 0}\` 帧，鼠标移动事件 \`${
          deltas.pointerMoveCount || 0
        }\` 次，最大滚动位移 \`ΔY = ${deltas.scrollDeltaY || 0}px\`）`;

    if (recordedChange) {
      out.push(
        `${en ? '### Recorded DOM/CSS Deltas (Initial -> Peak):' : '### 录制期间捕获的 DOM/CSS 状态变化 (Initial → Peak)：'}\n${metaSummary}\n\`\`\`json\n${pruneText(
          JSON.stringify(deltas.extremes, null, 2),
          1600
        )}\n\`\`\``
      );
    } else {
      out.push(`${en ? '### Recording Stats:' : '### 录制统计：'}\n${metaSummary}`);
    }
  }

  if (keyframes) {
    out.push(`${en ? '### Extracted @keyframes:' : '### 关联 @keyframes：'}\n\`\`\`css\n${pruneText(keyframes, 1500)}\n\`\`\``);
  }

  // 4. 通用 Canvas / WebGL 舞台指导（完全去除特定网站案例诱导）
  if (hasCanvas) {
    out.push(
      en
        ? `### ⚡ Canvas / WebGL Stage Replication Notes\nThis region contains a \`<canvas>\` element whose visual rendering is driven programmatically rather than purely via CSS.\n- Inspect the attached screenshot or 2x2 storyboard frames to identify the actual visual content (e.g., 2D data chart, particle field, gradient mesh, 3D scene, or shader effect).\n- Reconstruct the observed visual rendering and real pointer/scroll responsiveness cleanly using native Canvas 2D or WebGL without external dependencies.`
        : `### ⚡ Canvas / WebGL 画布舞台还原要求\n选区包含 \`<canvas>\` 画布元素，其核心画面由程序渲染驱动而非纯 CSS 属性：\n- 请严格依据随附截图或四格分镜图中真实呈现的画面内容（如数据图表、粒子/网格渐变、3D 场景或自定义 Shader），用原生 Canvas 2D 或 WebGL 实现对应的视觉渲染与交互响应。\n- 仅还原截图中实际存在的画面与交互，不要套用与当前页面无关的预设特效。`
    );
  }

  if (hasBackgroundVideo) {
    out.push(
      en
        ? '- **Background Video Layer**: Region contains a `<video>` element. Reuse any valid captured `src` URL via `<video autoplay muted loop playsinline>`, or provide a matching animated Canvas fallback if cross-origin playback is unavailable.'
        : '- **背景视频层**：选区包含 `<video>`，若上文采集到了有效 `src` URL，请直接使用 `<video autoplay muted loop playsinline>` 加载；若受跨域限制，请使用风格一致的柔和渐变/Canvas 动效平滑兜底。'
    );
  }

  if (!hasCanvas && !hasBackgroundVideo && uniqueLines.length === 0 && !recordedChange && !keyframes) {
    out.push(
      en
        ? 'No Canvas or significant CSS motion detected. Focus on 1:1 static layout fidelity and clean hover states.'
        : '未检测到 Canvas 画布或显著 CSS 动画，请按截图还原静态布局与常规按钮悬停反馈。'
    );
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
 * 编译生成网页复刻请求包（支持双语与自定义修改要求）
 * @param {object} capturePayload
 * @param {{ lang?: 'zh'|'en', customInstruction?: string }} [options]
 */
export function compileReversePrompt(capturePayload = {}, options = {}) {
  const lang = isEnLang(options.lang) ? 'en' : 'zh';
  const en = lang === 'en';
  const customDirective = String(options.customInstruction || '').trim();
  const systemInstruction = getReverseSystemInstruction(lang);

  const pruned = sanitizeAndPrunePayload(capturePayload);
  const box = pruned.boundingBox;

  let screenshotLine = en
    ? 'No screenshot captured; rely on the layout data below.'
    : '未采集到截图，请以布局数据为准。';
  if (pruned.imageInfo.hasValidBitmap) {
    if (capturePayload.isStoryboard) {
      screenshotLine = en
        ? 'Captured [2x2 4-Frame Motion Storyboard PNG] (send along with this prompt to replicate observed hover/scroll/canvas transitions).'
        : '已采集【2×2 四格动态分镜故事板图 (Motion Storyboard Frame #1 → #4)】（请与本 Prompt 一并发送给 AI，重点对照 4 格画面还原真实交互过程）。';
    } else if (capturePayload.screenshotSuspect) {
      const share = Math.round((capturePayload.visualPalette?.dominantShare || 0) * 100);
      screenshotLine = en
        ? `Captured, but ~${share}% of pixels are a single solid color (video/canvas may not have painted yet). Rely primarily on the layout & motion specs below.`
        : `已采集，但截图中单一颜色占比约 ${share}%，可能没有拍到视频 / 画布画面。请结合布局数据与动效要求实现。`;
    } else {
      screenshotLine = en
        ? 'Captured HD cropped screenshot of the target region (send along with this prompt).'
        : '已采集原网页高清局部截图（请与本 Prompt 一同提供给 AI）。';
    }
  }

  const customBlock = customDirective
    ? en
      ? `\n\n## ★ Custom Modification Directive (Highest Priority)\nWhile preserving the layout grammar and visual quality of the captured region, apply the following user instructions:\n> ${customDirective}`
      : `\n\n## ★ 用户自定义修改 / 精修指令（最高优先级）\n在保持原区域版式结构与视觉质感的基础上，请优先按以下要求定制修改：\n> ${customDirective}`
    : '';

  const userPrompt = en
    ? `Please replicate the following web region's layout, visual styling, and interactive motion at 1:1 fidelity.${customBlock}

## Context
- Source page: ${pruned.pageTitle ? `${pruned.pageTitle} ` : ''}\`${pruned.pageUrl}\`
- Region size: ${box.width} × ${box.height} px (DPR ${box.dpr || 1})
- Visual reference: ${screenshotLine}

## 1. Layer Hierarchy (Background -> Foreground)
${formatLayoutSection(capturePayload.layout, lang)}

## 2. Motion, Recorded Deltas & Canvas Specs
${buildMotionSection(capturePayload, lang)}

## 3. Reference: Computed Styles of Root \`${pruned.tagName}\`
\`\`\`json
${pruned.stylesJson}
\`\`\`

## 4. Reference: Folded HTML Tree (Web Components Pierced)
\`\`\`xml
${pruned.html || '<!-- none -->'}
\`\`\``
    : `请 1:1 复刻以下网页区域的界面布局与动态交互特效。${customBlock}

## 来源与上下文
- 页面：${pruned.pageTitle ? `${pruned.pageTitle} ` : ''}\`${pruned.pageUrl}\`
- 选区尺寸：${box.width} × ${box.height} px（DPR ${box.dpr || 1}）
- 视觉参考图：${screenshotLine}

## 一、图层结构（从背景到前景）
${formatLayoutSection(capturePayload.layout, lang)}

## 二、动效、录制极值与画布交互规范
${buildMotionSection(capturePayload, lang)}

## 三、补充参考：选区根节点 \`${pruned.tagName}\` 的计算样式
\`\`\`json
${pruned.stylesJson}
\`\`\`

## 四、补充参考：原始 HTML 结构（已穿透 Web Components，仅用于理解层级）
\`\`\`xml
${pruned.html || '<!-- 无 -->'}
\`\`\``;

  const combinedPromptForWeb = `${systemInstruction}\n\n---\n\n${userPrompt}`;

  return {
    systemInstruction,
    userPrompt,
    combinedPromptForWeb,
    imageInfo: pruned.imageInfo,
    prunedSummary: pruned
  };
}

/**
 * PPTX 95%+ 复刻系统级指令（中文 / 英文）
 * （严禁出现连续三个反引号，避免离线展示 Prompt 时误触发 Sandbox 提取）
 */
export const PPTX_SYSTEM_INSTRUCTION = `你是一名顶级的演示文稿视觉设计师与前端工程师，任务是根据从 .pptx (OOXML) 底层提取的四级样式继承数据，对目标幻灯片进行 95% 以上还原度的 1:1 复刻（并优先执行用户指定的改稿/换主题指令）。

输入数据说明：
- 所有坐标百分比 (l%, t%, w%, h%) 与参考像素均直接来自 .pptx 底层 EMU 测量数据，并已完成 Theme -> SlideMaster -> SlideLayout -> Slide 四级继承与色板运算。

复刻规则：
1. 严格还原画布比例（如 16:9 1280×720）与所有元素的位置、宽高、旋转角、层叠顺序（母版装饰层 → 版式层 → 幻灯片内容层）。
2. 除非用户在「自定义改稿指令」中要求替换文案或风格，否则必须 100% 保留原始真实文案、列表符号、表格单元格内容与图表数值。
3. 严格还原全部精确 HEX/RGBA 色值、渐变角度、圆角大小、边框、投影以及每段文字的字号 (pt)、字体、字重与颜色。
4. 严禁添加原 PPT 数据中不存在的多余装饰或参数标签。

输出要求：
1. 先输出清晰的【逐页 PPT 复刻拆解规范】（含配色板、字体层级、版式布局、各图层参数与动画顺序）。
2. 再给出一个完整闭合的 html 代码块：单文件 1280×720（或原比例）等比缩放 HTML5 演示稿，每页使用 section.ppt-slide 容器，支持左右键盘翻页与全屏放映，以便直接一键无损回转为可编辑 .pptx 文件。`;

export const PPTX_SYSTEM_INSTRUCTION_EN = `You are a world-class presentation designer and frontend engineer. Your task is to replicate target PowerPoint slides at 95%+ fidelity using 4-level OOXML style inheritance specs extracted directly from the .pptx archive (while honoring any custom user editing directive).

Input Specs:
- All percentage coordinates (l%, t%, w%, h%) and pixel dimensions come directly from OOXML EMU geometry with resolved Theme -> SlideMaster -> SlideLayout -> Slide color and font inheritance.

Replication Rules:
1. Faithfully preserve slide aspect ratio (e.g. 16:9 1280x720), exact coordinates, sizes, rotation angles, and layer order (Master -> Layout -> Slide).
2. Unless explicitly requested in the "Custom Editing Directive", preserve 100% of original copy, bullet points, table cells, and chart values.
3. Preserve exact HEX/RGBA colors, gradient angles, corner radii, strokes, shadows, and paragraph/run typography (pt size, font family, weight, alignment).
4. Do not invent decorative overlays or debug labels absent from the source deck.

Output Requirements:
1. Provide a concise slide-by-slide design & layout breakdown (palette, typography scale, grid/coordinates, animations).
2. Output one complete self-contained html code block: a single-file aspect-locked HTML5 presentation using section.ppt-slide containers with arrow-key navigation and fullscreen support, ready for one-click conversion back into an editable .pptx file.`;

export function getPptxSystemInstruction(lang = 'zh') {
  return isEnLang(lang) ? PPTX_SYSTEM_INSTRUCTION_EN : PPTX_SYSTEM_INSTRUCTION;
}

function describeFill(fill, lang = 'zh') {
  const en = isEnLang(lang);
  if (!fill || fill.type === 'none') return en ? 'none (transparent)' : '无填充 (transparent)';
  if (fill.type === 'solid') return en ? `solid ${fill.color}` : `纯色 ${fill.color}`;
  if (fill.type === 'gradient') return en ? `gradient ${fill.css}` : `渐变 ${fill.css}`;
  if (fill.type === 'image') {
    return en
      ? `image fill (${fill.mediaPath || 'embedded'})`
      : `图片填充 (${fill.mediaPath || '内嵌图片'})`;
  }
  return en ? 'default' : '默认';
}

function formatSlideForPrompt(slide, isCompact = false, lang = 'zh') {
  const en = isEnLang(lang);
  const lines = [];
  lines.push(en ? `### Slide ${slide.slideNumber}: ${slide.title}` : `### 第 ${slide.slideNumber} 页：${slide.title}`);
  lines.push(`- ${en ? 'Background' : '背景'}：${describeFill(slide.background, lang)}`);
  if (slide.transition) {
    lines.push(
      `- ${en ? 'Transition' : '切页动画'}：${slide.transition.effect} (speed: ${slide.transition.speed})`
    );
  }
  if (slide.notes) {
    lines.push(`- ${en ? 'Speaker Notes' : '演讲者备注'}：${pruneText(slide.notes, 240)}`);
  }

  const elements = slide.elements || [];
  if (elements.length === 0) {
    lines.push(en ? '- Layers: empty slide' : '- 图层：空页面');
    return lines.join('\n');
  }

  lines.push(
    en
      ? `- Layers (${elements.length} objects, Master -> Layout -> Slide bottom-to-top):`
      : `- 图层清单（共 ${elements.length} 个对象，按母版 → 版式 → 内容由底向上排列）：`
  );
  const limit = isCompact ? 18 : 60;

  elements.slice(0, limit).forEach((el, idx) => {
    const b = el.box || {};
    const posStr = en
      ? `box l=${b.lPct}%, t=${b.tPct}%, w=${b.wPct}%, h=${b.hPct}% (${b.xPx},${b.yPx} ${b.wPx}×${b.hPx}px${
          b.rotDeg ? `, rot ${b.rotDeg}°` : ''
        })`
      : `位置 l=${b.lPct}%, t=${b.tPct}%, w=${b.wPct}%, h=${b.hPct}% (${b.xPx},${b.yPx} ${b.wPx}×${b.hPx}px${
          b.rotDeg ? `, 旋转 ${b.rotDeg}°` : ''
        })`;
    const layerTag = en
      ? el.fromLayer === 'master'
        ? '[Master]'
        : el.fromLayer === 'layout'
        ? '[Layout]'
        : '[Slide]'
      : el.fromLayer === 'master'
      ? '[母版]'
      : el.fromLayer === 'layout'
      ? '[版式]'
      : '[页面]';

    if (el.type === 'shape') {
      const geom = el.geometry?.kind === 'custom' ? (en ? 'customPath' : '自定义矢量路径') : el.geometry?.prst || 'rect';
      const radiusNote =
        el.geometry?.prst === 'roundRect' && el.geometry?.adjRatio != null
          ? en
            ? ` (radius ratio ${Math.round(el.geometry.adjRatio * 1000) / 10}%)`
            : ` (圆角比例 ${Math.round(el.geometry.adjRatio * 1000) / 10}%)`
          : '';
      const borderStr =
        el.line && el.line.widthPx > 0
          ? `; ${en ? 'stroke' : '边框'}: ${el.line.widthPx}px ${el.line.dash} ${el.line.color}`
          : '';
      const shadowStr = el.shadow ? `; ${en ? 'shadow' : '阴影'}: ${el.shadow}` : '';
      const animStr = el.animation
        ? `; ${en ? 'anim' : '入场动画'} #${el.animation.order}: ${el.animation.effectClass} (${el.animation.durationMs}ms)`
        : '';
      lines.push(`  ${idx + 1}. ${layerTag} [${en ? 'Shape' : '图形'}:${geom}${radiusNote}] ${el.name} | ${posStr}`);
      lines.push(
        `     - ${en ? 'Style' : '外观'}：${en ? 'fill' : '填充'} ${describeFill(el.fill, lang)}${borderStr}${shadowStr}${animStr}`
      );

      if (el.text && el.text.plainText) {
        const pList = (el.text.paragraphs || [])
          .filter((p) => (p.text || '').trim())
          .slice(0, isCompact ? 5 : 16);
        lines.push(`     - ${en ? 'Text (vAlign:' : '文本 (垂直对齐:'}${el.text.vAlign})：`);
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
      lines.push(`  ${idx + 1}. ${layerTag} [${en ? 'Image' : '图片'}] ${el.name} (${el.mediaPath || 'embedded'}) | ${posStr}`);
      if (el.crop) {
        lines.push(`     - ${en ? 'Crop' : '裁剪'}：L=${el.crop.l}% T=${el.crop.t}% R=${el.crop.r}% B=${el.crop.b}%`);
      }
    } else if (el.type === 'table') {
      lines.push(
        `  ${idx + 1}. ${layerTag} [${en ? 'Table' : '表格'}] ${(el.rows || []).length}×${(el.colWidthPcts || []).length} | ${posStr}`
      );
      (el.rows || []).slice(0, isCompact ? 4 : 12).forEach((row, rIdx) => {
        const cellTexts = (row.cells || [])
          .filter((c) => !c.mergedSkip)
          .map((c) => `"${(c.text?.plainText || '').replace(/\n/g, ' ')}"`);
        lines.push(`     - ${en ? `Row ${rIdx + 1}` : `行${rIdx + 1}`}: [ ${cellTexts.join(' | ')} ]`);
      });
    } else if (el.type === 'chart') {
      lines.push(`  ${idx + 1}. ${layerTag} [${en ? 'Chart' : '图表'}:${el.chart?.chartKind || 'chart'}] "${el.name}" | ${posStr}`);
      (el.chart?.series || []).slice(0, 4).forEach((s) => {
        lines.push(
          en
            ? `     - Series ${s.name}: cats[${s.categories.join(', ')}] vals[${s.values.join(', ')}]`
            : `     - 系列 ${s.name}: 分类[${s.categories.join(', ')}] 数值[${s.values.join(', ')}]`
        );
      });
    }
  });

  if (elements.length > limit) {
    lines.push(
      en
        ? `  ... (${elements.length - limit} secondary elements omitted)`
        : `  ... 其余 ${elements.length - limit} 个次要元素已省略`
    );
  }

  return lines.join('\n');
}

/**
 * 将解析后的 PPTX 文档编译为 95%+ 还原度复刻 Prompt（支持双语与自定义改稿要求）
 * @param {object} pptxDoc parsePptxBuffer 返回的数据模型
 * @param {{ scope?: 'single'|'all', slideIndex?: number, lang?: 'zh'|'en', customInstruction?: string }} [options]
 */
export function compilePptxPrompt(pptxDoc, options = {}) {
  if (!pptxDoc || !Array.isArray(pptxDoc.slides) || pptxDoc.slides.length === 0) {
    throw new Error('缺少有效的 PPTX 解析数据 / Missing valid PPTX data');
  }

  const lang = isEnLang(options.lang) ? 'en' : 'zh';
  const en = lang === 'en';
  const customDirective = String(options.customInstruction || '').trim();
  const systemInstruction = getPptxSystemInstruction(lang);

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

  const slidesSection = targetSlides.map((s) => formatSlideForPrompt(s, isCompact, lang)).join('\n\n---\n\n');

  const customBlock = customDirective
    ? en
      ? `\n\n## ★ Custom Editing / Rewrite Directive (Highest Priority)\nPreserve the visual layout quality and precision of the reference deck while applying these exact changes:\n> ${customDirective}`
      : `\n\n## ★ 用户自定义改稿 / 换风格指令（最高优先级）\n在保持原 PPT 高级版式与排版精度的基础上，请优先严格执行以下定制要求：\n> ${customDirective}`
    : '';

  const userPrompt = en
    ? `Replicate ${
        scope === 'all' ? `the entire presentation (${targetSlides.length} slides)` : `Slide ${targetSlides[0].slideNumber}`
      } at 1:1 fidelity using the exact OOXML specs below:${customBlock}

## 1. Deck Specs & Theme System
- File: \`${pptxDoc.fileName}\`
- Stage Size: \`${pptxDoc.stageW} × ${pptxDoc.stageH} px\` (Aspect \`${pptxDoc.ratioLabel}\`)
- Theme Palette: ${colorList}
- Theme Fonts: Major [${tFonts.majorEa || ''} / ${tFonts.majorLatin || ''}], Minor [${tFonts.minorEa || ''} / ${tFonts.minorLatin || ''}]

## 2. Slide-by-Slide Layer & Typography Specs
${slidesSection}`
    : `请根据以下从 .pptx 文件底层解析出的精确工程参数，1:1 复刻${
        scope === 'all' ? `整份演示文稿（共 ${targetSlides.length} 页）` : `第 ${targetSlides[0].slideNumber} 页幻灯片`
      }：${customBlock}

## 一、全局演示文稿规格与主题系统
- 文件名：\`${pptxDoc.fileName}\`
- 画布尺寸：\`${pptxDoc.stageW} × ${pptxDoc.stageH} px\`（比例 \`${pptxDoc.ratioLabel}\`）
- 主题色板：${colorList}
- 主题字体：标题 [${tFonts.majorEa || ''} / ${tFonts.majorLatin || ''}]，正文 [${tFonts.minorEa || ''} / ${tFonts.minorLatin || ''}]

## 二、逐页精确图层与排版参数
${slidesSection}`;

  const combinedPromptForWeb = `${systemInstruction}\n\n---\n\n${userPrompt}`;

  return {
    systemInstruction,
    userPrompt,
    combinedPromptForWeb,
    imageInfo: { hasValidBitmap: false, mimeType: '', base64Data: '', dataUrl: '' }
  };
}
