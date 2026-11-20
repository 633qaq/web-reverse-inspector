/**
 * @file utils/pptx-html-renderer.js
 * @description 将解析后的 PPTX 模型 1:1 渲染为单文件交互式 HTML5 演示文稿
 * 采用基准画布 + 视口自适应等比缩放机制，确保字号、坐标、颜色、图片、表格与矢量图形在任意屏幕下 1:1 保真。
 */

function escHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ptToPx(pt) {
  return Math.round(pt * 1.33333 * 10) / 10;
}

function fillToCssBackground(fill) {
  if (!fill || fill.type === 'none') return 'transparent';
  if (fill.type === 'solid') return fill.color || 'transparent';
  if (fill.type === 'gradient') return fill.css || 'transparent';
  if (fill.type === 'image' && fill.dataUrl) {
    return `url("${fill.dataUrl}") center / 100% 100% no-repeat`;
  }
  return 'transparent';
}

/**
 * 常见 OOXML 预设几何形状到 SVG 多边形/路径的映射 (viewBox 0 0 100 100)
 */
const PRESET_SVG_SHAPES = {
  triangle: 'M 50 0 L 100 100 L 0 100 Z',
  rtTriangle: 'M 0 0 L 100 100 L 0 100 Z',
  diamond: 'M 50 0 L 100 50 L 50 100 L 0 50 Z',
  parallelogram: 'M 20 0 L 100 0 L 80 100 L 0 100 Z',
  trapezoid: 'M 18 0 L 82 0 L 100 100 L 0 100 Z',
  pentagon: 'M 50 0 L 100 38 L 81 100 L 19 100 L 0 38 Z',
  hexagon: 'M 25 0 L 75 0 L 100 50 L 75 100 L 25 100 L 0 50 Z',
  octagon: 'M 30 0 L 70 0 L 100 30 L 100 70 L 70 100 L 30 100 L 0 70 L 0 30 Z',
  rightArrow: 'M 0 28 L 62 28 L 62 6 L 100 50 L 62 94 L 62 72 L 0 72 Z',
  leftArrow: 'M 100 28 L 38 28 L 38 6 L 0 50 L 38 94 L 38 72 L 100 72 Z',
  upArrow: 'M 28 100 L 28 38 L 6 38 L 50 0 L 94 38 L 72 38 L 72 100 Z',
  downArrow: 'M 28 0 L 28 62 L 6 62 L 50 100 L 94 62 L 72 62 L 72 0 Z',
  chevron: 'M 0 0 L 75 0 L 100 50 L 75 100 L 0 100 L 25 50 Z',
  homePlate: 'M 0 0 L 78 0 L 100 50 L 78 100 L 0 100 Z',
  star5: 'M 50 0 L 61.8 36.3 L 100 38.2 L 70.6 61.8 L 80.9 98.2 L 50 77.6 L 19.1 98.2 L 29.4 61.8 L 0 38.2 L 38.2 36.3 Z',
  plus: 'M 32 0 L 68 0 L 68 32 L 100 32 L 100 68 L 68 68 L 68 100 L 32 100 L 32 68 L 0 68 L 0 32 L 32 32 Z'
};

function buildSvgDefsAndFill(fill, uid) {
  if (!fill || fill.type === 'none') return { defs: '', fillAttr: 'none' };
  if (fill.type === 'solid') return { defs: '', fillAttr: fill.color };
  if (fill.type === 'gradient' && Array.isArray(fill.stops) && fill.stops.length > 0) {
    const rad = (((fill.angle ?? 180) - 90) * Math.PI) / 180;
    const x1 = Math.round((0.5 - Math.cos(rad) * 0.5) * 100);
    const y1 = Math.round((0.5 - Math.sin(rad) * 0.5) * 100);
    const x2 = Math.round((0.5 + Math.cos(rad) * 0.5) * 100);
    const y2 = Math.round((0.5 + Math.sin(rad) * 0.5) * 100);
    const stopsHtml = fill.stops
      .map((s) => `<stop offset="${s.pos}%" stop-color="${escHtml(s.color)}"/>`)
      .join('');
    return {
      defs: `<linearGradient id="g_${uid}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">${stopsHtml}</linearGradient>`,
      fillAttr: `url(#g_${uid})`
    };
  }
  return { defs: '', fillAttr: 'none' };
}

