/**
 * @file background/router-web-gemini.js
 * @description Gemini 网页版 (gemini.google.com) 模型切换、零侵入 DOM 桥接与 StreamGenerate RPC 兜底模块
 * 支持官方模型菜单选择：4 Argon / 4 Carbon / 4 Hydrogen / 3.1 Pro / 3.5 Flash-Lite / auto / 自定义模型
 */

const GEMINI_APP_URL = 'https://gemini.google.com/app';
const GEMINI_STREAM_RPC_URL =
  'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate';

let cachedGeminiParams = {
  atToken: '',
  blParam: '',
  fSid: '',
  expiresAt: 0
};

/**
 * 从 gemini.google.com/app 的 HTML 源码中提取 SNlM0e (at 签名) 与会话参数
 * @param {string} htmlText
 */
function extractTokensFromHtml(htmlText = '') {
  const snlm0eMatch = htmlText.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
  const blMatch = htmlText.match(/"cfb2h"\s*:\s*"([^"]+)"/);
  const sidMatch = htmlText.match(/"FdrFJe"\s*:\s*"([^"]+)"/);

  return {
    atToken: snlm0eMatch ? snlm0eMatch[1] : '',
    blParam: blMatch ? blMatch[1] : 'boq_assistant-bard-web-server_20250401.08_p0',
    fSid: sidMatch ? sidMatch[1] : ''
  };
}

/**
 * 查找已打开的 gemini.google.com 标签页，若不存在则自动创建一个隐藏后台标签页 (active: false)
 * @returns {Promise<number>} tabId
 */
async function findOrCreateGeminiTab() {
  const existingTabs = await chrome.tabs.query({
    url: ['https://gemini.google.com/*']
  });

  if (existingTabs && existingTabs.length > 0 && existingTabs[0].id) {
    return existingTabs[0].id;
  }

  const createdTab = await chrome.tabs.create({
    url: GEMINI_APP_URL,
    active: false
  });

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 8000);

    function listener(tabId, info) {
      if (tabId === createdTab.id && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });

  return createdTab.id;
}

/**
 * 在 gemini.google.com 标签页的 MAIN 世界上下文中读取 WIZ_global_data.SNlM0e
 */
async function extractGeminiTokenViaMainWorld(lang = 'zh') {
  const isEn = String(lang || '').toLowerCase().startsWith('en');
  try {
    const tabId = await findOrCreateGeminiTab();
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          const wiz = window.WIZ_global_data || {};
          const atToken = wiz.SNlM0e || '';
          const blParam = wiz.cfb2h || 'boq_assistant-bard-web-server_20250401.08_p0';
          const fSid = wiz.FdrFJe || '';
          if (atToken) {
            return { ok: true, atToken, blParam, fSid };
          }
          const html = document.documentElement.innerHTML;
          const m = html.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
          return {
            ok: Boolean(m && m[1]),
            atToken: m ? m[1] : '',
            blParam,
            fSid
          };
        } catch (err) {
          return { ok: false, error: err?.message || String(err) };
        }
      }
    });

    const res = results?.[0]?.result;
    if (res && res.ok && res.atToken) {
      cachedGeminiParams = {
        atToken: res.atToken,
        blParam: res.blParam,
        fSid: res.fSid,
        expiresAt: Date.now() + 10 * 60 * 1000
      };
      return {
        ok: true,
        ...cachedGeminiParams,
        reason: isEn
          ? 'Connected to Gemini Web via official tab'
          : '已通过官网标签页连接 Gemini Web'
      };
    }

    return {
      ok: false,
      reason: isEn
        ? 'No valid Gemini Web session found. Please sign in at gemini.google.com.'
        : '未在 gemini.google.com 提取到有效登录态，请先在浏览器打开 gemini.google.com 登录 Google 账号'
    };
  } catch (err) {
    return {
      ok: false,
      reason: isEn
        ? `Failed to inspect Gemini session: ${err?.message || String(err)}`
        : `MAIN 上下文检测 Gemini 会话失败: ${err?.message || String(err)}`
    };
  }
}

