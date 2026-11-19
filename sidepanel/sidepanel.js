/**
 * @file sidepanel/sidepanel.js
 * @description 常驻侧边栏状态管理、配置持久化、网页双模态采集联调、流式输出渲染与 Sandbox 实时预览
 */

import { formatLayoutSection, compilePptxPrompt } from '../utils/prompt-compiler.js';
import { parsePptxBuffer } from '../utils/pptx-parser.js';
import { renderPptxToHtmlDeck } from '../utils/pptx-html-renderer.js';
import { injectSandboxExportProbe, requestSlidesSnapshotFromSandbox } from '../utils/html-slide-extractor.js';
import { exportSlidesModelToPptxBlob } from '../utils/pptx-exporter.js';
import { t, applyDomI18n, detectDefaultLang, normalizeLang } from '../utils/i18n.js';

const STORAGE_KEY = 'wri_user_config_v1';

/**
 * 根据当前界面语言构建各驱动通道可选的最新大模型清单
 */
function getChannelModelOptions(lang = 'zh') {
  return {
    'web-chatgpt': [
      { value: 'GPT-6.2 Astra', label: t('modelChatgptAstra', {}, lang) },
      { value: 'GPT-6.2 Sol', label: 'GPT-6.2 Sol' },
      { value: 'GPT-6.1 Sol', label: 'GPT-6.1 Sol' },
      { value: 'GPT-6.1 Terra', label: 'GPT-6.1 Terra' },
      { value: 'GPT-6 Astra', label: 'GPT-6 Astra' },
      { value: 'auto', label: t('modelChatgptAuto', {}, lang) },
      { value: 'custom', label: t('modelCustomOption', {}, lang) }
    ],
    'web-gemini': [
      { value: '4 Argon', label: t('modelGeminiArgon', {}, lang) },
      { value: '4 Carbon', label: t('modelGeminiCarbon', {}, lang) },
      { value: '4 Hydrogen', label: t('modelGeminiHydrogen', {}, lang) },
      { value: '3.1 Pro', label: t('modelGemini31Pro', {}, lang) },
      { value: '3.5 Flash-Lite', label: t('modelGemini35Flash', {}, lang) },
      { value: 'auto', label: t('modelGeminiAuto', {}, lang) },
      { value: 'custom', label: t('modelCustomOption', {}, lang) }
    ],
    'byok-gemini': [
      { value: 'gemini-4-argon', label: '4 Argon (Code & analysis)' },
      { value: 'gemini-4-carbon', label: '4 Carbon (Most complex work)' },
      { value: 'gemini-4-hydrogen', label: '4 Hydrogen (Everyday help)' },
      { value: 'gemini-3.1-pro', label: '3.1 Pro (Detailed research)' },
      { value: 'gemini-3.5-flash-lite', label: '3.5 Flash-Lite (Quick answers)' },
      { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
      { value: 'custom', label: t('modelCustomIdOption', {}, lang) }
    ],
    'byok-openai': [
      { value: 'gpt-6.2-astra', label: 'GPT-6.2 Astra' },
      { value: 'gpt-6.2-sol', label: 'GPT-6.2 Sol' },
      { value: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { value: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
      { value: 'gpt-6-astra', label: 'GPT-6 Astra' },
      { value: 'gpt-4o', label: 'gpt-4o' },
      { value: 'custom', label: t('modelCustomIdOption', {}, lang) }
    ]
  };
}

const state = {
  config: {
    channel: 'web-chatgpt',
    webChatgptModel: 'GPT-6.2 Astra',
    webGeminiModel: '4 Argon',
    geminiApiKey: '',
    geminiModel: 'gemini-4-argon',
    openaiApiKey: '',
    openaiModel: 'gpt-6.2-astra',
    customModelId: '',
    modelSchemaVersion: 2,
    theme: 'dark',
    lang: detectDefaultLang()
  },
  isStreaming: false,
  isExportingPptx: false,
  streamBuffer: '',
  extractedHtmlCode: '',
  sandboxMountedCode: '',
  sandboxReadyPromise: null,
  lastCapturePayload: null,
  pptxDoc: null
};

function tr(key, vars = {}) {
  return t(key, vars, state.config.lang);
}

// DOM 引用
const els = {
  channelSelect: document.getElementById('channelSelect'),
  activeModelSelect: document.getElementById('activeModelSelect'),
  customModelInput: document.getElementById('customModelInput'),
  statusBadge: document.getElementById('statusBadge'),
  statusText: document.getElementById('statusText'),
  statusDetail: document.getElementById('statusDetail'),
  langToggleBtn: document.getElementById('langToggleBtn'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  toggleSettingsBtn: document.getElementById('toggleSettingsBtn'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  settingsDrawer: document.getElementById('settingsDrawer'),
  geminiApiKey: document.getElementById('geminiApiKey'),
  geminiModel: document.getElementById('geminiModel'),
  openaiApiKey: document.getElementById('openaiApiKey'),
  openaiModel: document.getElementById('openaiModel'),
  saveConfigBtn: document.getElementById('saveConfigBtn'),
  saveToast: document.getElementById('saveToast'),
  wbTabWeb: document.getElementById('wbTabWeb'),
  wbTabPptx: document.getElementById('wbTabPptx'),
  webCaptureBox: document.getElementById('webCaptureBox'),
  pptxCaptureBox: document.getElementById('pptxCaptureBox'),
  pptxDropZone: document.getElementById('pptxDropZone'),
  pptxFileInput: document.getElementById('pptxFileInput'),
  pptxLoadedCard: document.getElementById('pptxLoadedCard'),
  pptxMetaText: document.getElementById('pptxMetaText'),
  pptxReuploadBtn: document.getElementById('pptxReuploadBtn'),
  pptxSlideSelect: document.getElementById('pptxSlideSelect'),
  pptxScopeSelect: document.getElementById('pptxScopeSelect'),
  pptxPreviewHtmlBtn: document.getElementById('pptxPreviewHtmlBtn'),
  pptxGenPromptBtn: document.getElementById('pptxGenPromptBtn'),
  pptxSendAiBtn: document.getElementById('pptxSendAiBtn'),
  pptxDownloadHtmlBtn: document.getElementById('pptxDownloadHtmlBtn'),
  pptxExportFileBtn: document.getElementById('pptxExportFileBtn'),
  captureBtns: document.querySelectorAll('#webCaptureBox .capture-btn'),
  runMockBtn: document.getElementById('runMockBtn'),
  stopStreamBtn: document.getElementById('stopStreamBtn'),
  debugHeader: document.getElementById('debugHeader'),
  debugBody: document.getElementById('debugBody'),
  debugCollapseIcon: document.getElementById('debugCollapseIcon'),
  captureSummaryBadge: document.getElementById('captureSummaryBadge'),
  debugTabs: document.querySelectorAll('.debug-tab'),
  screenshotEmpty: document.getElementById('screenshotEmpty'),
  screenshotImg: document.getElementById('screenshotImg'),
  debugHtmlPre: document.getElementById('debugHtmlPre'),
  debugLayoutPre: document.getElementById('debugLayoutPre'),
  debugCssPre: document.getElementById('debugCssPre'),
  debugDeltaPre: document.getElementById('debugDeltaPre'),
  tabPromptBtn: document.getElementById('tabPromptBtn'),
  tabSandboxBtn: document.getElementById('tabSandboxBtn'),
  promptPane: document.getElementById('promptPane'),
  sandboxPane: document.getElementById('sandboxPane'),
  promptOutput: document.getElementById('promptOutput'),
  streamProgressWrap: document.getElementById('streamProgressWrap'),
  streamProgressBar: document.getElementById('streamProgressBar'),
  copyImageBtn: document.getElementById('copyImageBtn'),
  copyPromptBtn: document.getElementById('copyPromptBtn'),
  copyCodeBtn: document.getElementById('copyCodeBtn'),
  sandboxFrame: document.getElementById('sandboxFrame'),
  sandboxStatusText: document.getElementById('sandboxStatusText'),
  sandboxDownloadHtmlBtn: document.getElementById('sandboxDownloadHtmlBtn'),
  sandboxExportPptxBtn: document.getElementById('sandboxExportPptxBtn'),
  refreshSandboxBtn: document.getElementById('refreshSandboxBtn')
};

/**
 * 带超时回退与异常捕获的跨上下文消息通信封装
 * @param {object} message 发送给 Service Worker 的消息
 * @param {number} timeoutMs 超时毫秒数
 */
async function sendMessageSafe(message, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ ok: false, timeout: true, error: tr('swTimeoutError') });
        }
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({
              ok: false,
              error: chrome.runtime.lastError.message || tr('swNoResponse')
            });
            return;
          }
          resolve(response || { ok: false, error: tr('swEmptyResponse') });
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
 * 获取指定通道当前保存的模型 ID
 */
function getStoredModelForChannel(channel) {
  if (channel === 'web-chatgpt') return state.config.webChatgptModel || 'GPT-6.2 Astra';
  if (channel === 'web-gemini') return state.config.webGeminiModel || '4 Argon';
  if (channel === 'byok-gemini') return state.config.geminiModel || 'gemini-4-argon';
  if (channel === 'byok-openai') return state.config.openaiModel || 'gpt-6.2-astra';
  return 'GPT-6.2 Astra';
}

/**
 * 根据当前选中的通道，动态渲染顶部常驻模型下拉框 (#activeModelSelect)
 */
function renderActiveModelSelector() {
  if (!els.activeModelSelect) return;
  const channel = els.channelSelect.value || 'web-chatgpt';
  const modelMap = getChannelModelOptions(state.config.lang);
  const options = modelMap[channel] || modelMap['web-chatgpt'];
  const currentModel = getStoredModelForChannel(channel);

  els.activeModelSelect.innerHTML = '';
  for (const item of options) {
    const opt = document.createElement('option');
    opt.value = item.value;
    opt.textContent = item.label;
    els.activeModelSelect.appendChild(opt);
  }

  const isPreset = options.some((o) => o.value === currentModel && o.value !== 'custom');
  if (isPreset) {
    els.activeModelSelect.value = currentModel;
    els.customModelInput?.classList.add('hidden');
  } else {
    els.activeModelSelect.value = 'custom';
    if (els.customModelInput) {
      els.customModelInput.value = currentModel !== 'custom' ? currentModel : state.config.customModelId || '';
      els.customModelInput.classList.remove('hidden');
    }
  }
}

/**
 * 读取顶部模型选择器当前选中的最终模型名并写回 state.config 对应字段
 */
function syncSelectedModelToConfig() {
  if (!els.activeModelSelect) return;
  const channel = els.channelSelect.value || 'web-chatgpt';
  let chosen = els.activeModelSelect.value;

  if (chosen === 'custom') {
    els.customModelInput?.classList.remove('hidden');
    const customVal = (els.customModelInput?.value || '').trim();
    if (customVal) {
      chosen = customVal;
      state.config.customModelId = customVal;
    } else {
      chosen = channel.includes('gemini') ? '4 Argon' : 'GPT-6.2 Astra';
    }
  } else {
    els.customModelInput?.classList.add('hidden');
  }

  if (channel === 'web-chatgpt') state.config.webChatgptModel = chosen;
  else if (channel === 'web-gemini') state.config.webGeminiModel = chosen;
  else if (channel === 'byok-gemini') {
    state.config.geminiModel = chosen;
    if (els.geminiModel && Array.from(els.geminiModel.options).some((o) => o.value === chosen)) {
      els.geminiModel.value = chosen;
    }
  } else if (channel === 'byok-openai') {
    state.config.openaiModel = chosen;
    if (els.openaiModel && Array.from(els.openaiModel.options).some((o) => o.value === chosen)) {
      els.openaiModel.value = chosen;
    }
  }
}

/**
 * 从 chrome.storage.local 加载持久化配置（含模型列表 Schema v2 自动升级）
 */
async function loadPersistedConfig() {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEY]);
    if (stored && stored[STORAGE_KEY]) {
      const saved = stored[STORAGE_KEY];
      // 若为旧版本存储的模型配置，自动升级至最新 GPT-6.2 Astra / Gemini 4 Argon
      if (!saved.modelSchemaVersion || saved.modelSchemaVersion < 2) {
        saved.webChatgptModel = 'GPT-6.2 Astra';
        saved.webGeminiModel = '4 Argon';
        saved.geminiModel = 'gemini-4-argon';
        saved.openaiModel = 'gpt-6.2-astra';
        saved.modelSchemaVersion = 2;
        await chrome.storage.local.set({ [STORAGE_KEY]: { ...state.config, ...saved } });
      }
      state.config = { ...state.config, ...saved };
    }
  } catch (err) {
    console.warn('[WRI SidePanel] 读取 storage 失败，使用默认配置:', err);
  }

  els.channelSelect.value = state.config.channel;
  els.geminiApiKey.value = state.config.geminiApiKey || '';
  els.geminiModel.value = state.config.geminiModel || 'gemini-4-argon';
  els.openaiApiKey.value = state.config.openaiApiKey || '';
  els.openaiModel.value = state.config.openaiModel || 'gpt-6.2-astra';
  applyTheme(state.config.theme || 'dark');
  applyLanguage(state.config.lang || detectDefaultLang(), { refreshStatus: false });
}

