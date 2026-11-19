/**
 * @file background/service-worker.js
 * @description 核心消息总线与任务调度器（含双模态特征采集、元提示词编译、BYOK 多模态流式路由与容错回退）
 */

import { checkChatGPTWebSession, streamChatGPTWeb } from './router-web-chatgpt.js';
import { checkGeminiWebSession, streamGeminiWeb } from './router-web-gemini.js';
import { streamByokGeneration } from './router-byok-api.js';
import { compileReversePrompt } from '../utils/prompt-compiler.js';
import { fetchCrossOriginKeyframes, filterComputedStyles } from '../utils/style-filter.js';
import { t, normalizeLang } from '../utils/i18n.js';

const STORAGE_KEY = 'wri_user_config_v1';
let activeStreamAbortController = null;
let recordedStoryboardFrames = [];

/**
 * 初始化 SidePanel 点击图标自动展开行为
 */
async function initSidePanelBehavior() {
  try {
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (err) {
    console.warn('[WRI ServiceWorker] 设置 sidePanel 行为失败:', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  initSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  initSidePanelBehavior();
});

initSidePanelBehavior();

/**
 * 读取持久化的用户通道与模型配置（含 Schema v2 自动迁移）
 */
async function getStoredUserConfig() {
  const defaults = {
    channel: 'web-chatgpt',
    webChatgptModel: 'GPT-6.2 Astra',
    webGeminiModel: '4 Argon',
    geminiApiKey: '',
    geminiModel: 'gemini-4-argon',
    openaiApiKey: '',
    openaiModel: 'gpt-6.2-astra',
    modelSchemaVersion: 2
  };
  try {
    const res = await chrome.storage.local.get([STORAGE_KEY]);
    const saved = res?.[STORAGE_KEY];
    if (!saved) return defaults;
    if (!saved.modelSchemaVersion || saved.modelSchemaVersion < 2) {
      const migrated = {
        ...defaults,
        ...saved,
        webChatgptModel: 'GPT-6.2 Astra',
        webGeminiModel: '4 Argon',
        geminiModel: 'gemini-4-argon',
        openaiModel: 'gpt-6.2-astra',
        modelSchemaVersion: 2
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: migrated });
      return migrated;
    }
    return { ...defaults, ...saved };
  } catch (_e) {
    return defaults;
  }
}

/**
 * 带超时与异常捕获的跨上下文消息发送工具（Service Worker -> SidePanel）
 */
export async function sendRuntimeMessageSafe(payload, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, timeout: true, error: '跨上下文通信超时' });
      }
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(payload, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || '接收端未就绪'
          });
          return;
        }
        resolve({ ok: true, data: response });
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err?.message || String(err) });
      }
    }
  });
}

/**
 * 带超时与异常捕获的标签页消息发送工具（Service Worker -> Content Script）
 */
export async function sendTabMessageSafe(tabId, payload, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, timeout: true, error: '向页面 Content Script 发送消息超时' });
      }
    }, timeoutMs);

    try {
      chrome.tabs.sendMessage(tabId, payload, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || 'Content Script 未响应'
          });
          return;
        }
        resolve({ ok: true, data: response });
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err?.message || String(err) });
      }
    }
  });
}

/**
 * ArrayBuffer 安全转 Base64 字符串
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

/**
 * 从 OffscreenCanvas 像素中提取目标区域的真实主背景色、表面色与高光强调色 (HEX)
 */
function extractPaletteFromCanvas(ctx, width, height) {
  const defaultPalette = {
    bgHex: '#0f172a',
    surfaceHex: '#1e293b',
    accentHex: '#38bdf8'
  };
  try {
    const imgData = ctx.getImageData(0, 0, width, height).data;
    const step = Math.max(4, Math.floor((imgData.length / 4) / 400)) * 4;
    const buckets = new Map();
    let bestAccent = { sat: -1, hex: '#38bdf8' };

    const toHex = (r, g, b) =>
      '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');

    for (let i = 0; i < imgData.length; i += step) {
      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];
      const a = imgData[i + 3];
      if (a < 128) continue;

      // 量化到 24 步长颜色桶统计主色调
      const qr = Math.round(r / 24) * 24;
      const qg = Math.round(g / 24) * 24;
      const qb = Math.round(b / 24) * 24;
      const hex = toHex(qr, qg, qb);
      buckets.set(hex, (buckets.get(hex) || 0) + 1);

      // 计算色彩饱和度挑选高光强调色
      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      const l = (max + min) / 2;
      const d = max - min;
      const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      if (sat > bestAccent.sat && l > 0.25 && l < 0.85) {
        bestAccent = { sat, hex: toHex(r, g, b) };
      }
    }

    const sorted = Array.from(buckets.entries()).sort((a, b) => b[1] - a[1]);
    const totalSamples = sorted.reduce((sum, [, count]) => sum + count, 0) || 1;
    return {
      bgHex: sorted[0]?.[0] || defaultPalette.bgHex,
      surfaceHex: sorted[1]?.[0] || sorted[0]?.[0] || defaultPalette.surfaceHex,
      accentHex: bestAccent.hex || defaultPalette.accentHex,
      // 最大颜色桶占比：接近 1 说明截图几乎是纯色（可能没拍到视频 / 画布画面）
      dominantShare: Math.round(((sorted[0]?.[1] || 0) / totalSamples) * 100) / 100
    };
  } catch (_e) {
    return defaultPalette;
  }
}

