/**
 * @file background/router-web-chatgpt.js
 * @description ChatGPT 网页版 (chatgpt.com) 零侵入 DOM 桥接器：
 * 1. 绝不重写或劫持 window.fetch（防止触发 OpenAI Sentinel / Turnstile 环境完整性检测导致 403 Unusual activity）。
 * 2. 若检测到旧版本留下的 fetch 钩子，自动从同源干净 iframe 恢复原生 [native code] fetch。
 * 3. 采用 ProseMirror 原生 execCommand 输入与纯 DOM 语法树实时流式读取。
 */

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const SESSION_URL = 'https://chatgpt.com/api/auth/session';

let cachedSession = {
  accessToken: '',
  expiresAt: 0,
  userEmail: ''
};

/**
 * 查找已打开的 chatgpt.com 标签页，若不存在则自动创建一个标签页
 * @returns {Promise<number>} tabId
 */
async function findOrCreateChatGPTTab() {
  const existingTabs = await chrome.tabs.query({
    url: ['https://chatgpt.com/*', 'https://chat.openai.com/*']
  });

  if (existingTabs && existingTabs.length > 0 && existingTabs[0].id) {
    return existingTabs[0].id;
  }

  const createdTab = await chrome.tabs.create({
    url: `${CHATGPT_ORIGIN}/`,
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
 * 检测 ChatGPT Web 登录状态（仅通过 chrome.cookies 无感检测，不主动发裸请求触发风控）
 */
export async function checkChatGPTWebSession(lang = 'zh') {
  const isEn = String(lang || '').toLowerCase().startsWith('en');
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'chatgpt.com' });
    const hasSessionToken =
      Array.isArray(cookies) &&
      cookies.some(
        (c) =>
          c.name.includes('session-token') ||
          c.name === '__Secure-next-auth.session-token'
      );

    if (hasSessionToken) {
      return {
        ok: true,
        accessToken: 'cookie-verified',
        reason: isEn
          ? 'ChatGPT Web session ready (non-invasive DOM bridge)'
          : 'ChatGPT Web 登录态已就绪 (零侵入 DOM 桥接模式)'
      };
    }

    // 备选：轻量检测 session 接口
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(SESSION_URL, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (resp.ok) {
      const data = await resp.json();
      if (data && data.accessToken) {
        cachedSession = {
          accessToken: data.accessToken,
          userEmail: data?.user?.email || '',
          expiresAt: Date.now() + 10 * 60 * 1000
        };
        return {
          ok: true,
          accessToken: data.accessToken,
          userEmail: cachedSession.userEmail,
          reason: isEn
            ? `ChatGPT Web connected${cachedSession.userEmail ? ` (${cachedSession.userEmail})` : ''}`
            : `ChatGPT Web 已连接 ${cachedSession.userEmail ? `(${cachedSession.userEmail})` : ''}`
        };
      }
    }

    return {
      ok: false,
      reason: isEn
        ? 'No chatgpt.com session found. Sign in or switch to BYOK.'
        : '未检测到 chatgpt.com 登录态，请先在浏览器登录或切换 BYOK'
    };
  } catch (_err) {
    return {
      ok: false,
      reason: isEn
        ? 'Please sign in at https://chatgpt.com first'
        : '请先在浏览器打开 https://chatgpt.com 登录账号'
    };
  }
}

/**
 * 在 chatgpt.com 标签页中恢复原生环境、切换模型下拉框、自动附带截图并驱动官方 ProseMirror 编辑器发送消息
 */
async function triggerCleanDomSendInTab(tabId, promptText, model = 'GPT-6.2 Astra', imageDataUrl = '') {
  const execResults = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [promptText, model, imageDataUrl || ''],
    func: async (textToSend, preferredModel, imgDataUrl) => {
      try {
        // 1. 若当前标签页曾被旧版本脚本重写过 window.fetch，从同源干净 iframe 恢复原生 [native code] fetch
        if (window.__WRI_FETCH_TAP_INSTALLED__ || !Function.prototype.toString.call(window.fetch).includes('[native code]')) {
          try {
            const cleanFrame = document.createElement('iframe');
            cleanFrame.style.display = 'none';
            document.documentElement.appendChild(cleanFrame);
            if (cleanFrame.contentWindow && cleanFrame.contentWindow.fetch) {
              window.fetch = cleanFrame.contentWindow.fetch.bind(window);
            }
            cleanFrame.remove();
            window.__WRI_FETCH_TAP_INSTALLED__ = false;
          } catch (_e) {
            // ignore
          }
        }

        // 2. 通过 ChatGPT 官方顶栏模型切换菜单真实切换模型（支持 GPT-6.2 Astra / Sol / 6.1 / 6 等）
        let switchedModelInfo = 'auto';
        if (preferredModel && preferredModel !== 'auto') {
          const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const targetNorm = norm(preferredModel);

          const isMatchLine = (text) => {
            const lines = String(text || '')
              .split(/\r?\n/)
              .map(norm)
              .filter(Boolean);
            return lines.some(
              (line) =>
                line === targetNorm ||
                line === `${targetNorm} max` ||
                line.startsWith(`${targetNorm} `)
            );
          };

          const findModelButton = () => {
            const direct = document.querySelector('button[data-testid="model-switcher-dropdown-button"]');
            if (direct) return direct;
            const buttons = Array.from(document.querySelectorAll('button[aria-haspopup]'));
            return (
              buttons.find((btn) =>
                /gpt-|chatgpt|astra|sol|terra|默认/i.test(
                  `${btn.innerText || ''} ${btn.getAttribute('aria-label') || ''}`
                )
              ) || null
            );
          };

          const modelBtn = findModelButton();
          if (modelBtn) {
            const currentText = modelBtn.innerText || '';
            if (isMatchLine(currentText)) {
              switchedModelInfo = `already:${currentText.trim()}`;
            } else {
              // 兼容 Radix UI：依次派发 pointerdown + mousedown + click 打开菜单
              modelBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
              modelBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
              modelBtn.click();

              let matchedItem = null;
              for (let attempt = 0; attempt < 12; attempt++) {
                await new Promise((r) => setTimeout(r, 120));
                const menuItems = Array.from(
                  document.querySelectorAll(
                    '[role="menuitem"], [role="menuitemradio"], [role="option"], [data-radix-collection-item]'
                  )
                );
                matchedItem = menuItems.find((item) => isMatchLine(item.innerText || item.textContent));
                if (matchedItem) break;
              }

              if (matchedItem) {
                const isDisabled =
                  matchedItem.disabled ||
                  matchedItem.getAttribute('aria-disabled') === 'true' ||
                  matchedItem.dataset?.disabled === 'true';
                if (isDisabled) {
                  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
                  return {
                    ok: false,
                    error: `ChatGPT 模型「${preferredModel}」当前账号暂不可用或处于锁定状态，请切换其他模型`
                  };
                }
                matchedItem.click();
                switchedModelInfo = `switched:${preferredModel}`;
                await new Promise((r) => setTimeout(r, 240));
              } else {
                // 未匹配到目标模型时按下 Escape 收起菜单，避免遮挡后续输入框
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
                switchedModelInfo = `not_found:${preferredModel}`;
              }
            }
          }
        }

        // 2. 记录发送前已有的 assistant 回复节点数
        const assistantSelector = '[data-message-author-role="assistant"]';
        const initialCount = document.querySelectorAll(assistantSelector).length;
        window.__WRI_DOM_BRIDGE_STATE__ = {
          initialCount,
          startedAt: Date.now()
        };

        // 3. 等待 #prompt-textarea 输入框就绪
        let editorEl = null;
        for (let i = 0; i < 25; i++) {
          editorEl =
            document.querySelector('#prompt-textarea') ||
            document.querySelector('div[contenteditable="true"]') ||
            document.querySelector('textarea');
          if (editorEl) break;
          await new Promise((r) => setTimeout(r, 200));
        }

        if (!editorEl) {
          return {
            ok: false,
            error: '未找到 chatgpt.com 输入框，请确认已在浏览器登录 chatgpt.com'
          };
        }

        // 4. 若带有截图/分镜图，自动通过 DataTransfer / ClipboardEvent 贴图上传
        let imageAttached = false;
        if (imgDataUrl && imgDataUrl.startsWith('data:image/')) {
          try {
            const resp = await fetch(imgDataUrl);
            const blob = await resp.blob();
            const ext = (blob.type || 'image/png').includes('jpeg') ? 'jpg' : 'png';
            const file = new File([blob], `reverse-capture.${ext}`, { type: blob.type || 'image/png' });
            const dt = new DataTransfer();
            dt.items.add(file);

            // 优先注入页面文件上传控件，其次向编辑器派发 paste 事件
            const fileInput =
              document.querySelector('input[type="file"][accept*="image"]') ||
              document.querySelector('input[type="file"]');
            if (fileInput) {
              fileInput.files = dt.files;
              fileInput.dispatchEvent(new Event('change', { bubbles: true }));
              imageAttached = true;
            } else {
              editorEl.focus();
              const pasteEvt = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt
              });
              editorEl.dispatchEvent(pasteEvt);
              imageAttached = true;
            }

            // 温和等待图片上传缩略图就绪（最多 2.2s，不阻断后续发送）
            for (let w = 0; w < 11; w++) {
              await new Promise((r) => setTimeout(r, 200));
              const readyBtn =
                document.querySelector('button[data-testid="send-button"]:not([disabled])') ||
                document.querySelector('button[aria-label*="Send"]:not([disabled])');
              const hasThumb = document.querySelector('img[src^="blob:"], [data-testid*="attachment"]');
              if (hasThumb && readyBtn && w >= 2) break;
            }
          } catch (_imgErr) {
            imageAttached = false;
          }
        }

        // 5. 使用标准 Selection + execCommand('insertText') 向 ProseMirror 注入文本（保持原生事件链完整性）
        editorEl.focus();
        if (editorEl.tagName === 'TEXTAREA') {
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value'
          )?.set;
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
            document.querySelector('button[data-testid="send-button"]:not([disabled])') ||
            document.querySelector('button[aria-label*="Send"]:not([disabled])') ||
            document.querySelector('button[aria-label*="发送"]:not([disabled])') ||
            document.querySelector('form button[type="submit"]:not([disabled])');
          if (sendBtn) break;
          await new Promise((r) => setTimeout(r, 200));
        }

        if (sendBtn && !sendBtn.disabled) {
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

        return { ok: true, switchedModelInfo, imageAttached };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    }
  });

  return execResults?.[0]?.result || { ok: false, error: '执行页面脚本失败' };
}