/**
 * 热切换整个侧边栏界面语言（中文 ⇄ English）并刷新所有动态下拉、状态与预览提示
 */
function applyLanguage(lang, { refreshStatus = false } = {}) {
  const locale = normalizeLang(lang);
  state.config.lang = locale;
  applyDomI18n(document, locale);
  renderActiveModelSelector();

  // 若已加载 PPTX 文档，刷新其元信息与幻灯片下拉框文本
  if (state.pptxDoc) {
    if (els.pptxMetaText) {
      els.pptxMetaText.textContent = tr('pptxMetaSummary', {
        file: state.pptxDoc.fileName,
        count: state.pptxDoc.slideCount,
        ratio: state.pptxDoc.ratioLabel
      });
    }
    if (els.pptxSlideSelect) {
      const prevVal = els.pptxSlideSelect.value || '0';
      els.pptxSlideSelect.innerHTML = '';
      state.pptxDoc.slides.forEach((s, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = tr('pptxSlideOption', { num: s.slideNumber, title: s.title });
        els.pptxSlideSelect.appendChild(opt);
      });
      els.pptxSlideSelect.value = prevVal;
    }
    renderPptxDebugPreview(Number(els.pptxSlideSelect?.value || 0));
  } else if (state.lastCapturePayload) {
    renderCapturePreview(state.lastCapturePayload);
  }

  // 若当前 Sandbox 处于无代码提示状态，实时同步其语言
  if (!state.extractedHtmlCode) {
    updateSandboxPreview('');
  } else {
    els.sandboxStatusText.textContent = tr('sandboxMountedStatus', { chars: state.extractedHtmlCode.length });
  }

  if (refreshStatus) {
    refreshChannelStatus();
  }
}

