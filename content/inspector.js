/**
 * @file content/inspector.js
 * @description Shadow DOM 元素拾取器、Web Components (shadowRoot) 深度穿透、复合图层（背景画布+前景UI）联合采集与真实 CSS 提取
 */

(() => {
  window.__WRI_INSPECTOR_LOADED__ = true;

  const STYLE_WHITELIST = [
    'display', 'position', 'top', 'right', 'bottom', 'left',
    'width', 'height', 'minHeight', 'maxWidth',
    'padding', 'margin', 'overflow', 'zIndex',
    'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'gap',
    'gridTemplateColumns', 'gridTemplateRows',
    'color', 'background', 'backgroundColor', 'backgroundImage',
    'backgroundSize', 'backgroundPosition', 'backgroundClip',
    'webkitBackgroundClip', 'webkitTextFillColor',
    'border', 'borderRadius', 'boxShadow', 'opacity', 'mixBlendMode',
    'filter', 'backdropFilter', 'webkitBackdropFilter',
    'transform', 'perspective',
    'transition', 'animation', 'animationName', 'animationDuration',
    'animationTimingFunction',
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
    'textAlign', 'textTransform', 'textShadow', 'objectFit'
  ];

  const DEFAULT_SKIP_VALUES = new Set([
    '', 'none', 'normal', 'auto', '0px', '0%', '0s',
    'all', 'all 0s ease 0s', 'all 0s ease 0s, all 0s ease 0s',
    'none 0s ease 0s 1 normal none running',
    'rgba(0, 0, 0, 0)', 'transparent', 'visible', 'static',
    'start', 'stretch', 'row', 'nowrap', 'content-box', 'border-box',
    '1', '100%', '0px none rgb(0, 0, 0)', 'matrix(1, 0, 0, 1, 0, 0)'
  ]);

  let isInspecting = false;
  let currentMode = 'inspector';
  let hoveredElement = null;
  let rafId = null;
  let shadowHost = null;
  let shadowRoot = null;
  let highlightBox = null;
  let tooltipEl = null;

  /**
   * 过滤浏览器合成的冗余默认简写属性
   */
  function isBrowserDefaultNoise(prop, valStr, cs) {
    if (!valStr) return true;
    const s = String(valStr).trim();
    if (!s || DEFAULT_SKIP_VALUES.has(s)) return true;

    if (prop === 'background') {
      if (
        (s.startsWith('rgba(0, 0, 0, 0) none') || s.startsWith('transparent none')) &&
        !s.includes('gradient') &&
        !s.includes('url(')
      ) {
        return true;
      }
    }
    if (prop === 'transition') {
      if (s === 'all' || s === 'none' || /^all\s+0s\b/.test(s)) {
        return true;
      }
    }
    if (prop === 'border' && (s.startsWith('0px none') || s.startsWith('0px solid'))) {
      return true;
    }
    if (prop === 'animationTimingFunction' && (!cs.animationName || cs.animationName === 'none')) {
      return true;
    }
    if (prop === 'webkitTextFillColor' && cs.color && s === String(cs.color).trim()) {
      return true;
    }
    if (prop === 'backgroundPosition' && s === '0% 0%') return true;
    if (prop === 'opacity' && s === '1') return true;
    if (prop === 'zIndex' && s === 'auto') return true;
    if (prop === 'mixBlendMode' && s === 'normal') return true;
    if (prop === 'objectFit' && s === 'fill') return true;
    if (prop === 'textAlign' && (s === 'start' || s === 'left')) return true;

    return false;
  }

  /**
   * 创建挂载在独立 Shadow DOM 中的高亮吸管 UI
   */
  function ensureShadowUI() {
    if (shadowHost && document.documentElement.contains(shadowHost)) {
      return;
    }

    shadowHost = document.createElement('div');
    shadowHost.id = '__wri-inspector-shadow-host__';
    shadowHost.style.cssText = 'all: initial !important; position: fixed !important; inset: 0 !important; pointer-events: none !important; z-index: 2147483646 !important;';
    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = `
      :host { all: initial; }
      .wri-banner {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(9, 13, 22, 0.92);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(56, 189, 248, 0.55);
        box-shadow: 0 12px 32px rgba(2, 6, 23, 0.65), 0 0 20px rgba(56, 189, 248, 0.25);
        color: #f8fafc;
        padding: 8px 16px;
        border-radius: 999px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 10px;
        pointer-events: none;
        z-index: 2147483647;
      }
      .wri-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #38bdf8;
        box-shadow: 0 0 10px #38bdf8;
        animation: wriPulse 1.2s ease-in-out infinite;
      }
      @keyframes wriPulse {
        0%, 100% { opacity: 0.4; transform: scale(0.9); }
        50% { opacity: 1; transform: scale(1.2); }
      }
      .wri-kbd {
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.22);
        padding: 1px 6px;
        border-radius: 4px;
        font-family: monospace;
        font-size: 11px;
        color: #7dd3fc;
      }
      .wri-highlight {
        position: fixed;
        pointer-events: none;
        border: 2px solid #38bdf8;
        background: rgba(56, 189, 248, 0.10);
        box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.4), inset 0 0 18px rgba(56, 189, 248, 0.18);
        border-radius: 6px;
        transition: all 0.05s cubic-bezier(0.22, 1, 0.36, 1);
        display: none;
      }
      .wri-tooltip {
        position: fixed;
        pointer-events: none;
        background: rgba(9, 13, 22, 0.95);
        border: 1px solid rgba(56, 189, 248, 0.5);
        color: #f8fafc;
        padding: 5px 10px;
        border-radius: 6px;
        font-family: Consolas, Monaco, monospace;
        font-size: 11px;
        line-height: 1.4;
        white-space: nowrap;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
        display: none;
      }
      .wri-tag { color: #38bdf8; font-weight: 700; }
      .wri-dim { color: #94a3b8; margin-left: 6px; }
      .wri-fx { color: #c084fc; margin-left: 6px; font-weight: 600; }
    `;

    const banner = document.createElement('div');
    banner.className = 'wri-banner';
    banner.innerHTML = `
      <span class="wri-dot"></span>
      <span id="wri-banner-text">🎯 吸管拾取已开启：悬停预览目标组件，左键点击抓取</span>
      <span class="wri-kbd">Esc 取消</span>
    `;

    highlightBox = document.createElement('div');
    highlightBox.className = 'wri-highlight';

    tooltipEl = document.createElement('div');
    tooltipEl.className = 'wri-tooltip';

    shadowRoot.appendChild(styleEl);
    shadowRoot.appendChild(banner);
    shadowRoot.appendChild(highlightBox);
    shadowRoot.appendChild(tooltipEl);
    document.documentElement.appendChild(shadowHost);
  }

  function removeShadowUI() {
    if (shadowHost && shadowHost.parentNode) {
      shadowHost.parentNode.removeChild(shadowHost);
    }
    shadowHost = null;
    shadowRoot = null;
    highlightBox = null;
    tooltipEl = null;
  }

  /**
   * 获取元素简洁描述符
   */
  function getElementDescriptor(el) {
    if (!el || !el.tagName) return 'unknown';
    const tag = el.tagName.toLowerCase();
    const idStr = el.id ? `#${el.id.slice(0, 24)}` : '';
    let clsStr = '';
    if (typeof el.className === 'string' && el.className.trim()) {
      const classes = el.className
        .trim()
        .split(/\s+/)
        .filter((c) => !c.startsWith('__wri'))
        .slice(0, 2);
      if (classes.length > 0) {
        clsStr = '.' + classes.join('.');
      }
    }
    return `${tag}${idStr}${clsStr}`;
  }

  /**
   * 判断一个元素是否为纯背景画布或空遮罩（不含前景文本与交互按钮）
   */
  function isBackgroundCanvasOrEmptyLayer(el) {
    if (!el || !el.tagName) return true;
    const tag = el.tagName.toLowerCase();
    if (tag === 'canvas' || tag === 'video' || tag.includes('-canvas')) {
      return true;
    }
    const textLen = (el.innerText || '').trim().length;
    const hasInteractiveChildren =
      el.querySelectorAll('button, a, h1, h2, h3, h4, p, input, [role="button"], [role="tab"]').length > 0;
    return textLen === 0 && !hasInteractiveChildren;
  }

  /**
   * 当用户点中了底层的背景画布（如 <abc-canvas> 或 <div class="stage">）时，
   * 自动向上回溯找到同时包含该背景画布与前景 UI 控件（标题、按钮、切换器、卡片）的完整复合模块容器！
   */
  function resolveCompositeContainer(targetEl) {
    if (!targetEl) return targetEl;
    if (!isBackgroundCanvasOrEmptyLayer(targetEl)) {
      return targetEl;
    }

    const targetRect = targetEl.getBoundingClientRect();
    let curr = targetEl.parentElement;
    let steps = 0;

    while (curr && curr !== document.body && curr !== document.documentElement && steps < 5) {
      const currRect = curr.getBoundingClientRect();
      // 确保父容器不会过大（不超过视口高度的 2.2 倍）
      const isReasonableSize = currRect.height <= Math.max(targetRect.height * 1.6, window.innerHeight * 1.5);
      const hasForegroundContent =
        (curr.innerText || '').trim().length > 0 ||
        curr.querySelectorAll('h1, h2, h3, p, button, a, video, svg').length > 0;

      if (hasForegroundContent && isReasonableSize) {
        return curr;
      }
      curr = curr.parentElement;
      steps++;
    }

    return targetEl.parentElement && targetEl.parentElement !== document.body
      ? targetEl.parentElement
      : targetEl;
  }

  /**
   * 智能穿透空透明遮罩，定位当前鼠标坐标下的最佳组件
   */
  function pickBestElementAtPoint(x, y) {
    const stack = document.elementsFromPoint(x, y);
    if (!stack || stack.length === 0) return null;

    const candidates = stack.filter(
      (el) =>
        el &&
        el !== shadowHost &&
        el !== document.documentElement &&
        el !== document.body &&
        !el.id?.startsWith('__wri-')
    );

    if (candidates.length === 0) return null;

    // 1. 优先在坐标栈中寻找前景交互元素或含文本的卡片/区块
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 16 || rect.height < 16) continue;
      if (!isBackgroundCanvasOrEmptyLayer(el) && rect.height < window.innerHeight * 1.4) {
        return el;
      }
    }

    // 2. 若鼠标点在背景画布区域（如 abc-canvas / div.stage），自动聚合其所在的复合章节容器
    return resolveCompositeContainer(candidates[0]);
  }

  /**
   * 提取单个元素的非默认核心 Computed CSS
   */
  function extractFilteredComputedStyles(el) {
    const cs = window.getComputedStyle(el);
    const result = {};

    for (const prop of STYLE_WHITELIST) {
      const val = cs[prop];
      if (isBrowserDefaultNoise(prop, val, cs)) continue;
      result[prop] = String(val).trim();
    }

    for (const pseudo of ['::before', '::after']) {
      try {
        const pcs = window.getComputedStyle(el, pseudo);
        const content = pcs.getPropertyValue('content');
        if (content && content !== 'none' && content !== 'normal') {
          const pseudoStyles = {};
          for (const p of ['content', 'position', 'width', 'height', 'background', 'backgroundImage', 'borderRadius', 'filter', 'backdropFilter', 'opacity', 'transform', 'boxShadow']) {
            const v = pcs[p];
            if (!isBrowserDefaultNoise(p, v, pcs)) {
              pseudoStyles[p] = String(v).trim();
            }
          }
          if (Object.keys(pseudoStyles).length > 1) {
            result[pseudo] = pseudoStyles;
          }
        }
      } catch (_e) {
        // ignore
      }
    }

    return result;
  }

  /**
   * 判断一个 DOM 节点是否为“纯包裹用途的冗余空容器”
   */
  function isRedundantWrapper(el) {
    if (!el || el.children.length !== 1 || el.shadowRoot) return false;
    const tag = el.tagName.toLowerCase();
    if (!['div', 'span'].includes(tag)) return false;

    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
        return false;
      }
    }

    const cs = window.getComputedStyle(el);
    const hasVisual =
      (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') ||
      (cs.backgroundImage && cs.backgroundImage !== 'none') ||
      (cs.borderTopWidth && cs.borderTopWidth !== '0px') ||
      (cs.boxShadow && cs.boxShadow !== 'none') ||
      (cs.backdropFilter && cs.backdropFilter !== 'none') ||
      (cs.transform && cs.transform !== 'none') ||
      (cs.display === 'flex' || cs.display === 'grid');

    return !hasVisual;
  }

  /**
   * 实施“视觉有效节点折叠 + Web Components shadowRoot 深度穿透”
   * 生成包含前景 UI + 背景画布/视频结构的真实 HTML 骨架（上限 2200 字符）
   */
  function extractFoldedHtml(rootEl, maxChars = 2200) {
    const compositeRoot = resolveCompositeContainer(rootEl);

    function cleanAndFoldNode(origNode, depth = 0) {
      if (depth > 8) return null;

      if (origNode.nodeType === Node.TEXT_NODE) {
        const text = origNode.textContent.replace(/\s+/g, ' ').trim();
        if (!text) return null;
        return document.createTextNode(text.slice(0, 140));
      }

      if (origNode.nodeType !== Node.ELEMENT_NODE) return null;

      const tag = origNode.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'meta', 'link'].includes(tag)) {
        return null;
      }

      try {
        const cs = window.getComputedStyle(origNode);
        if (cs.display === 'none' || cs.visibility === 'hidden') {
          return null;
        }
      } catch (_e) {
        // ignore
      }

      let targetEl = origNode;
      while (depth > 0 && isRedundantWrapper(targetEl)) {
        targetEl = targetEl.children[0];
      }

      const targetTag = targetEl.tagName.toLowerCase();
      const clone = document.createElement(targetTag);

      const keepAttrs = [
        'id', 'class', 'type', 'href', 'src', 'poster', 'alt',
        'role', 'aria-label', 'viewBox', 'width', 'height'
      ];
      for (const attr of keepAttrs) {
        if (targetEl.hasAttribute(attr)) {
          let val = targetEl.getAttribute(attr) || '';
          if ((attr === 'src' || attr === 'poster') && val.startsWith('data:')) {
            val = '[DATA_URI]';
          } else if (val.length > 100) {
            val = val.slice(0, 100) + '...';
          }
          clone.setAttribute(attr, val);
        }
      }

      // 针对 canvas / video 标注实测渲染尺寸与上下文特征
      if (targetTag === 'canvas') {
        const cRect = targetEl.getBoundingClientRect();
        clone.setAttribute('data-rendered-size', `${Math.round(cRect.width)}x${Math.round(cRect.height)}`);
      } else if (targetTag === 'video') {
        const vRect = targetEl.getBoundingClientRect();
        clone.setAttribute('data-rendered-size', `${Math.round(vRect.width)}x${Math.round(vRect.height)}`);
        if (targetEl.currentSrc) {
          clone.setAttribute('data-video-src', targetEl.currentSrc.slice(0, 100));
        }
      }

      if (targetTag === 'path' && targetEl.hasAttribute('d')) {
        const dVal = targetEl.getAttribute('d') || '';
        clone.setAttribute('d', dVal.length > 48 ? dVal.slice(0, 48) + '...' : dVal);
      }

      // 关键突破：若该元素为自定义 Web Component 且拥有 open shadowRoot，自动穿透采集其内部真实 DOM！
      const childSourceNodes = [];
      if (targetEl.shadowRoot && targetEl.shadowRoot.childNodes.length > 0) {
        clone.setAttribute('data-web-component', 'shadow-root-expanded');
        childSourceNodes.push(...Array.from(targetEl.shadowRoot.childNodes));
      }
      childSourceNodes.push(...Array.from(targetEl.childNodes));

      const maxChildren = 14;
      let count = 0;
      for (const child of childSourceNodes) {
        if (count >= maxChildren) break;
        const cleanedChild = cleanAndFoldNode(child, depth + 1);
        if (cleanedChild) {
          clone.appendChild(cleanedChild);
          count++;
        }
      }

      return clone;
    }

    const foldedRoot = cleanAndFoldNode(compositeRoot, 0);
    if (!foldedRoot) return compositeRoot.outerHTML.slice(0, maxChars);

    let htmlStr = foldedRoot.outerHTML;
    if (htmlStr.length > maxChars) {
      htmlStr = htmlStr.slice(0, maxChars - 28) + '\n<!-- [HTML 已按上限截断] -->';
    }
    return htmlStr;
  }

  /**
   * 递归收集包含 ShadowRoot 在内的所有后代元素
   */
  function queryAllElementsDeep(rootEl, maxCount = 45) {
    const collected = [];
    function traverse(node) {
      if (!node || collected.length >= maxCount) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        collected.push(node);
        if (node.shadowRoot) {
          for (const sc of Array.from(node.shadowRoot.children)) {
            traverse(sc);
          }
        }
      }
      if (node.children) {
        for (const ch of Array.from(node.children)) {
          traverse(ch);
        }
      }
    }
    traverse(rootEl);
    return collected;
  }

  /**
   * 遍历同源 styleSheets 与 ShadowRoot 内部 styleSheets 提取关联 @keyframes
   */
  function collectKeyframesAndCorsSheets(rootEl) {
    const animNames = new Set();
    const nodes = queryAllElementsDeep(rootEl, 40);

    for (const node of nodes) {
      try {
        const cs = window.getComputedStyle(node);
        const rawNames = cs.animationName || '';
        rawNames.split(',').forEach((n) => {
          const clean = n.trim();
          if (clean && clean !== 'none') animNames.add(clean);
        });
      } catch (_e) {
        // ignore
      }
    }

    const matchedKeyframes = [];
    const corsStyleHrefs = [];

    const allSheets = [...Array.from(document.styleSheets)];
    for (const node of nodes) {
      if (node.shadowRoot && node.shadowRoot.styleSheets) {
        allSheets.push(...Array.from(node.shadowRoot.styleSheets));
      }
    }

    for (const sheet of allSheets) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
          if (rule.type === CSSRule.KEYFRAMES_RULE || rule.constructor?.name === 'CSSKeyframesRule') {
            if (animNames.size === 0 || animNames.has(rule.name)) {
              matchedKeyframes.push(rule.cssText);
            }
          }
        }
      } catch (_securityErr) {
        if (sheet.href) {
          corsStyleHrefs.push(sheet.href);
        }
      }
    }

    return {
      animationNames: Array.from(animNames),
      keyframesText: matchedKeyframes.slice(0, 6).join('\n\n'),
      corsStyleHrefs: Array.from(new Set(corsStyleHrefs)).slice(0, 6)
    };
  }

  const CONTROL_SELECTOR = 'a, button, [role="button"], [role="tab"], input, select, textarea';
  const SKIP_SCAN_TAGS = new Set([
    'html', 'head', 'script', 'style', 'noscript', 'meta', 'link',
    'template', 'br', 'source', 'track', 'path', 'g', 'defs', 'use'
  ]);

  function isTransparentColor(c) {
    return !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
  }

  function toPct(v) {
    return Math.round(v * 1000) / 10;
  }

  /**
   * 按 DOM 顺序深度遍历全部元素（含 open shadowRoot），跳过扩展自身注入的节点
   */
  function collectDeepElements(maxVisit = 6000) {
    const out = [];
    const stack = [document.documentElement];
    while (stack.length && out.length < maxVisit) {
      const node = stack.pop();
      if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.id && node.id.startsWith('__wri-')) continue;
      out.push(node);
      const kids = [];
      if (node.shadowRoot) kids.push(...node.shadowRoot.children);
      kids.push(...node.children);
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    return out;
  }

  function getDirectText(el) {
    let t = '';
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) t += n.textContent;
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  function hasSurfaceVisual(cs) {
    const hasBorder =
      cs.borderTopWidth !== '0px' &&
      cs.borderTopStyle !== 'none' &&
      !isTransparentColor(cs.borderTopColor);
    return (
      !isTransparentColor(cs.backgroundColor) ||
      (cs.backgroundImage && cs.backgroundImage !== 'none') ||
      hasBorder ||
      (cs.boxShadow && cs.boxShadow !== 'none') ||
      (cs.backdropFilter && cs.backdropFilter !== 'none')
    );
  }

  /**
   * 按钮/链接的可见背景、圆角、边框、内边距与文字颜色常常定义在内部子元素（或 shadowRoot）上，
   * 向下遍历最多 12 个内部节点聚合真实可见的控件样式。
   */
  function collectEffectiveControlStyle(el, rootCs) {
    const base = collectTextStyle(rootCs);
    const queue = [el];
    let visited = 0;

    while (queue.length && visited < 12) {
      const node = queue.shift();
      visited++;
      const cs = node === el ? rootCs : window.getComputedStyle(node);

      if (getDirectText(node)) {
        base.color = cs.color;
        base.fontSize = cs.fontSize;
        base.fontWeight = cs.fontWeight;
      }
      if (!base.background) {
        if (!isTransparentColor(cs.backgroundColor)) {
          base.background = cs.backgroundColor;
        } else if (cs.backgroundImage && cs.backgroundImage !== 'none') {
          base.background = cs.backgroundImage.slice(0, 160);
        }
      }
      if (!base.borderRadius && cs.borderRadius && cs.borderRadius !== '0px') {
        base.borderRadius = cs.borderRadius;
      }
      if (!base.border) {
        const b = collectBorder(cs);
        if (b) base.border = b;
      }
      if (!base.padding && cs.padding && cs.padding !== '0px') {
        base.padding = cs.padding;
      }
      if (!base.boxShadow && cs.boxShadow && cs.boxShadow !== 'none') {
        base.boxShadow = cs.boxShadow;
      }
      if (!base.backdropFilter && cs.backdropFilter && cs.backdropFilter !== 'none') {
        base.backdropFilter = cs.backdropFilter;
      }

      if (node.shadowRoot) {
        queue.push(...node.shadowRoot.children);
      }
      queue.push(...node.children);
    }

    return base;
  }

  function collectTextStyle(cs) {
    const s = {
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontFamily: (cs.fontFamily || '').split(',')[0].trim(),
      color: cs.color,
      lineHeight: cs.lineHeight
    };
    if (cs.letterSpacing && cs.letterSpacing !== 'normal') s.letterSpacing = cs.letterSpacing;
    if (cs.textAlign && !['start', 'left'].includes(cs.textAlign)) s.textAlign = cs.textAlign;
    if (cs.textTransform && cs.textTransform !== 'none') s.textTransform = cs.textTransform;
    if (cs.textShadow && cs.textShadow !== 'none') s.textShadow = cs.textShadow;
    return s;
  }

  function collectBorder(cs) {
    if (cs.borderTopWidth === '0px' || cs.borderTopStyle === 'none' || isTransparentColor(cs.borderTopColor)) {
      return '';
    }
    return `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`;
  }

  function collectMotion(cs) {
    const motion = [];
    if (!isBrowserDefaultNoise('transition', cs.transition, cs)) {
      motion.push(`transition: ${cs.transition}`);
    }
    if (cs.animationName && cs.animationName !== 'none') {
      motion.push(
        `animation: ${cs.animationName} ${cs.animationDuration} ${cs.animationTimingFunction} ${cs.animationIterationCount}`
      );
    }
    if (cs.transform && cs.transform !== 'none') {
      motion.push(`transform: ${cs.transform}`);
    }
    return motion;
  }

  /**
   * 区域布局采集：遍历与选区相交的所有可见元素（不依赖 hit-test，pointer-events:none 的背景视频也能采到），
   * 输出从背景到前景的图层清单：类型、相对选区的位置、尺寸、真实文案与关键样式。
   * @param {{x:number, y:number, width:number, height:number}} region 视口坐标
   */
  function scanRegionLayout(region) {
    const rx = region.x;
    const ry = region.y;
    const rw = Math.max(1, region.width);
    const rh = Math.max(1, region.height);
    const regionArea = rw * rh;
    const regionCenterX = rx + rw / 2;

    const buckets = { media: [], control: [], text: [], surface: [] };

    for (const el of collectDeepElements()) {
      const tag = el.tagName.toLowerCase();
      if (SKIP_SCAN_TAGS.has(tag)) continue;

      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;

      const ix = Math.max(0, Math.min(r.right, rx + rw) - Math.max(r.left, rx));
      const iy = Math.max(0, Math.min(r.bottom, ry + rh) - Math.max(r.top, ry));
      const inter = ix * iy;
      if (inter <= 0 || inter / (r.width * r.height) < 0.3) continue;

      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) continue;

      const insideControl = Boolean(el.parentElement && el.parentElement.closest(CONTROL_SELECTOR));
      let kind = null;
      if (['video', 'img', 'canvas'].includes(tag)) {
        kind = 'media';
      } else if (tag === 'svg') {
        if (!insideControl && !(el.parentElement && el.parentElement.closest('svg'))) kind = 'media';
      } else if (el.matches(CONTROL_SELECTOR)) {
        kind = 'control';
      } else if (!insideControl && getDirectText(el)) {
        kind = 'text';
      } else if (!insideControl && hasSurfaceVisual(cs)) {
        kind = 'surface';
      }
      if (!kind) continue;

      const clipL = Math.max(r.left, rx);
      const clipT = Math.max(r.top, ry);
      const entry = {
        kind,
        tag,
        sel: getElementDescriptor(el),
        box: {
          l: toPct((clipL - rx) / rw),
          t: toPct((clipT - ry) / rh),
          w: toPct(ix / rw),
          h: toPct(iy / rh)
        },
        px: { w: Math.round(r.width), h: Math.round(r.height) },
        coverage: Math.round((inter / regionArea) * 100) / 100,
        top: r.top,
        left: r.left
      };

      const elCenterX = r.left + r.width / 2;
      if (Math.abs(elCenterX - regionCenterX) / rw < 0.03 && r.width < rw * 0.9) {
        entry.align = '水平居中';
      }
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        entry.fixed = cs.position;
      }

      if (kind === 'text') {
        entry.text = getDirectText(el).slice(0, 100);
        entry.style = collectTextStyle(cs);
      } else if (kind === 'control') {
        const label =
          (el.innerText || '').replace(/\s+/g, ' ').trim() ||
          el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          '';
        entry.text = label ? label.slice(0, 60) : '(图标按钮)';
        entry.style = collectEffectiveControlStyle(el, cs);
      } else if (kind === 'surface') {
        entry.style = {};
        if (!isTransparentColor(cs.backgroundColor)) entry.style.backgroundColor = cs.backgroundColor;
        if (cs.backgroundImage !== 'none') entry.style.backgroundImage = cs.backgroundImage.slice(0, 160);
        if (cs.borderRadius !== '0px') entry.style.borderRadius = cs.borderRadius;
        const border = collectBorder(cs);
        if (border) entry.style.border = border;
        if (cs.boxShadow !== 'none') entry.style.boxShadow = cs.boxShadow;
        if (cs.backdropFilter && cs.backdropFilter !== 'none') entry.style.backdropFilter = cs.backdropFilter;
      } else if (kind === 'media') {
        entry.style = {};
        if (cs.objectFit && cs.objectFit !== 'fill') entry.style.objectFit = cs.objectFit;
        if (cs.borderRadius !== '0px') entry.style.borderRadius = cs.borderRadius;
        if (cs.filter && cs.filter !== 'none') entry.style.filter = cs.filter;
        entry.media = {};
        if (tag === 'video' || tag === 'img') {
          const sourceChild = tag === 'video' ? el.querySelector('source') : null;
          let src =
            el.currentSrc ||
            el.getAttribute('src') ||
            sourceChild?.src ||
            sourceChild?.getAttribute('src') ||
            '';
          if (src.startsWith('data:')) src = '[data-uri]';
          if (src.startsWith('blob:')) src = '[blob 流媒体，无法直接引用]';
          entry.media.src = src.slice(0, 220);
        }
        if (tag === 'video') {
          entry.media.poster = (el.getAttribute('poster') || '').slice(0, 220);
          entry.media.autoplay = el.autoplay || !el.paused;
          entry.media.loop = el.loop;
          entry.media.muted = el.muted;
        }
        if (tag === 'img' && el.alt) entry.media.alt = el.alt.slice(0, 80);
      }

      if (parseFloat(cs.opacity) < 1) entry.style.opacity = cs.opacity;
      const motion = collectMotion(cs);
      if (motion.length) entry.motion = motion;

      buckets[kind].push(entry);
    }

    const byCoverage = (a, b) => b.coverage - a.coverage;
    const byReading = (a, b) => (Math.abs(a.top - b.top) > 8 ? a.top - b.top : a.left - b.left);

    const media = buckets.media.sort(byCoverage).slice(0, 8);
    const surfaces = buckets.surface.sort(byCoverage).slice(0, 10);
    const texts = buckets.text
      .sort((a, b) => parseFloat(b.style.fontSize) - parseFloat(a.style.fontSize))
      .slice(0, 22);
    const controls = buckets.control.sort(byReading).slice(0, 16);
    const foreground = [...texts, ...controls].sort(byReading);

    const elements = [...media, ...surfaces, ...foreground].map((e) => {
      const { top, left, ...rest } = e;
      return rest;
    });

    const totalFound =
      buckets.media.length + buckets.surface.length + buckets.text.length + buckets.control.length;

    return {
      region: {
        width: Math.round(rw),
        height: Math.round(rh),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        scrollY: Math.round(window.scrollY)
      },
      backgroundMedia: elements.filter((e) => e.kind === 'media' && e.coverage >= 0.8),
      elements,
      truncated: totalFound > elements.length
    };
  }

  /**
   * 计算元素在当前视口内的可见部分
   */
  function getVisibleRect(el) {
    const r = el.getBoundingClientRect();
    const left = Math.max(0, r.left);
    const top = Math.max(0, r.top);
    const right = Math.min(window.innerWidth, r.right);
    const bottom = Math.min(window.innerHeight, r.bottom);
    return {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.max(1, Math.round(right - left)),
      height: Math.max(1, Math.round(bottom - top))
    };
  }

  /**
   * 完整打包目标元素（及其复合容器）的 DOM + Computed CSS + 子元素关键样式 + 图层清单 + Keyframes
   */
  function buildElementCaptureData(rawTargetEl, mode) {
    const compositeRoot = resolveCompositeContainer(rawTargetEl);
    const visibleRect = getVisibleRect(compositeRoot);
    const rootStyles = extractFilteredComputedStyles(compositeRoot);

    const deepNodes = queryAllElementsDeep(compositeRoot, 40);
    const childrenStyles = {};
    let pickedCount = 0;

    for (const child of deepNodes) {
      if (child === compositeRoot) continue;
      if (pickedCount >= 10) break;
      const childStyle = extractFilteredComputedStyles(child);
      if (Object.keys(childStyle).length >= 3) {
        const desc = getElementDescriptor(child);
        if (!childrenStyles[desc]) {
          childrenStyles[desc] = childStyle;
          pickedCount++;
        }
      }
    }

    const { animationNames, keyframesText, corsStyleHrefs } = collectKeyframesAndCorsSheets(compositeRoot);
    const layout = scanRegionLayout(visibleRect);

    return {
      captureMode: mode,
      timestamp: new Date().toISOString(),
      pageUrl: window.location.href,
      pageTitle: document.title,
      clickedTagName: getElementDescriptor(rawTargetEl),
      tagName: getElementDescriptor(compositeRoot),
      boundingBox: {
        ...visibleRect,
        dpr: window.devicePixelRatio || 1
      },
      layout,
      html: extractFoldedHtml(compositeRoot, 2200),
      computedStyles: {
        root: rootStyles,
        ...(Object.keys(childrenStyles).length > 0 ? { keyChildren: childrenStyles } : {})
      },
      animationNames,
      keyframes: keyframesText,
      corsStyleHrefs
    };
  }

  /**
   * 更新高亮吸管框坐标与提示信息
   */
  function updateHighlightPosition(targetEl) {
    if (!highlightBox || !tooltipEl || !targetEl) return;
    const rect = targetEl.getBoundingClientRect();

    highlightBox.style.display = 'block';
    highlightBox.style.left = `${rect.left}px`;
    highlightBox.style.top = `${rect.top}px`;
    highlightBox.style.width = `${rect.width}px`;
    highlightBox.style.height = `${rect.height}px`;

    const cs = window.getComputedStyle(targetEl);
    const fxFlags = [];
    if (!isBrowserDefaultNoise('transition', cs.transition, cs)) fxFlags.push('Transition');
    if (cs.animationName && cs.animationName !== 'none') fxFlags.push(`Anim:${cs.animationName}`);
    if ((cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none')) {
      fxFlags.push('Glass');
    }
    if (cs.transform && cs.transform !== 'none') fxFlags.push('3D/Transform');
    if (targetEl.shadowRoot) fxFlags.push('ShadowDOM');
    if (targetEl.tagName.toLowerCase() === 'canvas' || targetEl.querySelector('canvas, video')) {
      fxFlags.push('Canvas/Media');
    }

    const desc = getElementDescriptor(targetEl);
    const dim = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
    const fxHtml = fxFlags.length > 0 ? `<span class="wri-fx">⚡ ${fxFlags.join(' · ')}</span>` : '';

    tooltipEl.innerHTML = `<span class="wri-tag">${desc}</span><span class="wri-dim">${dim}</span>${fxHtml}`;
    tooltipEl.style.display = 'block';

    const tooltipTop = rect.top > 34 ? rect.top - 30 : Math.min(window.innerHeight - 30, rect.bottom + 6);
    const tooltipLeft = Math.max(8, Math.min(window.innerWidth - 260, rect.left));
    tooltipEl.style.top = `${tooltipTop}px`;
    tooltipEl.style.left = `${tooltipLeft}px`;
  }

  function onMouseMove(e) {
    if (!isInspecting) return;
    const x = e.clientX;
    const y = e.clientY;

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const bestEl = pickBestElementAtPoint(x, y);
      if (!bestEl) return;
      hoveredElement = bestEl;
      updateHighlightPosition(bestEl);
    });
  }

  function onClick(e) {
    if (!isInspecting) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const target = hoveredElement || pickBestElementAtPoint(e.clientX, e.clientY) || e.target;
    const modeAtClick = currentMode;
    stopInspector();

    if (!target) return;

    const compositeTarget = resolveCompositeContainer(target);
    const baseData = buildElementCaptureData(compositeTarget, modeAtClick);

    if (modeAtClick === 'recorder' && typeof window.__WRI_START_RECORDER__ === 'function') {
      window.__WRI_START_RECORDER__(compositeTarget, baseData);
      return;
    }

    setTimeout(() => {
      try {
        chrome.runtime.sendMessage({
          type: 'CONTENT_CAPTURE_COMPLETE',
          payload: baseData
        });
      } catch (err) {
        console.warn('[WRI Inspector] 发送采集结果失败:', err);
      }
    }, 60);
  }

  function onKeyDown(e) {
    if (!isInspecting) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      stopInspector();
      try {
        chrome.runtime.sendMessage({ type: 'CONTENT_CAPTURE_CANCELLED' });
      } catch (_err) {
        // ignore
      }
    }
  }

  function startInspector(mode = 'inspector') {
    stopInspector();
    isInspecting = true;
    currentMode = mode;
    ensureShadowUI();

    const bannerTextEl = shadowRoot?.getElementById('wri-banner-text');
    if (bannerTextEl) {
      if (mode === 'recorder') {
        bannerTextEl.textContent = '🎬 第一步：请点击要录制 2 秒动态交互（Hover/Scroll）的目标区域';
      } else if (mode === 'hybrid') {
        bannerTextEl.textContent = '🔗 混合全量模式：请点击目标组件（自动提取复合图层 DOM + CSS + 局部截图）';
      } else {
        bannerTextEl.textContent = '🎯 吸管拾取已开启：悬停预览目标组件，左键点击抓取';
      }
    }

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKeyDown, true);
  }

  function stopInspector() {
    isInspecting = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKeyDown, true);
    removeShadowUI();
  }

  window.__WRI_START_INSPECTOR__ = startInspector;
  window.__WRI_STOP_INSPECTOR__ = stopInspector;
  window.__WRI_SCAN_REGION_LAYOUT__ = scanRegionLayout;
  window.__WRI_EXTRACT_FOLDED_HTML__ = extractFoldedHtml;

  if (!window.__WRI_INSPECTOR_LISTENER_BOUND__) {
    window.__WRI_INSPECTOR_LISTENER_BOUND__ = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      try {
        if (message?.type === 'ACTIVATE_INSPECTOR') {
          window.__WRI_START_INSPECTOR__(message.mode || 'inspector');
          sendResponse({ ok: true });
          return true;
        }
        if (message?.type === 'DEACTIVATE_ALL') {
          window.__WRI_STOP_INSPECTOR__();
          sendResponse({ ok: true });
          return true;
        }
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
      return false;
    });
  }
})();
