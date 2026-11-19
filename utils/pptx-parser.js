/**
 * @file utils/pptx-parser.js
 * @description 纯原生 ES Module OOXML (.pptx) 四级继承高精度解析引擎
 * 完整解析 Theme -> SlideMaster -> SlideLayout -> Slide 继承链、颜色变换、EMU 坐标、
 * 组合图形递归映射、矢量几何、表格、图表摘要、内嵌图片、动画与演讲者备注。
 */

import { openZipArchive, normalizeZipPath } from './zip-lite.js';

const EMU_PER_PX = 9525; // 96 DPI: 1px = 9525 EMU, 1pt = 12700 EMU

const PRESET_COLORS = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  dkgray: '#404040',
  ltgray: '#c0c0c0',
  orange: '#ffa500',
  pink: '#ffc0cb',
  purple: '#800080',
  navy: '#000080',
  teal: '#008080',
  silver: '#c0c0c0'
};

// ---------------- XML DOM 访问工具 ----------------

function child(el, localName) {
  if (!el || !el.childNodes) return null;
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType === 1 && n.localName === localName) return n;
  }
  return null;
}

function children(el, localName) {
  const out = [];
  if (!el || !el.childNodes) return out;
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType === 1 && (!localName || n.localName === localName)) out.push(n);
  }
  return out;
}

function findDesc(el, localName) {
  if (!el || !el.childNodes) return null;
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType !== 1) continue;
    if (n.localName === localName) return n;
    const hit = findDesc(n, localName);
    if (hit) return hit;
  }
  return null;
}

function findAllDesc(el, localName, out = []) {
  if (!el || !el.childNodes) return out;
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType !== 1) continue;
    if (n.localName === localName) out.push(n);
    findAllDesc(n, localName, out);
  }
  return out;
}

function attr(el, name) {
  if (!el || !el.getAttribute) return '';
  return el.getAttribute(name) || '';
}

function relAttr(el, name) {
  if (!el) return '';
  return (
    el.getAttribute(`r:${name}`) ||
    el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', name) ||
    el.getAttribute(name) ||
    ''
  );
}

function numAttr(el, name, fallback = 0) {
  const v = attr(el, name);
  if (v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function defaultParseXml(xmlStr) {
  if (typeof DOMParser === 'undefined') {
    throw new Error('缺少 DOMParser，请在浏览器/SidePanel 上下文调用或传入自定义 parseXml');
  }
  return new DOMParser().parseFromString(xmlStr, 'application/xml');
}

// ---------------- 路径与关系 (.rels) 解析 ----------------

function relsPathFor(partPath) {
  const norm = normalizeZipPath(partPath);
  const slash = norm.lastIndexOf('/');
  const dir = slash >= 0 ? norm.slice(0, slash + 1) : '';
  const file = slash >= 0 ? norm.slice(slash + 1) : norm;
  return `${dir}_rels/${file}.rels`;
}

function resolveRelTarget(sourcePartPath, target) {
  if (!target) return '';
  if (target.startsWith('/')) return normalizeZipPath(target.slice(1));
  const slash = sourcePartPath.lastIndexOf('/');
  const dir = slash >= 0 ? sourcePartPath.slice(0, slash + 1) : '';
  return normalizeZipPath(dir + target);
}

async function readRelsMap(zip, partPath, parseXml) {
  const map = new Map();
  const relXml = await zip.getText(relsPathFor(partPath));
  if (!relXml) return map;
  const doc = parseXml(relXml);
  for (const rel of findAllDesc(doc.documentElement, 'Relationship')) {
    const id = attr(rel, 'Id');
    const type = attr(rel, 'Type');
    const target = attr(rel, 'Target');
    const targetMode = attr(rel, 'TargetMode');
    if (!id) continue;
    map.set(id, {
      id,
      type,
      targetMode,
      target: targetMode === 'External' ? target : resolveRelTarget(partPath, target)
    });
  }
  return map;
}

// ---------------- OOXML 颜色与明度变换引擎 ----------------

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  };
}

function applyColorModifiers(baseHex, colorEl) {
  if (!baseHex) return '';
  let rgb = hexToRgb(baseHex);
  let alpha = 1;

  for (const mod of children(colorEl)) {
    const val = numAttr(mod, 'val', 0) / 100000;
    switch (mod.localName) {
      case 'alpha':
        alpha = Math.max(0, Math.min(1, val));
        break;
      case 'tint':
        rgb = {
          r: rgb.r + (255 - rgb.r) * (1 - val),
          g: rgb.g + (255 - rgb.g) * (1 - val),
          b: rgb.b + (255 - rgb.b) * (1 - val)
        };
        break;
      case 'shade':
        rgb = { r: rgb.r * val, g: rgb.g * val, b: rgb.b * val };
        break;
      case 'lumMod': {
        const hsl = rgbToHsl(rgb);
        hsl.l = Math.max(0, Math.min(1, hsl.l * val));
        rgb = hslToRgb(hsl);
        break;
      }
      case 'lumOff': {
        const hsl = rgbToHsl(rgb);
        hsl.l = Math.max(0, Math.min(1, hsl.l + val));
        rgb = hslToRgb(hsl);
        break;
      }
      case 'satMod': {
        const hsl = rgbToHsl(rgb);
        hsl.s = Math.max(0, Math.min(1, hsl.s * val));
        rgb = hslToRgb(hsl);
        break;
      }
      default:
        break;
    }
  }

  const hex = rgbToHex(rgb);
  if (alpha < 0.999) {
    const c = hexToRgb(hex);
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(alpha * 1000) / 1000})`;
  }
  return hex;
}

function resolveColorFromContainer(containerEl, ctx) {
  if (!containerEl) return '';

  const srgb = child(containerEl, 'srgbClr');
  if (srgb) {
    const val = attr(srgb, 'val');
    if (val) return applyColorModifiers(`#${val.toLowerCase()}`, srgb);
  }

  const scheme = child(containerEl, 'schemeClr');
  if (scheme) {
    const rawKey = attr(scheme, 'val');
    const mappedKey = ctx?.clrMap?.[rawKey] || rawKey;
    let baseHex = ctx?.theme?.colors?.[mappedKey] || ctx?.theme?.colors?.[rawKey] || '';
    if (!baseHex && rawKey === 'phClr') baseHex = ctx?.phClr || '#3b82f6';
    if (baseHex) return applyColorModifiers(baseHex, scheme);
  }

  const prst = child(containerEl, 'prstClr');
  if (prst) {
    const key = attr(prst, 'val').toLowerCase();
    const baseHex = PRESET_COLORS[key] || '';
    if (baseHex) return applyColorModifiers(baseHex, prst);
  }

  const sys = child(containerEl, 'sysClr');
  if (sys) {
    const lastClr = attr(sys, 'lastClr');
    const val = attr(sys, 'val').toLowerCase();
    const baseHex = lastClr ? `#${lastClr.toLowerCase()}` : val === 'windowtext' ? '#000000' : '#ffffff';
    return applyColorModifiers(baseHex, sys);
  }

  return '';
}