/**
 * 保存配置至 chrome.storage.local
 */
async function saveConfigToStorage(showToast = true) {
  syncSelectedModelToConfig();
  state.config = {
    ...state.config,
    channel: els.channelSelect.value,
    geminiApiKey: els.geminiApiKey.value.trim(),
    openaiApiKey: els.openaiApiKey.value.trim(),
    theme: document.documentElement.getAttribute('data-theme') || 'dark',
    lang: normalizeLang(state.config.lang)
  };

  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: state.config });
    if (showToast && els.saveToast) {
      els.saveToast.textContent = tr('saveToastSaved');
      setTimeout(() => {
        els.saveToast.textContent = tr('saveToastDefault');
      }, 2000);
    }
  } catch (err) {
    console.error('[WRI SidePanel] 保存配置失败:', err);
  }

  await refreshChannelStatus();
}

/**
 * 切换明暗主题
 */
function applyTheme(theme) {
  const target = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', target);
  state.config.theme = target;
}

/**
 * 刷新顶部通道连通状态徽标
 */
async function refreshChannelStatus() {
  els.statusText.textContent = tr('statusChecking');
  const res = await sendMessageSafe({
    type: 'CHECK_CHANNEL_STATUS',
    config: state.config
  });

  if (res && res.ok && res.status) {
    const { ready, badgeText, detail } = res.status;
    els.statusText.textContent = badgeText;
    els.statusDetail.textContent = detail;
    els.statusBadge.classList.toggle('status-ok', Boolean(ready));
    els.statusBadge.classList.toggle('status-warn', !ready);
  } else {
    els.statusText.textContent = tr('statusLocalReady');
    els.statusDetail.textContent = res?.error || tr('statusReadyFallbackDetail');
    els.statusBadge.classList.remove('status-ok');
    els.statusBadge.classList.add('status-warn');
  }
}

/**
 * 渲染捕获特征到调试预览区
 */