/**
 * 检测 Gemini Web 登录状态并提取 SNlM0e (at 签名)
 */
export async function checkGeminiWebSession(lang = 'zh') {
  const isEn = String(lang || '').toLowerCase().startsWith('en');
  if (cachedGeminiParams.atToken && Date.now() < cachedGeminiParams.expiresAt) {
    return {
      ok: true,
      ...cachedGeminiParams,
      reason: isEn
        ? 'Gemini Web session ready (UI model switch & DOM bridge)'
        : 'Gemini Web 登录态已就绪 (支持 UI 模型切换与 DOM 桥接)'
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5500);
    const resp = await fetch(GEMINI_APP_URL, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'text/html,application/xhtml+xml'
      },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (resp.status === 403) {
      return extractGeminiTokenViaMainWorld(lang);
    }

    if (!resp.ok) {
      return {
        ok: false,
        reason: isEn
          ? `gemini.google.com returned HTTP ${resp.status}; please verify your Google login.`
          : `gemini.google.com 返回 HTTP ${resp.status}，请确认已登录 Google 账号`
      };
    }

    const html = await resp.text();
    const tokens = extractTokensFromHtml(html);

    if (tokens.atToken) {
      cachedGeminiParams = {
        ...tokens,
        expiresAt: Date.now() + 10 * 60 * 1000
      };
      return {
        ok: true,
        ...cachedGeminiParams,
        reason: isEn
          ? 'Gemini Web ready (supports 4 Argon / 4 Hydrogen / 3.1 Pro switching)'
          : 'Gemini Web 已就绪 (支持 4 Argon / 4 Hydrogen / 3.1 Pro 等模型切换)'
      };
    }

    return extractGeminiTokenViaMainWorld(lang);
  } catch (_err) {
    return extractGeminiTokenViaMainWorld(lang);
  }
}

/**
 * 在 gemini.google.com 标签页中切换指定模型、自动附带截图并驱动官方输入框发送请求
 */