/**
 * 截取当前可见标签页并通过 OffscreenCanvas 精准裁剪选区高清 PNG Base64 + 提取真实像素色板
 */
async function captureAndCropTabRegion(windowId, box) {
  try {
    const fullDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    if (!fullDataUrl || !box) {
      return { base64: fullDataUrl || '', palette: null };
    }

    const resp = await fetch(fullDataUrl);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);

    const dpr = box.dpr || 1;
    const sx = Math.max(0, Math.min(bitmap.width - 1, Math.round(box.x * dpr)));
    const sy = Math.max(0, Math.min(bitmap.height - 1, Math.round(box.y * dpr)));
    const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(box.width * dpr)));
    const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(box.height * dpr)));

    const maxDim = 1200;
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    const outW = Math.max(1, Math.round(sw * scale));
    const outH = Math.max(1, Math.round(sh * scale));

    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
    bitmap.close();

    const palette = extractPaletteFromCanvas(ctx, outW, outH);
    const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
    const arrayBuffer = await croppedBlob.arrayBuffer();
    return {
      base64: `data:image/png;base64,${arrayBufferToBase64(arrayBuffer)}`,
      palette
    };
  } catch (err) {
    console.warn('[WRI ServiceWorker] 局部截图裁剪失败:', err);
    return { base64: '', palette: null };
  }
}

/**
 * 将录制过程中抓拍到的最多 4 张过程帧拼接为一张 2×2 动态分镜故事板图 (Motion Storyboard PNG)
 * 让多模态大模型一眼看清：初始态 -> 鼠标交互态（如透镜折射） -> 过渡态 -> 滚动/结束态（如收缩为 3D 水晶球）
 */
async function composeStoryboardFromFrames(frames = []) {
  try {
    const validFrames = frames
      .filter((f) => f && f.base64)
      .sort((a, b) => a.frameIndex - b.frameIndex)
      .slice(0, 4);
    if (validFrames.length === 0) return '';
    if (validFrames.length === 1) return validFrames[0].base64;

    const bitmaps = await Promise.all(
      validFrames.map(async (f) => {
        const resp = await fetch(f.base64);
        const blob = await resp.blob();
        return createImageBitmap(blob);
      })
    );

    const cellW = 640;
    const cellH = 380;
    const gap = 12;
    const headerH = 44;
    const cols = 2;
    const rows = Math.ceil(bitmaps.length / 2);

    const totalW = cols * cellW + (cols + 1) * gap;
    const totalH = headerH + rows * cellH + (rows + 1) * gap;

    const canvas = new OffscreenCanvas(totalW, totalH);
    const ctx = canvas.getContext('2d');

    // 深色背景底板
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, totalW, totalH);

    // 顶部总标题栏
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(
      '🎬 MOTION STORYBOARD (4-Second Dynamic Interaction Sequence: Frame #1 → #4)',
      gap + 6,
      28
    );

    for (let i = 0; i < bitmaps.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = gap + col * (cellW + gap);
      const y = headerH + gap + row * (cellH + gap);

      const bmp = bitmaps[i];
      ctx.fillStyle = '#111827';
      ctx.fillRect(x, y, cellW, cellH);

      // 等比例居中绘制单帧画面
      const scale = Math.min(cellW / bmp.width, cellH / bmp.height);
      const dw = Math.round(bmp.width * scale);
      const dh = Math.round(bmp.height * scale);
      const dx = x + Math.round((cellW - dw) / 2);
      const dy = y + Math.round((cellH - dh) / 2);
      ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, dx, dy, dw, dh);
      bmp.close();

      // 边框与左上角帧状态标签
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, cellW, cellH);

      const labelText = validFrames[i].label || `Frame #${i + 1}`;
      ctx.fillStyle = 'rgba(9, 13, 22, 0.86)';
      ctx.fillRect(x + 8, y + 8, Math.min(cellW - 16, labelText.length * 9 + 24), 28);
      ctx.fillStyle = '#7dd3fc';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(labelText, x + 16, y + 27);
    }

    const outBlob = await canvas.convertToBlob({ type: 'image/png' });
    const buf = await outBlob.arrayBuffer();
    return `data:image/png;base64,${arrayBufferToBase64(buf)}`;
  } catch (err) {
    console.warn('[WRI ServiceWorker] 合成四格动态分镜图失败:', err);
    return frames[0]?.base64 || '';
  }
}