function renderCapturePreview(payload) {
  if (!payload) return;
  state.lastCapturePayload = payload;

  // 确保调试面板处于展开态
  els.debugBody.classList.remove('hidden');
  els.debugCollapseIcon.style.transform = 'rotate(0deg)';

  const modeMap = {
    inspector: tr('modeInspectorLabel'),
    recorder: tr('modeRecorderLabel'),
    cropper: tr('modeCropperLabel'),
    hybrid: tr('modeHybridLabel')
  };
  const label = modeMap[payload.captureMode] || payload.captureMode;
  const box = payload.boundingBox || {};
  els.captureSummaryBadge.textContent = `${label} · ${payload.tagName || 'Element'} (${box.width || 0}×${box.height || 0})`;

  // 1. 视觉截图
  if (payload.screenshotBase64) {
    els.screenshotImg.src = payload.screenshotBase64;
    els.screenshotImg.classList.remove('hidden');
    els.screenshotEmpty.classList.add('hidden');
  } else {
    els.screenshotImg.classList.add('hidden');
    els.screenshotEmpty.classList.remove('hidden');
  }

  // 2. HTML 骨架
  els.debugHtmlPre.textContent = payload.html || tr('debugHtmlEmpty');

  // 2.1 选区布局结构（与发给 AI 的 Prompt 第一部分完全一致）
  if (els.debugLayoutPre) {
    els.debugLayoutPre.textContent = formatLayoutSection(payload.layout);
  }

  // 截图有效性提示
  if (payload.screenshotSuspect) {
    const share = Math.round((payload.visualPalette?.dominantShare || 0) * 100);
    els.captureSummaryBadge.textContent += tr('badgeSolidColorWarn', { share });
  }

  // 3. Computed CSS + Keyframes
  const cssText = JSON.stringify(payload.computedStyles || {}, null, 2);
  const kfText = payload.keyframes ? `\n\n/* --- @keyframes --- */\n${payload.keyframes}` : '';
  els.debugCssPre.textContent = cssText + kfText;

  // 4. 4秒动态交互极值
  els.debugDeltaPre.textContent = JSON.stringify(
    payload.interactionDeltas || { note: tr('debugDeltaNoRecordNote') },
    null,
    2
  );
}

/**
 * 从逆向 Prompt 文本中提取单文件 HTML 预览代码
 */
function extractHtmlBlock(markdownText = '') {
  const completeMatch = markdownText.match(/```html\s*([\s\S]*?)```/i);
  if (completeMatch && completeMatch[1]) {
    return completeMatch[1].trim();
  }
  const openMatch = markdownText.match(/```html\s*([\s\S]*)$/i);
  if (openMatch && openMatch[1]) {
    return openMatch[1].trim();
  }
  return '';
}

/**
 * 将提取出的 HTML 代码挂载至安全隔离的 Sandbox iframe（仅在预览态附加导出测量探针，不污染原始代码）
 */
function updateSandboxPreview(htmlCode, { forceReload = false } = {}) {
  const code = htmlCode || state.extractedHtmlCode;
  if (!code) {
    state.sandboxMountedCode = '';
    state.sandboxReadyPromise = null;
    els.sandboxStatusText.textContent = tr('sandboxPromptModeStatus');
    els.sandboxFrame.srcdoc = `<!DOCTYPE html><html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#090d16;color:#94a3b8;font-family:sans-serif;font-size:13px;padding:24px;text-align:center;line-height:1.6;"><div>${tr('sandboxPromptModeBodyHtml')}</div></body></html>`;
    return;
  }

  if (!forceReload && state.sandboxMountedCode === code && state.sandboxReadyPromise) {
    return;
  }

  state.sandboxMountedCode = code;
  state.sandboxReadyPromise = new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      els.sandboxFrame.removeEventListener('load', finish);
      clearTimeout(fallbackTimer);
      setTimeout(resolve, 60);
    };
    const fallbackTimer = setTimeout(finish, 3000);
    els.sandboxFrame.addEventListener('load', finish, { once: true });
  });

  els.sandboxFrame.srcdoc = injectSandboxExportProbe(code);
  els.sandboxStatusText.textContent = tr('sandboxMountedStatus', { chars: code.length });
}

/**
 * 在真实网页中激活对应的采集器（吸管 / 4s录制 / 局部截图 / 混合模式）
 */
async function startPageCapture(mode = 'hybrid') {
  els.captureBtns.forEach((btn) => {
    btn.classList.toggle('active-mode', btn.dataset.mode === mode);
  });

  switchOutputView('prompt');

  const modeHintMap = {
    inspector: tr('hintStartInspector'),
    recorder: tr('hintStartRecorder'),
    cropper: tr('hintStartCropper'),
    hybrid: tr('hintStartHybrid')
  };
  els.statusDetail.textContent = modeHintMap[mode] || tr('hintStartDefault');

  const res = await sendMessageSafe({
    type: 'START_PAGE_CAPTURE',
    mode,
    config: state.config
  });

  if (res && res.ok && res.fallbackMock && res.capturePayload) {
    els.statusDetail.textContent = res.notice || tr('hintRestrictedMock');
    renderCapturePreview(res.capturePayload);
  } else if (res && !res.ok) {
    els.statusDetail.textContent = tr('hintStartFail', { error: res.error || tr('hintStartFailDefault') });
  }
}

/**
 * 触发内置 Mock 流式逆向测试
 */
async function triggerMockStream(mode = 'hybrid') {
  els.captureBtns.forEach((btn) => {
    btn.classList.toggle('active-mode', btn.dataset.mode === mode);
  });

  switchOutputView('prompt');

  const res = await sendMessageSafe({
    type: 'TRIGGER_CAPTURE_OR_MOCK',
    mode,
    config: state.config
  });

  if (res && res.ok && res.capturePayload) {
    renderCapturePreview(res.capturePayload);
  }
}

/**
 * 切换底部结果视图（Prompt 文本 vs Sandbox 预览）
 */
