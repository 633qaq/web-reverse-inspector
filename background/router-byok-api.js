/**
 * @file background/router-byok-api.js
 * @description Google AI Studio (Gemini API) 与 OpenAI 原生 API 多模态 SSE 流式直连模块
 */

const CONNECT_TIMEOUT_MS = 25000;

/**
 * 通用 SSE (Server-Sent Events) 行流读取器
 * @param {ReadableStream<Uint8Array>} bodyStream 响应流
 * @param {(dataStr: string) => void} onDataLine 每次收到 data: 行时的回调
 * @param {AbortSignal} [signal] 中断信号
 */
async function consumeSseStream(bodyStream, onDataLine, signal) {
  const reader = bodyStream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        break;
      }

      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;
        const dataPayload = line.slice(5).trim();
        if (!dataPayload) continue;
        onDataLine(dataPayload);
      }
    }

    if (buffer.trim().startsWith('data:')) {
      const remaining = buffer.trim().slice(5).trim();
      if (remaining) onDataLine(remaining);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch (_e) {
      // ignore
    }
  }
}

/**
 * 规范化 OpenAI-Compatible API Endpoint（支持 DeepSeek / OpenRouter / SiliconFlow / Ollama 等自定义 Base URL）
 * @param {string} [baseUrl]
 * @returns {string}
 */
export function resolveOpenAIChatEndpoint(baseUrl = '') {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return 'https://api.openai.com/v1/chat/completions';
  if (/\/chat\/completions$/i.test(clean)) return clean;
  if (/\/v\d+$/i.test(clean)) return `${clean}/chat/completions`;
  return `${clean}/v1/chat/completions`;
}

function isLocalhostEndpoint(url = '') {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(String(url).trim());
}

/**
 * 解析 API 错误响应文本，输出人类可读的双语排障提示
 */
async function extractReadableApiError(response, providerName, lang = 'zh') {
  const isEn = String(lang || '').toLowerCase().startsWith('en');
  let detail = '';
  try {
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      detail = json?.error?.message || json?.message || text.slice(0, 240);
    } catch (_e) {
      detail = text.slice(0, 240);
    }
  } catch (_e) {
    detail = response.statusText || (isEn ? 'Unknown network error' : '未知网络错误');
  }

  if (response.status === 400) {
    return isEn
      ? `${providerName} bad request (HTTP 400): ${detail}`
      : `${providerName} 请求参数错误 (HTTP 400): ${detail}`;
  }
  if (response.status === 401 || response.status === 403) {
    return isEn
      ? `${providerName} authentication failed (HTTP ${response.status}): check your API key in Settings. (${detail})`
      : `${providerName} API Key 鉴权失败或无权限 (HTTP ${response.status}): 请在右上角「设置」检查密钥是否正确。(${detail})`;
  }
  if (response.status === 429) {
    return isEn
      ? `${providerName} rate limit or quota exceeded (HTTP 429): ${detail}`
      : `${providerName} 请求频率或配额超限 (HTTP 429): ${detail}`;
  }
  return isEn
    ? `${providerName} request error (HTTP ${response.status}): ${detail}`
    : `${providerName} 接口异常 (HTTP ${response.status}): ${detail}`;
}

/**
 * Google AI Studio (Gemini API) 原生多模态流式直连
 * 支持 gemini-2.5-pro / gemini-2.5-flash + inline_data Base64 图像联合输入
 */
