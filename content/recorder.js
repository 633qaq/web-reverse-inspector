/**
 * @file content/recorder.js
 * @description 4 秒多节点动态交互录制器 + 四格关键帧分镜抓拍触发器 (Motion Storyboard)
 * 支持同时捕获：
 * 1. DOM/CSS 属性极值变化（如滚动时标题/按钮的 opacity、transform、filter 过渡）
 * 2. 鼠标轨迹 (pointermove) 与页面滚动位移 (scrollY)
 * 3. Canvas / WebGL 舞台在 T=0.15s / 1.4s / 2.65s / 3.9s 四个时间点的真实画面分镜抓拍
 */

(() => {
  window.__WRI_RECORDER_LOADED__ = true;

  const TRACKED_PROPS = [
    'transform',
    'opacity',
    'filter',
    'backdropFilter',
    'clipPath',
    'webkitClipPath',
    'borderRadius',
    'boxShadow',
    'backgroundColor',
    'borderColor',
    'letterSpacing'
  ];

  let recorderShadowHost = null;
  let recorderShadowRoot = null;
  let isRecording = false;

  /**
   * 创建挂载在独立 Shadow DOM 中的顶部极细进度条与右上角录制角标（避免遮挡画面中央特效）
   */
  function createRecorderBanner() {
    removeRecorderBanner();

    recorderShadowHost = document.createElement('div');
    recorderShadowHost.id = '__wri-recorder-shadow-host__';
    recorderShadowHost.style.cssText =
      'all: initial !important; position: fixed !important; inset: 0 !important; pointer-events: none !important; z-index: 2147483646 !important;';
    recorderShadowRoot = recorderShadowHost.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = `
      :host { all: initial; }
      .wri-top-progress {
        position: fixed;
        top: 0;
        left: 0;
        height: 4px;
        width: 0%;
        background: linear-gradient(90deg, #f43f5e, #38bdf8, #a855f7);
        box-shadow: 0 0 12px rgba(244, 63, 94, 0.8);
        transition: width 0.1s linear;
      }
      .wri-rec-pill {
        position: fixed;
        top: 10px;
        right: 14px;
        background: rgba(9, 13, 22, 0.9);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(244, 63, 94, 0.65);
        color: #f8fafc;
        padding: 6px 12px;
        border-radius: 999px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 11px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        pointer-events: none;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      }
      .wri-rec-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #f43f5e;
        box-shadow: 0 0 8px #f43f5e;
        animation: recBlink 0.6s ease-in-out infinite;
      }
      @keyframes recBlink {
        0%, 100% { opacity: 0.35; transform: scale(0.85); }
        50% { opacity: 1; transform: scale(1.2); }
      }
      .wri-rec-timer {
        font-family: monospace;
        color: #fda4af;
        font-weight: 700;
      }
    `;

    const progress = document.createElement('div');
    progress.id = 'wri-rec-progress';
    progress.className = 'wri-top-progress';

    const pill = document.createElement('div');
    pill.id = 'wri-rec-pill';
    pill.className = 'wri-rec-pill';
    pill.innerHTML = `
      <span class="wri-rec-dot"></span>
      <span>🎬 正在抓拍 4 格动态分镜：请移动鼠标并滚动滚轮</span>
      <span id="wri-rec-countdown" class="wri-rec-timer">4.0s</span>
    `;

    recorderShadowRoot.appendChild(styleEl);
    recorderShadowRoot.appendChild(progress);
    recorderShadowRoot.appendChild(pill);
    document.documentElement.appendChild(recorderShadowHost);
  }

  function removeRecorderBanner() {
    if (recorderShadowHost && recorderShadowHost.parentNode) {
      recorderShadowHost.parentNode.removeChild(recorderShadowHost);
    }
    recorderShadowHost = null;
    recorderShadowRoot = null;
  }

  function getShortSelector(el) {
    if (!el || !el.tagName) return 'node';
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id.slice(0, 18)}` : '';
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
    return `${tag}${id}${cls}`;
  }

  function getElementLabel(el) {
    const sel = getShortSelector(el);
    const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (txt && txt.length <= 36) {
      return `${sel} ("${txt}")`;
    }
    return sel;
  }

  /**
   * 评估两个样式快照之间的差异显著度得分
   */
  function computeStyleDeltaScore(initialSnap, currentSnap) {
    let score = 0;
    for (const prop of TRACKED_PROPS) {
      const a = initialSnap[prop] || '';
      const b = currentSnap[prop] || '';
      if (a !== b) {
        score += 12;
        const numsA = (a.match(/-?\d+(\.\d+)?/g) || []).map(Number);
        const numsB = (b.match(/-?\d+(\.\d+)?/g) || []).map(Number);
        const len = Math.min(numsA.length, numsB.length);
        for (let i = 0; i < len; i++) {
          score += Math.abs(numsB[i] - numsA[i]);
        }
      }
    }
    if (Math.abs((currentSnap.rectW || 0) - (initialSnap.rectW || 0)) > 8) score += 20;
    if (Math.abs((currentSnap.rectH || 0) - (initialSnap.rectH || 0)) > 8) score += 20;
    return score;
  }

  /**
   * 读取目标元素的追踪样式与几何尺寸快照
   */
  function readStyleSnapshot(el) {
    const cs = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const snap = {
      rectW: Math.round(r.width),
      rectH: Math.round(r.height),
      rectTop: Math.round(r.top)
    };
    for (const prop of TRACKED_PROPS) {
      snap[prop] = cs[prop] || '';
    }
    snap.inlineStyle = el.getAttribute('style') || '';
    return snap;
  }

  /**
   * 递归收集包含 ShadowRoot 在内的关键节点（标题、按钮、Canvas、视频、容器）
   */
  function collectWatchCandidates(rootEl, maxCount = 55) {
    const out = [rootEl];
    const stack = [document.body || rootEl];
    while (stack.length && out.length < maxCount) {
      const node = stack.pop();
      if (!node || node.nodeType !== 1) continue;
      if (node.id && node.id.startsWith('__wri-')) continue;
      const tag = node.tagName.toLowerCase();
      if (
        ['h1', 'h2', 'h3', 'p', 'a', 'button', 'canvas', 'video', 'section', 'header', 'nav'].includes(tag) ||
        tag.includes('-') ||
        node.hasAttribute('style')
      ) {
        if (!out.includes(node)) out.push(node);
      }
      const kids = [];
      if (node.shadowRoot) kids.push(...node.shadowRoot.children);
      kids.push(...node.children);
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    return out;
  }

  /**
   * 检测选区/页面内的 Canvas / WebGL 舞台信息
   */
  function inspectCanvasLayers(watchedList) {
    const canvases = [];
    for (const el of watchedList) {
      if (!el || !el.tagName) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === 'canvas' || tag.includes('-canvas')) {
        const r = el.getBoundingClientRect();
        if (r.width > 40 && r.height > 40) {
          canvases.push({
            selector: getShortSelector(el),
            size: `${Math.round(r.width)}×${Math.round(r.height)}px`,
            fullViewport: r.width >= window.innerWidth * 0.8 && r.height >= window.innerHeight * 0.7
          });
        }
      }
    }
    return canvases;
  }

  /**
   * 启动 4.0 秒动态交互录制 + 4 帧关键画面分镜抓拍
   */
  function startInteractionRecording(targetEl, baseCaptureData = {}) {
    if (!targetEl || isRecording) return;
    isRecording = true;

    const durationMs = 4000;
    const startTime = performance.now();
    createRecorderBanner();

    // 通知后台清空上一次的分镜帧缓存
    try {
      chrome.runtime.sendMessage({
        type: 'RESET_STORYBOARD_FRAMES',
        boundingBox: baseCaptureData.boundingBox
      });
    } catch (_e) {
      // ignore
    }

    const watchedElements = collectWatchCandidates(targetEl, 55);
    const canvasLayers = inspectCanvasLayers(watchedElements);

    const initialMap = new Map();
    const peakMap = new Map();
    const scoreMap = new Map();

    for (const el of watchedElements) {
      const snap = readStyleSnapshot(el);
      initialMap.set(el, snap);
      peakMap.set(el, { ...snap });
      scoreMap.set(el, 0);
    }

    let sampleCount = 0;
    let globalMaxScore = 0;
    let mostActiveElement = targetEl;
    const inlineMutations = [];

    const initialScrollY = Math.round(window.scrollY);
    let maxScrollDeltaY = 0;
    let pointerMoves = 0;
    let lastPointer = { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };

    function onLiveMouseMove(e) {
      pointerMoves++;
      lastPointer = { x: Math.round(e.clientX), y: Math.round(e.clientY) };
      const elAtCursor = document.elementFromPoint(e.clientX, e.clientY);
      if (
        elAtCursor &&
        elAtCursor !== document.body &&
        elAtCursor !== document.documentElement &&
        !initialMap.has(elAtCursor) &&
        initialMap.size < 70
      ) {
        const snap = readStyleSnapshot(elAtCursor);
        initialMap.set(elAtCursor, snap);
        peakMap.set(elAtCursor, { ...snap });
        scoreMap.set(elAtCursor, 0);
      }
    }

    function onLiveScroll() {
      const dy = Math.round(window.scrollY) - initialScrollY;
      if (Math.abs(dy) > Math.abs(maxScrollDeltaY)) {
        maxScrollDeltaY = dy;
      }
    }

    window.addEventListener('mousemove', onLiveMouseMove, { passive: true, capture: true });
    window.addEventListener('scroll', onLiveScroll, { passive: true, capture: true });

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.target && m.target.nodeType === 1) {
          const val = m.target.getAttribute(m.attributeName) || '';
          if (val && inlineMutations.length < 15) {
            inlineMutations.push({
              target: getShortSelector(m.target),
              attr: m.attributeName,
              value: val.slice(0, 160),
              atMs: Math.round(performance.now() - startTime)
            });
          }
        }
      }
    });

    try {
      observer.observe(document.body || targetEl, {
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'data-state']
      });
    } catch (_e) {
      // ignore
    }

    // 4 个关键帧抓拍时间点 (ms)
    const keyframeScheduleMs = [150, 1400, 2650, 3850];
    const triggeredFrames = new Set();

    function triggerKeyframeSnapshot(frameIndex, elapsedMs) {
      // 抓拍前短暂隐藏右上角胶囊 45ms，防止被拍进画面
      const pillEl = recorderShadowRoot?.getElementById('wri-rec-pill');
      if (pillEl) pillEl.style.opacity = '0';

      const metaLabel = `#${frameIndex + 1} ${(elapsedMs / 1000).toFixed(1)}s | 鼠标(${Math.round(
        (lastPointer.x / Math.max(1, window.innerWidth)) * 100
      )}%,${Math.round((lastPointer.y / Math.max(1, window.innerHeight)) * 100)}%) | 滚动ΔY:${
        Math.round(window.scrollY) - initialScrollY
      }px`;

      setTimeout(() => {
        try {
          chrome.runtime.sendMessage({
            type: 'CAPTURE_KEYFRAME_TICK',
            frameIndex,
            label: metaLabel,
            boundingBox: baseCaptureData.boundingBox
          });
        } catch (_e) {
          // ignore
        }
        setTimeout(() => {
          if (pillEl) pillEl.style.opacity = '1';
        }, 55);
      }, 25);
    }

    let rafHandle = null;
    function sampleLoop(now) {
      const elapsed = now - startTime;
      const remaining = Math.max(0, (durationMs - elapsed) / 1000);

      const timerEl = recorderShadowRoot?.getElementById('wri-rec-countdown');
      if (timerEl) timerEl.textContent = `${remaining.toFixed(1)}s`;
      const progEl = recorderShadowRoot?.getElementById('wri-rec-progress');
      if (progEl) progEl.style.width = `${Math.min(100, (elapsed / durationMs) * 100)}%`;

      // 检查是否到达 4 格分镜抓拍时间点
      for (let i = 0; i < keyframeScheduleMs.length; i++) {
        if (!triggeredFrames.has(i) && elapsed >= keyframeScheduleMs[i]) {
          triggeredFrames.add(i);
          triggerKeyframeSnapshot(i, elapsed);
        }
      }

      sampleCount++;

      for (const [el, initSnap] of initialMap.entries()) {
        if (!el.isConnected) continue;
        const curSnap = readStyleSnapshot(el);
        const s = computeStyleDeltaScore(initSnap, curSnap);
        if (s > (scoreMap.get(el) || 0)) {
          scoreMap.set(el, s);
          peakMap.set(el, curSnap);
        }
        if (s > globalMaxScore) {
          globalMaxScore = s;
          mostActiveElement = el;
        }
      }

      if (elapsed < durationMs) {
        rafHandle = requestAnimationFrame(sampleLoop);
      } else {
        finishRecording();
      }
    }

    function finishRecording() {
      isRecording = false;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      window.removeEventListener('mousemove', onLiveMouseMove, { capture: true });
      window.removeEventListener('scroll', onLiveScroll, { capture: true });
      observer.disconnect();
      removeRecorderBanner();

      // 汇总所有发生了显著样式或尺寸变化的节点（按得分排序取前 6 个节点）
      const changedNodes = Array.from(scoreMap.entries())
        .filter(([, s]) => s > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);

      const extremes = {};
      for (const [el] of changedNodes) {
        const initSnap = initialMap.get(el);
        const peakSnap = peakMap.get(el);
        if (!initSnap || !peakSnap) continue;
        const nodeKey = getElementLabel(el);
        const nodeDiff = {};

        for (const prop of TRACKED_PROPS) {
          if (initSnap[prop] !== peakSnap[prop]) {
            nodeDiff[prop] = {
              initial: initSnap[prop] || 'none',
              peak: peakSnap[prop] || 'none'
            };
          }
        }
        if (
          Math.abs(peakSnap.rectW - initSnap.rectW) > 6 ||
          Math.abs(peakSnap.rectH - initSnap.rectH) > 6
        ) {
          nodeDiff.boundingSize = {
            initial: `${initSnap.rectW}×${initSnap.rectH}px`,
            peak: `${peakSnap.rectW}×${peakSnap.rectH}px`
          };
        }

        if (Object.keys(nodeDiff).length > 0) {
          extremes[nodeKey] = nodeDiff;
        }
      }

      const hasCssChange = Object.keys(extremes).length > 0;

      const finalPayload = {
        ...baseCaptureData,
        captureMode: 'recorder',
        interactionDeltas: {
          durationMs,
          sampleCount,
          watchedNodeCount: initialMap.size,
          changed: hasCssChange,
          mostActiveNode: hasCssChange ? getElementLabel(mostActiveElement) : null,
          maxDeltaScore: Number(globalMaxScore.toFixed(2)),
          pointerMoveCount: pointerMoves,
          scrollDeltaY: maxScrollDeltaY,
          canvasLayers,
          storyboardFrameCount: triggeredFrames.size,
          extremes,
          inlineMutations,
          note: hasCssChange
            ? '已捕获多节点样式/尺寸极值与 4 格动态分镜图'
            : canvasLayers.length > 0
            ? '检测到全屏/大尺寸 Canvas 舞台：视觉特效由 WebGL / Shader 实时绘制驱动，请重点参照 2×2 四格动态分镜截图还原动画过程'
            : '4 秒录制期间未检测到显著 CSS 变化'
        }
      };

      // 等待 120ms 确保最后一帧分镜抓拍完成
      setTimeout(() => {
        try {
          chrome.runtime.sendMessage({
            type: 'CONTENT_CAPTURE_COMPLETE',
            payload: finalPayload
          });
        } catch (err) {
          console.warn('[WRI Recorder] 发送录制结果失败:', err);
        }
      }, 120);
    }

    rafHandle = requestAnimationFrame(sampleLoop);
  }

  window.__WRI_START_RECORDER__ = startInteractionRecording;
})();
