/**
 * @file utils/style-filter.js
 * @description 浏览器默认无用 CSS 过滤白名单、简写噪点清洗与跨域样式表 @keyframes 解析工具
 */

/**
 * 核心视觉、布局与动效 CSS 属性白名单
 */
export const CORE_STYLE_WHITELIST = [
  'display',
  'position',
  'width',
  'height',
  'padding',
  'margin',
  'overflow',
  'zIndex',
  'flexDirection',
  'flexWrap',
  'justifyContent',
  'alignItems',
  'gap',
  'gridTemplateColumns',
  'gridTemplateRows',
  'color',
  'background',
  'backgroundColor',
  'backgroundImage',
  'backgroundSize',
  'backgroundClip',
  'webkitBackgroundClip',
  'webkitTextFillColor',
  'border',
  'borderRadius',
  'boxShadow',
  'opacity',
  'mixBlendMode',
  'filter',
  'backdropFilter',
  'webkitBackdropFilter',
  'transform',
  'perspective',
  'transition',
  'animation',
  'animationName',
  'animationDuration',
  'animationTimingFunction',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textShadow'
];

/**
 * 浏览器常见无信息量默认属性值集合
 */
export const IGNORED_DEFAULT_VALUES = new Set([
  '',
  'none',
  'normal',
  'auto',
  '0px',
  '0%',
  '0s',
  'all',
  'all 0s ease 0s',
  'all 0s ease 0s, all 0s ease 0s',
  'none 0s ease 0s 1 normal none running',
  'rgba(0, 0, 0, 0)',
  'transparent',
  'visible',
  'static',
  'start',
  'stretch',
  'row',
  'nowrap',
  'content-box',
  'border-box',
  '1',
  '100%',
  '0px none rgb(0, 0, 0)',
  'matrix(1, 0, 0, 1, 0, 0)'
]);

/**
 * 判断某个 CSS 属性值是否为浏览器的冗余默认简写噪点
 * 例如：
 * - background: "rgba(0, 0, 0, 0) none repeat scroll 0% 0% / auto padding-box border-box"
 * - transition: "all" 或 "all 0s ease 0s"
 * - border: "0px none rgb(248, 249, 252)"
 */
export function isNoisyBrowserDefault(key, valStr) {
  if (!valStr) return true;
  const s = String(valStr).trim();
  if (!s || IGNORED_DEFAULT_VALUES.has(s)) return true;

  if (key === 'background') {
    // 剔除完全透明且无背景图/渐变的浏览器合成 background 简写
    if (
      (s.startsWith('rgba(0, 0, 0, 0) none') || s.startsWith('transparent none')) &&
      !s.includes('gradient') &&
      !s.includes('url(')
    ) {
      return true;
    }
  }

  if (key === 'transition') {
    if (s === 'all' || s === 'none' || /^all\s+0s\b/.test(s)) {
      return true;
    }
  }

  if (key === 'border' || key.startsWith('border')) {
    if (s.startsWith('0px none') || s.startsWith('0px solid')) {
      return true;
    }
  }

  if (key === 'animationTimingFunction' && s === 'ease') {
    return true;
  }

  if (key === 'opacity' && s === '1') return true;
  if (key === 'zIndex' && s === 'auto') return true;
  if (key === 'mixBlendMode' && s === 'normal') return true;

  return false;
}

/**
 * 清洗并过滤 Computed Styles，剔除无意义默认值与合成简写噪点
 * @param {Record<string, string>} rawStyles 原始样式键值对象
 * @returns {Record<string, string>} 过滤后的高价值样式对象
 */
export function filterComputedStyles(rawStyles = {}) {
  const cleaned = {};
  if (!rawStyles || typeof rawStyles !== 'object') return cleaned;

  for (const key of CORE_STYLE_WHITELIST) {
    const val = rawStyles[key];
    if (val === undefined || val === null) continue;
    const trimmed = String(val).trim();
    if (isNoisyBrowserDefault(key, trimmed)) continue;

    // 若 webkitTextFillColor 与 color 完全一致，剔除冗余属性
    if (key === 'webkitTextFillColor' && rawStyles.color && trimmed === String(rawStyles.color).trim()) {
      continue;
    }

    cleaned[key] = trimmed;
  }

  return cleaned;
}

/**
 * 从原始 CSS 样式表文本中提取指定名称（或全部）的 @keyframes 规则块
 */
export function extractKeyframesFromCssText(cssText = '', targetNames = []) {
  const results = [];
  if (!cssText || typeof cssText !== 'string') return results;

  const nameSet = new Set(
    (targetNames || [])
      .map((n) => String(n).trim())
      .filter((n) => n && n !== 'none')
  );

  const regex = /@(?:-\w+-)?keyframes\s+([a-zA-Z0-9_-]+)\s*\{/g;
  let match;

  while ((match = regex.exec(cssText)) !== null) {
    const animName = match[1];
    if (nameSet.size > 0 && !nameSet.has(animName)) {
      continue;
    }

    const startIdx = match.index;
    const braceOpenIdx = regex.lastIndex - 1;
    let depth = 1;
    let i = braceOpenIdx + 1;

    while (i < cssText.length && depth > 0) {
      const ch = cssText[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }

    if (depth === 0) {
      const ruleBlock = cssText.slice(startIdx, i).trim();
      results.push(ruleBlock);
      if (results.length >= 8) break;
    }
  }

  return results;
}

/**
 * 后台并发拉取跨域 CSS 链接并提取关联的 @keyframes
 */
export async function fetchCrossOriginKeyframes(hrefList = [], animationNames = []) {
  if (!Array.isArray(hrefList) || hrefList.length === 0) return '';

  const uniqueHrefs = Array.from(new Set(hrefList)).slice(0, 6);
  const collected = [];

  await Promise.all(
    uniqueHrefs.map(async (url) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) return;
        const cssText = await resp.text();
        const extracted = extractKeyframesFromCssText(cssText, animationNames);
        collected.push(...extracted);
      } catch (_err) {
        // 忽略单个跨域 CSS 拉取失败
      }
    })
  );

  return Array.from(new Set(collected)).join('\n\n');
}
