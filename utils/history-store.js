/**
 * @file utils/history-store.js
 * @description 零依赖纯原生 IndexedDB 本地历史记录管理与多页 HTML 演示稿拼合工具
 * 自动持久化最近 25 条网页逆向 / AI 生成 / PPTX 解析 / HTML 导入记录，支持一键恢复与多选拼合导出多页 .pptx。
 */

const DB_NAME = 'wri_history_db_v1';
const DB_VERSION = 1;
const STORE_NAME = 'records';
const MAX_RECORDS = 25;

let memoryFallback = [];

function openHistoryDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Open IndexedDB failed'));
  });
}

/**
 * 列出历史记录（按创建时间倒序）
 * @returns {Promise<Array<object>>}
 */
export async function listHistoryRecords() {
  try {
    const db = await openHistoryDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = Array.isArray(req.result) ? req.result : [];
        rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (_err) {
    return [...memoryFallback].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
}

/**
 * 新增或更新一条历史记录，并自动清理超出 MAX_RECORDS 的最旧记录
 */
export async function saveHistoryRecord(record) {
  const item = {
    id: record.id || `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: record.createdAt || Date.now(),
    kind: record.kind || 'web', // 'web' | 'pptx' | 'html' | 'ai'
    title: String(record.title || 'Untitled').slice(0, 80),
    subtitle: String(record.subtitle || '').slice(0, 100),
    thumbnail: typeof record.thumbnail === 'string' ? record.thumbnail : '',
    promptText: typeof record.promptText === 'string' ? record.promptText : '',
    htmlCode: typeof record.htmlCode === 'string' ? record.htmlCode : ''
  };

  try {
    const db = await openHistoryDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // 超出上限时裁剪最旧记录
    const all = await listHistoryRecords();
    if (all.length > MAX_RECORDS) {
      const toRemove = all.slice(MAX_RECORDS);
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        toRemove.forEach((old) => store.delete(old.id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    return item;
  } catch (_err) {
    memoryFallback = [item, ...memoryFallback.filter((r) => r.id !== item.id)].slice(0, MAX_RECORDS);
    return item;
  }
}

/**
 * 删除单条历史记录
 */
export async function deleteHistoryRecord(id) {
  try {
    const db = await openHistoryDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (_err) {
    memoryFallback = memoryFallback.filter((r) => r.id !== id);
  }
}

/**
 * 清空所有历史记录
 */
export async function clearHistoryRecords() {
  try {
    const db = await openHistoryDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (_err) {
    memoryFallback = [];
  }
}

/**
 * 为单页 HTML 片段中的 CSS 规则加上独立作用域前缀，防止多页拼合时样式互相污染
 */
function scopeCssForSlide(cssText = '', scopeSelector = '') {
  if (!cssText.trim() || !scopeSelector) return '';
  // 去掉注释并逐块作用域化（保留 @keyframes 与 @media 原结构）
  const cleaned = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  let i = 0;
  const len = cleaned.length;

  while (i < len) {
    while (i < len && /\s/.test(cleaned[i])) i++;
    if (i >= len) break;

    if (cleaned[i] === '@') {
      const atStart = i;
      while (i < len && cleaned[i] !== '{' && cleaned[i] !== ';') i++;
      if (i < len && cleaned[i] === ';') {
        out += cleaned.slice(atStart, i + 1) + '\n';
        i++;
        continue;
      }
      const header = cleaned.slice(atStart, i).trim();
      let depth = 0;
      const bodyStart = i;
      while (i < len) {
        if (cleaned[i] === '{') depth++;
        else if (cleaned[i] === '}') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      const block = cleaned.slice(bodyStart, i);
      if (/^@media/i.test(header)) {
        const inner = block.slice(1, -1);
        out += `${header} {\n${scopeCssForSlide(inner, scopeSelector)}\n}\n`;
      } else {
        // @keyframes / @font-face 原样保留
        out += `${header} ${block}\n`;
      }
      continue;
    }

    const selStart = i;
    while (i < len && cleaned[i] !== '{') i++;
    if (i >= len) break;
    const rawSelector = cleaned.slice(selStart, i).trim();

    let depth = 0;
    const declStart = i;
    while (i < len) {
      if (cleaned[i] === '{') depth++;
      else if (cleaned[i] === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      i++;
    }
    const declBlock = cleaned.slice(declStart, i);
    if (!rawSelector) continue;

    const scopedSel = rawSelector
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((sel) => {
        if (sel === ':root' || sel === 'html' || sel === 'body' || sel === 'html, body') {
          return scopeSelector;
        }
        if (/^(html|body)\b/i.test(sel)) {
          return sel.replace(/^(html|body)\b/i, scopeSelector);
        }
        return `${scopeSelector} ${sel}`;
      })
      .join(', ');

    out += `${scopedSel} ${declBlock}\n`;
  }

  return out;
}

function escHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 将多条历史记录（HTML 代码或截图）拼合为一份标准 1280×720 多页 HTML5 演示稿，可直接预览并一键导出多页可编辑 .pptx
 * @param {Array<object>} items
 * @param {{ lang?: 'zh'|'en', title?: string }} [options]
 */
export function mergeHistoryItemsIntoDeck(items = [], options = {}) {
  const isEn = String(options.lang || '').toLowerCase().startsWith('en');
  const title = options.title || (isEn ? 'Merged Multi-Slide Deck' : '拼合多页演示文稿');
  const validItems = items.filter((it) => it && (it.htmlCode || it.thumbnail));
  if (validItems.length === 0) {
    throw new Error(isEn ? 'No mergeable HTML or screenshot items selected' : '所选历史记录不含可拼合的 HTML 或截图');
  }

  const scopedStyles = [];
  const slideSections = [];
  const slideOptions = [];

  validItems.forEach((item, idx) => {
    const scopeSel = `.ppt-slide[data-slide-index="${idx}"]`;
    const slideTitle = item.title || `Slide ${idx + 1}`;
    slideOptions.push(`<option value="${idx}" ${idx === 0 ? 'selected' : ''}>${idx + 1}. ${escHtml(slideTitle)}</option>`);

    if (item.htmlCode && item.htmlCode.trim()) {
      const raw = item.htmlCode;
      // 提取全部 <style> 与 <body>
      const styles = [...raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
      if (styles) {
        scopedStyles.push(scopeCssForSlide(styles, scopeSel));
      }
      const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      let bodyHtml = bodyMatch ? bodyMatch[1] : raw;
      // 剔除嵌套的演示稿控制栏与脚本避免互相干扰
      bodyHtml = bodyHtml
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<div[^>]*class="[^"]*\b(deck-bar|notes-drawer)\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');

      // 若本身就是自带 .ppt-slide 的演示稿，激活其首张并展开
      bodyHtml = bodyHtml.replace(/class="([^"]*)\bppt-slide\b([^"]*)"/i, 'class="$1ppt-slide is-active$2" style="display:block;position:relative;width:100%;height:100%;"');

      slideSections.push(
        `<section class="ppt-slide${idx === 0 ? ' is-active' : ''}" data-slide-index="${idx}" data-title="${escHtml(slideTitle)}" style="background:#0f172a;color:#f8fafc;overflow:hidden;">${bodyHtml}</section>`
      );
    } else if (item.thumbnail) {
      slideSections.push(
        `<section class="ppt-slide${idx === 0 ? ' is-active' : ''}" data-slide-index="${idx}" data-title="${escHtml(slideTitle)}" style="background:#0f172a;color:#f8fafc;padding:40px 56px;display:flex;flex-direction:column;gap:20px;">
          <h2 style="font-size:32px;font-weight:700;color:#f8fafc;margin:0;">${escHtml(slideTitle)}</h2>
          <p style="font-size:15px;color:#94a3b8;margin:0;">${escHtml(item.subtitle || '')}</p>
          <div style="flex:1;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.04);border:1px solid rgba(148,163,184,0.22);border-radius:14px;overflow:hidden;padding:12px;">
            <img src="${item.thumbnail}" alt="${escHtml(slideTitle)}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;" />
          </div>
        </section>`
      );
    }
  });

  const deckUi = isEn
    ? { htmlLang: 'en', prev: 'Previous (←)', next: 'Next (→)', fs: '⛶ Fullscreen' }
    : { htmlLang: 'zh-CN', prev: '上一页 (←)', next: '下一页 (→)', fs: '⛶ 全屏' };

  return `<!DOCTYPE html>
<html lang="${deckUi.htmlLang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #0b0f17; overflow: hidden; font-family: "Microsoft YaHei", "PingFang SC", -apple-system, sans-serif; }
  .deck-viewport { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding-bottom: 44px; }
  .stage-scaler { position: relative; width: 1280px; height: 720px; transform-origin: center center; box-shadow: 0 24px 64px rgba(0,0,0,0.72); background: #0f172a; overflow: hidden; flex-shrink: 0; }
  .ppt-slide { position: absolute; inset: 0; width: 1280px; height: 720px; display: none; overflow: hidden; }
  .ppt-slide.is-active { display: block; }
  .deck-bar { position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.28); z-index: 999; }
  .deck-btn { background: rgba(255,255,255,0.08); color: #e2e8f0; border: 1px solid rgba(255,255,255,0.14); border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
  .deck-select { background: rgba(30,41,59,0.95); color: #f8fafc; border: 1px solid rgba(148,163,184,0.28); border-radius: 999px; padding: 4px 10px; font-size: 12px; max-width: 220px; }
  ${scopedStyles.join('\n')}
</style>
</head>
<body>
  <div class="deck-viewport" id="deckViewport">
    <div class="stage-scaler" id="stageScaler">
      ${slideSections.join('\n')}
    </div>
  </div>
  <div class="deck-bar">
    <button class="deck-btn" id="prevBtn" title="${deckUi.prev}">◀</button>
    <select class="deck-select" id="slideSelect">${slideOptions.join('')}</select>
    <button class="deck-btn" id="nextBtn" title="${deckUi.next}">▶</button>
    <button class="deck-btn" id="fsBtn">${deckUi.fs}</button>
  </div>
  <script>
    const viewport = document.getElementById('deckViewport');
    const scaler = document.getElementById('stageScaler');
    const slides = Array.from(document.querySelectorAll('.stage-scaler > .ppt-slide'));
    const sel = document.getElementById('slideSelect');
    let cur = 0;
    function fit() {
      const s = Math.min((viewport.clientWidth - 16) / 1280, (viewport.clientHeight - 16) / 720);
      scaler.style.transform = 'scale(' + Math.max(0.1, s).toFixed(4) + ')';
    }
    function show(i) {
      if (!slides.length) return;
      cur = (i + slides.length) % slides.length;
      slides.forEach((el, idx) => el.classList.toggle('is-active', idx === cur));
      sel.value = String(cur);
    }
    document.getElementById('prevBtn').onclick = () => show(cur - 1);
    document.getElementById('nextBtn').onclick = () => show(cur + 1);
    sel.onchange = (e) => show(Number(e.target.value));
    document.getElementById('fsBtn').onclick = () => document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
    window.addEventListener('keydown', (e) => {
      if (['ArrowRight', 'PageDown'].includes(e.key)) show(cur + 1);
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) show(cur - 1);
    });
    window.addEventListener('resize', fit);
    fit();
    show(0);
  </script>
</body>
</html>`;
}