// ---------------- Theme / Master / Layout 解析 ----------------

function parseThemeXml(xmlDoc) {
  const colors = {
    dk1: '#000000',
    lt1: '#ffffff',
    dk2: '#1f2937',
    lt2: '#f3f4f6',
    accent1: '#3b82f6',
    accent2: '#ef4444',
    accent3: '#10b981',
    accent4: '#8b5cf6',
    accent5: '#06b6d4',
    accent6: '#f59e0b',
    hlink: '#2563eb',
    folHlink: '#7c3aed'
  };

  const fonts = {
    majorLatin: 'Calibri',
    majorEa: 'Microsoft YaHei',
    minorLatin: 'Calibri',
    minorEa: 'Microsoft YaHei'
  };

  if (!xmlDoc) return { colors, fonts };

  const clrScheme = findDesc(xmlDoc.documentElement, 'clrScheme');
  if (clrScheme) {
    for (const cNode of children(clrScheme)) {
      const hex = resolveColorFromContainer(cNode, { theme: { colors } });
      if (hex) colors[cNode.localName] = hex;
    }
  }

  const fontScheme = findDesc(xmlDoc.documentElement, 'fontScheme');
  if (fontScheme) {
    const major = child(fontScheme, 'majorFont');
    const minor = child(fontScheme, 'minorFont');
    if (major) {
      const l = attr(child(major, 'latin'), 'typeface');
      const ea = attr(child(major, 'ea'), 'typeface');
      if (l) fonts.majorLatin = l;
      if (ea) fonts.majorEa = ea;
    }
    if (minor) {
      const l = attr(child(minor, 'latin'), 'typeface');
      const ea = attr(child(minor, 'ea'), 'typeface');
      if (l) fonts.minorLatin = l;
      if (ea) fonts.minorEa = ea;
    }
  }

  return { colors, fonts };
}

function parseClrMap(clrMapEl, baseMap = null) {
  const map = {
    bg1: 'lt1',
    tx1: 'dk1',
    bg2: 'lt2',
    tx2: 'dk2',
    accent1: 'accent1',
    accent2: 'accent2',
    accent3: 'accent3',
    accent4: 'accent4',
    accent5: 'accent5',
    accent6: 'accent6',
    hlink: 'hlink',
    folHlink: 'folHlink',
    ...(baseMap || {})
  };
  if (!clrMapEl) return map;
  for (const k of Object.keys(map)) {
    const v = attr(clrMapEl, k);
    if (v) map[k] = v;
  }
  return map;
}

// ---------------- 填充、边框、阴影与矢量几何解析 ----------------

async function parseFill(containerEl, ctx) {
  if (!containerEl) return null;

  if (child(containerEl, 'noFill')) {
    return { type: 'none' };
  }

  const solid = child(containerEl, 'solidFill');
  if (solid) {
    const color = resolveColorFromContainer(solid, ctx);
    if (color) return { type: 'solid', color };
  }

  const grad = child(containerEl, 'gradFill');
  if (grad) {
    const gsLst = child(grad, 'gsLst');
    const stops = [];
    if (gsLst) {
      for (const gs of children(gsLst, 'gs')) {
        const posPct = Math.round((numAttr(gs, 'pos', 0) / 100000) * 1000) / 10;
        const col = resolveColorFromContainer(gs, ctx);
        if (col) stops.push({ pos: posPct, color: col });
      }
    }
    stops.sort((a, b) => a.pos - b.pos);
    if (stops.length > 0) {
      const lin = child(grad, 'lin');
      const pathEl = child(grad, 'path');
      if (pathEl && attr(pathEl, 'path') === 'circle') {
        const stopStr = stops.map((s) => `${s.color} ${s.pos}%`).join(', ');
        return { type: 'gradient', css: `radial-gradient(circle, ${stopStr})`, stops };
      }
      const ang = lin ? numAttr(lin, 'ang', 0) : 0;
      const cssAngle = Math.round(((ang / 60000 + 90) % 360) * 10) / 10;
      const stopStr = stops.map((s) => `${s.color} ${s.pos}%`).join(', ');
      return {
        type: 'gradient',
        angle: cssAngle,
        css: `linear-gradient(${cssAngle}deg, ${stopStr})`,
        stops
      };
    }
  }

  const blipFill = child(containerEl, 'blipFill');
  if (blipFill) {
    const blip = child(blipFill, 'blip');
    const embedId = relAttr(blip, 'embed');
    if (embedId && ctx.rels && ctx.rels.has(embedId)) {
      const targetPath = ctx.rels.get(embedId).target;
      const dataUrl = await ctx.zip.getDataUrl(targetPath);
      if (dataUrl) {
        return {
          type: 'image',
          dataUrl,
          mediaPath: targetPath
        };
      }
    }
  }

  return null;
}

async function parseLine(spPrEl, ctx) {
  const ln = child(spPrEl, 'ln');
  if (!ln) return null;
  if (child(ln, 'noFill')) return { widthPx: 0, color: 'transparent', dash: 'solid' };

  const widthEmu = numAttr(ln, 'w', 12700);
  const widthPx = Math.max(0.75, Math.round((widthEmu / EMU_PER_PX) * ctx.scale * 10) / 10);
  const solid = child(ln, 'solidFill');
  const color = solid ? resolveColorFromContainer(solid, ctx) : '';
  const prstDash = attr(child(ln, 'prstDash'), 'val');
  const dash = prstDash && prstDash !== 'solid' ? (prstDash.includes('dot') ? 'dotted' : 'dashed') : 'solid';

  if (!color) return null;
  return { widthPx, color, dash };
}

function parseShadow(spPrEl, ctx) {
  const effLst = child(spPrEl, 'effectLst');
  if (!effLst) return '';
  const shdw = child(effLst, 'outerShdw');
  if (!shdw) return '';

  const blurPx = Math.round((numAttr(shdw, 'blurRad', 38100) / EMU_PER_PX) * ctx.scale * 10) / 10;
  const distPx = (numAttr(shdw, 'dist', 38100) / EMU_PER_PX) * ctx.scale;
  const dirRad = ((numAttr(shdw, 'dir', 0) / 60000) * Math.PI) / 180;
  const ox = Math.round(Math.cos(dirRad) * distPx * 10) / 10;
  const oy = Math.round(Math.sin(dirRad) * distPx * 10) / 10;
  const color = resolveColorFromContainer(shdw, ctx) || 'rgba(0,0,0,0.28)';

  return `${ox}px ${oy}px ${blurPx}px ${color}`;
}