export async function streamGeminiByok({
  apiKey,
  model = 'gemini-4-argon',
  compiledPrompt,
  onChunk,
  signal,
  lang = 'zh'
}) {
  const isEn = String(lang || '').toLowerCase().startsWith('en');
  if (!apiKey || !apiKey.trim()) {
    throw new Error(
      isEn
        ? 'Google AI Studio API Key is not configured. Click ⚙️ Settings to enter your key.'
        : '未配置 Google AI Studio API Key，请点击右上角 ⚙️ 设置面板填入密钥。'
    );
  }

  const cleanKey = apiKey.trim();
  const cleanModel = (model || 'gemini-2.5-pro').trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(cleanKey)}`;

  const userParts = [{ text: compiledPrompt.userPrompt }];
  if (compiledPrompt.imageInfo && compiledPrompt.imageInfo.hasValidBitmap) {
    userParts.push({
      inline_data: {
        mime_type: compiledPrompt.imageInfo.mimeType,
        data: compiledPrompt.imageInfo.base64Data
      }
    });
  }

  const requestBody = {
    system_instruction: {
      parts: [{ text: compiledPrompt.systemInstruction }]
    },
    contents: [
      {
        role: 'user',
        parts: userParts
      }
    ],
    generationConfig: {
      temperature: 0.25,
      maxOutputTokens: 8192
    }
  };

  const timeoutController = new AbortController();
  const connectTimer = setTimeout(() => timeoutController.abort(), CONNECT_TIMEOUT_MS);

  const onExternalAbort = () => timeoutController.abort();
  if (signal) {
    if (signal.aborted) timeoutController.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: timeoutController.signal
    });
  } catch (err) {
    clearTimeout(connectTimer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
    if (signal?.aborted) throw new Error('ABORTSIGNAL_TRIGGERED');
    throw new Error(`连接 Google AI Studio 失败或超时: ${err?.message || String(err)}`);
  }

  clearTimeout(connectTimer);

  if (!response.ok) {
    if (signal) signal.removeEventListener('abort', onExternalAbort);
    const errMsg = await extractReadableApiError(response, 'Gemini API', lang);
    throw new Error(errMsg);
  }

  if (!response.body) {
    if (signal) signal.removeEventListener('abort', onExternalAbort);
    throw new Error('Gemini API 响应不包含可读数据流');
  }

  let fullText = '';
  try {
    await consumeSseStream(
      response.body,
      (dataStr) => {
        if (dataStr === '[DONE]') return;
        try {
          const parsed = JSON.parse(dataStr);
          const parts = parsed?.candidates?.[0]?.content?.parts;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (typeof part.text === 'string' && part.text.length > 0) {
                fullText += part.text;
                if (typeof onChunk === 'function') {
                  onChunk(part.text, fullText);
                }
              }
            }
          }
        } catch (_parseErr) {
          // 忽略非完整 JSON 行
        }
      },
      signal
    );
  } finally {
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }

  return fullText;
}

/**
 * OpenAI 官方 API (gpt-4o / gpt-4o-mini) 原生多模态流式直连
 * 支持 DOM 文本 + image_url Base64 图像联合输入
 */
export async function streamOpenAIByok({
  apiKey,
  baseUrl = '',
  model = 'gpt-6.2-astra',
  compiledPrompt,
  onChunk,
  signal,
  lang = 'zh'
}) {
  const endpoint = resolveOpenAIChatEndpoint(baseUrl);
  const isLocal = isLocalhostEndpoint(endpoint);
  const cleanKey = String(apiKey || '').trim() || (isLocal ? 'local-ollama' : '');
  const isEn = String(lang || '').toLowerCase().startsWith('en');

  if (!cleanKey) {
    throw new Error(
      isEn
        ? 'OpenAI API Key is not configured. Click ⚙️ Settings to enter your key (or point Base URL to localhost).'
        : '未配置 OpenAI API Key，请点击右上角 ⚙️ 设置面板填入密钥（本地 Ollama 等接口可填 localhost Base URL 免密钥）。'
    );
  }

  const cleanModel = (model || 'gpt-6.2-astra').trim();

  const userContent = [
    {
      type: 'text',
      text: compiledPrompt.userPrompt
    }
  ];

  if (compiledPrompt.imageInfo && compiledPrompt.imageInfo.hasValidBitmap) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: compiledPrompt.imageInfo.dataUrl,
        detail: 'high'
      }
    });
  }

  const requestBody = {
    model: cleanModel,
    stream: true,
    temperature: 0.25,
    messages: [
      {
        role: 'system',
        content: compiledPrompt.systemInstruction
      },
      {
        role: 'user',
        content: userContent.length === 1 ? userContent[0].text : userContent
      }
    ]
  };

  const timeoutController = new AbortController();
  const connectTimer = setTimeout(() => timeoutController.abort(), CONNECT_TIMEOUT_MS);

  const onExternalAbort = () => timeoutController.abort();
  if (signal) {
    if (signal.aborted) timeoutController.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cleanKey}`
      },
      body: JSON.stringify(requestBody),
      signal: timeoutController.signal
    });
  } catch (err) {
    clearTimeout(connectTimer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
    if (signal?.aborted) throw new Error('ABORTSIGNAL_TRIGGERED');
    throw new Error(`连接 OpenAI API 失败或超时: ${err?.message || String(err)}`);
  }

  clearTimeout(connectTimer);

  if (!response.ok) {
    if (signal) signal.removeEventListener('abort', onExternalAbort);
    const errMsg = await extractReadableApiError(response, 'OpenAI API', lang);
    throw new Error(errMsg);
  }

  if (!response.body) {
    if (signal) signal.removeEventListener('abort', onExternalAbort);
    throw new Error('OpenAI API 响应不包含可读数据流');
  }

  let fullText = '';
  try {
    await consumeSseStream(
      response.body,
      (dataStr) => {
        if (dataStr === '[DONE]') return;
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            fullText += delta;
            if (typeof onChunk === 'function') {
              onChunk(delta, fullText);
            }
          }
        } catch (_parseErr) {
          // 忽略非完整 JSON 行
        }
      },
      signal
    );
  } finally {
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }

  return fullText;
}

/**
 * 统一 BYOK 多模态流式路由入口
 * @param {{
 *   channel: 'byok-gemini' | 'byok-openai',
 *   config: object,
 *   compiledPrompt: object,
 *   onChunk: (delta: string, fullText: string) => void,
 *   signal?: AbortSignal
 * }} options
 */
export async function streamByokGeneration(options) {
  const { channel, config = {}, compiledPrompt, onChunk, signal } = options;
  const lang = config.lang || 'zh';

  if (channel === 'byok-gemini') {
    return streamGeminiByok({
      apiKey: config.geminiApiKey,
      model: config.geminiModel || 'gemini-4-argon',
      compiledPrompt,
      onChunk,
      signal,
      lang
    });
  }

  if (channel === 'byok-openai') {
    return streamOpenAIByok({
      apiKey: config.openaiApiKey,
      baseUrl: config.openaiBaseUrl || '',
      model: config.openaiModel || 'gpt-6.2-astra',
      compiledPrompt,
      onChunk,
      signal,
      lang
    });
  }

  throw new Error(`Unsupported BYOK channel: ${channel}`);
}