function renderTextBodyHtml(textObj) {
  if (!textObj || !Array.isArray(textObj.paragraphs)) return '';
  const hasVisibleText = textObj.paragraphs.some((p) => (p.text || '').trim().length > 0);
  if (!hasVisibleText) return '';

  const justify =
    textObj.vAlign === 'middle' ? 'center' : textObj.vAlign === 'bottom' ? 'flex-end' : 'flex-start';
  const pad = textObj.paddingPx || { l: 6, t: 4, r: 6, b: 4 };

  const pHtml = textObj.paragraphs
    .map((p) => {
      const s = p.style || {};
      const indentPx = (s.level || 0) * 18;
      const pStyle = [
        `text-align:${s.align || 'left'}`,
        `line-height:${s.lineHeight || 1.25}`,
        `margin-top:${ptToPx(s.spaceBeforePt || 0)}px`,
        `margin-bottom:${ptToPx(s.spaceAfterPt || 0)}px`,
        indentPx > 0 ? `padding-left:${indentPx}px` : ''
      ]
        .filter(Boolean)
        .join(';');

      const bulletHtml = s.bullet
        ? `<span style="margin-right:6px;display:inline-block;">${escHtml(s.bullet)}</span>`
        : '';

      const runsHtml = (p.runs || [])
        .map((r) => {
          if (r.text === '\n') return '<br/>';
          const rs = r.style || {};
          const deco = [rs.underline ? 'underline' : '', rs.strike ? 'line-through' : '']
            .filter(Boolean)
            .join(' ');
          const spanStyle = [
            rs.fontFamily ? `font-family:${escHtml(rs.fontFamily)},sans-serif` : '',
            `font-size:${ptToPx(rs.fontSizePt || 14)}px`,
            `font-weight:${rs.bold ? 700 : 400}`,
            rs.italic ? 'font-style:italic' : '',
            deco ? `text-decoration:${deco}` : '',
            rs.letterSpacingPt ? `letter-spacing:${ptToPx(rs.letterSpacingPt)}px` : '',
            rs.color ? `color:${escHtml(rs.color)}` : ''
          ]
            .filter(Boolean)
            .join(';');
          return `<span style="${spanStyle}">${escHtml(r.text)}</span>`;
        })
        .join('');

      return `<div class="ppt-p" style="${pStyle}">${bulletHtml}${runsHtml || '&nbsp;'}</div>`;
    })
    .join('');

  return `<div class="ppt-tx" style="position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;justify-content:${justify};padding:${pad.t}px ${pad.r}px ${pad.b}px ${pad.l}px;word-break:break-word;">${pHtml}</div>`;
}