function parseGeometry(spPrEl) {
  const prstGeom = child(spPrEl, 'prstGeom');
  if (prstGeom) {
    const prst = attr(prstGeom, 'prst') || 'rect';
    let adjRatio = null;
    const avLst = child(prstGeom, 'avLst');
    if (avLst) {
      const gd = child(avLst, 'gd');
      const fmla = attr(gd, 'fmla');
      const m = fmla.match(/val\s+(-?\d+)/);
      if (m) adjRatio = Number(m[1]) / 100000;
    }
    return { kind: 'preset', prst, adjRatio };
  }

  const custGeom = child(spPrEl, 'custGeom');
  if (custGeom) {
    const pathLst = child(custGeom, 'pathLst');
    const pathEl = pathLst ? child(pathLst, 'path') : null;
    if (pathEl) {
      const vbW = numAttr(pathEl, 'w', 1000);
      const vbH = numAttr(pathEl, 'h', 1000);
      const cmds = [];
      for (const cmd of children(pathEl)) {
        if (cmd.localName === 'moveTo') {
          const pt = child(cmd, 'pt');
          cmds.push(`M ${numAttr(pt, 'x')} ${numAttr(pt, 'y')}`);
        } else if (cmd.localName === 'lnTo') {
          const pt = child(cmd, 'pt');
          cmds.push(`L ${numAttr(pt, 'x')} ${numAttr(pt, 'y')}`);
        } else if (cmd.localName === 'cubicBezTo') {
          const pts = children(cmd, 'pt');
          if (pts.length === 3) {
            cmds.push(
              `C ${numAttr(pts[0], 'x')} ${numAttr(pts[0], 'y')}, ${numAttr(pts[1], 'x')} ${numAttr(
                pts[1],
                'y'
              )}, ${numAttr(pts[2], 'x')} ${numAttr(pts[2], 'y')}`
            );
          }
        } else if (cmd.localName === 'quadBezTo') {
          const pts = children(cmd, 'pt');
          if (pts.length === 2) {
            cmds.push(`Q ${numAttr(pts[0], 'x')} ${numAttr(pts[0], 'y')}, ${numAttr(pts[1], 'x')} ${numAttr(pts[1], 'y')}`);
          }
        } else if (cmd.localName === 'close') {
          cmds.push('Z');
        }
      }
      if (cmds.length > 0) {
        return { kind: 'custom', d: cmds.join(' '), vbW: Math.max(1, vbW), vbH: Math.max(1, vbH) };
      }
    }
  }

  return { kind: 'preset', prst: 'rect', adjRatio: null };
}

// ---------------- 文本与四级列表样式继承解析 ----------------

function resolveFontFamily(typeface, themeFonts) {
  if (!typeface) return '';
  if (typeface === '+mj-lt') return themeFonts.majorLatin;
  if (typeface === '+mj-ea') return themeFonts.majorEa || themeFonts.majorLatin;
  if (typeface === '+mn-lt') return themeFonts.minorLatin;
  if (typeface === '+mn-ea') return themeFonts.minorEa || themeFonts.minorLatin;
  return typeface;
}

function extractLevelStylesMap(lstStyleEl, ctx) {
  const levels = {};
  if (!lstStyleEl) return levels;
  for (let lvl = 1; lvl <= 9; lvl++) {
    const pPr = child(lstStyleEl, `lvl${lvl}pPr`);
    if (pPr) levels[lvl - 1] = parseParagraphProps(pPr, ctx);
  }
  const defPPr = child(lstStyleEl, 'defPPr');
  if (defPPr && !levels[0]) {
    levels[0] = parseParagraphProps(defPPr, ctx);
  }
  return levels;
}

function mergeLevelStyleMaps(...maps) {
  const merged = {};
  for (let lvl = 0; lvl < 9; lvl++) {
    let acc = {};
    for (const m of maps) {
      if (m && m[lvl]) {
        acc = {
          ...acc,
          ...m[lvl],
          defRun: { ...(acc.defRun || {}), ...(m[lvl].defRun || {}) }
        };
      }
    }
    if (Object.keys(acc).length > 0) merged[lvl] = acc;
  }
  return merged;
}

function parseRunProps(rPrEl, ctx) {
  if (!rPrEl) return {};
  const style = {};

  const sz = attr(rPrEl, 'sz');
  if (sz) style.fontSizePt = Math.round((Number(sz) / 100) * 10) / 10;

  const b = attr(rPrEl, 'b');
  if (b !== '') style.bold = b === '1' || b === 'true';

  const it = attr(rPrEl, 'i');
  if (it !== '') style.italic = it === '1' || it === 'true';

  const u = attr(rPrEl, 'u');
  if (u && u !== 'none') style.underline = true;

  const strike = attr(rPrEl, 'strike');
  if (strike && strike !== 'noStrike') style.strike = true;

  const spc = attr(rPrEl, 'spc');
  if (spc) style.letterSpacingPt = Math.round((Number(spc) / 100) * 10) / 10;

  const solid = child(rPrEl, 'solidFill');
  if (solid) {
    const color = resolveColorFromContainer(solid, ctx);
    if (color) style.color = color;
  }

  const latin = child(rPrEl, 'latin');
  const ea = child(rPrEl, 'ea');
  const themeFonts = ctx?.theme?.fonts || {};
  const eaFace = resolveFontFamily(attr(ea, 'typeface'), themeFonts);
  const latinFace = resolveFontFamily(attr(latin, 'typeface'), themeFonts);
  const families = [eaFace, latinFace].filter(Boolean);
  if (families.length > 0) style.fontFamily = Array.from(new Set(families)).join(', ');

  return style;
}

function parseParagraphProps(pPrEl, ctx) {
  if (!pPrEl) return {};
  const out = {};

  const algn = attr(pPrEl, 'algn');
  if (algn === 'ctr') out.align = 'center';
  else if (algn === 'r') out.align = 'right';
  else if (algn === 'just') out.align = 'justify';
  else if (algn === 'l') out.align = 'left';

  const lvl = attr(pPrEl, 'lvl');
  if (lvl !== '') out.level = Number(lvl) || 0;

  const lnSpc = child(pPrEl, 'lnSpc');
  if (lnSpc) {
    const spcPct = child(lnSpc, 'spcPct');
    const spcPts = child(lnSpc, 'spcPts');
    if (spcPct) out.lineHeight = Math.round((numAttr(spcPct, 'val', 100000) / 100000) * 100) / 100;
    else if (spcPts) out.lineHeightPt = Math.round((numAttr(spcPts, 'val', 1400) / 100) * 10) / 10;
  }

  const spcBef = child(pPrEl, 'spcBef');
  if (spcBef) {
    const pts = child(spcBef, 'spcPts');
    if (pts) out.spaceBeforePt = Math.round((numAttr(pts, 'val', 0) / 100) * 10) / 10;
  }

  const spcAft = child(pPrEl, 'spcAft');
  if (spcAft) {
    const pts = child(spcAft, 'spcPts');
    if (pts) out.spaceAfterPt = Math.round((numAttr(pts, 'val', 0) / 100) * 10) / 10;
  }

  if (child(pPrEl, 'buNone')) {
    out.bullet = '';
  } else {
    const buChar = child(pPrEl, 'buChar');
    const buAuto = child(pPrEl, 'buAutoNum');
    if (buChar) out.bullet = attr(buChar, 'char') || '•';
    else if (buAuto) out.bulletAuto = attr(buAuto, 'type') || 'arabicPeriod';
  }

  const defRPr = child(pPrEl, 'defRPr');
  if (defRPr) out.defRun = parseRunProps(defRPr, ctx);

  return out;
}