async function triggerGeminiDomSendInTab(tabId, promptText, model = '4 Argon', imageDataUrl = '') {
  const execResults = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [promptText, model, imageDataUrl || ''],
    func: async (textToSend, preferredModel, imgDataUrl) => {
      try {
        const MODEL_ALIAS_MAP = {
          '3.5 flash-lite': ['3.5 flash-lite', 'quick answers'],
          '4 hydrogen': ['4 hydrogen', 'everyday help'],
          '3.1 pro': ['3.1 pro', 'detailed research'],
          '4 argon': ['4 argon', 'code & analysis'],
          '4 carbon': ['4 carbon', 'most complex work']
        };

        const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

        const getTargetAliases = (m) => {
          const k = norm(m);
          return MODEL_ALIAS_MAP[k] || [k];
        };

        const matchesModelText = (rawText, aliases) => {
          const lines = String(rawText || '')
            .split(/\r?\n/)
            .map(norm)
            .filter(Boolean);
          const full = norm(rawText);
          return aliases.some(
            (alias) =>
              lines.some((l) => l === alias || l.startsWith(`${alias} `)) ||
              full === alias
          );
        };

        // 1. 记录发送前已有的 model-response 数量
        const responseSelector = 'model-response, .model-response-text, message-content';
        const initialCount = document.querySelectorAll('model-response').length || document.querySelectorAll(responseSelector).length;
        window.__WRI_GEMINI_BRIDGE_STATE__ = {
          initialCount,
          useModelResponseTag: document.querySelectorAll('model-response').length > 0 || Boolean(document.querySelector('chat-window')),
          startedAt: Date.now()
        };

        // 2. 等待 Gemini 输入框就绪（最多等待 6 秒）
        let editorEl = null;
        for (let i = 0; i < 30; i++) {
          editorEl =
            document.querySelector('rich-textarea .ql-editor[contenteditable="true"]') ||
            document.querySelector('div.ql-editor[contenteditable="true"]') ||
            document.querySelector('div[contenteditable="true"][role="textbox"]') ||
            document.querySelector('textarea[aria-label]');
          if (editorEl) break;
          await new Promise((r) => setTimeout(r, 200));
        }

        if (!editorEl) {
          return {
            ok: false,
            noEditor: true,
            error: '未在 gemini.google.com 页面找到对话输入框，请确认已在浏览器登录账号'
          };
        }

        // 3. 如指定了具体模型（非 auto），自动点击模型切换菜单选中对应模型
        let modelStatus = 'auto';
        if (preferredModel && preferredModel !== 'auto') {
          const aliases = getTargetAliases(preferredModel);

          const findGeminiModeButton = () => {
            const directSelectors = [
              'bard-mode-switcher button',
              '[data-test-id="bard-mode-menu-button"]',
              '[data-test-id*="mode-switcher"] button',
              'button.logo-pill-btn',
              'button.input-area-switch',
              '[class*="mode-switcher"] button'
            ];
            for (const sel of directSelectors) {
              const btn = document.querySelector(sel);
              if (btn) return btn;
            }
            const candidates = Array.from(
              document.querySelectorAll('button[aria-haspopup], button[aria-expanded], [role="button"][aria-haspopup]')
            );
            return (
              candidates.find((b) => {
                const txt = `${b.innerText || ''} ${b.getAttribute('aria-label') || ''}`;
                return /4\s*hydrogen|4\s*argon|4\s*carbon|3\.5\s*flash-lite|3\.1\s*pro|2\.5\s*pro|2\.5\s*flash|quick\s*answers|everyday\s*help|detailed\s*research|code\s*&\s*analysis|most\s*complex\s*work/i.test(
                  txt
                );
              }) || null
            );
          };

          const modeBtn = findGeminiModeButton();
          if (modeBtn) {
            const btnText = modeBtn.innerText || '';
            if (matchesModelText(btnText, aliases)) {
              modelStatus = `already:${btnText.trim()}`;
            } else {
              modeBtn.click();

              let targetItem = null;
              for (let attempt = 0; attempt < 12; attempt++) {
                await new Promise((r) => setTimeout(r, 120));
                const menuItems = Array.from(
                  document.querySelectorAll(
                    '.cdk-overlay-pane [role="menuitem"], .cdk-overlay-pane [role="menuitemradio"], .cdk-overlay-pane [role="option"], .cdk-overlay-pane button, [role="menu"] button, .mat-mdc-menu-item'
                  )
                );
                targetItem = menuItems.find((item) => matchesModelText(item.innerText || item.textContent, aliases));
                if (targetItem) break;
              }

              if (!targetItem) {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
                return {
                  ok: false,
                  modelError: true,
                  error: `在 Gemini 网页版模型菜单中未找到「${preferredModel}」，请切换为可用模型或选择「跟随网页端当前模型」`
                };
              }

              const hasLockIcon = Array.from(targetItem.querySelectorAll('mat-icon, [fonticon], svg')).some((ic) => {
                const iconName = `${ic.textContent || ''} ${ic.getAttribute('fonticon') || ''} ${ic.getAttribute('data-mat-icon-name') || ''} ${ic.getAttribute('aria-label') || ''}`.toLowerCase();
                return iconName.includes('lock');
              });

              if (
                targetItem.disabled ||
                targetItem.getAttribute('aria-disabled') === 'true' ||
                hasLockIcon
              ) {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
                return {
                  ok: false,
                  modelError: true,
                  error: `Gemini 模型「${preferredModel}」在当前账号中未解锁（带🔒标识），请切换为 4 Argon / 4 Hydrogen / 3.1 Pro / 3.5 Flash-Lite`
                };
              }

              targetItem.click();
              modelStatus = `switched:${preferredModel}`;
              await new Promise((r) => setTimeout(r, 250));
            }
          } else {
            modelStatus = 'switcher_not_found';
          }
        }

        // 4. 若带有截图/分镜图，自动向 Gemini 编辑器派发 ClipboardEvent 粘贴或注入文件框
        let imageAttached = false;
        if (imgDataUrl && imgDataUrl.startsWith('data:image/')) {
          try {
            const resp = await fetch(imgDataUrl);
            const blob = await resp.blob();
            const ext = (blob.type || 'image/png').includes('jpeg') ? 'jpg' : 'png';
            const file = new File([blob], `reverse-capture.${ext}`, { type: blob.type || 'image/png' });
            const dt = new DataTransfer();
            dt.items.add(file);

            editorEl.focus();
            const pasteEvt = new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              clipboardData: dt
            });
            editorEl.dispatchEvent(pasteEvt);
            imageAttached = true;

            const fileInput = document.querySelector('input[type="file"]');
            if (fileInput) {
              await new Promise((r) => setTimeout(r, 250));
              const hasPreview = document.querySelector('uploader-file-preview, img[src^="blob:"], .file-preview');
              if (!hasPreview) {
                fileInput.files = dt.files;
                fileInput.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }

            // 等待缩略图挂载（最多 2.2s）
            for (let w = 0; w < 10; w++) {
              await new Promise((r) => setTimeout(r, 200));
              const hasPreview = document.querySelector('uploader-file-preview, img[src^="blob:"], .file-preview');
              if (hasPreview && w >= 2) break;
            }
          } catch (_imgErr) {
            imageAttached = false;
          }
        }

        // 5. 向 Gemini Quill / RichText 编辑器注入文本
        editorEl.focus();
        if (editorEl.tagName === 'TEXTAREA') {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) setter.call(editorEl, textToSend);
          else editorEl.value = textToSend;
          editorEl.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(editorEl);
          selection.removeAllRanges();
          selection.addRange(range);
          const inserted = document.execCommand('insertText', false, textToSend);
          if (!inserted) {
            editorEl.textContent = textToSend;
            editorEl.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: textToSend
              })
            );
          }
        }

        await new Promise((r) => setTimeout(r, imageAttached ? 550 : 280));

        // 6. 触发发送按钮或回车键
        let sendBtn = null;
        for (let s = 0; s < 10; s++) {
          sendBtn =
            document.querySelector('button.send-button:not([disabled])') ||
            document.querySelector('button[aria-label*="Send"]:not([disabled])') ||
            document.querySelector('button[aria-label*="发送"]:not([disabled])') ||
            document.querySelector('button[mattooltip*="Send"]:not([disabled])');
          if (sendBtn) break;
          await new Promise((r) => setTimeout(r, 200));
        }

        if (sendBtn) {
          sendBtn.click();
        } else {
          editorEl.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true
            })
          );
        }

        return { ok: true, modelStatus, imageAttached };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    }
  });

  return execResults?.[0]?.result || { ok: false, error: '执行 Gemini 页面脚本失败' };
}