/**
 * 纯 DOM 只读轮询：从页面渲染的 [data-message-author-role="assistant"] 节点无损还原 Markdown 与代码块
 */
async function pollAssistantDomMarkdown(tabId) {
  const execResults = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      function serializeDomToMarkdown(rootEl) {
        if (!rootEl) return '';
        const container = rootEl.querySelector('.markdown') || rootEl;

        function walk(node) {
          if (!node) return '';
          if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
          if (node.nodeType !== Node.ELEMENT_NODE) return '';

          const tag = node.tagName.toLowerCase();
          if (['button', 'svg', 'style', 'script'].includes(tag)) return '';

          if (tag === 'pre') {
            const codeEl = node.querySelector('code');
            const codeText = codeEl ? codeEl.textContent : node.textContent;
            const langClass = codeEl?.className || '';
            const langMatch = langClass.match(/language-([a-zA-Z0-9_-]+)/);
            const lang = langMatch
              ? langMatch[1]
              : codeText.includes('<!DOCTYPE') || codeText.includes('<html')
              ? 'html'
              : '';
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
          if (tag === 'p') return `${node.textContent.trim()}\n\n`;

          let out = '';
          for (const child of Array.from(node.childNodes)) {
            out += walk(child);
          }
          return out;
        }

        return walk(container).trim() || container.innerText || '';
      }

      // 检测页面是否弹出了红色错误提示框（如 Unusual activity / Rate limit）
      const alertEl =
        document.querySelector('[role="alert"]') ||
        document.querySelector('.text-token-text-error');
      const alertText = alertEl ? alertEl.textContent.trim() : '';
      if (alertText && (alertText.includes('Unusual activity') || alertText.includes('Try again later'))) {
        return {
          text: '',
          isGenerating: false,
          error: 'ChatGPT 网页端当前处于设备风控冷却期 (Unusual activity)'
        };
      }

      const st = window.__WRI_DOM_BRIDGE_STATE__ || { initialCount: 0 };
      const nodes = document.querySelectorAll('[data-message-author-role="assistant"]');
      const hasNew = nodes.length > (st.initialCount || 0);
      const latestNode = hasNew ? nodes[nodes.length - 1] : null;
      const md = latestNode ? serializeDomToMarkdown(latestNode) : '';

      const isStopVisible = Boolean(
        document.querySelector('button[data-testid="stop-button"]') ||
          document.querySelector('button[aria-label*="Stop"]')
      );

      return {
        text: md,
        isGenerating: isStopVisible,
        hasNew,
        error: ''
      };
    }
  });

  return (
    execResults?.[0]?.result || {
      text: '',
      isGenerating: false,
      hasNew: false,
      error: ''
    }
  );
}

