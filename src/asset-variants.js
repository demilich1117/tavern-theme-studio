import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from './storage-migrations.js';
export function imageDimensions(bytes, mime) {
  if (mime === 'image/png' && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (mime === 'image/gif' && bytes.length >= 10) return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (mime === 'image/webp' && bytes.length >= 30) {
    const type = bytes.toString('ascii', 12, 16);
    if (type === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (type === 'VP8 ') return { width: bytes.readUInt16LE(26) & 16383, height: bytes.readUInt16LE(28) & 16383 };
    if (type === 'VP8L') { const value = bytes.readUInt32LE(21); return { width: (value & 16383) + 1, height: ((value >>> 14) & 16383) + 1 }; }
  }
  if (mime === 'image/jpeg') {
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset++] !== 255) continue; const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      if (marker === 255 || marker === 0 || (marker >= 208 && marker <= 215)) continue;
      const length = bytes.readUInt16BE(offset); if (length < 2 || offset + length > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
      offset += length;
    }
  }
  return { width: null, height: null };
}
export async function createVariants(dataDir, assets) {
  const file = path.join(dataDir, 'asset-variants.json'); let entries = [];
  try { entries = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  async function inspect(id) {
    const { bytes, mime } = await assets.read(id);
    // Conservatively retain all GIFs and any PNG/WebP animation markers.
    return { mime, ...imageDimensions(bytes, mime), animated: mime === 'image/gif' || bytes.includes(Buffer.from('acTL')) || (mime === 'image/webp' && bytes.length >= 21 && bytes.toString('ascii', 12, 16) === 'VP8X' && !!(bytes[20] & 2)), bytes: bytes.length };
  }
  return { list: () => structuredClone(entries), inspect,
    async put(originalId, bytes, kind) {
      if (!['thumbnail', 'optimized'].includes(kind)) throw new Error('未知素材变体用途。');
      const original = await inspect(originalId);
      if (original.animated) throw new Error('动画保持原文件，不自动转换为静态图。');
      const variant = await assets.put(bytes, kind === 'thumbnail' ? '素材缩略图' : '优化变体');
      const size = await inspect(variant.id);
      if (!size.width || !size.height || !original.width || !original.height || size.width > original.width || size.height > original.height || Math.abs(size.height - original.height * size.width / original.width) > 1) throw new Error('变体需保留比例，不能放大或改变原始构图。');
      const next = [...entries.filter(e => !(e.originalId === originalId && e.kind === kind)), { originalId, variantId: variant.id, reference: variant.reference, kind, createdAt: new Date().toISOString() }];
      await atomicJson(file, next); entries = next; return variant;
    },
  };
}