function switchOutputView(viewName) {
  const isPrompt = viewName === 'prompt';
  els.tabPromptBtn.classList.toggle('active', isPrompt);
  els.tabSandboxBtn.classList.toggle('active', !isPrompt);
  els.promptPane.classList.toggle('active', isPrompt);
  els.sandboxPane.classList.toggle('active', !isPrompt);

  if (!isPrompt && state.extractedHtmlCode) {
    updateSandboxPreview(state.extractedHtmlCode);
  }
}

/**
 * 绑定监听来自 Service Worker 的采集结果与流式输出消息
 */
function setupRuntimeStreamListener() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (!message || !message.type) return false;

      if (message.type === 'CAPTURE_RESULT_READY') {
        if (message.capturePayload) {
          renderCapturePreview(message.capturePayload);
          els.statusDetail.textContent = message.capturePayload.screenshotSuspect
            ? tr('hintCaptureSuspect')
            : tr('hintCaptureReady', { target: message.capturePayload.tagName || 'Element' });
        }
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === 'CAPTURE_CANCELLED_NOTIFY') {
        els.captureBtns.forEach((btn) => btn.classList.remove('active-mode'));
        els.statusDetail.textContent = tr('hintCaptureCancelled');
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === 'CHANNEL_FALLBACK_NOTICE') {
        if (message.notice) {
          els.statusDetail.textContent = message.notice;
        }
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === 'STREAM_START') {
        state.isStreaming = true;
        state.streamBuffer = '';
        if (message.mode !== 'pptx') {
          state.extractedHtmlCode = '';
        }
        els.promptOutput.textContent = '';
        els.promptOutput.classList.add('streaming');
        els.streamProgressWrap.classList.remove('hidden');
        els.streamProgressBar.style.width = '5%';
        els.stopStreamBtn.classList.remove('hidden');
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === 'STREAM_CHUNK') {
        state.streamBuffer += message.chunk || '';
        els.promptOutput.textContent = state.streamBuffer;
        els.promptOutput.scrollTop = els.promptOutput.scrollHeight;
        if (typeof message.progress === 'number') {
          els.streamProgressBar.style.width = `${message.progress}%`;
        }
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === 'STREAM_DONE') {
        state.isStreaming = false;
        if (message.fullText) {
          state.streamBuffer = message.fullText;
          els.promptOutput.textContent = state.streamBuffer;
        }
        els.promptOutput.classList.remove('streaming');
        els.streamProgressBar.style.width = '100%';
        setTimeout(() => {
          els.streamProgressWrap.classList.add('hidden');
        }, 500);
        els.stopStreamBtn.classList.add('hidden');
        els.captureBtns.forEach((btn) => btn.classList.remove('active-mode'));

        const code = extractHtmlBlock(state.streamBuffer);
        if (code) {
          state.extractedHtmlCode = code;
          updateSandboxPreview(code);
        }
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === 'STREAM_ABORTED') {
        state.isStreaming = false;
        els.promptOutput.classList.remove('streaming');
        els.streamProgressWrap.classList.add('hidden');
        els.stopStreamBtn.classList.add('hidden');
        els.promptOutput.textContent += tr('streamAbortedNote');
        sendResponse({ ok: true });
        return false;
      }
    } catch (err) {
      console.error('[WRI SidePanel] 处理消息异常:', err);
    }
    return false;
  });
}

/**
 * 一键将捕获的高清局部截图复制到系统剪贴板（支持直接 Ctrl+V 粘贴到 AI 聊天框）
 */
async function copyScreenshotToClipboard(btnElement) {
  const dataUrl = state.lastCapturePayload?.screenshotBase64;
  if (!dataUrl || !dataUrl.startsWith('data:image/png')) {
    btnElement.textContent = tr('copyNoImage');
    setTimeout(() => {
      btnElement.textContent = tr('copyImageBtn');
    }, 1500);
    return;
  }

  try {
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ]);
    btnElement.textContent = tr('copyImageOk');
    setTimeout(() => {
      btnElement.textContent = tr('copyImageBtn');
    }, 1600);
  } catch (err) {
    console.warn('[WRI SidePanel] 复制截图失败:', err);
    btnElement.textContent = tr('copyFail');
    setTimeout(() => {
      btnElement.textContent = tr('copyImageBtn');
    }, 1600);
  }
}

/**
 * 复制文本到剪贴板并反馈按钮状态
 */
async function copyTextWithFeedback(text, btnElement, labelKey) {
  if (!text || !text.trim()) {
    btnElement.textContent = tr('copyEmpty');
    setTimeout(() => {
      btnElement.textContent = tr(labelKey);
    }, 1500);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    btnElement.textContent = tr('copyTextOk');
    setTimeout(() => {
      btnElement.textContent = tr(labelKey);
    }, 1600);
  } catch (_err) {
    btnElement.textContent = tr('copyFail');
    setTimeout(() => {
      btnElement.textContent = tr(labelKey);
    }, 1600);
  }
}

/**
 * 切换工作台模式：网页捕获逆向 vs PPTX 文件复刻
 */
function switchWorkbenchMode(mode) {
  const isPptx = mode === 'pptx';
  els.wbTabWeb?.classList.toggle('active', !isPptx);
  els.wbTabPptx?.classList.toggle('active', isPptx);
  els.webCaptureBox?.classList.toggle('hidden', isPptx);
  els.pptxCaptureBox?.classList.toggle('hidden', !isPptx);
}

/**
 * 在调试预览区展示当前 PPTX 幻灯片的真实底层解析数据
 */
