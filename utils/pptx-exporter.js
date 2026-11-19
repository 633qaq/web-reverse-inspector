/**
 * @file utils/pptx-exporter.js
 * @description 零依赖、严格遵循 ECMA-376 OOXML Schema 规范的纯前端 .pptx 生成引擎
 * 将高保真 SlidesExportModel（可由 Sandbox DOM 排版测量探针或 pptx-parser 产出）无损序列化为
 * 可在 Microsoft PowerPoint / WPS Office / Apple Keynote 零报错直接打开与二次编辑的 .pptx 文件。
 */

import { buildZipArchive, computeCrc32 } from './zip-lite.js';

const EMU_PER_PX = 9525; // 914400 EMU/inch ÷ 96 px/inch
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

const REL_OFFICE_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const REL_CORE_PROPS = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
const REL_EXT_PROPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties';
const REL_SLIDE_MASTER = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster';
const REL_SLIDE_LAYOUT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout';
const REL_SLIDE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
const REL_THEME = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme';
const REL_PRES_PROPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps';
const REL_VIEW_PROPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps';
const REL_TABLE_STYLES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles';
const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const REL_NOTES_SLIDE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';
const REL_NOTES_MASTER = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster';

// ---------------- 工具函数 ----------------

function escXml(str = '') {
  return String(str)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function pxToEmu(px) {
  return Math.round((Number(px) || 0) * EMU_PER_PX);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function clampByte(n) {
  return clamp(Math.round(Number(n) || 0), 0, 255);
}

function byteToHex(n) {
  return clampByte(n).toString(16).padStart(2, '0').toUpperCase();
}

/**
 * 解析任意 CSS 颜色为 { hex: 'RRGGBB', alpha: 0..1 }
 */
export function parseCssColor(raw, extraAlpha = 1) {
  const mulAlpha = clamp(Number.isFinite(extraAlpha) ? extraAlpha : 1, 0, 1);
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s || s === 'transparent' || s === 'none') return null;

  // #rgb / #rgba / #rrggbb / #rrggbbaa
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (h.length === 3 || h.length === 4) {
      const r = h[0] + h[0];
      const g = h[1] + h[1];
      const b = h[2] + h[2];
      const a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
      return { hex: (r + g + b).toUpperCase(), alpha: clamp(a * mulAlpha, 0, 1) };
    }
    if (h.length === 6 || h.length === 8) {
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return { hex: h.slice(0, 6).toUpperCase(), alpha: clamp(a * mulAlpha, 0, 1) };
    }
  }

  // rgb(...) / rgba(...)
  const rgbMatch = s.match(/^rgba?\(\s*([0-9.]+)\s*[,\s]\s*([0-9.]+)\s*[,\s]\s*([0-9.]+)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/);
  if (rgbMatch) {
    const hex = byteToHex(rgbMatch[1]) + byteToHex(rgbMatch[2]) + byteToHex(rgbMatch[3]);
    let a = 1;
    if (rgbMatch[4] !== undefined) {
      a = rgbMatch[4].endsWith('%') ? parseFloat(rgbMatch[4]) / 100 : parseFloat(rgbMatch[4]);
    }
    const finalAlpha = clamp((Number.isFinite(a) ? a : 1) * mulAlpha, 0, 1);
    if (finalAlpha <= 0.001) return null;
    return { hex, alpha: finalAlpha };
  }

  return null;
}

function buildSrgbClrXml(colorStr, extraAlpha = 1) {
  const parsed = parseCssColor(colorStr, extraAlpha);
  if (!parsed) return '';
  if (parsed.alpha < 0.995) {
    const alphaVal = clamp(Math.round(parsed.alpha * 100000), 1, 100000);
    return `<a:srgbClr val="${parsed.hex}"><a:alpha val="${alphaVal}"/></a:srgbClr>`;
  }
  return `<a:srgbClr val="${parsed.hex}"/>`;
}

/**
 * 将 CSS linear-gradient 角度转为 OOXML <a:lin ang="..."> 角度单位（60000/度）
 * 严格与 pptx-parser.js 的 cssAngle = (ang / 60000 + 90) % 360 互逆
 */
export function cssAngleToOoxmlAng(cssDeg = 180) {
  const norm = ((Number(cssDeg) - 90) % 360 + 360) % 360;
  return Math.round(norm * 60000) % 21600000;
}

/**
 * 将 Base64 DataURL 解码为原始字节与扩展名
 */
function decodeDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return null;

  const mime = m[1].toLowerCase().trim();
  let ext = 'png';
  if (mime === 'image/jpeg' || mime === 'image/jpg') ext = 'jpeg';
  else if (mime === 'image/gif') ext = 'gif';
  else if (mime === 'image/bmp') ext = 'bmp';
  else if (mime === 'image/png') ext = 'png';
  else return null; // 非 Office 原生支持的媒体格式跳过

  const b64 = m[2].replace(/\s+/g, '');
  let binary = '';
  try {
    binary = atob(b64);
  } catch (_err) {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { ext, mime, bytes };
}

/**
 * 构建填充 XML（支持 solid / gradient / none）
 */
function buildFillXml(fill, extraOpacity = 1) {
  if (!fill || fill.kind === 'none') return '<a:noFill/>';

  if (fill.kind === 'solid') {
    const clr = buildSrgbClrXml(fill.color, (fill.alpha ?? 1) * extraOpacity);
    return clr ? `<a:solidFill>${clr}</a:solidFill>` : '<a:noFill/>';
  }

  if (fill.kind === 'gradient' && Array.isArray(fill.stops) && fill.stops.length >= 2) {
    const sorted = [...fill.stops]
      .map((s) => ({
        pos: clamp(Math.round((Number(s.pos) || 0) * 1000), 0, 100000),
        clr: buildSrgbClrXml(s.color, (s.alpha ?? 1) * extraOpacity)
      }))
      .filter((s) => Boolean(s.clr))
      .sort((a, b) => a.pos - b.pos);

    if (sorted.length < 2) {
      return sorted.length === 1 ? `<a:solidFill>${sorted[0].clr}</a:solidFill>` : '<a:noFill/>';
    }

    const gsXml = sorted.map((s) => `<a:gs pos="${s.pos}">${s.clr}</a:gs>`).join('');
    if (fill.gradientType === 'radial') {
      return `<a:gradFill rotWithShape="1"><a:gsLst>${gsXml}</a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>`;
    }
    const ang = cssAngleToOoxmlAng(fill.angle ?? 180);
    return `<a:gradFill rotWithShape="1"><a:gsLst>${gsXml}</a:gsLst><a:lin ang="${ang}" scaled="1"/></a:gradFill>`;
  }

  return '<a:noFill/>';
}

/**
 * 构建边框线 XML（<a:ln>）
 */
function buildLineXml(stroke, extraOpacity = 1) {
  if (!stroke || !stroke.widthPx || stroke.widthPx <= 0.1) {
    return '<a:ln><a:noFill/></a:ln>';
  }
  const clr = buildSrgbClrXml(stroke.color, (stroke.alpha ?? 1) * extraOpacity);
  if (!clr) return '<a:ln><a:noFill/></a:ln>';

  const wEmu = Math.max(6350, pxToEmu(stroke.widthPx)); // 最小 0.5pt
  const dashMap = {
    dashed: 'dash',
    dotted: 'sysDot',
    solid: 'solid'
  };
  const prstDash = dashMap[stroke.dash] || 'solid';
  return `<a:ln w="${wEmu}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill>${clr}</a:solidFill><a:prstDash val="${prstDash}"/></a:ln>`;
}

/**
 * 构建外阴影 XML（<a:effectLst>）
 */
function buildEffectLstXml(shadow, extraOpacity = 1) {
  if (!shadow || !shadow.color) return '';
  const clr = buildSrgbClrXml(shadow.color, (shadow.alpha ?? 0.3) * extraOpacity);
  if (!clr) return '';

  const dx = Number(shadow.xPx) || 0;
  const dy = Number(shadow.yPx) || 0;
  const blurRad = Math.max(0, pxToEmu(shadow.blurPx || 0));
  const dist = Math.max(0, pxToEmu(Math.hypot(dx, dy)));
  const dirDeg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  const dir = Math.round(dirDeg * 60000) % 21600000;

  return `<a:effectLst><a:outerShdw blurRad="${blurRad}" dist="${dist}" dir="${dir}" algn="ctr" rotWithShape="0">${clr}</a:outerShdw></a:effectLst>`;
}

/**
 * 清理字体名称（取首位有效字体，过滤 CSS 泛型关键字）
 */
function resolveTypeface(fontFamily = '') {
  const generic = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', '-apple-system', 'blinkmacsystemfont', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'inherit', 'initial', 'unset']);
  const parts = String(fontFamily)
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

  for (const name of parts) {
    if (!generic.has(name.toLowerCase())) {
      return name;
    }
  }
  return 'Microsoft YaHei';
}

/**
 * 构建文本体 XML（支持 <p:txBody> 与表格单元格 <a:txBody>）
 */
function buildTextBodyXml(textObj, { tagName = 'p:txBody', padding = null, extraOpacity = 1, defaultFontSizePx = 16 } = {}) {
  const anchorMap = {
    top: 't',
    middle: 'ctr',
    center: 'ctr',
    bottom: 'b'
  };
  const anchor = anchorMap[textObj?.vAlign] || 't';

  const lIns = Math.max(0, pxToEmu(padding?.leftPx ?? 0));
  const tIns = Math.max(0, pxToEmu(padding?.topPx ?? 0));
  const rIns = Math.max(0, pxToEmu(padding?.rightPx ?? 0));
  const bIns = Math.max(0, pxToEmu(padding?.bottomPx ?? 0));

  const bodyPr = `<a:bodyPr wrap="square" rtlCol="0" lIns="${lIns}" tIns="${tIns}" rIns="${rIns}" bIns="${bIns}" anchor="${anchor}" anchorCtr="0"><a:noAutofit/></a:bodyPr>`;

  const alignMap = {
    left: 'l',
    start: 'l',
    center: 'ctr',
    right: 'r',
    end: 'r',
    justify: 'just'
  };

  const paragraphs = Array.isArray(textObj?.paragraphs) && textObj.paragraphs.length > 0 ? textObj.paragraphs : [];

  if (paragraphs.length === 0) {
    const emptySz = clamp(Math.round(defaultFontSizePx * 75), 600, 40000);
    return `<${tagName}>${bodyPr}<a:lstStyle/><a:p><a:endParaRPr lang="zh-CN" sz="${emptySz}"/></a:p></${tagName}>`;
  }

  const pXmlList = paragraphs.map((p) => {
    const algn = alignMap[p.align] || 'l';
    const pPrChildren = [];

    if (Number.isFinite(p.lineHeightRatio) && p.lineHeightRatio >= 0.8 && p.lineHeightRatio <= 4) {
      const pct = Math.round(p.lineHeightRatio * 100000);
      pPrChildren.push(`<a:lnSpc><a:spcPct val="${pct}"/></a:lnSpc>`);
    }
    if (Number.isFinite(p.spaceBeforePt) && p.spaceBeforePt > 0.2) {
      pPrChildren.push(`<a:spcBef><a:spcPts val="${Math.round(p.spaceBeforePt * 100)}"/></a:spcBef>`);
    }
    if (Number.isFinite(p.spaceAfterPt) && p.spaceAfterPt > 0.2) {
      pPrChildren.push(`<a:spcAft><a:spcPts val="${Math.round(p.spaceAfterPt * 100)}"/></a:spcAft>`);
    }
    pPrChildren.push('<a:buNone/>');

    const pPr = `<a:pPr algn="${algn}">${pPrChildren.join('')}</a:pPr>`;
    const runs = Array.isArray(p.runs) ? p.runs : [];
    let lastSz = clamp(Math.round(defaultFontSizePx * 75), 600, 40000);

    const runXmls = [];
    for (const run of runs) {
      const rawText = String(run?.text ?? '');
      if (!rawText) continue;

      const sz = clamp(Math.round((Number(run.fontSizePx) || defaultFontSizePx) * 75), 600, 40000);
      lastSz = sz;
      const bAttr = run.bold ? ' b="1"' : ' b="0"';
      const iAttr = run.italic ? ' i="1"' : ' i="0"';
      const uAttr = run.underline ? ' u="sng"' : '';
      const strikeAttr = run.strike ? ' strike="sngStrike"' : '';
      const spcVal = Number.isFinite(run.letterSpacingPx) && Math.abs(run.letterSpacingPx) > 0.1
        ? ` spc="${clamp(Math.round(run.letterSpacingPx * 75), -2000, 10000)}"`
        : '';

      const clrXml = buildSrgbClrXml(run.color || '#000000', (run.alpha ?? 1) * extraOpacity);
      const fillXml = clrXml ? `<a:solidFill>${clrXml}</a:solidFill>` : '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>';
      const typeface = escXml(resolveTypeface(run.fontFamily));
      const rPr = `<a:rPr lang="zh-CN" altLang="en-US" sz="${sz}"${bAttr}${iAttr}${uAttr}${strikeAttr}${spcVal} dirty="0">${fillXml}<a:latin typeface="${typeface}"/><a:ea typeface="${typeface}"/><a:cs typeface="${typeface}"/></a:rPr>`;

      // 若 run 内部含换行符，拆为 <a:r> + <a:br/>
      const lines = rawText.split(/\r?\n/);
      lines.forEach((lineSeg, lineIdx) => {
        if (lineIdx > 0) {
          runXmls.push(`<a:br>${rPr}</a:br>`);
        }
        if (lineSeg.length > 0) {
          runXmls.push(`<a:r>${rPr}<a:t>${escXml(lineSeg)}</a:t></a:r>`);
        }
      });
    }

    if (runXmls.length === 0) {
      return `<a:p>${pPr}<a:endParaRPr lang="zh-CN" altLang="en-US" sz="${lastSz}" dirty="0"/></a:p>`;
    }
    return `<a:p>${pPr}${runXmls.join('')}<a:endParaRPr lang="zh-CN" altLang="en-US" sz="${lastSz}" dirty="0"/></a:p>`;
  });

  return `<${tagName}>${bodyPr}<a:lstStyle/>${pXmlList.join('')}</${tagName}>`;
}

/**
 * 构建 <a:xfrm> 或 <p:xfrm>
 */
function buildXfrmXml(box, tagName = 'a:xfrm') {
  const x = pxToEmu(box?.xPx || 0);
  const y = pxToEmu(box?.yPx || 0);
  const cx = Math.max(9525, pxToEmu(box?.wPx || 1)); // 至少 1px
  const cy = Math.max(9525, pxToEmu(box?.hPx || 1));

  const attrs = [];
  if (Number.isFinite(box?.rotDeg) && Math.abs(box.rotDeg) > 0.05) {
    const rot = Math.round(((box.rotDeg % 360) + 360) % 360 * 60000) % 21600000;
    if (rot > 0) attrs.push(`rot="${rot}"`);
  }
  if (box?.flipH) attrs.push('flipH="1"');
  if (box?.flipV) attrs.push('flipV="1"');

  const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
  return `<${tagName}${attrStr}><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></${tagName}>`;
}

/**
 * 构建形状几何 <a:prstGeom>
 */
function buildGeometryXml(geometry, box) {
  const preset = geometry?.preset || 'rect';
  const minSide = Math.max(1, Math.min(Number(box?.wPx) || 1, Number(box?.hPx) || 1));
  const r = Number(geometry?.radiusPx) || 0;

  if (preset === 'ellipse') {
    return '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>';
  }
  if (preset === 'roundRect' || r > 0.5) {
    const adj = clamp(Math.round((r / minSide) * 100000), 0, 50000);
    return `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`;
  }
  return '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
}

/**
 * 构建形状 / 文本框节点 <p:sp>
 */
function buildShapeXml(el, id) {
  const opacity = clamp(Number.isFinite(el.opacity) ? el.opacity : 1, 0, 1);
  const hasVisibleFill = el.fill && el.fill.kind !== 'none';
  const hasVisibleStroke = el.stroke && el.stroke.widthPx > 0.1 && parseCssColor(el.stroke.color);
  const isPureTextBox = Boolean(el.text) && !hasVisibleFill && !hasVisibleStroke;

  // 对单行纯文本无框元素轻微扩宽 4px，避免 DirectWrite/Chrome 字宽微差引起意外折行
  const box = { ...(el.box || {}) };
  if (isPureTextBox && el.text?.paragraphs?.length === 1 && !el.isMultiLine) {
    const padPx = 4;
    const align = el.text.paragraphs[0]?.align || 'left';
    box.wPx = (Number(box.wPx) || 0) + padPx;
    if (align === 'center') box.xPx = (Number(box.xPx) || 0) - padPx / 2;
    else if (align === 'right' || align === 'end') box.xPx = (Number(box.xPx) || 0) - padPx;
  }

  const txBoxAttr = isPureTextBox ? ' txBox="1"' : '';
  const nvSpPr = `<p:nvSpPr><p:cNvPr id="${id}" name="${escXml(el.name || `Shape ${id}`)}"/><p:cNvSpPr${txBoxAttr}/><p:nvPr/></p:nvSpPr>`;

  // 严格按 ECMA-376 <p:spPr> 顺序：xfrm -> prstGeom -> fill -> ln -> effectLst
  const spPrParts = [
    buildXfrmXml(box, 'a:xfrm'),
    buildGeometryXml(el.geometry, box),
    buildFillXml(el.fill, opacity),
    buildLineXml(el.stroke, opacity),
    buildEffectLstXml(el.shadow, opacity)
  ].filter(Boolean);
  const spPr = `<p:spPr>${spPrParts.join('')}</p:spPr>`;

  const txBody = el.text
    ? buildTextBodyXml(el.text, { tagName: 'p:txBody', padding: el.padding, extraOpacity: opacity })
    : '';

  return `<p:sp>${nvSpPr}${spPr}${txBody}</p:sp>`;
}

/**
 * 构建图片节点 <p:pic>
 */
function buildPictureXml(el, id, relId) {
  const opacity = clamp(Number.isFinite(el.opacity) ? el.opacity : 1, 0, 1);
  const nvPicPr = `<p:nvPicPr><p:cNvPr id="${id}" name="${escXml(el.name || `Picture ${id}`)}"/><p:cNvPicPr><a:picLocks noChangeAspect="0"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`;

  const alphaTag = opacity < 0.995
    ? `<a:alphaModFix amt="${clamp(Math.round(opacity * 100000), 1, 100000)}"/>`
    : '';
  const blip = alphaTag
    ? `<a:blip r:embed="${relId}">${alphaTag}</a:blip>`
    : `<a:blip r:embed="${relId}"/>`;

  let srcRect = '';
  if (el.crop && (el.crop.l || el.crop.t || el.crop.r || el.crop.b)) {
    const l = Math.round((Number(el.crop.l) || 0) * 1000);
    const t = Math.round((Number(el.crop.t) || 0) * 1000);
    const r = Math.round((Number(el.crop.r) || 0) * 1000);
    const b = Math.round((Number(el.crop.b) || 0) * 1000);
    srcRect = `<a:srcRect l="${l}" t="${t}" r="${r}" b="${b}"/>`;
  }

  const blipFill = `<p:blipFill>${blip}${srcRect}<a:stretch><a:fillRect/></a:stretch></p:blipFill>`;
  const geom = buildGeometryXml(
    el.radiusPx > 0.5 ? { preset: el.isEllipse ? 'ellipse' : 'roundRect', radiusPx: el.radiusPx } : { preset: 'rect' },
    el.box
  );

  const spPrParts = [
    buildXfrmXml(el.box, 'a:xfrm'),
    geom,
    buildLineXml(el.stroke, opacity),
    buildEffectLstXml(el.shadow, opacity)
  ].filter(Boolean);
  const spPr = `<p:spPr>${spPrParts.join('')}</p:spPr>`;

  return `<p:pic>${nvPicPr}${blipFill}${spPr}</p:pic>`;
}

/**
 * 构建单元格边框（lnL / lnR / lnT / lnB）
 */
function buildCellBorderXml(tagName, border) {
  if (!border || !border.widthPx || border.widthPx <= 0.1) {
    return `<a:${tagName} w="0"><a:noFill/></a:${tagName}>`;
  }
  const clr = buildSrgbClrXml(border.color, border.alpha ?? 1);
  if (!clr) return `<a:${tagName} w="0"><a:noFill/></a:${tagName}>`;
  const wEmu = Math.max(6350, pxToEmu(border.widthPx));
  return `<a:${tagName} w="${wEmu}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill>${clr}</a:solidFill><a:prstDash val="solid"/></a:${tagName}>`;
}

/**
 * 构建原生表格 <p:graphicFrame><a:tbl>
 */
function buildTableXml(el, id) {
  const colWidths = Array.isArray(el.colWidthsPx) && el.colWidthsPx.length > 0
    ? el.colWidthsPx
    : [Math.max(40, el.box?.wPx || 200)];
  const colCount = colWidths.length;

  const gridColsXml = colWidths
    .map((w) => `<a:gridCol w="${Math.max(9525, pxToEmu(w))}"/>`)
    .join('');

  const rowsXml = (el.rows || [])
    .map((row) => {
      const hEmu = Math.max(9525, pxToEmu(row.heightPx || 32));
      const cells = Array.isArray(row.cells) ? row.cells : [];

      const cellsXml = [];
      for (let c = 0; c < colCount; c++) {
        const cell = cells[c] || { hMerge: false, vMerge: false, text: null };
        const attrs = [];
        if (cell.gridSpan && cell.gridSpan > 1) attrs.push(`gridSpan="${cell.gridSpan}"`);
        if (cell.rowSpan && cell.rowSpan > 1) attrs.push(`rowSpan="${cell.rowSpan}"`);
        if (cell.hMerge) attrs.push('hMerge="1"');
        if (cell.vMerge) attrs.push('vMerge="1"');
        const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';

        const txBody = buildTextBodyXml(cell.hMerge || cell.vMerge ? null : cell.text, {
          tagName: 'a:txBody',
          padding: cell.padding || { topPx: 4, rightPx: 6, bottomPx: 4, leftPx: 6 },
          defaultFontSizePx: 14
        });

        const vAlignMap = { top: 't', middle: 'ctr', center: 'ctr', bottom: 'b' };
        const anchor = vAlignMap[cell.text?.vAlign] || 'ctr';
        const b = cell.borders || {};
        // 严格顺序：lnL -> lnR -> lnT -> lnB -> fill
        const tcPrInner = [
          buildCellBorderXml('lnL', b.left),
          buildCellBorderXml('lnR', b.right),
          buildCellBorderXml('lnT', b.top),
          buildCellBorderXml('lnB', b.bottom),
          buildFillXml(cell.fill, 1)
        ].join('');

        const marL = Math.max(0, pxToEmu(cell.padding?.leftPx ?? 6));
        const marR = Math.max(0, pxToEmu(cell.padding?.rightPx ?? 6));
        const marT = Math.max(0, pxToEmu(cell.padding?.topPx ?? 4));
        const marB = Math.max(0, pxToEmu(cell.padding?.bottomPx ?? 4));

        cellsXml.push(
          `<a:tc${attrStr}>${txBody}<a:tcPr marL="${marL}" marR="${marR}" marT="${marT}" marB="${marB}" anchor="${anchor}">${tcPrInner}</a:tcPr></a:tc>`
        );
      }

      return `<a:tr h="${hEmu}">${cellsXml.join('')}</a:tr>`;
    })
    .join('');

  const nvGraphicFramePr = `<p:nvGraphicFramePr><p:cNvPr id="${id}" name="${escXml(el.name || `Table ${id}`)}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>`;
  const xfrm = buildXfrmXml(el.box, 'p:xfrm');

  return `<p:graphicFrame>${nvGraphicFramePr}${xfrm}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="0" bandRow="0"/><a:tblGrid>${gridColsXml}</a:tblGrid>${rowsXml}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

/**
 * 构建幻灯片背景 <p:bg>
 */
function buildSlideBgXml(bg, bgImageRelId = '') {
  if (!bg || bg.kind === 'none') {
    return '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
  }
  if (bg.kind === 'image' && bgImageRelId) {
    return `<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${bgImageRelId}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`;
  }
  const fillXml = buildFillXml(bg, 1);
  if (fillXml === '<a:noFill/>') {
    return '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
  }
  return `<p:bg><p:bgPr>${fillXml}<a:effectLst/></p:bgPr></p:bg>`;
}

// ---------------- 标准 OOXML 固定框架文档 ----------------

function buildRelsXml(rels) {
  const items = rels
    .map((r) => `<Relationship Id="${escXml(r.id)}" Type="${escXml(r.type)}" Target="${escXml(r.target)}"/>`)
    .join('');
  return `${XML_HEADER}<Relationships xmlns="${NS_REL}">${items}</Relationships>`;
}

function buildCorePropsXml(title = 'Web Reverse Inspector Presentation') {
  const iso = new Date().toISOString();
  return `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escXml(title)}</dc:title><dc:creator>Web Reverse Inspector</dc:creator><cp:lastModifiedBy>Web Reverse Inspector</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;
}