/**
 * 在活动网页中注入并启动双模态采集器
 */
async function startContentCaptureInActiveTab(mode = 'hybrid', lang = 'zh') {
  const locale = normalizeLang(lang);
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = tabs && tabs[0];

  if (!activeTab || !activeTab.id) {
    return { ok: false, error: t('swNoActiveTab', {}, locale) };
  }

  const url = activeTab.url || '';
  if (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.includes('chromewebstore.google.com')
  ) {
    return {
      ok: false,
      restrictedPage: true,
      error: t('swRestrictedPage', {}, locale)
    };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ['content/inspector.js', 'content/recorder.js', 'content/cropper.js']
    });

    if (mode === 'cropper') {
      const res = await sendTabMessageSafe(activeTab.id, { type: 'ACTIVATE_CROPPER', lang: locale });
      return res.ok ? { ok: true, tabId: activeTab.id } : { ok: false, error: res.error };
    } else {
      const res = await sendTabMessageSafe(activeTab.id, {
        type: 'ACTIVATE_INSPECTOR',
        mode,
        lang: locale
      });
      return res.ok ? { ok: true, tabId: activeTab.id } : { ok: false, error: res.error };
    }
  } catch (err) {
    return {
      ok: false,
      restrictedPage: true,
      error: t('swInjectRestricted', { error: err?.message || String(err) }, locale)
    };
  }
}

/**
 * 生成内置的 3D 全息卡片采集特征数据（使用 OffscreenCanvas 渲染真实 PNG Base64 以便同时支持 BYOK 多模态测试）
 */
async function createMockCapturePayload(mode = 'hybrid') {
  let pngBase64 = '';
  try {
    const canvas = new OffscreenCanvas(480, 260);
    const ctx = canvas.getContext('2d');

    const bgGrad = ctx.createLinearGradient(0, 0, 480, 260);
    bgGrad.addColorStop(0, '#0f172a');
    bgGrad.addColorStop(0.5, '#1e1b4b');
    bgGrad.addColorStop(1, '#090d16');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 480, 260);

    // 霓虹光晕球
    ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.beginPath();
    ctx.arc(360, 65, 65, 0, Math.PI * 2);
    ctx.fill();

    // 卡片容器
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.48)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(65, 42, 350, 176, 18);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('PRO MOTION · GLASS CARD', 92, 82);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 19px sans-serif';
    ctx.fillText('3D Holographic Spotlight', 92, 118);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.fillText('Hover tilt + backdrop-filter blur(20px)', 92, 146);

    const btnGrad = ctx.createLinearGradient(92, 165, 232, 195);
    btnGrad.addColorStop(0, '#38bdf8');
    btnGrad.addColorStop(1, '#c084fc');
    ctx.fillStyle = btnGrad;
    ctx.beginPath();
    ctx.roundRect(92, 165, 145, 32, 8);
    ctx.fill();

    ctx.fillStyle = '#090d16';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('Launch Inspector →', 110, 185);

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buf = await blob.arrayBuffer();
    pngBase64 = `data:image/png;base64,${arrayBufferToBase64(buf)}`;
  } catch (_e) {
    pngBase64 = '';
  }

  const payload = {
    captureMode: mode,
    timestamp: new Date().toISOString(),
    pageUrl: 'https://linear.app/features (Sample)',
    tagName: 'div.holographic-card',
    boundingBox: { x: 240, y: 180, width: 380, height: 220, dpr: 2 },
    html: `<div class="holographic-card" data-interactive="true">
  <div class="card-glow-spotlight"></div>
  <span class="card-badge">PRO MOTION</span>
  <h3 class="card-title">3D Holographic Spotlight Card</h3>
  <p class="card-desc">具备径向聚光灯追踪、毛玻璃噪点折射与弹性 3D 倾斜反馈的现代极客卡片组件。</p>
  <button class="card-cta">立即体验特效 <span>→</span></button>
</div>`,
    computedStyles: {
      root: {
        position: 'relative',
        width: '380px',
        padding: '28px',
        borderRadius: '20px',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)',
        backdropFilter: 'blur(20px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        boxShadow: '0 24px 48px -12px rgba(2, 6, 23, 0.75), inset 0 1px 1px rgba(255, 255, 255, 0.25)',
        transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
        transition: 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.45s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.3s ease'
      }
    },
    keyframes: `@keyframes pulseGlow {
  0%, 100% { opacity: 0.45; transform: scale(1); }
  50% { opacity: 0.85; transform: scale(1.08); }
}`,
    interactionDeltas: {
      durationMs: 2000,
      sampleCount: 48,
      extremes: {
        transform: {
          initial: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
          peak: 'perspective(1000px) rotateX(8.5deg) rotateY(-11.2deg) translateY(-6px) scale3d(1.03, 1.03, 1.03)'
        },
        borderColor: {
          initial: 'rgba(255, 255, 255, 0.14)',
          peak: 'rgba(56, 189, 248, 0.55)'
        },
        boxShadow: {
          initial: '0 24px 48px -12px rgba(2, 6, 23, 0.75)',
          peak: '0 32px 64px -12px rgba(56, 189, 248, 0.28), 0 0 28px rgba(129, 140, 248, 0.35)'
        }
      }
    },
    screenshotBase64: pngBase64
  };

  const compiled = compileReversePrompt(payload);
  payload.compiledMetaPrompt = compiled.combinedPromptForWeb;
  return payload;
}