function parseTextBody(txBodyEl, inheritedLevels, ctx, slideNumber) {
  if (!txBodyEl) return null;

  const bodyPr = child(txBodyEl, 'bodyPr');
  const anchorAttr = attr(bodyPr, 'anchor');
  const vAlign = anchorAttr === 'ctr' ? 'middle' : anchorAttr === 'b' ? 'bottom' : 'top';

  const padL = Math.round(((numAttr(bodyPr, 'lIns', 91440) / EMU_PER_PX) * ctx.scale) * 10) / 10;
  const padT = Math.round(((numAttr(bodyPr, 'tIns', 45720) / EMU_PER_PX) * ctx.scale) * 10) / 10;
  const padR = Math.round(((numAttr(bodyPr, 'rIns', 91440) / EMU_PER_PX) * ctx.scale) * 10) / 10;
  const padB = Math.round(((numAttr(bodyPr, 'bIns', 45720) / EMU_PER_PX) * ctx.scale) * 10) / 10;

  const shapeLevels = extractLevelStylesMap(child(txBodyEl, 'lstStyle'), ctx);
  const mergedLevels = mergeLevelStyleMaps(inheritedLevels, shapeLevels);

  const paragraphs = [];
  let plainTextLines = [];
  let autoIndex = 1;

  for (const pEl of children(txBodyEl, 'p')) {
    const pPrEl = child(pEl, 'pPr');
    const lvl = pPrEl && attr(pPrEl, 'lvl') !== '' ? Number(attr(pPrEl, 'lvl')) : 0;
    const baseLevel = mergedLevels[lvl] || mergedLevels[0] || {};
    const localPPr = parseParagraphProps(pPrEl, ctx);

    const pStyle = {
      align: localPPr.align || baseLevel.align || 'left',
      level: lvl,
      lineHeight: localPPr.lineHeight || baseLevel.lineHeight || 1.25,
      spaceBeforePt: localPPr.spaceBeforePt ?? baseLevel.spaceBeforePt ?? 0,
      spaceAfterPt: localPPr.spaceAfterPt ?? baseLevel.spaceAfterPt ?? 0,
      bullet: localPPr.bullet !== undefined ? localPPr.bullet : baseLevel.bullet || ''
    };

    if ((localPPr.bulletAuto || baseLevel.bulletAuto) && pStyle.bullet === '') {
      pStyle.bullet = `${autoIndex++}.`;
    }

    const runs = [];
    let pText = '';
    const baseRunStyle = {
      fontSizePt: 18,
      fontFamily: [ctx.theme?.fonts?.minorEa, ctx.theme?.fonts?.minorLatin].filter(Boolean).join(', ') || 'sans-serif',
      color: ctx.clrMap?.tx1 ? ctx.theme?.colors?.[ctx.clrMap.tx1] || '#111827' : '#111827',
      bold: false,
      italic: false,
      ...(baseLevel.defRun || {}),
      ...(localPPr.defRun || {})
    };

    for (const node of children(pEl)) {
      if (node.localName === 'r') {
        const rPr = parseRunProps(child(node, 'rPr'), ctx);
        const tEl = child(node, 't');
        const txt = tEl ? tEl.textContent || '' : '';
        if (txt) {
          pText += txt;
          runs.push({ text: txt, style: { ...baseRunStyle, ...rPr } });
        }
      } else if (node.localName === 'br') {
        pText += '\n';
        runs.push({ text: '\n', style: { ...baseRunStyle } });
      } else if (node.localName === 'fld') {
        const fldType = attr(node, 'type');
        const rPr = parseRunProps(child(node, 'rPr'), ctx);
        const tEl = child(node, 't');
        const txt = fldType === 'slidenum' ? String(slideNumber || 1) : tEl?.textContent || '';
        if (txt) {
          pText += txt;
          runs.push({ text: txt, style: { ...baseRunStyle, ...rPr } });
        }
      }
    }

    plainTextLines.push((pStyle.bullet ? `${pStyle.bullet} ` : '') + pText);
    paragraphs.push({ style: pStyle, runs, text: pText });
  }

  return {
    vAlign,
    paddingPx: { l: padL, t: padT, r: padR, b: padB },
    paragraphs,
    plainText: plainTextLines.join('\n').trim()
  };
}

// ---------------- 坐标与变换映射 ----------------

function readXfrm(spPrEl) {
  const xfrm = child(spPrEl, 'xfrm');
  if (!xfrm) return null;
  const off = child(xfrm, 'off');
  const ext = child(xfrm, 'ext');
  if (!off && !ext) return null;

  return {
    x: numAttr(off, 'x', 0),
    y: numAttr(off, 'y', 0),
    w: numAttr(ext, 'cx', 0),
    h: numAttr(ext, 'cy', 0),
    rotDeg: Math.round((numAttr(xfrm, 'rot', 0) / 60000) * 10) / 10,
    flipH: attr(xfrm, 'flipH') === '1',
    flipV: attr(xfrm, 'flipV') === '1'
  };
}

function readGroupXfrm(grpSpPrEl) {
  const xfrm = child(grpSpPrEl, 'xfrm');
  if (!xfrm) return null;
  const off = child(xfrm, 'off');
  const ext = child(xfrm, 'ext');
  const chOff = child(xfrm, 'chOff');
  const chExt = child(xfrm, 'chExt');
  if (!off || !ext) return null;

  return {
    x: numAttr(off, 'x', 0),
    y: numAttr(off, 'y', 0),
    w: numAttr(ext, 'cx', 1),
    h: numAttr(ext, 'cy', 1),
    chX: numAttr(chOff, 'x', 0),
    chY: numAttr(chOff, 'y', 0),
    chW: Math.max(1, numAttr(chExt, 'cx', numAttr(ext, 'cx', 1))),
    chH: Math.max(1, numAttr(chExt, 'cy', numAttr(ext, 'cy', 1))),
    rotDeg: Math.round((numAttr(xfrm, 'rot', 0) / 60000) * 10) / 10
  };
}

