/**
 * @file content/cropper.js
 * @description 独立 Shadow DOM 半透明十字准星拖拽选区截图遮罩
 */

(() => {
  if (window.__WRI_CROPPER_LOADED__) return;
  window.__WRI_CROPPER_LOADED__ = true;

  let isCropping = false;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let cropShadowHost = null;
  let cropShadowRoot = null;
  let selectionBox = null;
  let sizeBadge = null;

  /**
   * 创建挂载在独立 Shadow DOM 中的全屏十字准星裁剪遮罩
   */
  function mountCropperOverlay(lang = 'zh') {
    unmountCropperOverlay();
    const isEn = String(lang || window.__WRI_LANG__ || '').toLowerCase().startsWith('en');

    cropShadowHost = document.createElement('div');
    cropShadowHost.id = '__wri-cropper-shadow-host__';
    cropShadowHost.style.cssText = 'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; cursor: crosshair !important; user-select: none !important;';
    cropShadowRoot = cropShadowHost.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = `
      :host { all: initial; }
      .wri-crop-mask {
        position: fixed;
        inset: 0;
        background: rgba(6, 9, 17, 0.42);
        cursor: crosshair;
        user-select: none;
      }
      .wri-crop-banner {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(9, 13, 22, 0.94);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(56, 189, 248, 0.55);
        box-shadow: 0 12px 32px rgba(2, 6, 23, 0.65);
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
      .wri-selection {
        position: fixed;
        border: 2px solid #38bdf8;
        box-shadow: 0 0 0 9999px rgba(6, 9, 17, 0.52), 0 0 20px rgba(56, 189, 248, 0.4);
        background: transparent;
        pointer-events: none;
        display: none;
      }
      .wri-size-badge {
        position: fixed;
        background: rgba(9, 13, 22, 0.95);
        border: 1px solid rgba(56, 189, 248, 0.55);
        color: #7dd3fc;
        font-family: Consolas, Monaco, monospace;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 5px;
        pointer-events: none;
        display: none;
      }
    `;

    const mask = document.createElement('div');
    mask.className = 'wri-crop-mask';

    const banner = document.createElement('div');
    banner.className = 'wri-crop-banner';
    const bannerPrompt = isEn
      ? '📸 Region Crop: Hold left mouse button and drag to select target area'
      : '📸 局部框选截图：按住鼠标左键拖拽框选目标区域';
    const escText = isEn ? 'Esc Cancel' : 'Esc 取消';
    banner.innerHTML = `
      <span>${bannerPrompt}</span>
      <span class="wri-kbd">${escText}</span>
    `;

    selectionBox = document.createElement('div');
    selectionBox.className = 'wri-selection';

    sizeBadge = document.createElement('div');
    sizeBadge.className = 'wri-size-badge';

    mask.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('keydown', onKeyDown, true);

    cropShadowRoot.appendChild(styleEl);
    cropShadowRoot.appendChild(mask);
    cropShadowRoot.appendChild(selectionBox);
    cropShadowRoot.appendChild(sizeBadge);
    cropShadowRoot.appendChild(banner);
    document.documentElement.appendChild(cropShadowHost);
  }

  function unmountCropperOverlay() {
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseup', onMouseUp, true);
    window.removeEventListener('keydown', onKeyDown, true);
    if (cropShadowHost && cropShadowHost.parentNode) {
      cropShadowHost.parentNode.removeChild(cropShadowHost);
    }
    cropShadowHost = null;
    cropShadowRoot = null;
    selectionBox = null;
    sizeBadge = null;
  }

  function onMouseDown(e) {
    if (!isCropping || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    if (selectionBox && sizeBadge) {
      selectionBox.style.display = 'block';
      selectionBox.style.left = `${startX}px`;
      selectionBox.style.top = `${startY}px`;
      selectionBox.style.width = '0px';
      selectionBox.style.height = '0px';
      sizeBadge.style.display = 'block';
    }
  }

  function onMouseMove(e) {
    if (!isCropping || !isDragging || !selectionBox || !sizeBadge) return;
    e.preventDefault();

    const curX = e.clientX;
    const curY = e.clientY;
    const x = Math.min(startX, curX);
    const y = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);

    selectionBox.style.left = `${x}px`;
    selectionBox.style.top = `${y}px`;
    selectionBox.style.width = `${w}px`;
    selectionBox.style.height = `${h}px`;

    sizeBadge.textContent = `${Math.round(w)} × ${Math.round(h)} px (DPR ${window.devicePixelRatio || 1}x)`;
    sizeBadge.style.left = `${Math.max(8, x)}px`;
    sizeBadge.style.top = `${y > 28 ? y - 26 : y + h + 6}px`;
  }

  function onMouseUp(e) {
    if (!isCropping || !isDragging) return;
    e.preventDefault();
    e.stopPropagation();
    isDragging = false;

    const endX = e.clientX;
    const endY = e.clientY;
    const x = Math.round(Math.min(startX, endX));
    const y = Math.round(Math.min(startY, endY));
    const width = Math.round(Math.abs(endX - startX));
    const height = Math.round(Math.abs(endY - startY));

    stopCropper();

    // 若框选区域太小（< 12px），视为误触取消
    if (width < 12 || height < 12) {
      return;
    }

    // 遮罩已移除，此时采集选区内全部可见元素的布局结构
    const region = { x, y, width, height };
    let layout = null;
    let centerTag = 'region';
    let centerHtml = '';
    try {
      if (typeof window.__WRI_SCAN_REGION_LAYOUT__ === 'function') {
        layout = window.__WRI_SCAN_REGION_LAYOUT__(region);
      }
      const centerEl = document.elementFromPoint(x + width / 2, y + height / 2);
      if (centerEl && centerEl.tagName) {
        centerTag =
          centerEl.tagName.toLowerCase() +
          (centerEl.className && typeof centerEl.className === 'string'
            ? '.' + centerEl.className.trim().split(/\s+/)[0]
            : '');
        centerHtml =
          typeof window.__WRI_EXTRACT_FOLDED_HTML__ === 'function'
            ? window.__WRI_EXTRACT_FOLDED_HTML__(centerEl, 1500)
            : (centerEl.outerHTML || '').slice(0, 800);
      }
    } catch (err) {
      console.warn('[WRI Cropper] 区域布局采集失败:', err);
    }

    const payload = {
      captureMode: 'cropper',
      timestamp: new Date().toISOString(),
      pageUrl: window.location.href,
      pageTitle: document.title,
      tagName: `选区 (中心元素 ${centerTag})`,
      boundingBox: {
        x,
        y,
        width,
        height,
        dpr: window.devicePixelRatio || 1
      },
      layout,
      html: centerHtml,
      computedStyles: {},
      keyframes: '',
      corsStyleHrefs: []
    };

    // 等待 70ms 确保遮罩完全从渲染帧消失，再通知后台调用 captureVisibleTab
    setTimeout(() => {
      try {
        chrome.runtime.sendMessage({
          type: 'CONTENT_CAPTURE_COMPLETE',
          payload
        });
      } catch (err) {
        console.warn('[WRI Cropper] 发送截图框选坐标失败:', err);
      }
    }, 70);
  }

  function onKeyDown(e) {
    if (!isCropping) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      stopCropper();
      try {
        chrome.runtime.sendMessage({ type: 'CONTENT_CAPTURE_CANCELLED' });
      } catch (_err) {
        // ignore
      }
    }
  }

  function startCropper(lang = 'zh') {
    stopCropper();
    isCropping = true;
    isDragging = false;
    window.__WRI_LANG__ = String(lang || '').toLowerCase().startsWith('en') ? 'en' : 'zh';
    mountCropperOverlay(window.__WRI_LANG__);
  }

  function stopCropper() {
    isCropping = false;
    isDragging = false;
    unmountCropperOverlay();
  }

  window.__WRI_START_CROPPER__ = startCropper;
  window.__WRI_STOP_CROPPER__ = stopCropper;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message?.type === 'ACTIVATE_CROPPER') {
        startCropper(message.lang || 'zh');
        sendResponse({ ok: true });
        return true;
      }
      if (message?.type === 'DEACTIVATE_ALL') {
        stopCropper();
        sendResponse({ ok: true });
        return true;
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
    return false;
  });
})();