/**
 * 未调用模型时的输出：直接给出可发送给外部 AI 的复刻 Prompt。
 * 不编造任何参数，也不再用规则模板拼凑"复刻代码"（那类代码无法可信还原原网页，反而误导用户）。
 */
function buildOfflineFallbackMarkdown(capture = {}) {
  if (!capture || capture.pageUrl?.includes('(Sample)')) {
    return buildDefaultHolographicMarkdown();
  }
  return compileReversePrompt(capture).combinedPromptForWeb;
}

/**
 * 默认内置 3D 全息卡片完整四板块逆向 Markdown
 */
function buildDefaultHolographicMarkdown() {
  return `### 1. 【交互行为与状态机 (Initial -> Active -> Exit)】
- **Initial（静止默认态）**：
  - 卡片处于三维透视空间原点 \`perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)\`。
  - 顶部高光聚光灯层（\`.card-glow-spotlight\`）透明度为 \`0.45\`，伴随 \`pulseGlow\` 4 秒呼吸循环动画。
- **Active / Hover（鼠标悬停与移动态）**：
  - **状态触发**：鼠标进入容器并移动时，卡片产生明显的 **3D 视差抬升与倾斜**，实测极值达 \`rotateX(8.5deg) rotateY(-11.2deg) translateY(-6px) scale3d(1.03, 1.03, 1.03)\`。
  - **边框与外发光增强**：边框色由 \`rgba(255,255,255,0.14)\` 平滑过渡至电光蓝 \`rgba(56,189,248,0.55)\`，底部投射双层霓虹弥散阴影。
- **Exit（鼠标移出复位态）**：
  - 释放鼠标后，所有变换矩阵沿 \`cubic-bezier(0.22, 1, 0.36, 1)\` 阻尼曲线在 \`450ms\` 内顺滑回弹归零。

---

### 2. 【动效物理参数 (Duration / Cubic-Bezier / Spring 阻尼 / 3D 变换矩阵)】
| 属性维度 | 精确物理参数值 | 作用说明 |
| :--- | :--- | :--- |
| **透视视距 (Perspective)** | \`1000px\` | 赋予卡片真实近大远小 3D 景深感 |
| **核心缓动函数 (Easing)** | \`cubic-bezier(0.22, 1, 0.36, 1)\` | 定制 Out-Quint 弹簧阻尼曲线，初速度敏锐、收尾柔顺 |
| **过渡时长 (Duration)** | \`transform 450ms\`, \`box-shadow 450ms\`, \`border-color 300ms\` | 视觉层级异步响应，增强立体层次 |
| **3D 极值区间 (Delta)** | \`rotateX: [0deg, 8.5deg]\`, \`rotateY: [0deg, -11.2deg]\`, \`scale: [1, 1.03]\` | 2 秒动态录制捕获的真实悬停形变区间 |
| **关键帧周期 (Keyframes)** | \`pulseGlow 4s ease-in-out infinite\` | 背景星云光斑周期性缩放与明暗呼吸 |

---

### 3. 【视觉呈现规范 (精确色值 / 渐变 / 毛玻璃 / 阴影层级)】
- **背景深空画布**：\`radial-gradient(circle at 80% 20%, #1e1b4b 0%, #090d16 70%)\`
- **毛玻璃材质（Glassmorphism）**：
  - 主体填充：\`linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.02) 100%)\`
  - 背景滤镜：\`backdrop-filter: blur(20px) saturate(180%)\`
- **高光内描边与多层投影**：
  - 外边框：\`1px solid rgba(255, 255, 255, 0.14)\`（Hover 态：\`rgba(56, 189, 248, 0.55)\`）
  - 复合阴影：\`0 24px 48px -12px rgba(2, 6, 23, 0.75), inset 0 1px 1px rgba(255, 255, 255, 0.25)\`

---

### 4. 【可直接复制到 AI 编程工具的完整生成指令与单文件预览代码】

\`\`\`html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>3D Holographic Spotlight Card</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at 75% 20%, #1e1b4b 0%, #0f172a 45%, #060911 100%);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #f8fafc;
    overflow: hidden;
    padding: 20px;
  }
  .ambient-orb {
    position: absolute;
    width: 220px;
    height: 220px;
    border-radius: 50%;
    filter: blur(60px);
    z-index: 0;
    animation: pulseGlow 4s ease-in-out infinite;
  }
  .orb-1 { background: rgba(56, 189, 248, 0.28); top: 12%; right: 18%; }
  .orb-2 { background: rgba(168, 85, 247, 0.24); bottom: 12%; left: 18%; animation-delay: 2s; }

  @keyframes pulseGlow {
    0%, 100% { opacity: 0.45; transform: scale(1); }
    50% { opacity: 0.85; transform: scale(1.12); }
  }

  .holographic-card {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 360px;
    padding: 28px;
    border-radius: 20px;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.09) 0%, rgba(255, 255, 255, 0.02) 100%);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 24px 48px -12px rgba(2, 6, 23, 0.75), inset 0 1px 1px rgba(255, 255, 255, 0.25);
    transform: perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1);
    transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1),
                box-shadow 0.45s cubic-bezier(0.22, 1, 0.36, 1),
                border-color 0.3s ease;
    cursor: pointer;
    overflow: hidden;
  }
  .card-glow-spotlight {
    position: absolute;
    inset: 0;
    background: radial-gradient(280px circle at var(--mx, 50%) var(--my, 30%), rgba(56, 189, 248, 0.18), transparent 70%);
    pointer-events: none;
  }
  .card-badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: #7dd3fc;
    background: rgba(56, 189, 248, 0.14);
    border: 1px solid rgba(56, 189, 248, 0.35);
    margin-bottom: 16px;
  }
  .card-title {
    font-size: 20px;
    font-weight: 700;
    margin-bottom: 10px;
    background: linear-gradient(90deg, #ffffff, #cbd5e1);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .card-desc {
    font-size: 13px;
    line-height: 1.6;
    color: #94a3b8;
    margin-bottom: 22px;
  }
  .card-cta {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    border-radius: 10px;
    border: none;
    font-size: 13px;
    font-weight: 700;
    color: #090d16;
    background: linear-gradient(90deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%);
    cursor: pointer;
  }
</style>
</head>
<body>
  <div class="ambient-orb orb-1"></div>
  <div class="ambient-orb orb-2"></div>
  <div class="holographic-card" id="card">
    <div class="card-glow-spotlight"></div>
    <span class="card-badge">PRO MOTION · 1:1 REVERSE</span>
    <h3 class="card-title">3D Holographic Spotlight</h3>
    <p class="card-desc">在预览区移动鼠标体验：实时径向聚光灯追踪、毛玻璃折射与弹性 3D 倾斜反馈。</p>
    <button class="card-cta">立即体验交互 <span>→</span></button>
  </div>
  <script>
    const card = document.getElementById('card');
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mx', x + 'px');
      card.style.setProperty('--my', y + 'px');
      const rx = -((y / rect.height) - 0.5) * 16;
      const ry = ((x / rect.width) - 0.5) * 20;
      card.style.transform = \`perspective(1000px) rotateX(\${rx.toFixed(1)}deg) rotateY(\${ry.toFixed(1)}deg) translateY(-6px) scale3d(1.03,1.03,1.03)\`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)';
    });
  </script>
</body>
</html>
\`\`\``;
}

