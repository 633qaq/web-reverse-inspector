/**
 * @file utils/html-slide-extractor.js
 * @description Sandbox 隔离环境 DOM 真实排版测量探针与通信桥接器
 * 特性：
 * 1. 完全兼容 Chrome MV3 CSP 与 iframe[sandbox="allow-scripts"]，通过 postMessage 安全通信（带超时容错）。
 * 2. 仅在挂载 Sandbox 预览时临时注入探针，绝不污染用户复制或导出的纯净 .html 源码。
 * 3. 自动识别多页演示稿（.ppt-slide / .slide / section 等）与单页页面，自动消除预览缩放并还原真实逻辑坐标。
 * 4. 提取原生可编辑文本（含行内富文本 Run、中英文字体、对齐、行距）、纯色/多色标线性渐变、圆角/边框/外阴影/旋转、
 *    原生合并表格、图片（含 object-fit 裁剪），并将 <svg> 与 <canvas> 2x 超清透明底光栅化嵌入保真。
 */

export const PROBE_REQ_TYPE = 'WRI_EXPORT_SLIDES_REQ';
export const PROBE_RES_TYPE = 'WRI_EXPORT_SLIDES_RES';
const PROBE_MARKER = '/* __WRI_SANDBOX_EXPORT_PROBE__ */';

/**
 * 构建注入 Sandbox iframe 的自包含测量探针脚本源码（零外部依赖）
 * 注意：返回的字符串严禁包含字面量 "</script"，确保安全嵌入 HTML <script> 标签。
 */