/**
 * 纯 DOM 只读轮询：从 Gemini 网页渲染的 model-response 节点无损提取 Markdown 与代码块
 */
async function pollGeminiDomMarkdown(tabId) {
  const execResults = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      function serializeNodeToMarkdown(node) {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent || '';
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tag = node.tagName.toLowerCase();

        // 跳过按钮/操作栏/复制按钮等 UI 装饰节点
        if (
          ['button', 'mat-icon', 'svg', 'style', 'script'].includes(tag) ||
          node.classList?.contains('code-block-decoration') ||
          node.classList?.contains('response-container-header')
        ) {
          return '';
        }

        if (tag === 'code-block' || tag === 'pre') {
          const codeEl = node.querySelector('pre code, code') || node.querySelector('pre') || node;
          const codeText = codeEl.textContent || '';
          const langClass = codeEl.className || '';
          const langMatch = langClass.match(/language-([a-zA-Z0-9_-]+)/);
          const headerLangEl = node.querySelector('.code-block-decoration span');
          const headerLang = headerLangEl ? headerLangEl.textContent.trim().toLowerCase() : '';
          const lang = langMatch
            ? langMatch[1]
            : headerLang || (codeText.includes('<!DOCTYPE') || codeText.includes('<html') ? 'html' : '');
          return `\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n\n`;
        }

        if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
          const hashes = '#'.repeat(Number(tag[1]) || 3);
          return `${hashes} ${node.textContent.trim()}\n\n`;
        }

        if (tag === 'ul' || tag === 'ol') {
          let listOut = '';
          for (const li of Array.from(node.querySelectorAll(':scope > li'))) {
            listOut += `- ${li.textContent.trim()}\n`;
          }
          return listOut + '\n';
        }

        if (tag === 'hr') return '\n---\n\n';
        if (tag === 'br') return '\n';

        if (tag === 'p') {
          return `${node.textContent.trim()}\n\n`;
        }

        let inner = '';
        for (const child of Array.from(node.childNodes)) {
          inner += serializeNodeToMarkdown(child);
        }
        return inner;
      }

      const st = window.__WRI_GEMINI_BRIDGE_STATE__ || { initialCount: 0, useModelResponseTag: true };
      const containerNodes = st.useModelResponseTag
        ? document.querySelectorAll('model-response')
        : document.querySelectorAll('model-response, .model-response-text, message-content');
      const hasNew = containerNodes.length > (st.initialCount || 0);
      const latestNode = hasNew ? containerNodes[containerNodes.length - 1] : null;

      let md = '';
      if (latestNode) {
        const contentRoot =
          latestNode.querySelector('message-content .markdown, .markdown, message-content') || latestNode;
        md = serializeNodeToMarkdown(contentRoot).trim() || contentRoot.innerText || '';
      }

      const isStopVisible = Boolean(
        document.querySelector('button[aria-label*="Stop"]') ||
          document.querySelector('button[aria-label*="停止"]') ||
          document.querySelector('.stop-icon')
      );

      return {
        text: md,
        isGenerating: isStopVisible,
        hasNew
      };
    }
  });

  return (
    execResults?.[0]?.result || {
      text: '',
      isGenerating: false,
      hasNew: false
    }
  );
}