/**
 * 按块模拟流式输出指定文本至 SidePanel
 */
async function streamTextDirectToSidePanel(fullText, controller) {
  const chunkSize = 40;
  let cursor = 0;

  while (cursor < fullText.length) {
    if (controller.signal.aborted) {
      await sendRuntimeMessageSafe({ type: 'STREAM_ABORTED' });
      return;
    }

    const slice = fullText.slice(cursor, cursor + chunkSize);
    cursor += chunkSize;

    await sendRuntimeMessageSafe({
      type: 'STREAM_CHUNK',
      chunk: slice,
      progress: Math.min(100, Math.round((cursor / fullText.length) * 100))
    });

    await new Promise((r) => setTimeout(r, 14));
  }

  if (!controller.signal.aborted) {
    await sendRuntimeMessageSafe({
      type: 'STREAM_DONE',
      fullText
    });
  }
}

/**
 * 本地高精度逆向编译器流式推送（通道提示发送至顶部状态栏，不污染 Prompt 正文）
 */
async function streamOfflineFallbackToSidePanel(capturePayload, fallbackReason, controller, lang = 'zh') {
  const locale = normalizeLang(lang);
  if (fallbackReason) {
    const suspectHint = capturePayload?.screenshotSuspect ? t('swFallbackSuspect', {}, locale) : '';
    await sendRuntimeMessageSafe({
      type: 'CHANNEL_FALLBACK_NOTICE',
      notice: t('swFallbackNoticeWeb', { reason: fallbackReason, suspect: suspectHint }, locale)
    });
  }

  const fullText = buildOfflineFallbackMarkdown(capturePayload);
  await streamTextDirectToSidePanel(fullText, controller);
}

/**
 * 统一执行双轨 AI 流式路由（供网页逆向与 PPTX 复刻共用）
 */