/**
 * 调用 ChatGPT Web 流式生成逆向提示词（支持自动切换官方 UI 模型菜单：GPT-6.2 Astra / Sol / 6.1 / 6 等）
 */
export async function streamChatGPTWeb({ compiledPrompt, model = 'GPT-6.2 Astra', onChunk, signal, lang = 'zh' }) {
  const sessionRes = await checkChatGPTWebSession(lang);
  if (!sessionRes.ok) {
    throw new Error(sessionRes.reason);
  }

  const tabId = await findOrCreateChatGPTTab();
  const promptText = compiledPrompt.combinedPromptForWeb || compiledPrompt.userPrompt;
  const imageDataUrl = compiledPrompt?.imageInfo?.hasValidBitmap ? compiledPrompt.imageInfo.dataUrl : '';

  const triggerRes = await triggerCleanDomSendInTab(tabId, promptText, model, imageDataUrl);
  if (!triggerRes.ok) {
    throw new Error(triggerRes.error || '无法在 chatgpt.com 触发发送');
  }

  let previousText = '';
  let idleTicks = 0;
  let waitNewNodeTicks = 0;
  const startTime = Date.now();
  const maxWaitMs = 90000;

  while (Date.now() - startTime < maxWaitMs) {
    if (signal?.aborted) {
      throw new Error('ABORTSIGNAL_TRIGGERED');
    }

    await new Promise((r) => setTimeout(r, 220));

    const snap = await pollAssistantDomMarkdown(tabId);
    if (snap.error) {
      throw new Error(snap.error);
    }

    if (!snap.hasNew) {
      waitNewNodeTicks++;
      // 若超过 8 秒仍未出现新回复节点（例如后台标签页被 Turnstile 拦截），快速交由本地高精度逆向引擎处理
      if (waitNewNodeTicks >= 36) {
        throw new Error('ChatGPT 网页端在后台标签页等待人机校验，已自动启用内置高精度逆向编译器');
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

  throw new Error('等待 ChatGPT Web 响应超时，已自动切换为内置高精度逆向编译器');
}