/**
 * 解析 Gemini Web StreamGenerate 返回的 Google Batch RPC 数据块，提取最新的候选回答 Markdown
 * @param {string} rawRpcText
 * @returns {string} 提取出的最新回复文本
 */
export function parseGeminiRpcResponseText(rawRpcText = '') {
  if (!rawRpcText || typeof rawRpcText !== 'string') return '';

  const cleaned = rawRpcText.replace(/^\)\]\}'\s*/, '');
  const lines = cleaned.split(/\r?\n/);
  let bestCandidateText = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[[')) continue;

    try {
      const outerArr = JSON.parse(trimmed);
      for (const item of outerArr) {
        if (!Array.isArray(item) || item[0] !== 'wrb.fr' || typeof item[2] !== 'string') {
          continue;
        }
        const innerPayload = JSON.parse(item[2]);
        const candidate =
          innerPayload?.[4]?.[0]?.[1]?.[0] ||
          innerPayload?.[0]?.[0] ||
          '';
        if (typeof candidate === 'string' && candidate.length > bestCandidateText.length) {
          bestCandidateText = candidate;
        }
      }
    } catch (_e) {
      // ignore non-json length lines
    }
  }

  return bestCandidateText;
}

/**
 * 构造 StreamGenerate 接口所需的 f.req 表单请求体
 */
function buildGeminiFormBody(promptText, atToken) {
  const innerReq = JSON.stringify([
    [promptText, 0, null, []],
    ['zh-CN'],
    ['', '', '']
  ]);
  const fReq = JSON.stringify([null, innerReq]);

  const formParams = new URLSearchParams();
  formParams.set('f.req', fReq);
  formParams.set('at', atToken);
  return formParams.toString();
}

/**
 * RPC 兜底通道（仅在用户选择 auto 且页面输入框未加载时回退）
 */