async function dispatchCompiledPromptStream({ compiledPrompt, userConfig, mode = 'hybrid', fallbackText = '', capturePayload = null }) {
  if (activeStreamAbortController) {
    activeStreamAbortController.abort();
  }
  const controller = new AbortController();
  activeStreamAbortController = controller;

  const config = userConfig || (await getStoredUserConfig());
  const locale = normalizeLang(config?.lang);
  const channel = config.channel || 'byok-gemini';

  await sendRuntimeMessageSafe({
    type: 'STREAM_START',
    mode,
    channel
  });

  let chunkCount = 0;
  const onChunk = (deltaText, accumulatedText) => {
    chunkCount++;
    const estimatedProgress = Math.min(95, 10 + Math.round((accumulatedText.length / 3200) * 85));
    sendRuntimeMessageSafe({
      type: 'STREAM_CHUNK',
      chunk: deltaText,
      progress: estimatedProgress
    });
  };

  const runFallback = async (reason) => {
    if (capturePayload) {
      await streamOfflineFallbackToSidePanel(capturePayload, reason, controller, locale);
      return;
    }
    if (reason) {
      await sendRuntimeMessageSafe({
        type: 'CHANNEL_FALLBACK_NOTICE',
        notice: t('swFallbackNoticeCustom', { reason }, locale)
      });
    }
    await streamTextDirectToSidePanel(fallbackText || compiledPrompt.combinedPromptForWeb || '', controller);
  };

  try {
    if (channel === 'byok-gemini' || channel === 'byok-openai') {
      const hasGeminiKey = channel === 'byok-gemini' && config.geminiApiKey && config.geminiApiKey.trim().length > 8;
      const hasOpenAIKey = channel === 'byok-openai' && config.openaiApiKey && config.openaiApiKey.trim().length > 8;

      if (!hasGeminiKey && !hasOpenAIKey) {
        const keyName = channel === 'byok-gemini' ? 'Google AI Studio Key' : 'OpenAI API Key';
        await runFallback(t('swFallbackByokMissing', { keyName }, locale));
        return;
      }

      const finalFullText = await streamByokGeneration({
        channel,
        config,
        compiledPrompt,
        onChunk,
        signal: controller.signal
      });

      if (!controller.signal.aborted) {
        await sendRuntimeMessageSafe({
          type: 'STREAM_DONE',
          fullText: finalFullText
        });
      }
      return;
    }

    if (channel === 'web-chatgpt') {
      const finalFullText = await streamChatGPTWeb({
        compiledPrompt,
        model: config.webChatgptModel || 'GPT-6.2 Astra',
        onChunk,
        signal: controller.signal
      });
      if (!controller.signal.aborted) {
        await sendRuntimeMessageSafe({
          type: 'STREAM_DONE',
          fullText: finalFullText
        });
      }
      return;
    }

    if (channel === 'web-gemini') {
      const finalFullText = await streamGeminiWeb({
        compiledPrompt,
        model: config.webGeminiModel || '4 Argon',
        onChunk,
        signal: controller.signal
      });
      if (!controller.signal.aborted) {
        await sendRuntimeMessageSafe({
          type: 'STREAM_DONE',
          fullText: finalFullText
        });
      }
      return;
    }

    await runFallback('');
  } catch (err) {
    if (controller.signal.aborted || err?.message === 'ABORTSIGNAL_TRIGGERED') {
      await sendRuntimeMessageSafe({ type: 'STREAM_ABORTED' });
      return;
    }

    console.warn('[WRI ServiceWorker] 远端模型流式调用异常，启用回退:', err);
    if (chunkCount === 0) {
      await runFallback(err?.message || String(err));
    } else {
      await sendRuntimeMessageSafe({
        type: 'STREAM_CHUNK',
        chunk: t('swStreamInterrupted', { error: err?.message || String(err) }, locale)
      });
      await sendRuntimeMessageSafe({ type: 'STREAM_DONE' });
    }
  }
}

/**
 * 网页逆向任务调度：编译元提示词并进入统一流式路由
 */
async function dispatchReverseStream(capturePayload, userConfig) {
  const compiledPrompt = compileReversePrompt(capturePayload);
  return dispatchCompiledPromptStream({
    compiledPrompt,
    userConfig,
    mode: capturePayload?.captureMode || 'hybrid',
    capturePayload
  });
}

/**
 * 检查当前所选驱动通道的连通状态
 */