function buildAppPropsXml(slideCount) {
  return `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Web Reverse Inspector</Application><Slides>${slideCount}</Slides><ScaleCrop>false</ScaleCrop><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged></Properties>`;
}

function buildThemeXml() {
  return `${XML_HEADER}<a:theme xmlns:a="${NS_A}" name="Office Theme"><a:themeElements><a:clrScheme name="WRI"><a:dk1><a:srgbClr val="0F172A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1E293B"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="3B82F6"/></a:accent1><a:accent2><a:srgbClr val="EF4444"/></a:accent2><a:accent3><a:srgbClr val="10B981"/></a:accent3><a:accent4><a:srgbClr val="8B5CF6"/></a:accent4><a:accent5><a:srgbClr val="06B6D4"/></a:accent5><a:accent6><a:srgbClr val="F59E0B"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="WRI"><a:majorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/></a:majorFont><a:minorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/></a:minorFont></a:fontScheme><a:fmtScheme name="WRI"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

function buildSlideMasterXml() {
  return `${XML_HEADER}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
}

function buildSlideLayoutXml() {
  return `${XML_HEADER}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function buildNotesMasterXml() {
  return `${XML_HEADER}<p:notesMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:notesMaster>`;
}

function buildNotesSlideXml(notesText = '') {
  const lines = String(notesText).split(/\r?\n/);
  const pXml = lines
    .map((line) =>
      line.length
        ? `<a:p><a:r><a:rPr lang="zh-CN" sz="1200" dirty="0"/><a:t>${escXml(line)}</a:t></a:r></a:p>`
        : '<a:p><a:endParaRPr lang="zh-CN" sz="1200" dirty="0"/></a:p>'
    )
    .join('');

  return `${XML_HEADER}<p:notes xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${pXml}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

function buildPresPropsXml() {
  return `${XML_HEADER}<p:presentationPr xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"/>`;
}

function buildViewPropsXml() {
  return `${XML_HEADER}<p:viewPr xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:slideViewPr><p:cSldViewPr><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr></p:cSldViewPr></p:slideViewPr></p:viewPr>`;
}

function buildTableStylesXml() {
  return `${XML_HEADER}<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;
}

// ---------------- 核心导出入口 ----------------

/**
 * 将 SlidesExportModel 序列化为标准 .pptx 二进制（Uint8Array）
 * @param {object} model
 * @returns {Promise<{ bytes: Uint8Array, summary: object }>}
 */
export async function exportSlidesModelToPptxBytes(model) {
  const stageW = Math.max(320, Number(model?.stageW) || 1280);
  const stageH = Math.max(240, Number(model?.stageH) || 720);
  const slides = Array.isArray(model?.slides) && model.slides.length > 0 ? model.slides : [];
  if (slides.length === 0) {
    throw new Error('没有可导出的幻灯片页面');
  }

  const sldCx = pxToEmu(stageW);
  const sldCy = pxToEmu(stageH);
  const title = model?.title || 'Presentation';

  const zipFiles = [];
  const mediaDedup = new Map(); // hashKey -> { mediaPath, ext }
  const usedImageExts = new Set();
  let mediaCounter = 0;

  function registerMedia(dataUrl) {
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded || decoded.bytes.length === 0) return null;
    const key = `${decoded.ext}:${decoded.bytes.length}:${computeCrc32(decoded.bytes)}`;
    if (mediaDedup.has(key)) {
      return mediaDedup.get(key);
    }
    mediaCounter++;
    const fileName = `image${mediaCounter}.${decoded.ext}`;
    const mediaPath = `ppt/media/${fileName}`;
    zipFiles.push({ path: mediaPath, data: decoded.bytes, compress: false });
    usedImageExts.add(decoded.ext);
    const info = { mediaPath, relTarget: `../media/${fileName}`, ext: decoded.ext };
    mediaDedup.set(key, info);
    return info;
  }

  const hasAnyNotes = slides.some((s) => Boolean(s?.notes && String(s.notes).trim()));
  const slideRelsInPres = [];
  const contentTypeOverrides = [
    { partName: '/ppt/presentation.xml', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml' },
    { partName: '/ppt/slideMasters/slideMaster1.xml', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml' },
    { partName: '/ppt/slideLayouts/slideLayout1.xml', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml' },
    { partName: '/ppt/theme/theme1.xml', contentType: 'application/vnd.openxmlformats-officedocument.theme+xml' },
    { partName: '/ppt/presProps.xml', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml' },
    { partName: '/ppt/viewProps.xml', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml' },
    { partName: '/ppt/tableStyles.xml', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml' },
    { partName: '/docProps/core.xml', contentType: 'application/vnd.openxmlformats-package.core-properties+xml' },
    { partName: '/docProps/app.xml', contentType: 'application/vnd.openxmlformats-officedocument.extended-properties+xml' }
  ];

  if (hasAnyNotes) {
    contentTypeOverrides.push({
      partName: '/ppt/notesMasters/notesMaster1.xml',
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml'
    });
  }

  const summary = {
    slideCount: slides.length,
    shapeCount: 0,
    textShapeCount: 0,
    tableCount: 0,
    imageCount: 0,
    notesCount: 0,
    uniqueMediaCount: 0
  };

  // 逐页生成 Slide XML & Rels
  slides.forEach((slide, idx) => {
    const slideNum = idx + 1;
    const slideRels = [
      { id: 'rId1', type: REL_SLIDE_LAYOUT, target: '../slideLayouts/slideLayout1.xml' }
    ];
    let nextRelNum = 2;

    // 1. 页面背景图（如存在）
    let bgImgRelId = '';
    if (slide?.background?.kind === 'image' && slide.background.dataUrl) {
      const media = registerMedia(slide.background.dataUrl);
      if (media) {
        bgImgRelId = `rId${nextRelNum++}`;
        slideRels.push({ id: bgImgRelId, type: REL_IMAGE, target: media.relTarget });
        summary.imageCount++;
      }
    }

    // 2. 逐图层构建 OOXML 节点
    let nextShapeId = 2;
    const nodesXml = [];
    for (const el of slide?.elements || []) {
      if (!el || !el.box) continue;

      if (el.type === 'shape') {
        const spId = nextShapeId++;
        nodesXml.push(buildShapeXml(el, spId));
        summary.shapeCount++;
        if (el.text) summary.textShapeCount++;
      } else if (el.type === 'image' && el.dataUrl) {
        const media = registerMedia(el.dataUrl);
        if (media) {
          const rId = `rId${nextRelNum++}`;
          slideRels.push({ id: rId, type: REL_IMAGE, target: media.relTarget });
          const picId = nextShapeId++;
          nodesXml.push(buildPictureXml(el, picId, rId));
          summary.imageCount++;
        }
      } else if (el.type === 'table' && Array.isArray(el.rows) && el.rows.length > 0) {
        const tblId = nextShapeId++;
        nodesXml.push(buildTableXml(el, tblId));
        summary.tableCount++;
      }
    }

    // 3. 演讲者备注（如有）
    if (slide?.notes && String(slide.notes).trim()) {
      const notesRelId = `rId${nextRelNum++}`;
      slideRels.push({
        id: notesRelId,
        type: REL_NOTES_SLIDE,
        target: `../notesSlides/notesSlide${slideNum}.xml`
      });
      zipFiles.push({
        path: `ppt/notesSlides/notesSlide${slideNum}.xml`,
        data: buildNotesSlideXml(slide.notes)
      });
      zipFiles.push({
        path: `ppt/notesSlides/_rels/notesSlide${slideNum}.xml.rels`,
        data: buildRelsXml([
          { id: 'rId1', type: REL_NOTES_MASTER, target: '../notesMasters/notesMaster1.xml' },
          { id: 'rId2', type: REL_SLIDE, target: `../slides/slide${slideNum}.xml` }
        ])
      });
      contentTypeOverrides.push({
        partName: `/ppt/notesSlides/notesSlide${slideNum}.xml`,
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml'
      });
      summary.notesCount++;
    }

    const bgXml = buildSlideBgXml(slide?.background, bgImgRelId);
    const slideXml = `${XML_HEADER}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld>${bgXml}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${nodesXml.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

    zipFiles.push({ path: `ppt/slides/slide${slideNum}.xml`, data: slideXml });
    zipFiles.push({ path: `ppt/slides/_rels/slide${slideNum}.xml.rels`, data: buildRelsXml(slideRels) });

    contentTypeOverrides.push({
      partName: `/ppt/slides/slide${slideNum}.xml`,
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
    });

    slideRelsInPres.push({ slideNum });
  });

  summary.uniqueMediaCount = mediaDedup.size;

  // 4. 组装 Presentation 及其关系
  const presRels = [
    { id: 'rId1', type: REL_SLIDE_MASTER, target: 'slideMasters/slideMaster1.xml' },
    { id: 'rId2', type: REL_PRES_PROPS, target: 'presProps.xml' },
    { id: 'rId3', type: REL_VIEW_PROPS, target: 'viewProps.xml' },
    { id: 'rId4', type: REL_THEME, target: 'theme/theme1.xml' },
    { id: 'rId5', type: REL_TABLE_STYLES, target: 'tableStyles.xml' }
  ];
  let presRelCounter = 6;

  let notesMasterIdLstXml = '';
  if (hasAnyNotes) {
    const nmRelId = `rId${presRelCounter++}`;
    presRels.push({ id: nmRelId, type: REL_NOTES_MASTER, target: 'notesMasters/notesMaster1.xml' });
    notesMasterIdLstXml = `<p:notesMasterIdLst><p:notesMasterId r:id="${nmRelId}"/></p:notesMasterIdLst>`;
    zipFiles.push({ path: 'ppt/notesMasters/notesMaster1.xml', data: buildNotesMasterXml() });
    zipFiles.push({
      path: 'ppt/notesMasters/_rels/notesMaster1.xml.rels',
      data: buildRelsXml([{ id: 'rId1', type: REL_THEME, target: '../theme/theme1.xml' }])
    });
  }

  const sldIdXmlList = slideRelsInPres.map((item, idx) => {
    const rId = `rId${presRelCounter++}`;
    presRels.push({ id: rId, type: REL_SLIDE, target: `slides/slide${item.slideNum}.xml` });
    return `<p:sldId id="${256 + idx}" r:id="${rId}"/>`;
  });

  // 确定 sldSz type 属性（16:9 用 custom 或 screen16x9 均兼容，直接精准写入 cx/cy 最保真）
  const presentationXml = `${XML_HEADER}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${notesMasterIdLstXml}<p:sldIdLst>${sldIdXmlList.join('')}</p:sldIdLst><p:sldSz cx="${sldCx}" cy="${sldCy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;

  // 5. 写入固定框架文件
  const ctDefaults = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>'
  ];
  const extMimeMap = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp'
  };
  for (const ext of usedImageExts) {
    if (extMimeMap[ext]) {
      ctDefaults.push(`<Default Extension="${ext}" ContentType="${extMimeMap[ext]}"/>`);
    }
  }
  const ctOverridesXml = contentTypeOverrides
    .map((o) => `<Override PartName="${escXml(o.partName)}" ContentType="${escXml(o.contentType)}"/>`)
    .join('');

  const contentTypesXml = `${XML_HEADER}<Types xmlns="${NS_CT}">${ctDefaults.join('')}${ctOverridesXml}</Types>`;

  const rootRelsXml = buildRelsXml([
    { id: 'rId1', type: REL_OFFICE_DOC, target: 'ppt/presentation.xml' },
    { id: 'rId2', type: REL_CORE_PROPS, target: 'docProps/core.xml' },
    { id: 'rId3', type: REL_EXT_PROPS, target: 'docProps/app.xml' }
  ]);

  zipFiles.unshift(
    { path: '[Content_Types].xml', data: contentTypesXml },
    { path: '_rels/.rels', data: rootRelsXml },
    { path: 'docProps/core.xml', data: buildCorePropsXml(title) },
    { path: 'docProps/app.xml', data: buildAppPropsXml(slides.length) },
    { path: 'ppt/presentation.xml', data: presentationXml },
    { path: 'ppt/_rels/presentation.xml.rels', data: buildRelsXml(presRels) },
    { path: 'ppt/presProps.xml', data: buildPresPropsXml() },
    { path: 'ppt/viewProps.xml', data: buildViewPropsXml() },
    { path: 'ppt/tableStyles.xml', data: buildTableStylesXml() },
    { path: 'ppt/theme/theme1.xml', data: buildThemeXml() },
    { path: 'ppt/slideMasters/slideMaster1.xml', data: buildSlideMasterXml() },
    {
      path: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: buildRelsXml([
        { id: 'rId1', type: REL_SLIDE_LAYOUT, target: '../slideLayouts/slideLayout1.xml' },
        { id: 'rId2', type: REL_THEME, target: '../theme/theme1.xml' }
      ])
    },
    { path: 'ppt/slideLayouts/slideLayout1.xml', data: buildSlideLayoutXml() },
    {
      path: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: buildRelsXml([{ id: 'rId1', type: REL_SLIDE_MASTER, target: '../slideMasters/slideMaster1.xml' }])
    }
  );

  const bytes = await buildZipArchive(zipFiles);
  return { bytes, summary };
}

/**
 * 便捷封装：直接返回可用于浏览器下载的 .pptx Blob
 * @param {object} model
 * @returns {Promise<{ blob: Blob, summary: object }>}
 */
export async function exportSlidesModelToPptxBlob(model) {
  const { bytes, summary } = await exportSlidesModelToPptxBytes(model);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  });
  return { blob, summary };
}