function renderPptxDebugPreview(slideIndex = 0) {
  const doc = state.pptxDoc;
  if (!doc || !doc.slides?.length) return;
  const slide = doc.slides[Math.max(0, Math.min(doc.slides.length - 1, slideIndex))];

  els.captureSummaryBadge.textContent = tr('pptxDebugBadge', {
    file: doc.fileName,
    num: slide.slideNumber,
    total: doc.slideCount,
    ratio: doc.ratioLabel
  });
  els.screenshotImg.classList.add('hidden');
  els.screenshotEmpty.classList.remove('hidden');
  els.screenshotEmpty.textContent = tr('pptxDebugVisualHint', { count: slide.elements.length });

  const promptPkg = compilePptxPrompt(doc, { scope: 'single', slideIndex: slide.slideNumber - 1 });
  if (els.debugLayoutPre) {
    els.debugLayoutPre.textContent = promptPkg.userPrompt;
  }
  els.debugHtmlPre.textContent =
    tr('pptxDebugElementsComment', { count: slide.elements.length }) +
    JSON.stringify(
      slide.elements.map((e) => ({ type: e.type, layer: e.fromLayer, name: e.name, box: e.box, text: e.text?.plainText })),
      null,
      2
    );
  els.debugCssPre.textContent = JSON.stringify({ theme: doc.theme, background: slide.background, transition: slide.transition }, null, 2);
  els.debugDeltaPre.textContent = JSON.stringify(
    slide.elements.filter((e) => e.animation).map((e) => ({ name: e.name, animation: e.animation })),
    null,
    2
  );
}

/**
 * 解析用户上传或拖入的 .pptx 文件
 */
async function handlePptxFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.pptx')) {
    els.statusDetail.textContent = tr('pptxOnlyPptxWarn');
    return;
  }

  els.statusDetail.textContent = tr('pptxParsingStatus', { file: file.name });
  try {
    const buffer = await file.arrayBuffer();
    const pptxDoc = await parsePptxBuffer(buffer, { fileName: file.name });
    if (!pptxDoc.slides || pptxDoc.slides.length === 0) {
      throw new Error(tr('pptxNoSlidesErr'));
    }

    state.pptxDoc = pptxDoc;
    els.pptxDropZone?.classList.add('hidden');
    els.pptxLoadedCard?.classList.remove('hidden');
    if (els.pptxMetaText) {
      els.pptxMetaText.textContent = tr('pptxMetaSummary', {
        file: pptxDoc.fileName,
        count: pptxDoc.slideCount,
        ratio: pptxDoc.ratioLabel
      });
    }

    if (els.pptxSlideSelect) {
      els.pptxSlideSelect.innerHTML = '';
      pptxDoc.slides.forEach((s, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = tr('pptxSlideOption', { num: s.slideNumber, title: s.title });
        els.pptxSlideSelect.appendChild(opt);
      });
    }

    renderPptxDebugPreview(0);
    // 自动生成 1:1 HTML 演示稿并立即渲染到 Sandbox，同时生成首屏 Prompt
    generatePptxOutputs({ openSandbox: true });
    els.statusDetail.textContent = tr('pptxParsedOk', {
      file: file.name,
      count: pptxDoc.slideCount,
      ratio: pptxDoc.ratioLabel
    });
  } catch (err) {
    console.error('[WRI PPTX] 解析失败:', err);
    els.statusDetail.textContent = tr('pptxParseFail', { error: err?.message || String(err) });
  }
}

function getPptxSelection() {
  const slideIndex = Number(els.pptxSlideSelect?.value || 0);
  const scope = els.pptxScopeSelect?.value === 'all' ? 'all' : 'single';
  return { slideIndex, scope };
}

/**
 * 生成 95%+ 复刻 Prompt 与 1:1 HTML 演示稿
 */
function generatePptxOutputs({ openSandbox = false } = {}) {
  const doc = state.pptxDoc;
  if (!doc) return;
  const { slideIndex, scope } = getPptxSelection();

  const compiled = compilePptxPrompt(doc, { scope, slideIndex });
  state.streamBuffer = compiled.combinedPromptForWeb;
  els.promptOutput.textContent = state.streamBuffer;
  els.promptOutput.classList.remove('streaming');

  const htmlDeck = renderPptxToHtmlDeck(doc, {
    initialSlideIndex: scope === 'single' ? 0 : slideIndex,
    onlySlideIndex: scope === 'single' ? slideIndex : null,
    lang: state.config.lang
  });
  state.extractedHtmlCode = htmlDeck;
  updateSandboxPreview(htmlDeck);

  switchOutputView(openSandbox ? 'sandbox' : 'prompt');
}

/**
 * 将高保真 PPTX Prompt 发送至当前所选 AI 模型流式生成/精修
 */
async function sendPptxToSelectedAi() {
  const doc = state.pptxDoc;
  if (!doc) return;
  const { slideIndex, scope } = getPptxSelection();
  const compiledPrompt = compilePptxPrompt(doc, { scope, slideIndex });

  switchOutputView('prompt');
  els.statusDetail.textContent = tr('pptxSendingAi', { channel: state.config.channel });

  const res = await sendMessageSafe({
    type: 'DISPATCH_CUSTOM_PROMPT',
    mode: 'pptx',
    compiledPrompt,
    config: state.config
  });

  if (res && !res.ok) {
    els.statusDetail.textContent = tr('pptxSendAiFail', { error: res.error || 'Unknown error' });
  }
}

/**
 * 触发浏览器下载指定 Blob 文件
 */
function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * 推导安全的导出基础文件名
 */
function resolveExportBaseName(fallbackTitle = '') {
  if (state.pptxDoc?.fileName) {
    const { slideIndex, scope } = getPptxSelection();
    const clean = state.pptxDoc.fileName.replace(/\.pptx$/i, '');
    return scope === 'single' ? `${clean}_slide${slideIndex + 1}` : `${clean}_deck`;
  }
  const titleClean = String(fallbackTitle || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 48);
  return titleClean || `reverse_deck_${Date.now()}`;
}

/**
 * 一键导出当前单文件纯净 .html 演示稿（不含任何探针脚本）
 */