async function evaluateChannelStatus(config = {}) {
  const channel = config.channel || 'byok-gemini';
  const locale = normalizeLang(config.lang);

  if (channel === 'byok-gemini') {
    const hasKey = Boolean(config.geminiApiKey && config.geminiApiKey.trim().length > 8);
    const model = config.geminiModel || 'gemini-4-argon';
    return {
      ready: hasKey,
      badgeText: hasKey ? t('swReadyByokGeminiBadge', {}, locale) : t('swNeedByokGeminiBadge', {}, locale),
      detail: hasKey
        ? t('swReadyByokGeminiDetail', { model }, locale)
        : t('swNeedByokGeminiDetail', {}, locale)
    };
  }

  if (channel === 'byok-openai') {
    const hasKey = Boolean(config.openaiApiKey && config.openaiApiKey.trim().length > 8);
    const model = config.openaiModel || 'gpt-6.2-astra';
    return {
      ready: hasKey,
      badgeText: hasKey ? t('swReadyByokOpenaiBadge', {}, locale) : t('swNeedByokOpenaiBadge', {}, locale),
      detail: hasKey
        ? t('swReadyByokOpenaiDetail', { model }, locale)
        : t('swNeedByokOpenaiDetail', {}, locale)
    };
  }

  if (channel === 'web-chatgpt') {
    const selectedChatgptModel = config.webChatgptModel || 'GPT-6.2 Astra';
    try {
      const cookies = await chrome.cookies.getAll({ domain: 'chatgpt.com' });
      const hasSessionCookie =
        Array.isArray(cookies) &&
        cookies.some((c) => c.name.includes('session-token') || c.name === '_puid');
      if (hasSessionCookie) {
        const sessionCheck = await checkChatGPTWebSession();
        if (sessionCheck.ok) {
          return {
            ready: true,
            badgeText: t('swChatgptWebReady', {}, locale),
            detail: t('swModelDetail', { model: selectedChatgptModel, reason: sessionCheck.reason }, locale)
          };
        }
        return {
          ready: true,
          badgeText: t('swChatgptCookieReady', {}, locale),
          detail: t('swChatgptCookieDetail', { model: selectedChatgptModel }, locale)
        };
      }
      return {
        ready: false,
        badgeText: t('swChatgptNeedLogin', {}, locale),
        detail: t('swChatgptNeedLoginDetail', { model: selectedChatgptModel }, locale)
      };
    } catch (_err) {
      const fallback = await checkChatGPTWebSession();
      return {
        ready: Boolean(fallback.ok),
        badgeText: fallback.ok ? t('swChatgptWebReady', {}, locale) : t('swChatgptNeedLogin', {}, locale),
        detail: t('swModelDetail', { model: selectedChatgptModel, reason: fallback.reason }, locale)
      };
    }
  }

  if (channel === 'web-gemini') {
    const selectedGeminiModel = config.webGeminiModel || '4 Argon';
    try {
      const cookies = await chrome.cookies.getAll({ domain: '.google.com' });
      const hasSid =
        Array.isArray(cookies) &&
        cookies.some((c) => c.name === 'SID' || c.name === '__Secure-1PSID');
      if (hasSid) {
        const geminiCheck = await checkGeminiWebSession();
        if (geminiCheck.ok) {
          return {
            ready: true,
            badgeText: t('swGeminiWebReady', {}, locale),
            detail: t('swModelDetail', { model: selectedGeminiModel, reason: geminiCheck.reason }, locale)
          };
        }
        return {
          ready: true,
          badgeText: t('swGeminiCookieReady', {}, locale),
          detail: t('swGeminiCookieDetail', { model: selectedGeminiModel }, locale)
        };
      }
      return {
        ready: false,
        badgeText: t('swGeminiNeedLogin', {}, locale),
        detail: t('swGeminiNeedLoginDetail', { model: selectedGeminiModel }, locale)
      };
    } catch (_err) {
      const fallback = await checkGeminiWebSession();
      return {
        ready: Boolean(fallback.ok),
        badgeText: fallback.ok ? t('swGeminiWebReady', {}, locale) : t('swGeminiNeedLogin', {}, locale),
        detail: t('swModelDetail', { model: selectedGeminiModel, reason: fallback.reason }, locale)
      };
    }
  }

  return {
    ready: true,
    badgeText: t('swDefaultReadyBadge', {}, locale),
    detail: t('swDefaultReadyDetail', {}, locale)
  };
}

