/**
 * @file utils/zip-lite.js
 * @description 零第三方依赖的纯原生 ES Module ZIP 解压与打包引擎
 * - 解压：基于浏览器原生 DecompressionStream('deflate-raw') 与 Central Directory（兼容 Data Descriptor）
 * - 打包：基于浏览器原生 CompressionStream('deflate-raw') + 标准 IEEE CRC-32（兼容 PowerPoint / WPS / Keynote）
 */

const SIG_EOCD = 0x06054b50;
const SIG_CD = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const utf8Decoder = new TextDecoder('utf-8');
const utf8Encoder = new TextEncoder();
const latin1Decoder = new TextDecoder('iso-8859-1');

// 预计算 IEEE 802.3 CRC-32 查找表
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * 计算字节数组的标准 CRC-32 校验和
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function computeCrc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 使用浏览器原生 CompressionStream('deflate-raw') 压缩数据块
 * @param {Uint8Array} rawBytes
 * @returns {Promise<Uint8Array>}
 */
async function deflateRawBytes(rawBytes) {
  const stream = new Blob([rawBytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * 将 Date 对象转换为 ZIP 规范的 DOS 时间与日期字段
 * @param {Date} [date]
 */
function toDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { dosTime, dosDate };
}

function shouldStoreWithoutDeflate(path, byteLength) {
  if (byteLength < 64) return true;
  return /\.(png|jpe?g|gif|webp|zip|mp4|mp3|woff2)$/i.test(path);
}

/**
 * 在字节数组末尾倒序定位 End of Central Directory (EOCD) 偏移量
 * @param {DataView} view
 * @param {number} byteLength
 * @returns {number}
 */
function findEocdOffset(view, byteLength) {
  const minOffset = Math.max(0, byteLength - 65557);
  for (let i = byteLength - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      return i;
    }
  }
  return -1;
}

/**
 * 解码 ZIP 条目文件名
 */
function decodeEntryName(bytes, flags) {
  const isUtf8 = (flags & 0x0800) !== 0;
  const raw = isUtf8 ? utf8Decoder.decode(bytes) : latin1Decoder.decode(bytes);
  return raw.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * 使用浏览器原生 DecompressionStream('deflate-raw') 解压 DEFLATE 数据块
 * @param {Uint8Array} compressedBytes
 * @returns {Promise<Uint8Array>}
 */
async function inflateRawBytes(compressedBytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前运行环境不支持原生 DecompressionStream，请升级 Chrome 浏览器');
  }
  const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * 规范化压缩包内部相对路径（处理 ../ 与多余斜杠）
 * @param {string} path
 */
export function normalizeZipPath(path = '') {
  const parts = String(path).replace(/\\/g, '/').split('/');
  const stack = [];
  for (const seg of parts) {
    if (!seg || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return stack.join('/');
}

/**
 * 解析 ZIP ArrayBuffer 并返回按需解压访问器
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {Promise<{
 *   entries: Map<string, object>,
 *   listPaths: (prefix?: string) => string[],
 *   has: (path: string) => boolean,
 *   getBytes: (path: string) => Promise<Uint8Array|null>,
 *   getText: (path: string) => Promise<string|null>,
 *   getDataUrl: (path: string, mime?: string) => Promise<string|null>
 * }>}
 */
export async function openZipArchive(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocdOffset = findEocdOffset(view, bytes.byteLength);
  if (eocdOffset < 0) {
    throw new Error('无效的 PPTX/ZIP 文件：未找到 Central Directory 结束标识');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const entries = new Map();
  const lowerIndex = new Map();
  let cursor = cdOffset;

  for (let i = 0; i < totalEntries && cursor + 46 <= bytes.byteLength; i++) {
    if (view.getUint32(cursor, true) !== SIG_CD) break;

    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLen);
    const entryPath = normalizeZipPath(decodeEntryName(nameBytes, flags));
    cursor += 46 + nameLen + extraLen + commentLen;

    if (!entryPath || entryPath.endsWith('/')) continue;

    const meta = {
      path: entryPath,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    };
    entries.set(entryPath, meta);
    lowerIndex.set(entryPath.toLowerCase(), entryPath);
  }

  const cache = new Map();

  function resolvePath(rawPath) {
    const clean = normalizeZipPath(rawPath);
    if (entries.has(clean)) return clean;
    return lowerIndex.get(clean.toLowerCase()) || null;
  }

  async function getBytes(rawPath) {
    const resolved = resolvePath(rawPath);
    if (!resolved) return null;
    if (cache.has(resolved)) return cache.get(resolved);

    const meta = entries.get(resolved);
    const lh = meta.localHeaderOffset;
    if (lh + 30 > bytes.byteLength || view.getUint32(lh, true) !== SIG_LOCAL) {
      throw new Error(`ZIP 条目头部损坏: ${resolved}`);
    }

    const localNameLen = view.getUint16(lh + 26, true);
    const localExtraLen = view.getUint16(lh + 28, true);
    const dataStart = lh + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + meta.compressedSize;

    if (dataEnd > bytes.byteLength) {
      throw new Error(`ZIP 条目数据越界: ${resolved}`);
    }

    const rawSlice = bytes.subarray(dataStart, dataEnd);
    let output;
    if (meta.method === 0) {
      output = rawSlice.slice();
    } else if (meta.method === 8) {
      output = await inflateRawBytes(rawSlice);
    } else {
      throw new Error(`不支持的 ZIP 压缩方式 (${meta.method}): ${resolved}`);
    }

    cache.set(resolved, output);
    return output;
  }

  async function getText(rawPath) {
    const buf = await getBytes(rawPath);
    if (!buf) return null;
    return utf8Decoder.decode(buf);
  }

  async function getDataUrl(rawPath, explicitMime = '') {
    const buf = await getBytes(rawPath);
    if (!buf) return null;
    const mime = explicitMime || guessMimeByExt(rawPath);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < buf.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, buf.subarray(i, i + chunkSize));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  }

  function listPaths(prefix = '') {
    const normPrefix = normalizeZipPath(prefix);
    const keys = Array.from(entries.keys());
    return normPrefix ? keys.filter((k) => k.startsWith(normPrefix)) : keys;
  }

  return {
    entries,
    listPaths,
    has: (p) => Boolean(resolvePath(p)),
    getBytes,
    getText,
    getDataUrl
  };
}

function guessMimeByExt(filePath = '') {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'application/octet-stream';
}

/**
 * 将条目集合打包为标准 ZIP 二进制（适用于 .pptx 等 OOXML 格式导出）
 * @param {Array<{ path: string, data: string | Uint8Array | ArrayBuffer, compress?: boolean }> | Map<string, string | Uint8Array | ArrayBuffer> | Record<string, string | Uint8Array | ArrayBuffer>} inputEntries
 * @returns {Promise<Uint8Array>}
 */
export async function buildZipArchive(inputEntries) {
  let rawList = [];
  if (Array.isArray(inputEntries)) {
    rawList = inputEntries;
  } else if (inputEntries instanceof Map) {
    for (const [path, data] of inputEntries.entries()) {
      rawList.push({ path, data });
    }
  } else if (inputEntries && typeof inputEntries === 'object') {
    for (const [path, data] of Object.entries(inputEntries)) {
      rawList.push({ path, data });
    }
  }

  const canDeflate = typeof CompressionStream !== 'undefined';
  const { dosTime, dosDate } = toDosDateTime(new Date());
  const prepared = [];
  let totalLocalSize = 0;
  let totalCentralSize = 0;

  for (const item of rawList) {
    const cleanPath = normalizeZipPath(item?.path || '');
    if (!cleanPath) continue;

    let rawBytes;
    if (typeof item.data === 'string') {
      rawBytes = utf8Encoder.encode(item.data);
    } else if (item.data instanceof Uint8Array) {
      rawBytes = item.data;
    } else if (item.data instanceof ArrayBuffer) {
      rawBytes = new Uint8Array(item.data);
    } else {
      rawBytes = new Uint8Array(0);
    }

    const nameBytes = utf8Encoder.encode(cleanPath);
    const crc = computeCrc32(rawBytes);
    let method = 0;
    let payloadBytes = rawBytes;

    const wantCompress = item.compress !== false && canDeflate && !shouldStoreWithoutDeflate(cleanPath, rawBytes.length);
    if (wantCompress) {
      try {
        const deflated = await deflateRawBytes(rawBytes);
        if (deflated.length < rawBytes.length) {
          method = 8;
          payloadBytes = deflated;
        }
      } catch (_err) {
        // 压缩异常时自动退回 STORE（无损）
        method = 0;
        payloadBytes = rawBytes;
      }
    }

    const localOffset = totalLocalSize;
    totalLocalSize += 30 + nameBytes.length + payloadBytes.length;
    totalCentralSize += 46 + nameBytes.length;

    prepared.push({
      nameBytes,
      crc,
      method,
      compressedSize: payloadBytes.length,
      uncompressedSize: rawBytes.length,
      payloadBytes,
      localOffset
    });
  }

  const totalSize = totalLocalSize + totalCentralSize + 22;
  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);

  // 1. 写入所有 Local File Headers + 文件数据
  let cursor = 0;
  for (const entry of prepared) {
    view.setUint32(cursor, SIG_LOCAL, true);
    view.setUint16(cursor + 4, 20, true); // Version needed (2.0)
    view.setUint16(cursor + 6, 0x0800, true); // UTF-8 filename flag
    view.setUint16(cursor + 8, entry.method, true);
    view.setUint16(cursor + 10, dosTime, true);
    view.setUint16(cursor + 12, dosDate, true);
    view.setUint32(cursor + 14, entry.crc, true);
    view.setUint32(cursor + 18, entry.compressedSize, true);
    view.setUint32(cursor + 22, entry.uncompressedSize, true);
    view.setUint16(cursor + 26, entry.nameBytes.length, true);
    view.setUint16(cursor + 28, 0, true); // Extra field length
    cursor += 30;

    output.set(entry.nameBytes, cursor);
    cursor += entry.nameBytes.length;

    output.set(entry.payloadBytes, cursor);
    cursor += entry.payloadBytes.length;
  }

  // 2. 写入 Central Directory Headers
  const cdOffset = cursor;
  for (const entry of prepared) {
    view.setUint32(cursor, SIG_CD, true);
    view.setUint16(cursor + 4, 20, true); // Version made by
    view.setUint16(cursor + 6, 20, true); // Version needed
    view.setUint16(cursor + 8, 0x0800, true); // UTF-8 flag
    view.setUint16(cursor + 10, entry.method, true);
    view.setUint16(cursor + 12, dosTime, true);
    view.setUint16(cursor + 14, dosDate, true);
    view.setUint32(cursor + 16, entry.crc, true);
    view.setUint32(cursor + 20, entry.compressedSize, true);
    view.setUint32(cursor + 24, entry.uncompressedSize, true);
    view.setUint16(cursor + 28, entry.nameBytes.length, true);
    view.setUint16(cursor + 30, 0, true); // Extra
    view.setUint16(cursor + 32, 0, true); // Comment
    view.setUint16(cursor + 34, 0, true); // Disk number start
    view.setUint16(cursor + 36, 0, true); // Internal attrs
    view.setUint32(cursor + 38, 0, true); // External attrs
    view.setUint32(cursor + 42, entry.localOffset, true);
    cursor += 46;

    output.set(entry.nameBytes, cursor);
    cursor += entry.nameBytes.length;
  }

  // 3. 写入 End of Central Directory (EOCD)
  view.setUint32(cursor, SIG_EOCD, true);
  view.setUint16(cursor + 4, 0, true); // Disk number
  view.setUint16(cursor + 6, 0, true); // Start disk
  view.setUint16(cursor + 8, prepared.length, true);
  view.setUint16(cursor + 10, prepared.length, true);
  view.setUint32(cursor + 12, totalCentralSize, true);
  view.setUint32(cursor + 16, cdOffset, true);
  view.setUint16(cursor + 20, 0, true); // Comment length

  return output;
}