function downloadPptxHtmlFile() {
  let htmlDeck = state.extractedHtmlCode || extractHtmlBlock(state.streamBuffer);
  if (!htmlDeck && state.pptxDoc) {
    const { slideIndex, scope } = getPptxSelection();
    htmlDeck = renderPptxToHtmlDeck(state.pptxDoc, {
      initialSlideIndex: scope === 'single' ? 0 : slideIndex,
      onlySlideIndex: scope === 'single' ? slideIndex : null,
      lang: state.config.lang
    });
  }
  if (!htmlDeck) {
    els.statusDetail.textContent = tr('pptxNoHtmlToExport');
    return;
  }

  const blob = new Blob([htmlDeck], { type: 'text/html;charset=utf-8' });
  triggerBlobDownload(blob, `${resolveExportBaseName()}.html`);
  els.statusDetail.textContent = tr('pptxHtmlExported', { kb: Math.max(1, Math.round(blob.size / 1024)) });
}

/**
 * 将 Sandbox 中确认无误的 HTML 演示稿高保真转换为标准可编辑 .pptx 文件并下载
 */
async function exportCurrentSandboxToPptx() {
  if (state.isExportingPptx) return;

  const htmlCode = state.extractedHtmlCode || extractHtmlBlock(state.streamBuffer);
  if (!htmlCode) {
    els.statusDetail.textContent = tr('pptxNeedSandboxHtml');
    els.sandboxStatusText.textContent = tr('pptxSandboxNoHtml');
    return;
  }

  state.isExportingPptx = true;
  const btns = [els.sandboxExportPptxBtn, els.pptxExportFileBtn].filter(Boolean);

  try {
    btns.forEach((b) => { b.disabled = true; });
    if (els.sandboxExportPptxBtn) els.sandboxExportPptxBtn.textContent = tr('pptxExportingBtn');
    if (els.pptxExportFileBtn) {
      els.pptxExportFileBtn.innerHTML = `<span>${tr('pptxExportingBanner')}</span>`;
    }
    els.statusDetail.textContent = tr('pptxExportingDetail');

    // 确保 Sandbox 处于可见状态且已挂载探针
    if (!els.sandboxPane.classList.contains('active')) {
      switchOutputView('sandbox');
    }
    if (state.sandboxMountedCode !== htmlCode || !state.sandboxReadyPromise) {
      updateSandboxPreview(htmlCode, { forceReload: true });
    }
    if (state.sandboxReadyPromise) {
      await state.sandboxReadyPromise;
    }

    // 再等两帧确保窗口切换后布局完全收敛
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const slidesModel = await requestSlidesSnapshotFromSandbox(els.sandboxFrame, {
      timeoutMs: 20000,
      rasterScale: 2
    });

    const { blob, summary } = await exportSlidesModelToPptxBlob(slidesModel);
    const fileName = `${resolveExportBaseName(slidesModel.title)}_converted.pptx`;
    triggerBlobDownload(blob, fileName);

    const st = slidesModel.stats || {};
    const sizeKb = Math.max(1, Math.round(blob.size / 1024));
    const reportParts = [
      tr('pptxStatSlides', { n: summary.slideCount }),
      tr('pptxStatTextBoxes', { n: summary.textShapeCount }),
      tr('pptxStatShapes', { n: Math.max(0, summary.shapeCount - summary.textShapeCount) })
    ];
    if (summary.tableCount > 0) reportParts.push(tr('pptxStatTables', { n: summary.tableCount }));
    if (summary.imageCount > 0) reportParts.push(tr('pptxStatMedia', { n: summary.imageCount }));
    if (summary.notesCount > 0) reportParts.push(tr('pptxStatNotes', { n: summary.notesCount }));

    const warnTip =
      Array.isArray(st.warnings) && st.warnings.length > 0
        ? tr('pptxExportWarnPrefix', { warn: st.warnings[0] })
        : '';
    els.statusDetail.textContent = tr('pptxExportOkDetail', {
      file: fileName,
      kb: sizeKb,
      stats: reportParts.join(' / '),
      warn: warnTip
    });
    els.sandboxStatusText.textContent = tr('pptxExportOkSandbox', {
      slides: summary.slideCount,
      kb: sizeKb
    });
  } catch (err) {
    console.error('[WRI PPTX Export] 转换失败:', err);
    const errMsg = err?.message || String(err);
    els.statusDetail.textContent = tr('pptxExportFailDetail', { error: errMsg });
    els.sandboxStatusText.textContent = tr('pptxExportFailSandbox', { error: errMsg });
  } finally {
    state.isExportingPptx = false;
    btns.forEach((b) => { b.disabled = false; });
    if (els.sandboxExportPptxBtn) {
      els.sandboxExportPptxBtn.textContent = tr('sandboxExportPptxBtn');
    }
    if (els.pptxExportFileBtn) {
      els.pptxExportFileBtn.innerHTML = `<span data-i18n="pptxExportBannerTitle">${tr('pptxExportBannerTitle')}</span><span class="export-pptx-badge" data-i18n="pptxExportBannerBadge">${tr('pptxExportBannerBadge')}</span>`;
    }
  }
}

/**
 * 初始化所有 UI 交互事件
 */