function renderShapeElement(el, uid) {
  const { box, geometry, fill, line, shadow, text, animation } = el;
  const transforms = [];
  if (box.rotDeg) transforms.push(`rotate(${box.rotDeg}deg)`);
  if (box.flipH) transforms.push('scaleX(-1)');
  if (box.flipV) transforms.push('scaleY(-1)');
  const transformCss = transforms.length ? `transform:${transforms.join(' ')};` : '';

  const animAttr = animation ? `data-anim-order="${animation.order}" style="--anim-dur:${animation.durationMs}ms;"` : '';
  const animClass = animation && animation.effectClass === 'entr' ? ' ppt-anim-entr' : '';

  // 直线 / 连接线
  if (geometry?.kind === 'preset' && (geometry.prst === 'line' || geometry.prst === 'straightConnector1')) {
    const strokeCol = line?.color || fill?.color || '#94a3b8';
    const strokeW = line?.widthPx || 1.5;
    const dashAttr = line?.dash === 'dashed' ? 'stroke-dasharray="6,4"' : line?.dash === 'dotted' ? 'stroke-dasharray="2,3"' : '';
    const isHorizontal = box.hPx <= 2;
    const isVertical = box.wPx <= 2;
    const x2 = isVertical ? 0 : Math.max(1, box.wPx);
    const y2 = isHorizontal ? 0 : Math.max(1, box.hPx);
    return `<div class="ppt-el${animClass}" ${animAttr} style="left:${box.xPx}px;top:${box.yPx}px;width:${Math.max(2, box.wPx)}px;height:${Math.max(2, box.hPx)}px;${transformCss}pointer-events:none;">
      <svg width="100%" height="100%" style="overflow:visible;display:block;"><line x1="0" y1="0" x2="${x2}" y2="${y2}" stroke="${escHtml(strokeCol)}" stroke-width="${strokeW}" ${dashAttr}/></svg>
    </div>`;
  }

  // 自定义矢量路径或特殊预设几何 (用 SVG 背景)
  const useSvg =
    geometry?.kind === 'custom' ||
    (geometry?.kind === 'preset' && PRESET_SVG_SHAPES[geometry.prst]);

  if (useSvg) {
    const { defs, fillAttr } = buildSvgDefsAndFill(fill, uid);
    const strokeAttr = line && line.widthPx > 0 ? escHtml(line.color) : 'none';
    const strokeW = line?.widthPx || 0;
    const dashAttr = line?.dash === 'dashed' ? 'stroke-dasharray="6,4"' : line?.dash === 'dotted' ? 'stroke-dasharray="2,3"' : '';
    const d = geometry.kind === 'custom' ? geometry.d : PRESET_SVG_SHAPES[geometry.prst];
    const vb = geometry.kind === 'custom' ? `0 0 ${geometry.vbW} ${geometry.vbH}` : '0 0 100 100';

    return `<div class="ppt-el${animClass}" ${animAttr} style="left:${box.xPx}px;top:${box.yPx}px;width:${box.wPx}px;height:${box.hPx}px;${transformCss}${shadow ? `filter:drop-shadow(${shadow});` : ''}">
      <svg viewBox="${vb}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;">
        ${defs ? `<defs>${defs}</defs>` : ''}
        <path d="${escHtml(d)}" fill="${fillAttr}" stroke="${strokeAttr}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke" ${dashAttr}/>
      </svg>
      ${renderTextBodyHtml(text)}
    </div>`;
  }

  // 标准矩形 / 圆角矩形 / 椭圆
  let borderRadiusCss = '';
  if (geometry?.prst === 'ellipse') {
    borderRadiusCss = 'border-radius:50%;';
  } else if (geometry?.prst === 'roundRect') {
    const ratio = geometry.adjRatio ?? 0.16667;
    const rPx = Math.round(Math.min(box.wPx, box.hPx) * ratio * 10) / 10;
    borderRadiusCss = `border-radius:${rPx}px;`;
  }

  const bgCss = fillToCssBackground(fill);
  const borderCss =
    line && line.widthPx > 0
      ? `border:${line.widthPx}px ${line.dash || 'solid'} ${escHtml(line.color)};`
      : '';
  const shadowCss = shadow ? `box-shadow:${escHtml(shadow)};` : '';

  return `<div class="ppt-el${animClass}" ${animAttr} style="left:${box.xPx}px;top:${box.yPx}px;width:${box.wPx}px;height:${box.hPx}px;background:${bgCss};${borderRadiusCss}${borderCss}${shadowCss}${transformCss}">
    ${renderTextBodyHtml(text)}
  </div>`;
}

function renderImageElement(el) {
  const { box, dataUrl, crop, geometry, line, shadow, animation } = el;
  if (!dataUrl) return '';

  const transforms = [];
  if (box.rotDeg) transforms.push(`rotate(${box.rotDeg}deg)`);
  if (box.flipH) transforms.push('scaleX(-1)');
  if (box.flipV) transforms.push('scaleY(-1)');
  const transformCss = transforms.length ? `transform:${transforms.join(' ')};` : '';

  let radiusCss = '';
  if (geometry?.prst === 'ellipse') radiusCss = 'border-radius:50%;';
  else if (geometry?.prst === 'roundRect') {
    const rPx = Math.round(Math.min(box.wPx, box.hPx) * (geometry.adjRatio ?? 0.16) * 10) / 10;
    radiusCss = `border-radius:${rPx}px;`;
  }

  const borderCss =
    line && line.widthPx > 0 ? `border:${line.widthPx}px ${line.dash || 'solid'} ${escHtml(line.color)};` : '';
  const shadowCss = shadow ? `box-shadow:${escHtml(shadow)};` : '';
  const animClass = animation && animation.effectClass === 'entr' ? ' ppt-anim-entr' : '';

  // 裁剪映射
  let imgStyle = 'width:100%;height:100%;object-fit:fill;display:block;';
  if (crop && (crop.l || crop.t || crop.r || crop.b)) {
    const visW = Math.max(5, 100 - crop.l - crop.r);
    const visH = Math.max(5, 100 - crop.t - crop.b);
    const scaleX = 100 / visW;
    const scaleY = 100 / visH;
    imgStyle = `position:absolute;width:${(scaleX * 100).toFixed(2)}%;height:${(scaleY * 100).toFixed(2)}%;left:${(
      -crop.l * scaleX
    ).toFixed(2)}%;top:${(-crop.t * scaleY).toFixed(2)}%;max-width:none;display:block;`;
  }

  return `<div class="ppt-el${animClass}" style="left:${box.xPx}px;top:${box.yPx}px;width:${box.wPx}px;height:${box.hPx}px;overflow:hidden;${radiusCss}${borderCss}${shadowCss}${transformCss}">
    <img src="${dataUrl}" alt="${escHtml(el.name || 'image')}" style="${imgStyle}" />
  </div>`;
}