function buildProbeScriptSource() {
  return `
${PROBE_MARKER}
(function () {
  if (window.__WRI_PPTX_PROBE_INSTALLED__) return;
  window.__WRI_PPTX_PROBE_INSTALLED__ = true;

  var REQ_TYPE = '${PROBE_REQ_TYPE}';
  var RES_TYPE = '${PROBE_RES_TYPE}';

  // -------- 通用 CSS 解析工具 --------

  function splitTopLevel(str, sep) {
    var out = [];
    var depth = 0;
    var start = 0;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === sep && depth === 0) {
        out.push(str.slice(start, i).trim());
        start = i + 1;
      }
    }
    var tail = str.slice(start).trim();
    if (tail) out.push(tail);
    return out;
  }

  function extractFuncBody(str, funcName) {
    var idx = str.toLowerCase().indexOf(funcName.toLowerCase() + '(');
    if (idx < 0) return null;
    var openPos = idx + funcName.length;
    var depth = 0;
    for (var i = openPos; i < str.length; i++) {
      if (str[i] === '(') depth++;
      else if (str[i] === ')') {
        depth--;
        if (depth === 0) {
          return str.slice(openPos + 1, i);
        }
      }
    }
    return null;
  }

  function parseRgbaColor(raw) {
    if (!raw || typeof raw !== 'string') return null;
    var s = raw.trim().toLowerCase();
    if (!s || s === 'transparent' || s === 'none') return null;
    if (s.startsWith('#')) {
      var h = s.slice(1);
      if (h.length === 3 || h.length === 4) {
        var r = parseInt(h[0] + h[0], 16);
        var g = parseInt(h[1] + h[1], 16);
        var b = parseInt(h[2] + h[2], 16);
        var a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
        if (a <= 0.002) return null;
        return { color: '#' + toHex2(r) + toHex2(g) + toHex2(b), alpha: a };
      }
      if (h.length === 6 || h.length === 8) {
        var a8 = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
        if (a8 <= 0.002) return null;
        return { color: '#' + h.slice(0, 6).toUpperCase(), alpha: a8 };
      }
    }
    var m = s.match(/^rgba?\\(\\s*([0-9.]+)\\s*[,\\s]\\s*([0-9.]+)\\s*[,\\s]\\s*([0-9.]+)(?:\\s*[,/]\\s*([0-9.]+%?))?\\s*\\)$/);
    if (m) {
      var alpha = 1;
      if (m[4] !== undefined) {
        alpha = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      }
      if (!isFinite(alpha) || alpha <= 0.002) return null;
      return {
        color: '#' + toHex2(Number(m[1])) + toHex2(Number(m[2])) + toHex2(Number(m[3])),
        alpha: Math.max(0, Math.min(1, alpha))
      };
    }
    return null;
  }

  function toHex2(n) {
    var v = Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
    return v.toString(16).padStart(2, '0').toUpperCase();
  }

  function parseGradient(bgImage) {
    if (!bgImage || bgImage === 'none') return null;
    var isLinear = /linear-gradient\\(/i.test(bgImage);
    var isRadial = !isLinear && /radial-gradient\\(/i.test(bgImage);
    if (!isLinear && !isRadial) return null;

    var body = extractFuncBody(bgImage, isLinear ? 'linear-gradient' : 'radial-gradient');
    if (!body) return null;
    var parts = splitTopLevel(body, ',');
    if (parts.length < 2) return null;

    var angle = 180;
    var stopStart = 0;
    var first = parts[0].trim().toLowerCase();

    if (isLinear) {
      if (first.endsWith('deg')) {
        angle = parseFloat(first);
        stopStart = 1;
      } else if (first.endsWith('turn')) {
        angle = parseFloat(first) * 360;
        stopStart = 1;
      } else if (first.endsWith('rad')) {
        angle = (parseFloat(first) * 180) / Math.PI;
        stopStart = 1;
      } else if (first.startsWith('to ')) {
        var dirMap = {
          'to top': 0,
          'to top right': 45, 'to right top': 45,
          'to right': 90,
          'to bottom right': 135, 'to right bottom': 135,
          'to bottom': 180,
          'to bottom left': 225, 'to left bottom': 225,
          'to left': 270,
          'to top left': 315, 'to left top': 315
        };
        angle = dirMap[first.replace(/\\s+/g, ' ')] ?? 180;
        stopStart = 1;
      }
    } else {
      // radial-gradient 首参可能是形状/位置声明（无颜色）
      if (!parseColorTokenFromStop(parts[0]).parsed) {
        stopStart = 1;
      }
    }

    var rawStops = [];
    for (var i = stopStart; i < parts.length; i++) {
      var info = parseColorTokenFromStop(parts[i]);
      if (info.parsed) {
        rawStops.push({
          color: info.parsed.color,
          alpha: info.parsed.alpha,
          pos: info.pos
        });
      }
    }
    if (rawStops.length < 2) return null;

    // 填充缺失的百分比位置
    if (rawStops[0].pos === null) rawStops[0].pos = 0;
    if (rawStops[rawStops.length - 1].pos === null) rawStops[rawStops.length - 1].pos = 100;
    for (var j = 1; j < rawStops.length - 1; j++) {
      if (rawStops[j].pos === null) {
        var prevIdx = j - 1;
        var nextIdx = j + 1;
        while (nextIdx < rawStops.length && rawStops[nextIdx].pos === null) nextIdx++;
        var span = nextIdx - prevIdx;
        var p0 = rawStops[prevIdx].pos;
        var p1 = rawStops[nextIdx].pos;
        rawStops[j].pos = p0 + ((p1 - p0) * (j - prevIdx)) / span;
      }
    }

    return {
      kind: 'gradient',
      gradientType: isRadial ? 'radial' : 'linear',
      angle: isFinite(angle) ? angle : 180,
      stops: rawStops
    };
  }

  function parseColorTokenFromStop(stopStr) {
    var s = stopStr.trim();
    var pos = null;
    var pctMatch = s.match(/(-?[0-9.]+)%\\s*$/);
    if (pctMatch) {
      pos = Math.max(0, Math.min(100, parseFloat(pctMatch[1])));
      s = s.slice(0, pctMatch.index).trim();
    } else {
      var pxMatch = s.match(/(-?[0-9.]+)px\\s*$/);
      if (pxMatch) {
        s = s.slice(0, pxMatch.index).trim();
      }
    }
    var parsed = parseRgbaColor(s);
    if (!parsed && s) {
      // 使用临时 canvas 标准化命名颜色
      parsed = resolveNamedColor(s);
    }
    return { parsed: parsed, pos: pos };
  }

  var colorProbeCtx = null;
  function resolveNamedColor(colorStr) {
    try {
      if (!colorProbeCtx) {
        var c = document.createElement('canvas');
        c.width = 1;
        c.height = 1;
        colorProbeCtx = c.getContext('2d');
      }
      colorProbeCtx.clearRect(0, 0, 1, 1);
      colorProbeCtx.fillStyle = '#010203';
      colorProbeCtx.fillStyle = colorStr;
      var norm = colorProbeCtx.fillStyle;
      if (norm === '#010203' && colorStr.toLowerCase() !== '#010203') return null;
      return parseRgbaColor(norm);
    } catch (_e) {
      return null;
    }
  }

  function parseBoxShadow(shadowStr) {
    if (!shadowStr || shadowStr === 'none') return null;
    var layers = splitTopLevel(shadowStr, ',');
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i].trim();
      if (!layer || /\\binset\\b/i.test(layer)) continue;

      // 提取颜色
      var colorMatch = layer.match(/(rgba?\\([^)]+\\)|#[0-9a-fA-F]{3,8})/);
      var parsedColor = colorMatch ? parseRgbaColor(colorMatch[1]) : null;
      var withoutColor = colorMatch ? layer.replace(colorMatch[1], '').trim() : layer;
      var nums = withoutColor.match(/-?[0-9.]+(?=px)/g) || [];
      var xPx = parseFloat(nums[0] || '0') || 0;
      var yPx = parseFloat(nums[1] || '0') || 0;
      var blurPx = Math.max(0, parseFloat(nums[2] || '0') || 0);

      if (parsedColor && (Math.abs(xPx) > 0.2 || Math.abs(yPx) > 0.2 || blurPx > 0.5)) {
        return {
          xPx: xPx,
          yPx: yPx,
          blurPx: blurPx,
          color: parsedColor.color,
          alpha: parsedColor.alpha
        };
      }
    }
    return null;
  }

  function parseTransform2D(transformStr) {
    if (!transformStr || transformStr === 'none') {
      return { rotDeg: 0, scaleX: 1, scaleY: 1, flipH: false, flipV: false };
    }
    var m = transformStr.match(/^matrix\\(([^)]+)\\)$/);
    if (!m) return { rotDeg: 0, scaleX: 1, scaleY: 1, flipH: false, flipV: false };
    var vals = m[1].split(',').map(function (v) { return parseFloat(v.trim()) || 0; });
    var a = vals[0], b = vals[1], c = vals[2], d = vals[3];
    var scaleX = Math.hypot(a, b) || 1;
    var det = a * d - b * c;
    var scaleY = Math.hypot(c, d) || 1;
    var rotDeg = (Math.atan2(b, a) * 180) / Math.PI;
    var flipH = false;
    var flipV = false;
    if (det < 0) {
      // 镜像翻转检测
      if (a < 0 && d > 0) { flipH = true; rotDeg = 0; }
      else if (d < 0 && a > 0) { flipV = true; rotDeg = 0; }
    }
    return { rotDeg: rotDeg, scaleX: scaleX, scaleY: scaleY, flipH: flipH, flipV: flipV };
  }

  function extractCssBgUrl(bgImage) {
    if (!bgImage || bgImage === 'none') return '';
    var m = bgImage.match(/url\\(\\s*["']?([^"')]+)["']?\\s*\\)/i);
    return m ? m[1] : '';
  }

  // -------- 媒体与矢量 2x 光栅化工具 --------

  function loadImageSafe(src, timeoutMs) {
    return new Promise(function (resolve) {
      var img = new Image();
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; resolve(null); }
      }, timeoutMs || 4000);
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        if (!done) { done = true; clearTimeout(timer); resolve(img); }
      };
      img.onerror = function () {
        if (!done) { done = true; clearTimeout(timer); resolve(null); }
      };
      img.src = src;
    });
  }

  async function urlToPngDataUrl(src, targetW, targetH, warnings) {
    if (!src) return null;
    if (/^data:image\\/(png|jpeg|jpg|gif);base64,/i.test(src)) {
      return src;
    }
    var img = await loadImageSafe(src, 4000);
    if (!img) {
      warnings.push('部分外部图片因跨域或加载失败未能内嵌');
      return null;
    }
    try {
      var w = Math.max(1, Math.min(2560, Math.round(targetW || img.naturalWidth || 300)));
      var h = Math.max(1, Math.min(2560, Math.round(targetH || img.naturalHeight || 200)));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/png');
    } catch (_err) {
      warnings.push('检测到受 CORS 保护的外链图片，无法导出为离线媒体');
      return null;
    }
  }

  async function extractImgElement(imgEl, box, rasterScale, warnings) {
    var src = imgEl.currentSrc || imgEl.getAttribute('src') || '';
    var cs = window.getComputedStyle(imgEl);
    var objectFit = (cs.objectFit || 'fill').toLowerCase();
    var natW = imgEl.naturalWidth || 0;
    var natH = imgEl.naturalHeight || 0;

    var crop = null;
    var drawBox = { xPx: box.xPx, yPx: box.yPx, wPx: box.wPx, hPx: box.hPx, rotDeg: box.rotDeg, flipH: box.flipH, flipV: box.flipV };

    if (natW > 0 && natH > 0 && box.wPx > 1 && box.hPx > 1) {
      var imgRatio = natW / natH;
      var boxRatio = box.wPx / box.hPx;

      if (objectFit === 'cover') {
        if (imgRatio > boxRatio + 0.01) {
          var visibleFracW = boxRatio / imgRatio;
          var trimPctX = ((1 - visibleFracW) / 2) * 100;
          crop = { l: trimPctX, r: trimPctX, t: 0, b: 0 };
        } else if (boxRatio > imgRatio + 0.01) {
          var visibleFracH = imgRatio / boxRatio;
          var trimPctY = ((1 - visibleFracH) / 2) * 100;
          crop = { l: 0, r: 0, t: trimPctY, b: trimPctY };
        }
      } else if (objectFit === 'contain') {
        if (imgRatio > boxRatio + 0.01) {
          var fitH = box.wPx / imgRatio;
          drawBox.yPx += (box.hPx - fitH) / 2;
          drawBox.hPx = fitH;
        } else if (boxRatio > imgRatio + 0.01) {
          var fitW = box.hPx * imgRatio;
          drawBox.xPx += (box.wPx - fitW) / 2;
          drawBox.wPx = fitW;
        }
      }
    }

    var dataUrl = null;
    if (/^data:image\\/(png|jpeg|jpg|gif);base64,/i.test(src)) {
      dataUrl = src;
    } else if (imgEl.complete && natW > 0) {
      try {
        var cw = Math.max(1, Math.min(2560, Math.round(Math.max(natW, drawBox.wPx * rasterScale))));
        var ch = Math.max(1, Math.min(2560, Math.round(Math.max(natH, drawBox.hPx * rasterScale))));
        var c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        var ctx = c.getContext('2d');
        ctx.drawImage(imgEl, 0, 0, cw, ch);
        dataUrl = c.toDataURL('image/png');
      } catch (_err) {
        dataUrl = await urlToPngDataUrl(src, drawBox.wPx * rasterScale, drawBox.hPx * rasterScale, warnings);
      }
    } else {
      dataUrl = await urlToPngDataUrl(src, drawBox.wPx * rasterScale, drawBox.hPx * rasterScale, warnings);
    }

    return { dataUrl: dataUrl, box: drawBox, crop: crop };
  }

  async function rasterizeSvgToPng(svgEl, box, rasterScale, warnings) {
    try {
      var clone = svgEl.cloneNode(true);
      var cs = window.getComputedStyle(svgEl);
      var w = Math.max(2, Math.round(box.wPx));
      var h = Math.max(2, Math.round(box.hPx));

      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      clone.setAttribute('width', String(w));
      clone.setAttribute('height', String(h));
      if (!clone.getAttribute('viewBox')) {
        clone.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      }
      if (!clone.style.fontFamily) {
        clone.style.fontFamily = cs.fontFamily || 'Microsoft YaHei, sans-serif';
      }
      if (!clone.style.color) {
        clone.style.color = cs.color || '#0f172a';
      }

      // 将 currentColor 固化为真实颜色，避免脱离子文档后丢失
      var allNodes = clone.querySelectorAll('*');
      var origNodes = svgEl.querySelectorAll('*');
      for (var i = 0; i < allNodes.length && i < origNodes.length; i++) {
        var ocs = window.getComputedStyle(origNodes[i]);
        if (allNodes[i].getAttribute('stroke') === 'currentColor') {
          allNodes[i].setAttribute('stroke', ocs.stroke || ocs.color || '#000000');
        }
        if (allNodes[i].getAttribute('fill') === 'currentColor') {
          allNodes[i].setAttribute('fill', ocs.fill || ocs.color || '#000000');
        }
      }

      var xmlStr = new XMLSerializer().serializeToString(clone);
      var svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xmlStr);
      var img = await loadImageSafe(svgDataUrl, 3000);
      if (!img) {
        // UTF-8 Base64 二次兜底
        var b64 = btoa(unescape(encodeURIComponent(xmlStr)));
        img = await loadImageSafe('data:image/svg+xml;base64,' + b64, 3000);
      }
      if (!img) return null;

      var scale = Math.min(3, Math.max(1.5, rasterScale || 2));
      var canvas = document.createElement('canvas');
      canvas.width = Math.min(2560, Math.max(2, Math.round(w * scale)));
      canvas.height = Math.min(2560, Math.max(2, Math.round(h * scale)));
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    } catch (_err) {
      warnings.push('部分 SVG 图形未能光栅化');
      return null;
    }
  }

  function captureCanvasToPng(canvasEl, warnings) {
    try {
      return canvasEl.toDataURL('image/png');
    } catch (_err) {
      warnings.push('检测到受跨域保护或不可读取的 Canvas 画布');
      return null;
    }
  }

  // -------- DOM 样式与几何读取 --------

  function extractFillFromStyle(cs) {
    var grad = parseGradient(cs.backgroundImage);
    if (grad) return grad;
    var solid = parseRgbaColor(cs.backgroundColor);
    if (solid) return { kind: 'solid', color: solid.color, alpha: solid.alpha };
    return { kind: 'none' };
  }

  function extractStrokeFromStyle(cs) {
    var wTop = parseFloat(cs.borderTopWidth) || 0;
    var wRight = parseFloat(cs.borderRightWidth) || 0;
    var wBottom = parseFloat(cs.borderBottomWidth) || 0;
    var wLeft = parseFloat(cs.borderLeftWidth) || 0;
    var maxW = Math.max(wTop, wRight, wBottom, wLeft);
    if (maxW <= 0.1) return null;

    var sideStyle =
      wTop >= maxW ? cs.borderTopStyle :
      wLeft >= maxW ? cs.borderLeftStyle :
      wBottom >= maxW ? cs.borderBottomStyle : cs.borderRightStyle;
    if (!sideStyle || sideStyle === 'none' || sideStyle === 'hidden') return null;

    var sideColor =
      wTop >= maxW ? cs.borderTopColor :
      wLeft >= maxW ? cs.borderLeftColor :
      wBottom >= maxW ? cs.borderBottomColor : cs.borderRightColor;
    var parsed = parseRgbaColor(sideColor);
    if (!parsed) return null;

    return {
      color: parsed.color,
      alpha: parsed.alpha,
      widthPx: maxW,
      dash: sideStyle === 'dashed' ? 'dashed' : sideStyle === 'dotted' ? 'dotted' : 'solid',
      perSide: { top: wTop, right: wRight, bottom: wBottom, left: wLeft }
    };
  }

  function isSingleSideAccentBorder(stroke) {
    if (!stroke || !stroke.perSide) return null;
    var p = stroke.perSide;
    var nonZero = [];
    if (p.top > 0.2) nonZero.push('top');
    if (p.right > 0.2) nonZero.push('right');
    if (p.bottom > 0.2) nonZero.push('bottom');
    if (p.left > 0.2) nonZero.push('left');
    return nonZero.length === 1 ? nonZero[0] : null;
  }

  function extractGeometryFromStyle(cs, box) {
    var tl = parseFloat(cs.borderTopLeftRadius) || 0;
    var tr = parseFloat(cs.borderTopRightRadius) || 0;
    var br = parseFloat(cs.borderBottomRightRadius) || 0;
    var bl = parseFloat(cs.borderBottomLeftRadius) || 0;
    var r = (tl + tr + br + bl) / 4;
    var minSide = Math.min(box.wPx || 0, box.hPx || 0);
    if (r >= minSide / 2 - 1 && Math.abs((box.wPx || 0) - (box.hPx || 0)) <= 2 && minSide > 2) {
      return { preset: 'ellipse', radiusPx: r };
    }
    if (r > 0.5) {
      return { preset: 'roundRect', radiusPx: r };
    }
    return { preset: 'rect', radiusPx: 0 };
  }

  function getLogicalBox(el, ctx) {
    var rect = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    var tf = parseTransform2D(cs.transform);

    var wPx = rect.width / ctx.scaleX;
    var hPx = rect.height / ctx.scaleY;
    var xPx = (rect.left - ctx.stageLeft) / ctx.scaleX;
    var yPx = (rect.top - ctx.stageTop) / ctx.scaleY;

    // 若元素存在自身旋转，利用未旋转中心点 + offsetWidth/Height 精确还原原矩形
    if (Math.abs(tf.rotDeg) > 0.2 && el.offsetWidth > 0 && el.offsetHeight > 0) {
      var cx = (rect.left + rect.right) / 2;
      var cy = (rect.top + rect.bottom) / 2;
      var origW = el.offsetWidth * tf.scaleX;
      var origH = el.offsetHeight * tf.scaleY;
      wPx = origW;
      hPx = origH;
      xPx = (cx - ctx.stageLeft) / ctx.scaleX - origW / 2;
      yPx = (cy - ctx.stageTop) / ctx.scaleY - origH / 2;
    }

    return {
      xPx: Math.round(xPx * 100) / 100,
      yPx: Math.round(yPx * 100) / 100,
      wPx: Math.round(wPx * 100) / 100,
      hPx: Math.round(hPx * 100) / 100,
      rotDeg: Math.round(tf.rotDeg * 10) / 10,
      flipH: tf.flipH,
      flipV: tf.flipV
    };
  }

  // -------- 富文本段落与 Run 精确提取 --------

  var BLOCK_TAGS = {
    DIV: 1, P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
    LI: 1, UL: 1, OL: 1, BLOCKQUOTE: 1, PRE: 1, HEADER: 1, FOOTER: 1, SECTION: 1, ARTICLE: 1
  };

  function hasVisualBox(el) {
    var cs = window.getComputedStyle(el);
    var fill = extractFillFromStyle(cs);
    if (fill.kind !== 'none') return true;
    if (extractCssBgUrl(cs.backgroundImage)) return true;
    var stroke = extractStrokeFromStyle(cs);
    if (stroke && stroke.widthPx > 0.2) return true;
    if (parseBoxShadow(cs.boxShadow)) return true;
    return false;
  }

  function isHiddenEl(el, cs) {
    if (!cs) cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    if (parseFloat(cs.opacity) < 0.01) return true;
    return false;
  }

  function isIgnoredControlEl(el, slideRoot) {
    if (!el || el.nodeType !== 1) return true;
    var tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' || tag === 'META' || tag === 'LINK') {
      return true;
    }
    if (el.hasAttribute('data-wri-ignore')) return true;
    var cls = typeof el.className === 'string' ? el.className : '';
    if (/\\b(deck-bar|notes-drawer|slide-controls|reveal-controls|nav-controls|pagination)\\b/i.test(cls)) {
      return true;
    }
    if (el !== slideRoot) {
      var cs = window.getComputedStyle(el);
      if (cs.position === 'fixed' && !slideRoot.contains(el)) return true;
    }
    return false;
  }

  /**
   * 判定元素是否可作为“原子文本（或带底色文字卡片）容器”一次性提取，避免拆碎或重影
   */
  function isAtomicTextContainer(el) {
    if (!el || el.nodeType !== 1) return false;
    var textVal = (el.innerText || el.textContent || '').trim();
    if (!textVal) return false;

    // 若包含任何媒体/表格/表单控件，不能作为纯文本容器
    if (el.querySelector('table, img, svg, canvas, video, iframe')) {
      return false;
    }

    var cs = window.getComputedStyle(el);
    // 如果是横向 flex / 多列 grid 且有多个可见元素子节点，分别独立提取（绝不把左右列合并）
    if (el.children.length >= 2) {
      var disp = cs.display || '';
      if (disp.includes('flex') && !cs.flexDirection.startsWith('column')) {
        // 检查可见子元素是否横向排列（y 坐标重叠、x 坐标错开）
        var rects = [];
        for (var k = 0; k < el.children.length; k++) {
          var childEl = el.children[k];
          if (!isHiddenEl(childEl)) {
            var r = childEl.getBoundingClientRect();
            if (r.width > 1 && r.height > 1) rects.push(r);
          }
        }
        if (rects.length >= 2) {
          var firstR = rects[0];
          for (var m = 1; m < rects.length; m++) {
            var overlapY = Math.min(firstR.bottom, rects[m].bottom) - Math.max(firstR.top, rects[m].top);
            if (overlapY > 4 && Math.abs(rects[m].left - firstR.left) > 12) {
              return false;
            }
          }
        }
      }
      if (disp.includes('grid')) {
        var cols = (cs.gridTemplateColumns || '').trim().split(/\\s+/).filter(Boolean);
        if (cols.length > 1) return false;
      }
    }

    // 检查所有后代：如果存在具备自身可见背景/边框/阴影或绝对定位的后代块元素，则不能合并
    var descendants = el.querySelectorAll('*');
    for (var i = 0; i < descendants.length; i++) {
      var d = descendants[i];
      if (d.tagName === 'BR') continue;
      var dcs = window.getComputedStyle(d);
      if (isHiddenEl(d, dcs)) continue;
      if (dcs.position === 'absolute' || dcs.position === 'fixed') return false;
      var isInline = !hasVisualBox(d) && (dcs.display === 'inline' || (dcs.display === 'inline-block' && d.tagName === 'SPAN'));
      if (!isInline && hasVisualBox(d)) return false;
      if (dcs.display.includes('grid')) {
        var gCols = (dcs.gridTemplateColumns || '').trim().split(/\\s+/).filter(Boolean);
        if (gCols.length > 1) return false;
      }
      if (dcs.display.includes('flex') && !dcs.flexDirection.startsWith('column') && d.children.length >= 2) {
        // 仅当子项都是 inline-like 小元素（如 bullet + text）才允许，否则拆开
        var hasBlockChild = false;
        for (var c = 0; c < d.children.length; c++) {
          var ccs = window.getComputedStyle(d.children[c]);
          if (ccs.display !== 'inline' && hasVisualBox(d.children[c])) hasBlockChild = true;
        }
        if (hasBlockChild) return false;
      }
    }
    return true;
  }

  function makeRunFromStyle(text, cs, scaleFont) {
    var fontSizePx = (parseFloat(cs.fontSize) || 14) * (scaleFont || 1);
    var parsedColor = parseRgbaColor(cs.color) || { color: '#000000', alpha: 1 };
    var fw = parseInt(cs.fontWeight, 10);
    var bold = cs.fontWeight === 'bold' || cs.fontWeight === 'bolder' || (isFinite(fw) && fw >= 600);
    var italic = cs.fontStyle === 'italic' || cs.fontStyle === 'oblique';
    var deco = (cs.textDecorationLine || cs.textDecoration || '').toLowerCase();
    var ls = parseFloat(cs.letterSpacing);
    return {
      text: text,
      fontFamily: cs.fontFamily || 'Microsoft YaHei',
      fontSizePx: Math.round(fontSizePx * 100) / 100,
      bold: bold,
      italic: italic,
      underline: deco.includes('underline'),
      strike: deco.includes('line-through'),
      color: parsedColor.color,
      alpha: parsedColor.alpha,
      letterSpacingPx: isFinite(ls) ? ls * (scaleFont || 1) : 0
    };
  }

  function extractParagraphMeta(blockEl, scaleFont) {
    var cs = window.getComputedStyle(blockEl);
    var align = (cs.textAlign || 'left').toLowerCase();
    if (align === 'start') align = 'left';
    if (align === 'end') align = 'right';
    if (!['left', 'center', 'right', 'justify'].includes(align)) align = 'left';

    var fs = parseFloat(cs.fontSize) || 14;
    var lh = parseFloat(cs.lineHeight);
    var lineHeightRatio = isFinite(lh) && fs > 0 ? Math.round((lh / fs) * 100) / 100 : 1.25;
    var spaceBeforePt = Math.max(0, (parseFloat(cs.marginTop) || 0) * 0.75 * (scaleFont || 1));
    var spaceAfterPt = Math.max(0, (parseFloat(cs.marginBottom) || 0) * 0.75 * (scaleFont || 1));
    return {
      align: align,
      lineHeightRatio: Math.max(0.9, Math.min(3.5, lineHeightRatio)),
      spaceBeforePt: Math.round(spaceBeforePt * 10) / 10,
      spaceAfterPt: Math.round(spaceAfterPt * 10) / 10
    };
  }

  function normalizeTextWhitespace(raw, whiteSpaceCss) {
    if (!raw) return '';
    if (whiteSpaceCss && (whiteSpaceCss.includes('pre'))) {
      return raw.replace(/\\u00a0/g, ' ');
    }
    return raw.replace(/[\\r\\n\\t]+/g, ' ').replace(/ {2,}/g, ' ');
  }

  function extractTextBodyFromContainer(containerEl, scaleFont) {
    // 若外层容器仅包裹了一个全尺寸透明排版层（如 .ppt-tx），透传其 padding 与 vAlign
    var layoutTarget = containerEl;
    if (containerEl.children.length === 1) {
      var onlyChild = containerEl.children[0];
      var ocs = window.getComputedStyle(onlyChild);
      if (!hasVisualBox(onlyChild) && (onlyChild.classList.contains('ppt-tx') || ocs.display === 'flex')) {
        layoutTarget = onlyChild;
      }
    }

    var outerCs = window.getComputedStyle(containerEl);
    var targetCs = window.getComputedStyle(layoutTarget);

    // 汇总容器内边距
    var padding = {
      topPx: (parseFloat(outerCs.paddingTop) || 0) + (layoutTarget !== containerEl ? (parseFloat(targetCs.paddingTop) || 0) : 0),
      rightPx: (parseFloat(outerCs.paddingRight) || 0) + (layoutTarget !== containerEl ? (parseFloat(targetCs.paddingRight) || 0) : 0),
      bottomPx: (parseFloat(outerCs.paddingBottom) || 0) + (layoutTarget !== containerEl ? (parseFloat(targetCs.paddingBottom) || 0) : 0),
      leftPx: (parseFloat(outerCs.paddingLeft) || 0) + (layoutTarget !== containerEl ? (parseFloat(targetCs.paddingLeft) || 0) : 0)
    };

    // 判断垂直对齐
    var vAlign = 'top';
    var jc = targetCs.justifyContent || '';
    var ai = targetCs.alignItems || '';
    if (targetCs.display.includes('flex')) {
      if (targetCs.flexDirection.startsWith('column')) {
        if (jc.includes('center')) vAlign = 'middle';
        else if (jc.includes('end')) vAlign = 'bottom';
      } else {
        if (ai.includes('center')) vAlign = 'middle';
        else if (ai.includes('end')) vAlign = 'bottom';
      }
    } else if (targetCs.verticalAlign === 'middle') {
      vAlign = 'middle';
    } else if (targetCs.verticalAlign === 'bottom') {
      vAlign = 'bottom';
    }

    var paragraphs = [];
    var currentP = null;

    function flushParagraph() {
      if (currentP && currentP.runs.length > 0) {
        // 清理首尾冗余空白
        var firstRun = currentP.runs[0];
        var lastRun = currentP.runs[currentP.runs.length - 1];
        firstRun.text = firstRun.text.replace(/^ +/, '');
        lastRun.text = lastRun.text.replace(/ +$/, '');
        currentP.runs = currentP.runs.filter(function (r) { return r.text.length > 0; });
        if (currentP.runs.length > 0) {
          paragraphs.push(currentP);
        }
      }
      currentP = null;
    }

    function ensureParagraph(refEl) {
      if (!currentP) {
        var meta = extractParagraphMeta(refEl || layoutTarget, scaleFont);
        currentP = {
          align: meta.align,
          lineHeightRatio: meta.lineHeightRatio,
          spaceBeforePt: meta.spaceBeforePt,
          spaceAfterPt: meta.spaceAfterPt,
          runs: []
        };
      }
      return currentP;
    }

    function walkText(node, currentBlockEl) {
      if (node.nodeType === 3) {
        var parentEl = node.parentElement || currentBlockEl;
        var pcs = window.getComputedStyle(parentEl);
        if (isHiddenEl(parentEl, pcs)) return;
        var norm = normalizeTextWhitespace(node.nodeValue || '', pcs.whiteSpace);
        if (!norm || (!norm.trim() && (!currentP || currentP.runs.length === 0))) return;
        var p = ensureParagraph(currentBlockEl);
        p.runs.push(makeRunFromStyle(norm, pcs, scaleFont));
        return;
      }

      if (node.nodeType !== 1) return;
      var tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return;
      if (tag === 'BR') {
        var pBr = ensureParagraph(currentBlockEl);
        var bcs = window.getComputedStyle(node.parentElement || currentBlockEl);
        pBr.runs.push(makeRunFromStyle('\\n', bcs, scaleFont));
        return;
      }

      var ncs = window.getComputedStyle(node);
      if (isHiddenEl(node, ncs)) return;

      var isBlock = Boolean(BLOCK_TAGS[tag]) || ncs.display === 'block' || ncs.display === 'list-item' || ncs.display === 'flex' || ncs.display === 'grid';
      var isWrapper = node === layoutTarget || node === containerEl;

      if (isBlock && !isWrapper) {
        flushParagraph();
        // 列表项自动补上项目符号（如 ul/ol li）
        if (tag === 'LI' && ncs.listStyleType && ncs.listStyleType !== 'none') {
          var bullet = ncs.listStyleType === 'decimal' ? (Array.prototype.indexOf.call(node.parentElement?.children || [], node) + 1) + '. ' : '• ';
          var pLi = ensureParagraph(node);
          pLi.runs.push(makeRunFromStyle(bullet, ncs, scaleFont));
        }
        for (var i = 0; i < node.childNodes.length; i++) {
          walkText(node.childNodes[i], node);
        }
        flushParagraph();
      } else {
        for (var j = 0; j < node.childNodes.length; j++) {
          walkText(node.childNodes[j], currentBlockEl);
        }
      }
    }

    walkText(layoutTarget, layoutTarget);
    flushParagraph();

    // 合并相邻完全同样式的 run
    paragraphs.forEach(function (p) {
      var merged = [];
      for (var i = 0; i < p.runs.length; i++) {
        var r = p.runs[i];
        var prev = merged[merged.length - 1];
        if (
          prev &&
          prev.fontFamily === r.fontFamily &&
          prev.fontSizePx === r.fontSizePx &&
          prev.bold === r.bold &&
          prev.italic === r.italic &&
          prev.underline === r.underline &&
          prev.strike === r.strike &&
          prev.color === r.color &&
          prev.alpha === r.alpha &&
          prev.letterSpacingPx === r.letterSpacingPx
        ) {
          prev.text += r.text;
        } else {
          merged.push(r);
        }
      }
      p.runs = merged;
    });

    // 判断是否多行（用于决定是否微扩防折行）
    var isMultiLine = paragraphs.length > 1;
    if (!isMultiLine && paragraphs.length === 1) {
      var fs0 = paragraphs[0].runs[0]?.fontSizePx || 16;
      var contentH = (containerEl.getBoundingClientRect().height || 0) - padding.topPx - padding.bottomPx;
      if (contentH > fs0 * 1.9) isMultiLine = true;
    }

    return {
      text: paragraphs.length > 0 ? { vAlign: vAlign, paragraphs: paragraphs } : null,
      padding: padding,
      isMultiLine: isMultiLine
    };
  }

  // -------- 原生表格 <table> 提取 --------

  function extractTableElement(tableEl, ctx) {
    var box = getLogicalBox(tableEl, ctx);
    var trList = Array.from(tableEl.querySelectorAll('tr')).filter(function (tr) {
      return tr.closest('table') === tableEl && !isHiddenEl(tr);
    });
    if (trList.length === 0) return null;

    // 1. 计算标准矩形网格（完整展开 colspan / rowspan 占位）
    var grid = [];
    var maxCols = 0;

    for (var r = 0; r < trList.length; r++) {
      if (!grid[r]) grid[r] = [];
      var tr = trList[r];
      var cells = Array.from(tr.children).filter(function (c) {
        return (c.tagName === 'TD' || c.tagName === 'TH') && !isHiddenEl(c);
      });
      var colCursor = 0;
      for (var ci = 0; ci < cells.length; ci++) {
        while (grid[r][colCursor]) colCursor++;
        var cellEl = cells[ci];
        var colSpan = Math.max(1, parseInt(cellEl.getAttribute('colspan') || '1', 10) || 1);
        var rowSpan = Math.max(1, parseInt(cellEl.getAttribute('rowspan') || '1', 10) || 1);
        var cellRect = cellEl.getBoundingClientRect();
        var cellCs = window.getComputedStyle(cellEl);
        var fill = extractFillFromStyle(cellCs);
        var extracted = extractTextBodyFromContainer(cellEl, ctx.scaleFont);

        function parseBorder(w, st, col) {
          var wp = parseFloat(w) || 0;
          if (wp <= 0.1 || st === 'none' || st === 'hidden') return null;
          var p = parseRgbaColor(col);
          return p ? { color: p.color, alpha: p.alpha, widthPx: wp } : null;
        }

        var masterCell = {
          gridSpan: colSpan,
          rowSpan: rowSpan,
          hMerge: false,
          vMerge: false,
          widthPx: cellRect.width / ctx.scaleX,
          fill: fill,
          borders: {
            top: parseBorder(cellCs.borderTopWidth, cellCs.borderTopStyle, cellCs.borderTopColor),
            right: parseBorder(cellCs.borderRightWidth, cellCs.borderRightStyle, cellCs.borderRightColor),
            bottom: parseBorder(cellCs.borderBottomWidth, cellCs.borderBottomStyle, cellCs.borderBottomColor),
            left: parseBorder(cellCs.borderLeftWidth, cellCs.borderLeftStyle, cellCs.borderLeftColor)
          },
          padding: extracted.padding,
          text: extracted.text
        };

        for (var dr = 0; dr < rowSpan; dr++) {
          if (!grid[r + dr]) grid[r + dr] = [];
          for (var dc = 0; dc < colSpan; dc++) {
            if (dr === 0 && dc === 0) {
              grid[r + dr][colCursor + dc] = masterCell;
            } else {
              grid[r + dr][colCursor + dc] = {
                gridSpan: 1,
                rowSpan: 1,
                hMerge: dc > 0,
                vMerge: dr > 0,
                fill: fill,
                borders: masterCell.borders,
                padding: { topPx: 0, rightPx: 0, bottomPx: 0, leftPx: 0 },
                text: null
              };
            }
          }
        }
        colCursor += colSpan;
        if (colCursor > maxCols) maxCols = colCursor;
      }
    }

    if (maxCols === 0) return null;

    // 2. 推导每列精确逻辑宽度
    var colWidthsPx = new Array(maxCols).fill(0);
    for (var rr = 0; rr < grid.length; rr++) {
      for (var cc = 0; cc < maxCols; cc++) {
        var cObj = grid[rr][cc];
        if (cObj && !cObj.hMerge && !cObj.vMerge && cObj.gridSpan === 1 && cObj.widthPx > 0) {
          if (colWidthsPx[cc] === 0) colWidthsPx[cc] = cObj.widthPx;
        }
      }
    }
    var knownSum = colWidthsPx.reduce(function (a, b) { return a + b; }, 0);
    var zeroCount = colWidthsPx.filter(function (w) { return w <= 0; }).length;
    if (zeroCount > 0) {
      var fallbackW = Math.max(24, (box.wPx - knownSum) / zeroCount);
      for (var z = 0; z < maxCols; z++) {
        if (colWidthsPx[z] <= 0) colWidthsPx[z] = fallbackW;
      }
    }
    // 按总宽归一化，避免累计误差
    var sumW = colWidthsPx.reduce(function (a, b) { return a + b; }, 0);
    if (sumW > 0 && box.wPx > 0) {
      var ratioW = box.wPx / sumW;
      colWidthsPx = colWidthsPx.map(function (w) { return Math.round(w * ratioW * 100) / 100; });
    }

    // 3. 组装各行
    var rows = trList.map(function (tr, rIdx) {
      var trRect = tr.getBoundingClientRect();
      var rowH = Math.max(16, Math.round((trRect.height / ctx.scaleY) * 100) / 100);
      var rowCells = [];
      for (var c = 0; c < maxCols; c++) {
        rowCells.push(
          grid[rIdx]?.[c] || {
            gridSpan: 1,
            rowSpan: 1,
            hMerge: false,
            vMerge: false,
            fill: { kind: 'none' },
            borders: {},
            padding: { topPx: 4, rightPx: 6, bottomPx: 4, leftPx: 6 },
            text: null
          }
        );
      }
      return { heightPx: rowH, cells: rowCells };
    });

    return {
      type: 'table',
      name: 'Table',
      box: box,
      colWidthsPx: colWidthsPx,
      rows: rows
    };
  }

  // -------- 单页 DOM 深度采集 --------

  async function extractSingleSlide(slideEl, slideIndex, options, warnings) {
    var stageRect = slideEl.getBoundingClientRect();
    var csRoot = window.getComputedStyle(slideEl);

    // 估算当前缩放因子（若本身或祖先有 scale）
    var rawW = slideEl.offsetWidth || stageRect.width || options.targetStageW || 1280;
    var rawH = slideEl.offsetHeight || stageRect.height || options.targetStageH || 720;
    var scaleX = rawW > 0 && stageRect.width > 0 ? stageRect.width / rawW : 1;
    var scaleY = rawH > 0 && stageRect.height > 0 ? stageRect.height / rawH : 1;

    // 防止意外除零
    if (!isFinite(scaleX) || scaleX <= 0.01) scaleX = 1;
    if (!isFinite(scaleY) || scaleY <= 0.01) scaleY = 1;

    var ctx = {
      slideRoot: slideEl,
      stageLeft: stageRect.left,
      stageTop: stageRect.top,
      stageW: rawW,
      stageH: rawH,
      scaleX: scaleX,
      scaleY: scaleY,
      scaleFont: 1,
      rasterScale: options.rasterScale || 2
    };

    // 页面背景解析（优先 slideEl，若透明则向上回退到 stage-scaler / body）
    var bg = extractFillFromStyle(csRoot);
    var bgUrl = extractCssBgUrl(csRoot.backgroundImage);
    if (bgUrl) {
      var bgDataUrl = await urlToPngDataUrl(bgUrl, rawW, rawH, warnings);
      if (bgDataUrl) bg = { kind: 'image', dataUrl: bgDataUrl };
    }
    if (bg.kind === 'none') {
      var parentBgEl = slideEl.parentElement;
      while (parentBgEl && bg.kind === 'none') {
        var pcs = window.getComputedStyle(parentBgEl);
        var pUrl = extractCssBgUrl(pcs.backgroundImage);
        if (pUrl) {
          var pData = await urlToPngDataUrl(pUrl, rawW, rawH, warnings);
          if (pData) { bg = { kind: 'image', dataUrl: pData }; break; }
        }
        var pf = extractFillFromStyle(pcs);
        if (pf.kind !== 'none') { bg = pf; break; }
        parentBgEl = parentBgEl.parentElement;
      }
    }

    var elements = [];
    var stats = { shapeCount: 0, textShapeCount: 0, tableCount: 0, imageCount: 0, svgRasterCount: 0, canvasRasterCount: 0 };

    function pushElement(elObj) {
      if (!elObj || !elObj.box) return;
      if (elObj.box.wPx < 0.5 || elObj.box.hPx < 0.5) return;
      // 过滤完全在画布视野之外的离屏节点
      if (
        elObj.box.xPx + elObj.box.wPx < -20 ||
        elObj.box.yPx + elObj.box.hPx < -20 ||
        elObj.box.xPx > rawW + 20 ||
        elObj.box.yPx > rawH + 20
      ) {
        return;
      }
      elements.push(elObj);
    }

    async function walkElement(el, depth) {
      if (!el || el.nodeType !== 1 || depth > 24) return;
      if (isIgnoredControlEl(el, slideEl)) return;

      var cs = window.getComputedStyle(el);
      if (isHiddenEl(el, cs)) return;

      var rect = el.getBoundingClientRect();
      if (rect.width < 0.5 || rect.height < 0.5) return;

      var box = getLogicalBox(el, ctx);
      var opacity = Math.max(0, Math.min(1, parseFloat(cs.opacity) || 1));

      if (cs.backdropFilter && cs.backdropFilter !== 'none') {
        warnings.push('检测到 CSS backdrop-filter 毛玻璃特效，已转为原生半透明形状保真');
      }

      var tag = el.tagName;

      // 1. 表格原子提取
      if (tag === 'TABLE') {
        var tbl = extractTableElement(el, ctx);
        if (tbl) {
          pushElement(tbl);
          stats.tableCount++;
        }
        return;
      }

      // 2. SVG 2x 高清透明 PNG 光栅化
      if (tag === 'SVG') {
        var svgPng = await rasterizeSvgToPng(el, box, ctx.rasterScale, warnings);
        if (svgPng) {
          pushElement({
            type: 'image',
            sourceKind: 'svg',
            name: 'Vector Graphic',
            box: box,
            dataUrl: svgPng,
            opacity: opacity
          });
          stats.imageCount++;
          stats.svgRasterCount++;
        }
        return;
      }

      // 3. Canvas 抓帧 PNG
      if (tag === 'CANVAS') {
        var canvasPng = captureCanvasToPng(el, warnings);
        if (canvasPng) {
          pushElement({
            type: 'image',
            sourceKind: 'canvas',
            name: 'Canvas Visual',
            box: box,
            dataUrl: canvasPng,
            opacity: opacity
          });
          stats.imageCount++;
          stats.canvasRasterCount++;
        }
        return;
      }

      // 4. 图片 <img>
      if (tag === 'IMG') {
        var imgRes = await extractImgElement(el, box, ctx.rasterScale, warnings);
        if (imgRes.dataUrl) {
          var imgGeom = extractGeometryFromStyle(cs, imgRes.box);
          pushElement({
            type: 'image',
            sourceKind: 'img',
            name: el.getAttribute('alt') || 'Image',
            box: imgRes.box,
            dataUrl: imgRes.dataUrl,
            crop: imgRes.crop,
            opacity: opacity,
            radiusPx: imgGeom.radiusPx,
            isEllipse: imgGeom.preset === 'ellipse',
            stroke: extractStrokeFromStyle(cs),
            shadow: parseBoxShadow(cs.boxShadow)
          });
          stats.imageCount++;
        }
        return;
      }

      // 5. 纯图片包装盒（外层 div 带有圆角/边框/阴影，内部只有一个 <img> 且无文字）
      if (
        el.children.length === 1 &&
        el.children[0].tagName === 'IMG' &&
        !(el.innerText || '').trim()
      ) {
        var innerImg = el.children[0];
        var wrapRes = await extractImgElement(innerImg, box, ctx.rasterScale, warnings);
        if (wrapRes.dataUrl) {
          var wrapGeom = extractGeometryFromStyle(cs, box);
          pushElement({
            type: 'image',
            sourceKind: 'img',
            name: innerImg.getAttribute('alt') || 'Image',
            box: box,
            dataUrl: wrapRes.dataUrl,
            crop: wrapRes.crop,
            opacity: opacity,
            radiusPx: wrapGeom.radiusPx,
            isEllipse: wrapGeom.preset === 'ellipse',
            stroke: extractStrokeFromStyle(cs),
            shadow: parseBoxShadow(cs.boxShadow)
          });
          stats.imageCount++;
          return;
        }
      }

      // 6. 原子文本 / 带底色文字卡片（一步合并提取，彻底防文字重影）
      if (el !== slideEl && isAtomicTextContainer(el)) {
        var fill = extractFillFromStyle(cs);
        var stroke = extractStrokeFromStyle(cs);
        var shadow = parseBoxShadow(cs.boxShadow);
        var geom = extractGeometryFromStyle(cs, box);
        var bgImgUrl = extractCssBgUrl(cs.backgroundImage);

        // 若带背景图，先放底层图片
        if (bgImgUrl) {
          var bgPng = await urlToPngDataUrl(bgImgUrl, box.wPx * ctx.rasterScale, box.hPx * ctx.rasterScale, warnings);
          if (bgPng) {
            pushElement({
              type: 'image',
              sourceKind: 'bg',
              name: 'Card Background',
              box: box,
              dataUrl: bgPng,
              opacity: opacity,
              radiusPx: geom.radiusPx
            });
            stats.imageCount++;
          }
        }

        // 若是单边装饰线（例如 border-left: 4px solid #38bdf8），将其拆为独立色条 + 卡片本体，保证 PPT 视觉完全一致
        var accentSide = isSingleSideAccentBorder(stroke);
        var mainStroke = accentSide ? null : stroke;

        var extractedText = extractTextBodyFromContainer(el, ctx.scaleFont);
        pushElement({
          type: 'shape',
          name: tag + ' TextBox',
          box: box,
          geometry: geom,
          fill: fill,
          stroke: mainStroke,
          shadow: shadow,
          opacity: opacity,
          padding: extractedText.padding,
          text: extractedText.text,
          isMultiLine: extractedText.isMultiLine
        });
        stats.shapeCount++;
        if (extractedText.text) stats.textShapeCount++;

        if (accentSide && stroke) {
          var barBox = makeAccentBarBox(box, accentSide, stroke.widthPx);
          pushElement({
            type: 'shape',
            name: 'Accent Border',
            box: barBox,
            geometry: { preset: 'rect', radiusPx: 0 },
            fill: { kind: 'solid', color: stroke.color, alpha: stroke.alpha },
            stroke: null,
            shadow: null,
            opacity: opacity,
            text: null
          });
          stats.shapeCount++;
        }
        return;
      }

      // 7. 复合布局容器：先绘制自身视觉背景/边框/阴影，再递归子元素
      if (el !== slideEl) {
        var cFill = extractFillFromStyle(cs);
        var cStroke = extractStrokeFromStyle(cs);
        var cShadow = parseBoxShadow(cs.boxShadow);
        var cBgUrl = extractCssBgUrl(cs.backgroundImage);
        var cGeom = extractGeometryFromStyle(cs, box);

        if (cBgUrl) {
          var cBgPng = await urlToPngDataUrl(cBgUrl, box.wPx * ctx.rasterScale, box.hPx * ctx.rasterScale, warnings);
          if (cBgPng) {
            pushElement({
              type: 'image',
              sourceKind: 'bg',
              name: 'Container Image',
              box: box,
              dataUrl: cBgPng,
              opacity: opacity,
              radiusPx: cGeom.radiusPx,
              stroke: cStroke,
              shadow: cShadow
            });
            stats.imageCount++;
          }
        } else if (cFill.kind !== 'none' || cStroke || cShadow) {
          var cAccentSide = isSingleSideAccentBorder(cStroke);
          pushElement({
            type: 'shape',
            name: 'Container Shape',
            box: box,
            geometry: cGeom,
            fill: cFill,
            stroke: cAccentSide ? null : cStroke,
            shadow: cShadow,
            opacity: opacity,
            text: null
          });
          stats.shapeCount++;

          if (cAccentSide && cStroke) {
            pushElement({
              type: 'shape',
              name: 'Accent Border',
              box: makeAccentBarBox(box, cAccentSide, cStroke.widthPx),
              geometry: { preset: 'rect', radiusPx: 0 },
              fill: { kind: 'solid', color: cStroke.color, alpha: cStroke.alpha },
              stroke: null,
              shadow: null,
              opacity: opacity,
              text: null
            });
            stats.shapeCount++;
          }
        }

        // 若复合容器里还混杂直接裸露 TextNode（Mixed Content），用 Range 精确测量其坐标单独提取
        for (var tIdx = 0; tIdx < el.childNodes.length; tIdx++) {
          var cn = el.childNodes[tIdx];
          if (cn.nodeType === 3 && (cn.nodeValue || '').trim()) {
            try {
              var range = document.createRange();
              range.selectNodeContents(cn);
              var tRect = range.getBoundingClientRect();
              if (tRect.width > 1 && tRect.height > 1) {
                var tBox = {
                  xPx: Math.round(((tRect.left - ctx.stageLeft) / ctx.scaleX) * 100) / 100,
                  yPx: Math.round(((tRect.top - ctx.stageTop) / ctx.scaleY) * 100) / 100,
                  wPx: Math.round((tRect.width / ctx.scaleX) * 100) / 100,
                  hPx: Math.round((tRect.height / ctx.scaleY) * 100) / 100,
                  rotDeg: 0
                };
                var run = makeRunFromStyle(cn.nodeValue.trim(), cs, ctx.scaleFont);
                var pMeta = extractParagraphMeta(el, ctx.scaleFont);
                pushElement({
                  type: 'shape',
                  name: 'Inline Text',
                  box: tBox,
                  geometry: { preset: 'rect', radiusPx: 0 },
                  fill: { kind: 'none' },
                  stroke: null,
                  shadow: null,
                  opacity: opacity,
                  padding: { topPx: 0, rightPx: 0, bottomPx: 0, leftPx: 0 },
                  text: {
                    vAlign: 'top',
                    paragraphs: [{
                      align: pMeta.align,
                      lineHeightRatio: pMeta.lineHeightRatio,
                      spaceBeforePt: 0,
                      spaceAfterPt: 0,
                      runs: [run]
                    }]
                  },
                  isMultiLine: false
                });
                stats.shapeCount++;
                stats.textShapeCount++;
              }
            } catch (_rErr) {}
          }
        }
      }

      // 8. 按视觉层叠序（z-index 升序 + 原文档序）遍历子元素
      var orderedChildren = Array.from(el.children).map(function (child, idx) {
        var ccs = window.getComputedStyle(child);
        var zi = parseInt(ccs.zIndex, 10);
        return { child: child, idx: idx, z: isFinite(zi) ? zi : 0 };
      });
      orderedChildren.sort(function (a, b) {
        return a.z !== b.z ? a.z - b.z : a.idx - b.idx;
      });

      for (var k = 0; k < orderedChildren.length; k++) {
        await walkElement(orderedChildren[k].child, depth + 1);
      }
    }

    await walkElement(slideEl, 0);

    return {
      slide: {
        index: slideIndex,
        title: slideEl.getAttribute('data-title') || ('Slide ' + (slideIndex + 1)),
        notes: slideEl.getAttribute('data-notes') || '',
        background: bg,
        elements: elements
      },
      stageW: rawW,
      stageH: rawH,
      stats: stats
    };
  }

  function makeAccentBarBox(box, side, widthPx) {
    var w = Math.max(1, widthPx);
    if (side === 'left') return { xPx: box.xPx, yPx: box.yPx, wPx: w, hPx: box.hPx, rotDeg: box.rotDeg };
    if (side === 'right') return { xPx: box.xPx + box.wPx - w, yPx: box.yPx, wPx: w, hPx: box.hPx, rotDeg: box.rotDeg };
    if (side === 'top') return { xPx: box.xPx, yPx: box.yPx, wPx: box.wPx, hPx: w, rotDeg: box.rotDeg };
    return { xPx: box.xPx, yPx: box.yPx + box.hPx - w, wPx: box.wPx, hPx: w, rotDeg: box.rotDeg };
  }

  // -------- 多页演示稿智能发现与无痕切换测量 --------

  function detectSlideNodes() {
    var selectors = [
      '.ppt-slide',
      '.reveal .slides > section',
      '.slides > section',
      '.deck > section',
      '.presentation > section',
      'section[data-slide]',
      'section[data-slide-index]',
      '[data-slide-index]',
      '[data-slide]',
      '.slide'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var list = Array.from(document.querySelectorAll(selectors[i])).filter(function (el) {
        return !isIgnoredControlEl(el, el) && el.tagName !== 'BUTTON' && el.tagName !== 'INPUT';
      });
      if (list.length > 0) {
        // 排除嵌套子 slide（只保留顶层 slide）
        var topLevel = list.filter(function (el) {
          return !list.some(function (other) { return other !== el && other.contains(el); });
        });
        if (topLevel.length > 0) return topLevel;
      }
    }

    // 检查是否存在多个顶级 <section> 作为分页演示稿
    var sections = Array.from(document.querySelectorAll('main > section, body > section')).filter(function (el) {
      return !isIgnoredControlEl(el, el);
    });
    if (sections.length >= 2) return sections;

    // 单页演示稿：优先取显式舞台容器，否则取 body
    var stage = document.querySelector('#stageScaler, .stage-scaler, .slide-stage, .canvas-stage, main');
    return [stage || document.body];
  }

  async function captureAllSlides(options) {
    var warnings = [];
    var freezeStyle = document.createElement('style');
    freezeStyle.id = '__wri_export_freeze__';
    freezeStyle.textContent = '* { animation-delay: 0s !important; animation-duration: 0.001s !important; transition-duration: 0s !important; }';
    document.head.appendChild(freezeStyle);

    // 若存在 .stage-scaler，临时取消 transform 缩放以获得 100% 原始逻辑像素精度
    var scaler = document.querySelector('#stageScaler, .stage-scaler');
    var prevScalerTransform = scaler ? scaler.style.transform : '';
    if (scaler) {
      scaler.style.transform = 'none';
    }

    var slideNodes = detectSlideNodes();
    var savedStates = slideNodes.map(function (el) {
      return {
        el: el,
        display: el.style.display,
        opacity: el.style.opacity,
        visibility: el.style.visibility,
        zIndex: el.style.zIndex,
        hadActive: el.classList.contains('is-active')
      };
    });

    var slidesOut = [];
    var stageW = options?.targetStageW || 1280;
    var stageH = options?.targetStageH || 720;
    var totalStats = {
      slideCount: 0,
      shapeCount: 0,
      textShapeCount: 0,
      tableCount: 0,
      imageCount: 0,
      svgRasterCount: 0,
      canvasRasterCount: 0
    };

    try {
      for (var i = 0; i < slideNodes.length; i++) {
        var target = slideNodes[i];
        var wasHidden = window.getComputedStyle(target).display === 'none';

        if (wasHidden) {
          target.style.display = 'block';
          target.style.opacity = '1';
          target.style.visibility = 'visible';
          target.style.zIndex = '-1';
        }

        // 等一帧确保布局与样式完全收敛
        await new Promise(function (r) { requestAnimationFrame(function () { r(); }); });

        var res = await extractSingleSlide(target, i, options || {}, warnings);
        if (i === 0 && res.stageW >= 320 && res.stageH >= 200) {
          stageW = Math.round(res.stageW);
          stageH = Math.round(res.stageH);
        }

        slidesOut.push(res.slide);
        totalStats.slideCount++;
        totalStats.shapeCount += res.stats.shapeCount;
        totalStats.textShapeCount += res.stats.textShapeCount;
        totalStats.tableCount += res.stats.tableCount;
        totalStats.imageCount += res.stats.imageCount;
        totalStats.svgRasterCount += res.stats.svgRasterCount;
        totalStats.canvasRasterCount += res.stats.canvasRasterCount;

        if (wasHidden) {
          target.style.display = savedStates[i].display;
          target.style.opacity = savedStates[i].opacity;
          target.style.visibility = savedStates[i].visibility;
          target.style.zIndex = savedStates[i].zIndex;
        }
      }
    } finally {
      // 完整恢复原页面状态，零视觉残留
      for (var j = 0; j < savedStates.length; j++) {
        var st = savedStates[j];
        st.el.style.display = st.display;
        st.el.style.opacity = st.opacity;
        st.el.style.visibility = st.visibility;
        st.el.style.zIndex = st.zIndex;
      }
      if (scaler) {
        scaler.style.transform = prevScalerTransform;
      }
      freezeStyle.remove();
    }

    // 若为窄视口响应式单页（非固定大画布且宽高均偏小），按等比坐标放大到标准 1280 宽屏画布，确保 PowerPoint 内字号和比例舒适
    if (!scaler && stageW > 0 && stageW < 900 && stageH < 900) {
      var upScale = 1280 / stageW;
      stageW = 1280;
      stageH = Math.round(stageH * upScale);
      scaleSlidesGeometry(slidesOut, upScale);
    }

    var uniqueWarnings = Array.from(new Set(warnings));
    return {
      title: (document.title || 'Presentation').replace(/\\s*—\\s*1:1 HTML 演示稿$/, '').trim(),
      stageW: stageW,
      stageH: stageH,
      slides: slidesOut,
      stats: Object.assign({}, totalStats, { warnings: uniqueWarnings })
    };
  }

  function scaleSlidesGeometry(slides, k) {
    slides.forEach(function (slide) {
      (slide.elements || []).forEach(function (el) {
        if (el.box) {
          el.box.xPx = Math.round(el.box.xPx * k * 100) / 100;
          el.box.yPx = Math.round(el.box.yPx * k * 100) / 100;
          el.box.wPx = Math.round(el.box.wPx * k * 100) / 100;
          el.box.hPx = Math.round(el.box.hPx * k * 100) / 100;
        }
        if (el.geometry && el.geometry.radiusPx) el.geometry.radiusPx *= k;
        if (el.radiusPx) el.radiusPx *= k;
        if (el.stroke && el.stroke.widthPx) el.stroke.widthPx *= k;
        if (el.shadow) {
          el.shadow.xPx *= k;
          el.shadow.yPx *= k;
          el.shadow.blurPx *= k;
        }
        if (el.padding) {
          el.padding.topPx *= k;
          el.padding.rightPx *= k;
          el.padding.bottomPx *= k;
          el.padding.leftPx *= k;
        }
        if (el.text && el.text.paragraphs) {
          el.text.paragraphs.forEach(function (p) {
            p.spaceBeforePt *= k;
            p.spaceAfterPt *= k;
            (p.runs || []).forEach(function (r) {
              r.fontSizePx = Math.round(r.fontSizePx * k * 100) / 100;
              if (r.letterSpacingPx) r.letterSpacingPx *= k;
            });
          });
        }
        if (el.type === 'table') {
          el.colWidthsPx = (el.colWidthsPx || []).map(function (w) { return w * k; });
          (el.rows || []).forEach(function (row) {
            row.heightPx *= k;
            (row.cells || []).forEach(function (cell) {
              if (cell.padding) {
                cell.padding.topPx *= k;
                cell.padding.rightPx *= k;
                cell.padding.bottomPx *= k;
                cell.padding.leftPx *= k;
              }
              if (cell.text && cell.text.paragraphs) {
                cell.text.paragraphs.forEach(function (p) {
                  (p.runs || []).forEach(function (r) {
                    r.fontSizePx = Math.round(r.fontSizePx * k * 100) / 100;
                  });
                });
              }
            });
          });
        }
      });
    });
  }

  // -------- postMessage 指令监听 --------
  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || data.type !== REQ_TYPE) return;
    var reqId = data.requestId;

    Promise.resolve()
      .then(function () { return captureAllSlides(data.options || {}); })
      .then(function (model) {
        window.parent.postMessage({ type: RES_TYPE, requestId: reqId, ok: true, model: model }, '*');
      })
      .catch(function (err) {
        window.parent.postMessage(
          { type: RES_TYPE, requestId: reqId, ok: false, error: (err && err.message) || String(err) },
          '*'
        );
      });
  });
})();
`;
}