function bindEvents() {
  els.langToggleBtn?.addEventListener('click', () => {
    const nextLang = state.config.lang === 'en' ? 'zh' : 'en';
    applyLanguage(nextLang, { refreshStatus: false });
    saveConfigToStorage(false);
  });

  els.themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
    saveConfigToStorage(false);
  });

  els.toggleSettingsBtn.addEventListener('click', () => {
    els.settingsDrawer.classList.toggle('hidden');
  });
  els.closeSettingsBtn.addEventListener('click', () => {
    els.settingsDrawer.classList.add('hidden');
  });

  els.channelSelect.addEventListener('change', () => {
    renderActiveModelSelector();
    saveConfigToStorage(false);
  });

  if (els.activeModelSelect) {
    els.activeModelSelect.addEventListener('change', () => {
      syncSelectedModelToConfig();
      saveConfigToStorage(false);
    });
  }

  if (els.customModelInput) {
    els.customModelInput.addEventListener('change', () => {
      syncSelectedModelToConfig();
      saveConfigToStorage(false);
    });
  }

  if (els.geminiModel) {
    els.geminiModel.addEventListener('change', () => {
      state.config.geminiModel = els.geminiModel.value;
      renderActiveModelSelector();
      saveConfigToStorage(false);
    });
  }

  if (els.openaiModel) {
    els.openaiModel.addEventListener('change', () => {
      state.config.openaiModel = els.openaiModel.value;
      renderActiveModelSelector();
      saveConfigToStorage(false);
    });
  }

  els.saveConfigBtn.addEventListener('click', () => {
    saveConfigToStorage(true);
  });
  els.statusBadge.addEventListener('click', () => {
    refreshChannelStatus();
  });

  // 工作台模式切换（网页捕获 vs PPTX 复刻）
  els.wbTabWeb?.addEventListener('click', () => switchWorkbenchMode('web'));
  els.wbTabPptx?.addEventListener('click', () => switchWorkbenchMode('pptx'));

  // PPTX 文件上传与拖拽
  els.pptxDropZone?.addEventListener('click', () => els.pptxFileInput?.click());
  els.pptxReuploadBtn?.addEventListener('click', () => els.pptxFileInput?.click());
  els.pptxFileInput?.addEventListener('change', (e) => {
    const file = e.target?.files?.[0];
    if (file) handlePptxFile(file);
    e.target.value = '';
  });

  els.pptxDropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.pptxDropZone.classList.add('drag-over');
  });
  els.pptxDropZone?.addEventListener('dragleave', () => {
    els.pptxDropZone.classList.remove('drag-over');
  });
  els.pptxDropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    els.pptxDropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handlePptxFile(file);
  });

  els.pptxSlideSelect?.addEventListener('change', () => {
    const idx = Number(els.pptxSlideSelect.value || 0);
    renderPptxDebugPreview(idx);
    generatePptxOutputs({ openSandbox: els.sandboxPane.classList.contains('active') });
  });
  els.pptxScopeSelect?.addEventListener('change', () => {
    generatePptxOutputs({ openSandbox: els.sandboxPane.classList.contains('active') });
  });

  els.pptxPreviewHtmlBtn?.addEventListener('click', () => generatePptxOutputs({ openSandbox: true }));
  els.pptxGenPromptBtn?.addEventListener('click', () => generatePptxOutputs({ openSandbox: false }));
  els.pptxSendAiBtn?.addEventListener('click', () => sendPptxToSelectedAi());
  els.pptxDownloadHtmlBtn?.addEventListener('click', () => downloadPptxHtmlFile());
  els.pptxExportFileBtn?.addEventListener('click', () => exportCurrentSandboxToPptx());

  // 四大真实网页采集模式按钮
  els.captureBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode || 'hybrid';
      startPageCapture(mode);
    });
  });

  // 一键 Mock 流式逆向按钮
  els.runMockBtn.addEventListener('click', () => {
    triggerMockStream('hybrid');
  });

  // 停止流式输出按钮
  els.stopStreamBtn.addEventListener('click', async () => {
    await sendMessageSafe({ type: 'STOP_STREAM' });
  });

  // 调试预览区折叠与 Tab 切换
  els.debugHeader.addEventListener('click', () => {
    const isHidden = els.debugBody.classList.toggle('hidden');
    els.debugCollapseIcon.style.transform = isHidden ? 'rotate(-90deg)' : 'rotate(0deg)';
  });

  els.debugTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.debugTab;
      els.debugTabs.forEach((t) => t.classList.toggle('active', t === tab));
      document.getElementById('debugContentVisual').classList.toggle('active', target === 'visual');
      document.getElementById('debugContentLayout').classList.toggle('active', target === 'layout');
      document.getElementById('debugContentHtml').classList.toggle('active', target === 'html');
      document.getElementById('debugContentCss').classList.toggle('active', target === 'css');
      document.getElementById('debugContentDelta').classList.toggle('active', target === 'delta');
    });
  });

  // 结果视图切换
  els.tabPromptBtn.addEventListener('click', () => switchOutputView('prompt'));
  els.tabSandboxBtn.addEventListener('click', () => switchOutputView('sandbox'));

  // 刷新 Sandbox 与一键导出 HTML / PPTX
  els.refreshSandboxBtn.addEventListener('click', () => {
    const code = extractHtmlBlock(state.streamBuffer) || state.extractedHtmlCode;
    updateSandboxPreview(code, { forceReload: true });
  });
  els.sandboxDownloadHtmlBtn?.addEventListener('click', () => downloadPptxHtmlFile());
  els.sandboxExportPptxBtn?.addEventListener('click', () => exportCurrentSandboxToPptx());

  // 一键复制截图、完整 Prompt 与仅复制代码
  if (els.copyImageBtn) {
    els.copyImageBtn.addEventListener('click', () => {
      copyScreenshotToClipboard(els.copyImageBtn);
    });
  }

  els.copyPromptBtn.addEventListener('click', () => {
    copyTextWithFeedback(state.streamBuffer, els.copyPromptBtn, 'copyPromptBtn');
  });

  els.copyCodeBtn.addEventListener('click', () => {
    const code = extractHtmlBlock(state.streamBuffer) || state.extractedHtmlCode;
    copyTextWithFeedback(code, els.copyCodeBtn, 'copyCodeBtn');
  });
}

// 启动初始化
(async function bootstrap() {
  setupRuntimeStreamListener();
  bindEvents();
  await loadPersistedConfig();
  await refreshChannelStatus();
})();