function renderTableElement(el) {
  const { box, colWidthPcts, rows } = el;
  const colgroup = (colWidthPcts || []).map((w) => `<col style="width:${w}%;"/>`).join('');

  const rowsHtml = (rows || [])
    .map((row) => {
      const cellsHtml = (row.cells || [])
        .map((cell) => {
          if (cell.mergedSkip) return '';
          const bg = cell.fill ? fillToCssBackground(cell.fill) : 'transparent';
          const spanAttrs = [
            cell.gridSpan > 1 ? `colspan="${cell.gridSpan}"` : '',
            cell.rowSpan > 1 ? `rowspan="${cell.rowSpan}"` : ''
          ]
            .filter(Boolean)
            .join(' ');
          return `<td ${spanAttrs} style="background:${bg};border:1px solid ${escHtml(
            cell.borderColor || 'rgba(148,163,184,0.35)'
          )};vertical-align:${cell.text?.vAlign || 'middle'};padding:0;">${renderTextBodyHtml(cell.text)}</td>`;
        })
        .join('');
      return `<tr style="height:${row.heightPx || 32}px;">${cellsHtml}</tr>`;
    })
    .join('');

  return `<div class="ppt-el" style="left:${box.xPx}px;top:${box.yPx}px;width:${box.wPx}px;height:${box.hPx}px;">
    <table style="width:100%;height:100%;border-collapse:collapse;table-layout:fixed;">
      ${colgroup ? `<colgroup>${colgroup}</colgroup>` : ''}
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
}

function renderChartElement(el, themeColors) {
  const { box, chart } = el;
  const palette = [
    themeColors?.accent1 || '#38bdf8',
    themeColors?.accent2 || '#f43f5e',
    themeColors?.accent3 || '#10b981',
    themeColors?.accent4 || '#a855f7',
    themeColors?.accent5 || '#f59e0b',
    themeColors?.accent6 || '#06b6d4'
  ];

  const kind = String(chart?.chartKind || 'barChart').toLowerCase();
  const seriesList = Array.isArray(chart?.series) && chart.series.length ? chart.series : [{ name: 'Series 1', categories: ['A', 'B', 'C', 'D'], values: [42, 68, 54, 86] }];
  const ser0 = seriesList[0];
  const vals = ser0?.values?.length ? ser0.values : [42, 68, 54, 86];
  const cats = ser0?.categories?.length ? ser0.categories : vals.map((_, i) => `项 ${i + 1}`);
  let svgInner = '';
  let svgW = 340;
  let svgH = 180;

  if (kind.includes('pie') || kind.includes('doughnut')) {
    // 原生 SVG 饼图 / 环形图
    const total = vals.reduce((acc, v) => acc + Math.max(0, Number(v) || 0), 0) || 1;
    const cx = 96;
    const cy = 90;
    const r = 68;
    const isDoughnut = kind.includes('doughnut');
    let startAngle = -Math.PI / 2;
    const slices = [];
    const legends = [];

    vals.forEach((rawV, i) => {
      const v = Math.max(0, Number(rawV) || 0);
      const frac = v / total;
      const sweep = Math.max(0.001, frac * Math.PI * 2);
      const endAngle = startAngle + sweep;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const largeArc = sweep > Math.PI ? 1 : 0;
      const col = palette[i % palette.length];
      if (frac >= 0.999) {
        slices.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${escHtml(col)}"/>`);
      } else {
        slices.push(
          `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${escHtml(col)}" stroke="#ffffff" stroke-width="1.2"/>`
        );
      }
      const ly = 24 + i * 24;
      if (ly < svgH - 8) {
        const lbl = String(cats[i] || `#${i + 1}`).slice(0, 10);
        const pct = Math.round(frac * 100);
        legends.push(
          `<rect x="190" y="${ly - 9}" width="10" height="10" rx="2" fill="${escHtml(col)}"/><text x="206" y="${ly}" font-size="11" fill="#475569">${escHtml(lbl)} (${pct}%)</text>`
        );
      }
      startAngle = endAngle;
    });

    const hole = isDoughnut ? `<circle cx="${cx}" cy="${cy}" r="34" fill="#ffffff"/>` : '';
    svgInner = `${slices.join('')}${hole}${legends.join('')}`;
  } else if (kind.includes('line') || kind.includes('area')) {
    // 原生 SVG 折线图 / 面积图（支持多系列）
    const allVals = seriesList.flatMap((s) => (s.values || []).map((v) => Number(v) || 0));
    const maxVal = Math.max(...allVals, 1);
    const minVal = Math.min(...allVals, 0);
    const span = Math.max(1, maxVal - minVal);
    const padL = 32;
    const padR = 20;
    const padT = 22;
    const padB = 34;
    const plotW = svgW - padL - padR;
    const plotH = svgH - padT - padB;
    const count = Math.max(2, vals.length);

    const gridLines = [0, 0.5, 1]
      .map((t) => {
        const y = padT + plotH * (1 - t);
        return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${svgW - padR}" y2="${y.toFixed(1)}" stroke="rgba(148,163,184,0.25)" stroke-dasharray="3,3"/>`;
      })
      .join('');

    const seriesSvg = seriesList
      .slice(0, 4)
      .map((ser, sIdx) => {
        const sVals = ser.values?.length ? ser.values : vals;
        const col = palette[sIdx % palette.length];
        const pts = sVals.map((v, i) => {
          const x = padL + (plotW * i) / Math.max(1, count - 1);
          const y = padT + plotH * (1 - ((Number(v) || 0) - minVal) / span);
          return { x, y, v };
        });
        const poly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const areaPath =
          kind.includes('area') && pts.length >= 2
            ? `<polygon points="${padL},${padT + plotH} ${poly} ${pts[pts.length - 1].x.toFixed(1)},${padT + plotH}" fill="${escHtml(col)}" opacity="0.18"/>`
            : '';
        const dots = pts
          .map(
            (p) =>
              `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${escHtml(col)}" stroke="#ffffff" stroke-width="1.2"/>` +
              (sIdx === 0 ? `<text x="${p.x.toFixed(1)}" y="${(p.y - 7).toFixed(1)}" font-size="10" fill="#64748b" text-anchor="middle">${p.v}</text>` : '')
          )
          .join('');
        return `${areaPath}<polyline points="${poly}" fill="none" stroke="${escHtml(col)}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
      })
      .join('');

    const xLabels = cats
      .slice(0, count)
      .map((c, i) => {
        const x = padL + (plotW * i) / Math.max(1, count - 1);
        return `<text x="${x.toFixed(1)}" y="${svgH - 12}" font-size="10" fill="#64748b" text-anchor="middle">${escHtml(String(c || '').slice(0, 8))}</text>`;
      })
      .join('');

    svgInner = `${gridLines}${seriesSvg}${xLabels}`;
  } else {
    // 默认柱状图
    const maxVal = Math.max(...vals.map((v) => Math.abs(v)), 1);
    const barW = Math.max(14, Math.floor(260 / Math.max(1, vals.length)));
    const gap = 14;
    svgW = Math.max(320, vals.length * (barW + gap) + 40);
    svgInner = vals
      .map((v, i) => {
        const h = Math.max(6, Math.round((Math.abs(v) / maxVal) * 120));
        const x = 24 + i * (barW + gap);
        const y = 140 - h;
        const col = palette[i % palette.length];
        const label = String(cats[i] || '').slice(0, 8);
        return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="${escHtml(col)}"/>
          <text x="${x + barW / 2}" y="${y - 6}" font-size="11" fill="#64748b" text-anchor="middle">${v}</text>
          <text x="${x + barW / 2}" y="162" font-size="10" fill="#64748b" text-anchor="middle">${escHtml(label)}</text>`;
      })
      .join('');
  }

  return `<div class="ppt-el" style="left:${box.xPx}px;top:${box.yPx}px;width:${box.wPx}px;height:${box.hPx}px;background:rgba(255,255,255,0.04);border:1px solid rgba(148,163,184,0.28);border-radius:8px;padding:12px;display:flex;flex-direction:column;">
    <div style="font-size:14px;font-weight:700;margin-bottom:6px;color:#334155;">${escHtml(chart?.title || el.name || 'Chart')}</div>
    <svg viewBox="0 0 ${svgW} ${svgH}" style="flex:1;width:100%;height:100%;">${svgInner}</svg>
  </div>`;
}