function mapEmuBox(rawBox, groupTransform, slideSizeEmu, stageW, stageH) {
  let x = rawBox.x;
  let y = rawBox.y;
  let w = rawBox.w;
  let h = rawBox.h;
  let rot = rawBox.rotDeg || 0;

  if (groupTransform) {
    const sx = groupTransform.w / groupTransform.chW;
    const sy = groupTransform.h / groupTransform.chH;
    x = groupTransform.x + (x - groupTransform.chX) * sx;
    y = groupTransform.y + (y - groupTransform.chY) * sy;
    w = w * sx;
    h = h * sy;
    rot += groupTransform.rotDeg || 0;
  }

  return {
    lPct: Math.round((x / slideSizeEmu.cx) * 1000) / 10,
    tPct: Math.round((y / slideSizeEmu.cy) * 1000) / 10,
    wPct: Math.round((w / slideSizeEmu.cx) * 1000) / 10,
    hPct: Math.round((h / slideSizeEmu.cy) * 1000) / 10,
    xPx: Math.round((x / slideSizeEmu.cx) * stageW * 10) / 10,
    yPx: Math.round((y / slideSizeEmu.cy) * stageH * 10) / 10,
    wPx: Math.round((w / slideSizeEmu.cx) * stageW * 10) / 10,
    hPx: Math.round((h / slideSizeEmu.cy) * stageH * 10) / 10,
    rotDeg: Math.round(rot * 10) / 10,
    flipH: Boolean(rawBox.flipH),
    flipV: Boolean(rawBox.flipV)
  };
}

// ---------------- 表格与图表解析 ----------------

async function parseTableElement(tblEl, box, ctx, slideNumber) {
  const tblGrid = child(tblEl, 'tblGrid');
  const colEls = tblGrid ? children(tblGrid, 'gridCol') : [];
  const totalColW = colEls.reduce((acc, c) => acc + numAttr(c, 'w', 0), 0) || 1;
  const colWidthPcts = colEls.map((c) => Math.round((numAttr(c, 'w', 0) / totalColW) * 1000) / 10);

  const rows = [];
  for (const tr of children(tblEl, 'tr')) {
    const rowHeightPx = Math.round((numAttr(tr, 'h', 370840) / EMU_PER_PX) * ctx.scale);
    const cells = [];
    for (const tc of children(tr, 'tc')) {
      if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') {
        cells.push({ mergedSkip: true });
        continue;
      }
      const gridSpan = numAttr(tc, 'gridSpan', 1);
      const rowSpan = numAttr(tc, 'rowSpan', 1);
      const tcPr = child(tc, 'tcPr');
      const fill = tcPr ? await parseFill(tcPr, ctx) : null;
      const borderColor =
        resolveColorFromContainer(child(child(tcPr, 'lnB'), 'solidFill'), ctx) ||
        resolveColorFromContainer(child(child(tcPr, 'lnL'), 'solidFill'), ctx) ||
        'rgba(148,163,184,0.35)';
      const txBody = child(tc, 'txBody');
      const parsedText = parseTextBody(txBody, { 0: { defRun: { fontSizePt: 12 } } }, ctx, slideNumber);
      cells.push({
        gridSpan,
        rowSpan,
        fill,
        borderColor,
        text: parsedText
      });
    }
    rows.push({ heightPx: rowHeightPx, cells });
  }

  return {
    type: 'table',
    box,
    colWidthPcts,
    rows
  };
}

async function parseChartSummary(chartPath, zip, parseXml) {
  const xmlText = await zip.getText(chartPath);
  if (!xmlText) return null;
  const doc = parseXml(xmlText);
  const root = doc.documentElement;

  const titleTexts = findAllDesc(findDesc(root, 'title'), 't').map((n) => n.textContent || '');
  const title = titleTexts.join('').trim();

  const plotArea = findDesc(root, 'plotArea');
  let chartKind = 'chart';
  if (plotArea) {
    for (const c of children(plotArea)) {
      if (c.localName.endsWith('Chart')) {
        chartKind = c.localName;
        break;
      }
    }
  }

  const series = [];
  for (const ser of findAllDesc(root, 'ser')) {
    const serName = findAllDesc(child(ser, 'tx'), 'v')
      .map((n) => n.textContent || '')
      .join('')
      .trim();
    const cats = findAllDesc(child(ser, 'cat'), 'v').map((n) => n.textContent || '');
    const vals = findAllDesc(child(ser, 'val'), 'v').map((n) => Number(n.textContent || 0));
    series.push({ name: serName || `系列 ${series.length + 1}`, categories: cats.slice(0, 12), values: vals.slice(0, 12) });
  }

  return { chartKind, title, series };
}

// ---------------- 形状树递归解析 & 占位符索引 ----------------

function indexPlaceholders(spTreeEl, ctx, slideNumber) {
  const byType = new Map();
  const byIdx = new Map();
  if (!spTreeEl) return { byType, byIdx };

  for (const sp of children(spTreeEl, 'sp')) {
    const nvSpPr = child(sp, 'nvSpPr');
    const nvPr = child(nvSpPr, 'nvPr');
    const ph = child(nvPr, 'ph');
    if (!ph) continue;

    const phType = attr(ph, 'type') || 'body';
    const phIdx = attr(ph, 'idx');
    const spPr = child(sp, 'spPr');
    const txBody = child(sp, 'txBody');

    const tpl = {
      phType,
      phIdx,
      xfrm: readXfrm(spPr),
      spPr,
      lstStyle: extractLevelStylesMap(child(txBody, 'lstStyle'), ctx),
      text: txBody ? parseTextBody(txBody, {}, ctx, slideNumber) : null
    };

    if (phIdx !== '') byIdx.set(phIdx, tpl);
    if (!byType.has(phType)) byType.set(phType, tpl);
  }

  return { byType, byIdx };
}

function lookupPlaceholderTemplate(phType, phIdx, layoutPhs, masterPhs) {
  const tryLookup = (mapObj) => {
    if (!mapObj) return null;
    if (phIdx !== '' && mapObj.byIdx.has(phIdx)) return mapObj.byIdx.get(phIdx);
    if (phType && mapObj.byType.has(phType)) return mapObj.byType.get(phType);
    if (phType === 'ctrTitle' && mapObj.byType.has('title')) return mapObj.byType.get('title');
    if (phType === 'subTitle' && mapObj.byType.has('body')) return mapObj.byType.get('body');
    return null;
  };
  return tryLookup(layoutPhs) || tryLookup(masterPhs) || null;
}