async function streamGeminiViaRpcFallback({ promptText, sessionRes, onChunk, signal }) {
  const reqId = Math.floor(100000 + Math.random() * 900000);
  const query = new URLSearchParams({
    bl: sessionRes.blParam || 'boq_assistant-bard-web-server_20250401.08_p0',
    _reqid: String(reqId),
    rt: 'c'
  });
  if (sessionRes.fSid) {
    query.set('f.sid', sessionRes.fSid);
  }

  const endpoint = `${GEMINI_STREAM_RPC_URL}?${query.toString()}`;
  const formBody = buildGeminiFormBody(promptText, sessionRes.atToken);

  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'X-Same-Domain': '1'
    },
    body: formBody,
    signal
  });

  if (!response.ok || !response.body) {
    throw new Error(`Gemini Web RPC 接口返回异常 (HTTP ${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let accumulatedRaw = '';
  let previousText = '';

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        throw new Error('ABORTSIGNAL_TRIGGERED');
      }

      const { value, done } = await reader.read();
      if (done) break;

      accumulatedRaw += decoder.decode(value, { stream: true });
      const latestText = parseGeminiRpcResponseText(accumulatedRaw);
      if (latestText && latestText.length > previousText.length) {
        const delta = latestText.slice(previousText.length);
        previousText = latestText;
        if (typeof onChunk === 'function') {
          onChunk(delta, previousText);
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch (_e) {
      // ignore
    }
  }

  if (!previousText) {
    throw new Error('Gemini Web RPC 响应为空，请确认已在浏览器登录 gemini.google.com');
  }
  return previousText;
}

/**
 * 调用 Gemini Web 流式生成逆向提示词（支持自动切换 UI 模型菜单：4 Argon / 4 Hydrogen / 3.1 Pro / 3.5 Flash-Lite / 4 Carbon）
 */
export async function streamGeminiWeb({ compiledPrompt, model = '4 Argon', onChunk, signal, lang = 'zh' }) {
  const sessionRes = await checkGeminiWebSession(lang);
  if (!sessionRes.ok) {
    throw new Error(sessionRes.reason || 'Gemini Web session not found. Please sign in at https://gemini.google.com/app');
  }

  const tabId = await findOrCreateGeminiTab();
  const promptText = compiledPrompt.combinedPromptForWeb || compiledPrompt.userPrompt;
  const imageDataUrl = compiledPrompt?.imageInfo?.hasValidBitmap ? compiledPrompt.imageInfo.dataUrl : '';

  const triggerRes = await triggerGeminiDomSendInTab(tabId, promptText, model, imageDataUrl);
  if (!triggerRes.ok) {
    // 若选择了特定模型但切换失败（例如带🔒未解锁），直接报错，不静默回退到错误模型
    if (triggerRes.modelError) {
      throw new Error(triggerRes.error);
    }
    // 仅在 auto 模式下找不到页面编辑器时尝试 RPC 兜底
    if (model === 'auto' && sessionRes.atToken) {
      return streamGeminiViaRpcFallback({ promptText, sessionRes, onChunk, signal });
    }
    throw new Error(triggerRes.error || '无法在 gemini.google.com 触发发送');
  }

  let previousText = '';
  let idleTicks = 0;
  let waitNewNodeTicks = 0;
  const startTime = Date.now();
  const maxWaitMs = 95000;

  while (Date.now() - startTime < maxWaitMs) {
    if (signal?.aborted) {
      throw new Error('ABORTSIGNAL_TRIGGERED');
    }

    await new Promise((r) => setTimeout(r, 220));

    const snap = await pollGeminiDomMarkdown(tabId);
    if (!snap.hasNew) {
      waitNewNodeTicks++;
      if (waitNewNodeTicks >= 36) {
        throw new Error('Gemini 网页端等待回复超时，请确认浏览器中 gemini.google.com 登录态有效');
      }
      continue;
    }

    if (snap.text && snap.text.length > previousText.length) {
      const delta = snap.text.slice(previousText.length);
      previousText = snap.text;
      idleTicks = 0;
      if (typeof onChunk === 'function') {
        onChunk(delta, previousText);
      }
    } else if (previousText.length > 0 && !snap.isGenerating) {
      idleTicks++;
    }

    if (previousText.length > 0 && idleTicks >= 5) {
      return previousText;
    }
  }

  if (previousText.length > 0) {
    return previousText;
  }

  throw new Error('等待 Gemini Web 响应超时');
}