/**
 * 将 parsePptxBuffer 输出的数据渲染为完整可独立运行的单文件 HTML5 演示文稿
 * @param {object} pptxDoc parsePptxBuffer 返回的模型
 * @param {{ initialSlideIndex?: number, onlySlideIndex?: number | null }} [options]
 * @returns {string}
 */
export function renderPptxToHtmlDeck(pptxDoc, options = {}) {
  const { stageW = 1280, stageH = 720, slides = [], fileName = 'Presentation' } = pptxDoc || {};
  const isEn = String(options.lang || '').toLowerCase().startsWith('en');
  const onlyIdx = typeof options.onlySlideIndex === 'number' ? options.onlySlideIndex : null;
  const targetSlides = onlyIdx !== null && slides[onlyIdx] ? [slides[onlyIdx]] : slides;
  const initialIdx = Math.max(0, Math.min(targetSlides.length - 1, options.initialSlideIndex || 0));

  const deckUi = isEn
    ? {
        htmlLang: 'en',
        titleSuffix: '1:1 HTML Slide Deck',
        prevTitle: 'Previous Slide (←)',
        nextTitle: 'Next Slide (→)',
        selectTitle: 'Jump to slide',
        notesTitle: 'Speaker Notes',
        notesLabel: '📝 Notes',
        fsTitle: 'Fullscreen (F)',
        fsLabel: '⛶ Fullscreen',
        notesPrefix: 'Speaker Notes: ',
        notesEmpty: 'No speaker notes on this slide'
      }
    : {
        htmlLang: 'zh-CN',
        titleSuffix: '1:1 HTML 演示稿',
        prevTitle: '上一页 (←)',
        nextTitle: '下一页 (→)',
        selectTitle: '跳转幻灯片',
        notesTitle: '演讲者备注',
        notesLabel: '📝 备注',
        fsTitle: '全屏演示 (F)',
        fsLabel: '⛶ 全屏',
        notesPrefix: '演讲者备注：',
        notesEmpty: '本页无演讲者备注'
      };

  let shapeUid = 0;

  const slidesHtml = targetSlides
    .map((slide, idx) => {
      const bgCss = fillToCssBackground(slide.background);
      const elementsHtml = (slide.elements || [])
        .map((el) => {
          shapeUid++;
          if (el.type === 'shape') return renderShapeElement(el, `${idx}_${shapeUid}`);
          if (el.type === 'image') return renderImageElement(el);
          if (el.type === 'table') return renderTableElement(el);
          if (el.type === 'chart') return renderChartElement(el, slide.theme?.colors);
          return '';
        })
        .join('\n');

      return `<section class="ppt-slide${idx === initialIdx ? ' is-active' : ''}" data-slide-index="${idx}" data-title="${escHtml(
        slide.title
      )}" data-notes="${escHtml(slide.notes || '')}" style="background:${bgCss};">
        ${elementsHtml}
      </section>`;
    })
    .join('\n');

  const slideOptionsHtml = targetSlides
    .map((s, idx) => `<option value="${idx}" ${idx === initialIdx ? 'selected' : ''}>${s.slideNumber}. ${escHtml(s.title)}</option>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="${deckUi.htmlLang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escHtml(fileName)} — ${deckUi.titleSuffix}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%;
    height: 100%;
    background: #0b0f17;
    color: #f8fafc;
    font-family: "Microsoft YaHei", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow: hidden;
    user-select: text;
  }
  .deck-viewport {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding-bottom: 44px;
  }
  .stage-scaler {
    position: relative;
    width: ${stageW}px;
    height: ${stageH}px;
    transform-origin: center center;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(255, 255, 255, 0.08);
    background: #ffffff;
    overflow: hidden;
    flex-shrink: 0;
  }
  .ppt-slide {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: none;
    overflow: hidden;
  }
  .ppt-slide.is-active {
    display: block;
  }
  .ppt-el {
    position: absolute;
  }
  .ppt-p {
    white-space: pre-wrap;
  }
  @keyframes pptFadeInUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .ppt-slide.is-active .ppt-anim-entr {
    animation: pptFadeInUp var(--anim-dur, 450ms) cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .deck-bar {
    position: fixed;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.9);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(148, 163, 184, 0.25);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    z-index: 99;
    font-size: 12px;
  }
  .deck-btn {
    background: rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .deck-btn:hover { background: rgba(56, 189, 248, 0.22); border-color: rgba(56, 189, 248, 0.5); }
  .deck-select {
    background: rgba(30, 41, 59, 0.9);
    color: #f8fafc;
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 12px;
    max-width: 190px;
    outline: none;
  }
  .notes-drawer {
    position: fixed;
    bottom: 58px;
    left: 50%;
    transform: translateX(-50%);
    width: min(680px, 90vw);
    max-height: 150px;
    overflow-y: auto;
    padding: 12px 16px;
    border-radius: 12px;
    background: rgba(9, 13, 22, 0.94);
    border: 1px solid rgba(56, 189, 248, 0.4);
    font-size: 12.5px;
    line-height: 1.6;
    color: #cbd5e1;
    display: none;
    z-index: 98;
  }
  .notes-drawer.open { display: block; }
  @media (prefers-reduced-motion: reduce) {
    .ppt-slide.is-active .ppt-anim-entr { animation: none; }
  }
</style>
</head>
<body>
  <div class="deck-viewport" id="deckViewport">
    <div class="stage-scaler" id="stageScaler">
      ${slidesHtml}
    </div>
  </div>

  <div class="notes-drawer" id="notesDrawer"></div>

  <div class="deck-bar">
    <button class="deck-btn" id="prevBtn" title="${deckUi.prevTitle}">◀</button>
    <select class="deck-select" id="slideSelect" title="${deckUi.selectTitle}">${slideOptionsHtml}</select>
    <button class="deck-btn" id="nextBtn" title="${deckUi.nextTitle}">▶</button>
    <button class="deck-btn" id="notesBtn" title="${deckUi.notesTitle}">${deckUi.notesLabel}</button>
    <button class="deck-btn" id="fsBtn" title="${deckUi.fsTitle}">${deckUi.fsLabel}</button>
  </div>

  <script>
    const stageW = ${stageW};
    const stageH = ${stageH};
    const notesPrefix = ${JSON.stringify(deckUi.notesPrefix)};
    const notesEmpty = ${JSON.stringify(deckUi.notesEmpty)};
    const viewport = document.getElementById('deckViewport');
    const scaler = document.getElementById('stageScaler');
    const slides = Array.from(document.querySelectorAll('.ppt-slide'));
    const slideSelect = document.getElementById('slideSelect');
    const notesDrawer = document.getElementById('notesDrawer');
    let current = ${initialIdx};

    function fitStage() {
      const vw = Math.max(200, viewport.clientWidth - 16);
      const vh = Math.max(150, viewport.clientHeight - 16);
      const scale = Math.min(vw / stageW, vh / stageH);
      scaler.style.transform = 'scale(' + scale.toFixed(4) + ')';
    }

    function showSlide(index) {
      if (!slides.length) return;
      current = (index + slides.length) % slides.length;
      slides.forEach((s, i) => s.classList.toggle('is-active', i === current));
      if (slideSelect) slideSelect.value = String(current);
      const notes = slides[current]?.dataset?.notes || '';
      notesDrawer.textContent = notes ? notesPrefix + notes : notesEmpty;
    }

    document.getElementById('prevBtn').addEventListener('click', () => showSlide(current - 1));
    document.getElementById('nextBtn').addEventListener('click', () => showSlide(current + 1));
    slideSelect.addEventListener('change', (e) => showSlide(Number(e.target.value)));
    document.getElementById('notesBtn').addEventListener('click', () => notesDrawer.classList.toggle('open'));
    document.getElementById('fsBtn').addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    });

    window.addEventListener('keydown', (e) => {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); showSlide(current + 1); }
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); showSlide(current - 1); }
      else if (e.key.toLowerCase() === 'f') { document.getElementById('fsBtn').click(); }
    });

    window.addEventListener('resize', fitStage);
    fitStage();
    showSlide(current);
  </script>
</body>
</html>`;
}