async function parseShapeTreeElements(spTreeEl, ctx, options = {}) {
  const {
    groupTransform = null,
    onlyNonPlaceholders = false,
    layoutPhs = null,
    masterPhs = null,
    masterTxStyles = {},
    defaultTextLevels = {},
    slideNumber = 1,
    animationsBySpid = new Map()
  } = options;

  const elements = [];
  if (!spTreeEl) return elements;

  for (const node of children(spTreeEl)) {
    const tag = node.localName;

    // 1. 组合形状递归展开
    if (tag === 'grpSp') {
      const grpSpPr = child(node, 'grpSpPr');
      const localGrp = readGroupXfrm(grpSpPr);
      let nextGroup = groupTransform;
      if (localGrp) {
        if (groupTransform) {
          const sx = groupTransform.w / groupTransform.chW;
          const sy = groupTransform.h / groupTransform.chH;
          nextGroup = {
            ...localGrp,
            x: groupTransform.x + (localGrp.x - groupTransform.chX) * sx,
            y: groupTransform.y + (localGrp.y - groupTransform.chY) * sy,
            w: localGrp.w * sx,
            h: localGrp.h * sy,
            rotDeg: (groupTransform.rotDeg || 0) + (localGrp.rotDeg || 0)
          };
        } else {
          nextGroup = localGrp;
        }
      }
      const nested = await parseShapeTreeElements(node, ctx, {
        ...options,
        groupTransform: nextGroup
      });
      elements.push(...nested);
      continue;
    }

    // 2. 普通形状 / 文本框 (<p:sp>)
    if (tag === 'sp') {
      const nvSpPr = child(node, 'nvSpPr');
      const cNvPr = child(nvSpPr, 'cNvPr');
      const spid = attr(cNvPr, 'id');
      const name = attr(cNvPr, 'name');
      const ph = child(child(nvSpPr, 'nvPr'), 'ph');
      const isPh = Boolean(ph);

      if (onlyNonPlaceholders && isPh) {
        // Master/Layout 上的 footer / dt / sldNum 等若含真实可见文本则也保留
        const phType = attr(ph, 'type');
        const txText = findAllDesc(node, 't')
          .map((t) => t.textContent || '')
          .join('')
          .trim();
        const hasSlideNum = Boolean(findDesc(node, 'fld'));
        if (!['ftr', 'dt', 'sldNum'].includes(phType) || (!txText && !hasSlideNum)) {
          continue;
        }
      }

      const phType = isPh ? attr(ph, 'type') || 'body' : '';
      const phIdx = isPh ? attr(ph, 'idx') : '';

      const layoutTpl = isPh ? lookupPlaceholderTemplate(phType, phIdx, layoutPhs, null) : null;
      const masterTpl = isPh ? lookupPlaceholderTemplate(phType, phIdx, null, masterPhs) : null;

      const spPr = child(node, 'spPr');
      const rawXfrm = readXfrm(spPr) || layoutTpl?.xfrm || masterTpl?.xfrm;
      if (!rawXfrm || rawXfrm.w <= 0 || rawXfrm.h <= 0) continue;

      const box = mapEmuBox(rawXfrm, groupTransform, ctx.slideSizeEmu, ctx.stageW, ctx.stageH);

      // 解析形状参考色 (<p:style><a:fillRef/lnRef>)
      const styleEl = child(node, 'style');
      const fillRef = styleEl ? child(styleEl, 'fillRef') : null;
      const fillRefColor = fillRef && numAttr(fillRef, 'idx', 0) > 0 ? resolveColorFromContainer(fillRef, ctx) : '';
      const shapeCtx = { ...ctx, phClr: fillRefColor || ctx.theme?.colors?.accent1 };

      let fill = await parseFill(spPr, shapeCtx);
      if (!fill && layoutTpl?.spPr) fill = await parseFill(layoutTpl.spPr, shapeCtx);
      if (!fill && masterTpl?.spPr) fill = await parseFill(masterTpl.spPr, shapeCtx);
      if (!fill && fillRefColor) fill = { type: 'solid', color: fillRefColor };

      let line = await parseLine(spPr, shapeCtx);
      if (!line && styleEl) {
        const lnRef = child(styleEl, 'lnRef');
        if (lnRef && numAttr(lnRef, 'idx', 0) > 0) {
          const lnCol = resolveColorFromContainer(lnRef, shapeCtx);
          if (lnCol) line = { widthPx: 1, color: lnCol, dash: 'solid' };
        }
      }

      const shadow = parseShadow(spPr, shapeCtx);
      const geometry = parseGeometry(spPr);

      // 合并四级文本样式继承链
      const txStyleKind = ['title', 'ctrTitle'].includes(phType)
        ? masterTxStyles.titleStyle
        : isPh
        ? masterTxStyles.bodyStyle
        : masterTxStyles.otherStyle;

      const inheritedLevels = mergeLevelStyleMaps(
        defaultTextLevels,
        txStyleKind || {},
        masterTpl?.lstStyle || {},
        layoutTpl?.lstStyle || {}
      );

      const txBody = child(node, 'txBody');
      const text = txBody ? parseTextBody(txBody, inheritedLevels, shapeCtx, slideNumber) : null;

      elements.push({
        type: 'shape',
        spid,
        name: name || (isPh ? `占位符:${phType}` : '图形'),
        placeholderType: phType || null,
        box,
        geometry,
        fill,
        line,
        shadow,
        text,
        animation: animationsBySpid.get(spid) || null
      });
      continue;
    }

    // 3. 图片 (<p:pic>)
    if (tag === 'pic') {
      const nvPicPr = child(node, 'nvPicPr');
      const cNvPr = child(nvPicPr, 'cNvPr');
      const spid = attr(cNvPr, 'id');
      const name = attr(cNvPr, 'name') || '图片';

      const spPr = child(node, 'spPr');
      const rawXfrm = readXfrm(spPr);
      if (!rawXfrm || rawXfrm.w <= 0 || rawXfrm.h <= 0) continue;

      const box = mapEmuBox(rawXfrm, groupTransform, ctx.slideSizeEmu, ctx.stageW, ctx.stageH);
      const blipFill = child(node, 'blipFill');
      const blip = child(blipFill, 'blip');
      const embedId = relAttr(blip, 'embed');
      let dataUrl = '';
      let mediaPath = '';
      if (embedId && ctx.rels && ctx.rels.has(embedId)) {
        mediaPath = ctx.rels.get(embedId).target;
        dataUrl = (await ctx.zip.getDataUrl(mediaPath)) || '';
      }

      const srcRectEl = child(blipFill, 'srcRect');
      const crop = srcRectEl
        ? {
            l: numAttr(srcRectEl, 'l', 0) / 1000,
            t: numAttr(srcRectEl, 't', 0) / 1000,
            r: numAttr(srcRectEl, 'r', 0) / 1000,
            b: numAttr(srcRectEl, 'b', 0) / 1000
          }
        : null;

      const line = await parseLine(spPr, ctx);
      const shadow = parseShadow(spPr, ctx);
      const geometry = parseGeometry(spPr);

      elements.push({
        type: 'image',
        spid,
        name,
        box,
        geometry,
        dataUrl,
        mediaPath,
        crop,
        line,
        shadow,
        animation: animationsBySpid.get(spid) || null
      });
      continue;
    }

    // 4. 表格与图表 (<p:graphicFrame>)
    if (tag === 'graphicFrame') {
      const xfrmEl = child(node, 'xfrm');
      const off = child(xfrmEl, 'off');
      const ext = child(xfrmEl, 'ext');
      if (!off || !ext) continue;
      const rawXfrm = {
        x: numAttr(off, 'x', 0),
        y: numAttr(off, 'y', 0),
        w: numAttr(ext, 'cx', 0),
        h: numAttr(ext, 'cy', 0),
        rotDeg: 0
      };
      if (rawXfrm.w <= 0 || rawXfrm.h <= 0) continue;
      const box = mapEmuBox(rawXfrm, groupTransform, ctx.slideSizeEmu, ctx.stageW, ctx.stageH);

      const tblEl = findDesc(node, 'tbl');
      if (tblEl) {
        const tableObj = await parseTableElement(tblEl, box, ctx, slideNumber);
        elements.push(tableObj);
        continue;
      }

      const chartEl = findDesc(node, 'chart');
      if (chartEl) {
        const rId = relAttr(chartEl, 'id');
        const chartPath = rId && ctx.rels?.has(rId) ? ctx.rels.get(rId).target : '';
        const chartSummary = chartPath ? await parseChartSummary(chartPath, ctx.zip, ctx.parseXml) : null;
        elements.push({
          type: 'chart',
          name: chartSummary?.title || '嵌入图表',
          box,
          chart: chartSummary
        });
      }
    }
  }

  return elements;
}