/**
 * 统一消息总线监听
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (!message || !message.type) {
        sendResponse({ ok: false, error: 'Invalid message format' });
        return;
      }

      switch (message.type) {
        case 'CHECK_CHANNEL_STATUS': {
          const status = await evaluateChannelStatus(message.config || {});
          sendResponse({ ok: true, status });
          break;
        }

        case 'START_PAGE_CAPTURE': {
          const mode = message.mode || 'hybrid';
          const result = await startContentCaptureInActiveTab(mode, message.config?.lang);
          if (!result.ok && result.restrictedPage) {
            const mockCapture = await createMockCapturePayload(mode);
            sendResponse({
              ok: true,
              fallbackMock: true,
              notice: result.error,
              capturePayload: mockCapture
            });
            dispatchReverseStream(mockCapture, message.config).catch(console.error);
          } else {
            sendResponse(result);
          }
          break;
        }

        case 'RESET_STORYBOARD_FRAMES': {
          recordedStoryboardFrames = [];
          sendResponse({ ok: true });
          break;
        }

        case 'CAPTURE_KEYFRAME_TICK': {
          const winId = sender?.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
          const box = message.boundingBox;
          const snap = await captureAndCropTabRegion(winId, box);
          if (snap && snap.base64 && recordedStoryboardFrames.length < 4) {
            recordedStoryboardFrames.push({
              frameIndex: typeof message.frameIndex === 'number' ? message.frameIndex : recordedStoryboardFrames.length,
              label: message.label || `Frame #${recordedStoryboardFrames.length + 1}`,
              base64: snap.base64,
              palette: snap.palette
            });
          }
          sendResponse({ ok: true, count: recordedStoryboardFrames.length });
          break;
        }

        case 'CONTENT_CAPTURE_COMPLETE': {
          const rawPayload = message.payload || {};
          const winId = sender?.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;

          if (rawPayload.computedStyles?.root) {
            rawPayload.computedStyles.root = filterComputedStyles(rawPayload.computedStyles.root);
          }

          if (Array.isArray(rawPayload.corsStyleHrefs) && rawPayload.corsStyleHrefs.length > 0) {
            const extraKf = await fetchCrossOriginKeyframes(
              rawPayload.corsStyleHrefs,
              rawPayload.animationNames || []
            );
            if (extraKf) {
              rawPayload.keyframes = [rawPayload.keyframes, extraKf].filter(Boolean).join('\n\n');
            }
          }

          // 若为录制模式且抓拍到了多张动态过程帧，优先合成为 2×2 四格动态分镜图
          if (rawPayload.captureMode === 'recorder' && recordedStoryboardFrames.length >= 2) {
            const storyboardBase64 = await composeStoryboardFromFrames(recordedStoryboardFrames);
            if (storyboardBase64) {
              rawPayload.screenshotBase64 = storyboardBase64;
              rawPayload.isStoryboard = true;
              rawPayload.storyboardLabels = recordedStoryboardFrames.map((f) => f.label);
              const firstPalette = recordedStoryboardFrames[0]?.palette;
              if (firstPalette) {
                rawPayload.visualPalette = firstPalette;
                rawPayload.screenshotSuspect = false;
              }
            }
            recordedStoryboardFrames = [];
          } else if (rawPayload.boundingBox) {
            const cropResult = await captureAndCropTabRegion(winId, rawPayload.boundingBox);
            if (cropResult && cropResult.base64) {
              rawPayload.screenshotBase64 = cropResult.base64;
              if (cropResult.palette) {
                rawPayload.visualPalette = cropResult.palette;
                rawPayload.screenshotSuspect = (cropResult.palette.dominantShare || 0) > 0.9;
              }
            }
          }

          // 编译元提示词并挂载至 capturePayload 供调试面板检视
          const compiled = compileReversePrompt(rawPayload);
          rawPayload.compiledMetaPrompt = compiled.combinedPromptForWeb;

          sendResponse({ ok: true });

          await sendRuntimeMessageSafe({
            type: 'CAPTURE_RESULT_READY',
            capturePayload: rawPayload
          });

          const config = await getStoredUserConfig();
          dispatchReverseStream(rawPayload, config).catch(console.error);
          break;
        }

        case 'CONTENT_CAPTURE_CANCELLED': {
          await sendRuntimeMessageSafe({
            type: 'CAPTURE_CANCELLED_NOTIFY'
          });
          sendResponse({ ok: true });
          break;
        }

        case 'TRIGGER_CAPTURE_OR_MOCK': {
          const mode = message.mode || 'hybrid';
          const mockCapture = await createMockCapturePayload(mode);
          sendResponse({
            ok: true,
            stage: 'Batch 3 Ready',
            capturePayload: mockCapture
          });
          dispatchReverseStream(mockCapture, message.config).catch(console.error);
          break;
        }

        case 'DISPATCH_CUSTOM_PROMPT': {
          if (!message.compiledPrompt) {
            sendResponse({ ok: false, error: '缺少 compiledPrompt 参数' });
            break;
          }
          sendResponse({ ok: true });
          const config = message.config || (await getStoredUserConfig());
          dispatchCompiledPromptStream({
            compiledPrompt: message.compiledPrompt,
            userConfig: config,
            mode: message.mode || 'pptx',
            fallbackText: message.compiledPrompt.combinedPromptForWeb || ''
          }).catch(console.error);
          break;
        }

        case 'STOP_STREAM': {
          if (activeStreamAbortController) {
            activeStreamAbortController.abort();
            activeStreamAbortController = null;
          }
          sendResponse({ ok: true });
          break;
        }

        default: {
          sendResponse({ ok: false, error: `未知消息类型: ${message.type}` });
        }
      }
    } catch (err) {
      console.error('[WRI ServiceWorker] 消息处理异常:', err);
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();

  return true;
});