/**
 * 仅用于 Sandbox 预览挂载：在 HTML 源码末尾无侵入附加测量探针脚本
 * @param {string} rawHtml
 * @returns {string}
 */
export function injectSandboxExportProbe(rawHtml = '') {
  const html = String(rawHtml || '');
  if (!html.trim()) return html;
  if (html.includes(PROBE_MARKER)) return html;

  // 防御性转义，确保脚本中绝不出现闭合标签
  const safeScript = buildProbeScriptSource().replace(/<\/script/gi, '<\\/script');
  const scriptTag = `\n<script>${safeScript}</script>\n`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${scriptTag}</body>`);
  }
  if (/<\/html>/i.test(html)) {
    return html.replace(/<\/html>/i, `${scriptTag}</html>`);
  }
  return html + scriptTag;
}

/**
 * 向 Sandbox iframe 发送排版快照采集请求（带严格来源校验、异常捕获与超时保护）
 * @param {HTMLIFrameElement} iframeEl
 * @param {{ timeoutMs?: number, targetStageW?: number, targetStageH?: number, rasterScale?: number }} [options]
 * @returns {Promise<object>} SlidesExportModel
 */
export function requestSlidesSnapshotFromSandbox(iframeEl, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 20000;

  return new Promise((resolve, reject) => {
    if (!iframeEl || !iframeEl.contentWindow) {
      reject(new Error('Sandbox 预览窗口尚未挂载，请先预览 HTML 演示稿'));
      return;
    }

    const requestId = `wri_pptx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };

    const onMessage = (event) => {
      if (settled) return;
      if (event.source !== iframeEl.contentWindow) return;
      const data = event.data;
      if (!data || data.type !== PROBE_RES_TYPE || data.requestId !== requestId) return;

      settled = true;
      cleanup();
      if (data.ok && data.model) {
        resolve(data.model);
      } else {
        reject(new Error(data.error || 'Sandbox 页面排版测量失败'));
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('采集 HTML 演示稿排版超时（请点击「🔄 重新挂载渲染」后再试）'));
    }, timeoutMs);

    window.addEventListener('message', onMessage);

    try {
      iframeEl.contentWindow.postMessage(
        {
          type: PROBE_REQ_TYPE,
          requestId,
          options: {
            targetStageW: options.targetStageW || 1280,
            targetStageH: options.targetStageH || 720,
            rasterScale: options.rasterScale || 2
          }
        },
        '*'
      );
    } catch (err) {
      settled = true;
      cleanup();
      reject(new Error(`无法向 Sandbox 发送转换指令: ${err?.message || String(err)}`));
    }
  });
}