// ---------------- 幻灯片动画与切换解析 ----------------

function parseSlideAnimations(slideRoot) {
  const map = new Map();
  const timing = child(slideRoot, 'timing');
  if (!timing) return map;

  let order = 1;
  for (const cTn of findAllDesc(timing, 'cTn')) {
    const presetClass = attr(cTn, 'presetClass');
    const presetID = attr(cTn, 'presetID');
    if (!presetClass) continue;

    const spTgt = findDesc(cTn, 'spTgt');
    const spid = attr(spTgt, 'spid');
    if (!spid) continue;

    const durMs = Number(attr(cTn, 'dur')) || 500;
    const nodeType = attr(cTn, 'nodeType') || 'clickEffect';
    if (!map.has(spid)) {
      map.set(spid, {
        order: order++,
        effectClass: presetClass,
        presetId: presetID || '1',
        durationMs: Math.min(3000, Math.max(150, durMs)),
        trigger: nodeType
      });
    }
  }

  return map;
}

function parseSlideTransition(slideRoot) {
  const tr = child(slideRoot, 'transition');
  if (!tr) return null;
  let effect = 'fade';
  for (const c of children(tr)) {
    if (c.localName !== 'sndAc') {
      effect = c.localName;
      break;
    }
  }
  return {
    effect,
    speed: attr(tr, 'spd') || 'med'
  };
}

// ---------------- 主入口：parsePptxBuffer ----------------

/**
 * 解析上传的 .pptx 二进制数据为高保真结构化演示文稿模型
 * @param {ArrayBuffer|Uint8Array} buffer .pptx 文件二进制内容
 * @param {{ fileName?: string, parseXml?: (xml: string) => Document }} [options]
 * @returns {Promise<object>}
 */
export async function parsePptxBuffer(buffer, options = {}) {
  const fileName = options.fileName || 'presentation.pptx';
  const parseXml = options.parseXml || defaultParseXml;
  const zip = await openZipArchive(buffer);

  const presXmlText = await zip.getText('ppt/presentation.xml');
  if (!presXmlText) {
    throw new Error('无效的 .pptx 文件：缺少 ppt/presentation.xml');
  }
  const presDoc = parseXml(presXmlText);
  const presRoot = presDoc.documentElement;
  const presRels = await readRelsMap(zip, 'ppt/presentation.xml', parseXml);

  // 幻灯片尺寸 (默认 16:9: 12192000 x 6858000 EMU -> 1280 x 720 px)
  const sldSz = child(presRoot, 'sldSz');
  const cx = numAttr(sldSz, 'cx', 12192000);
  const cy = numAttr(sldSz, 'cy', 6858000);
  const slideSizeEmu = { cx, cy };

  const stageW = 1280;
  const rawWpx = cx / EMU_PER_PX;
  const rawHpx = cy / EMU_PER_PX;
  const scale = stageW / rawWpx;
  const stageH = Math.round(rawHpx * scale);
  const ratioLabel = Math.abs(cx / cy - 16 / 9) < 0.08 ? '16:9' : Math.abs(cx / cy - 4 / 3) < 0.08 ? '4:3' : `${Math.round((cx / cy) * 100) / 100}:1`;

  // 解析默认主题与全局文字样式
  let defaultTheme = parseThemeXml(null);
  const firstThemePath = zip.listPaths('ppt/theme/')[0];
  if (firstThemePath) {
    const themeTxt = await zip.getText(firstThemePath);
    if (themeTxt) defaultTheme = parseThemeXml(parseXml(themeTxt));
  }

  const defaultTextLevels = extractLevelStylesMap(child(presRoot, 'defaultTextStyle'), {
    theme: defaultTheme,
    clrMap: parseClrMap(null)
  });

  // 按 sldIdLst 有序收集幻灯片路径
  const slidePaths = [];
  const sldIdLst = child(presRoot, 'sldIdLst');
  if (sldIdLst) {
    for (const sldId of children(sldIdLst, 'sldId')) {
      const rId = relAttr(sldId, 'id');
      if (rId && presRels.has(rId)) {
        slidePaths.push(presRels.get(rId).target);
      }
    }
  }

  if (slidePaths.length === 0) {
    slidePaths.push(...zip.listPaths('ppt/slides/slide').filter((p) => p.endsWith('.xml')).sort());
  }

  // 缓存 Master 与 Layout，避免多页重复解析
  const masterCache = new Map();
  const layoutCache = new Map();

  async function getMaster(masterPath) {
    if (masterCache.has(masterPath)) return masterCache.get(masterPath);
    const mXml = await zip.getText(masterPath);
    if (!mXml) return null;
    const mDoc = parseXml(mXml);
    const mRoot = mDoc.documentElement;
    const mRels = await readRelsMap(zip, masterPath, parseXml);

    let theme = defaultTheme;
    for (const rel of mRels.values()) {
      if (rel.type && rel.type.includes('/theme')) {
        const tTxt = await zip.getText(rel.target);
        if (tTxt) theme = parseThemeXml(parseXml(tTxt));
        break;
      }
    }

    const clrMap = parseClrMap(child(mRoot, 'clrMap'));
    const ctx = { zip, parseXml, rels: mRels, theme, clrMap, slideSizeEmu, stageW, stageH, scale };

    const cSld = child(mRoot, 'cSld');
    const bgEl = child(cSld, 'bg');
    const bgPr = bgEl ? child(bgEl, 'bgPr') : null;
    const bgRef = bgEl ? child(bgEl, 'bgRef') : null;
    let background = bgPr ? await parseFill(bgPr, ctx) : null;
    if (!background && bgRef && numAttr(bgRef, 'idx', 0) > 0) {
      const col = resolveColorFromContainer(bgRef, ctx);
      if (col) background = { type: 'solid', color: col };
    }

    const txStylesEl = child(mRoot, 'txStyles');
    const txStyles = {
      titleStyle: extractLevelStylesMap(child(txStylesEl, 'titleStyle'), ctx),
      bodyStyle: extractLevelStylesMap(child(txStylesEl, 'bodyStyle'), ctx),
      otherStyle: extractLevelStylesMap(child(txStylesEl, 'otherStyle'), ctx)
    };

    const spTree = child(cSld, 'spTree');
    const placeholders = indexPlaceholders(spTree, ctx, 1);

    const masterObj = {
      path: masterPath,
      theme,
      clrMap,
      background,
      txStyles,
      spTree,
      rels: mRels,
      placeholders
    };
    masterCache.set(masterPath, masterObj);
    return masterObj;
  }

  async function getLayout(layoutPath) {
    if (layoutCache.has(layoutPath)) return layoutCache.get(layoutPath);
    const lXml = await zip.getText(layoutPath);
    if (!lXml) return null;
    const lDoc = parseXml(lXml);
    const lRoot = lDoc.documentElement;
    const lRels = await readRelsMap(zip, layoutPath, parseXml);

    let master = null;
    for (const rel of lRels.values()) {
      if (rel.type && rel.type.includes('/slideMaster')) {
        master = await getMaster(rel.target);
        break;
      }
    }

    const theme = master?.theme || defaultTheme;
    const clrMapOvr = child(lRoot, 'clrMapOvr');
    const overrideMapping = clrMapOvr ? child(clrMapOvr, 'overrideClrMapping') : null;
    const clrMap = overrideMapping ? parseClrMap(overrideMapping, master?.clrMap) : master?.clrMap || parseClrMap(null);

    const ctx = { zip, parseXml, rels: lRels, theme, clrMap, slideSizeEmu, stageW, stageH, scale };
    const cSld = child(lRoot, 'cSld');
    const bgEl = child(cSld, 'bg');
    const bgPr = bgEl ? child(bgEl, 'bgPr') : null;
    const background = bgPr ? await parseFill(bgPr, ctx) : null;
    const showMasterSp = attr(lRoot, 'showMasterSp') !== '0';

    const spTree = child(cSld, 'spTree');
    const placeholders = indexPlaceholders(spTree, ctx, 1);

    const layoutObj = {
      path: layoutPath,
      master,
      theme,
      clrMap,
      background,
      showMasterSp,
      spTree,
      rels: lRels,
      placeholders
    };
    layoutCache.set(layoutPath, layoutObj);
    return layoutObj;
  }

  // 逐页解析幻灯片
  const slides = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const slideNumber = i + 1;
    const slidePath = slidePaths[i];
    const sXml = await zip.getText(slidePath);
    if (!sXml) continue;

    const sDoc = parseXml(sXml);
    const sRoot = sDoc.documentElement;
    const sRels = await readRelsMap(zip, slidePath, parseXml);

    let layout = null;
    let notesText = '';
    for (const rel of sRels.values()) {
      if (rel.type && rel.type.includes('/slideLayout')) {
        layout = await getLayout(rel.target);
      } else if (rel.type && rel.type.includes('/notesSlide')) {
        const nXml = await zip.getText(rel.target);
        if (nXml) {
          const nDoc = parseXml(nXml);
          notesText = findAllDesc(nDoc.documentElement, 't')
            .map((t) => t.textContent || '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        }
      }
    }

    const master = layout?.master || null;
    const theme = layout?.theme || defaultTheme;
    const clrMapOvr = child(sRoot, 'clrMapOvr');
    const overrideMapping = clrMapOvr ? child(clrMapOvr, 'overrideClrMapping') : null;
    const clrMap = overrideMapping ? parseClrMap(overrideMapping, layout?.clrMap) : layout?.clrMap || parseClrMap(null);

    const slideCtx = { zip, parseXml, rels: sRels, theme, clrMap, slideSizeEmu, stageW, stageH, scale };
    const cSld = child(sRoot, 'cSld');
    const bgEl = child(cSld, 'bg');
    const bgPr = bgEl ? child(bgEl, 'bgPr') : null;
    const bgRef = bgEl ? child(bgEl, 'bgRef') : null;
    let slideBg = bgPr ? await parseFill(bgPr, slideCtx) : null;
    if (!slideBg && bgRef && numAttr(bgRef, 'idx', 0) > 0) {
      const col = resolveColorFromContainer(bgRef, slideCtx);
      if (col) slideBg = { type: 'solid', color: col };
    }

    const background = slideBg || layout?.background || master?.background || { type: 'solid', color: '#ffffff' };
    const showMasterSp = attr(sRoot, 'showMasterSp') !== '0';

    const layers = [];
    if (showMasterSp && layout?.showMasterSp && master?.spTree) {
      const masterCtx = { ...slideCtx, rels: master.rels, clrMap: master.clrMap };
      const masterElems = await parseShapeTreeElements(master.spTree, masterCtx, {
        onlyNonPlaceholders: true,
        masterTxStyles: master.txStyles,
        defaultTextLevels,
        slideNumber
      });
      masterElems.forEach((e) => (e.fromLayer = 'master'));
      layers.push(...masterElems);
    }

    if (showMasterSp && layout?.spTree) {
      const layoutCtx = { ...slideCtx, rels: layout.rels, clrMap: layout.clrMap };
      const layoutElems = await parseShapeTreeElements(layout.spTree, layoutCtx, {
        onlyNonPlaceholders: true,
        masterPhs: master?.placeholders,
        masterTxStyles: master?.txStyles || {},
        defaultTextLevels,
        slideNumber
      });
      layoutElems.forEach((e) => (e.fromLayer = 'layout'));
      layers.push(...layoutElems);
    }

    const animationsBySpid = parseSlideAnimations(sRoot);
    const transition = parseSlideTransition(sRoot);

    const slideElems = await parseShapeTreeElements(child(cSld, 'spTree'), slideCtx, {
      onlyNonPlaceholders: false,
      layoutPhs: layout?.placeholders,
      masterPhs: master?.placeholders,
      masterTxStyles: master?.txStyles || {},
      defaultTextLevels,
      slideNumber,
      animationsBySpid
    });
    slideElems.forEach((e) => (e.fromLayer = 'slide'));
    layers.push(...slideElems);

    // 提取本页首个标题作为页标签
    const titleElem = layers.find((el) => ['title', 'ctrTitle'].includes(el.placeholderType) && el.text?.plainText);
    const firstTextElem = layers.find((el) => el.text?.plainText);
    const slideTitle = (titleElem?.text?.plainText || firstTextElem?.text?.plainText || `第 ${slideNumber} 页`).split('\n')[0].slice(0, 48);

    slides.push({
      slideNumber,
      slidePath,
      title: slideTitle,
      theme,
      background,
      transition,
      notes: notesText,
      elements: layers
    });
  }

  return {
    fileName,
    slideCount: slides.length,
    stageW,
    stageH,
    ratioLabel,
    slideSizeEmu,
    theme: defaultTheme,
    slides
  };
}
