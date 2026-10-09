import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ASSET_ID, ASSET_RE, assetReference, externalImageUrl } from './shared/assets.js';
import { scanVariables } from './shared/variables.js';
import { atomicJson } from './storage-migrations.js';
import { serialQueue } from './serial-queue.js';
import { dependencies, rewriteDependencies } from './css-dependencies.js';

export const MAX_ASSET_BYTES = 32 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 48 * 1024 * 1024;
const DATA_IMAGE = /data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})/g;
const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
export function imageType(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'gif';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  throw new Error('请选择 PNG、JPEG、WebP 或 GIF 图片。');
}
// Keep source-position-based variable IDs valid when image values change length.
export async function mapProjectCss(value, transform) {
  const next = structuredClone(value);
  const oldCss = next.baseTheme?.custom_css;
  if (typeof oldCss === 'string') {
    const before = scanVariables(oldCss);
    next.baseTheme.custom_css = await transform(oldCss);
    const after = scanVariables(next.baseTheme.custom_css);
    if (next.variableEdits && typeof next.variableEdits === 'object') {
      const ids = new Map(before.map((v, i) => [v.id, after[i]?.id]));
      const edits = {};
      for (const [id, v] of Object.entries(next.variableEdits)) edits[ids.get(id) || id] = typeof v === 'string' ? await transform(v) : v;
      next.variableEdits = edits;
    }
  }
  if (typeof next.customCss === 'string') next.customCss = await transform(next.customCss);
  for (const scope of Object.values(next.rules || {})) for (const props of Object.values(scope)) for (const [key, value] of Object.entries(props)) if (typeof value === 'string') props[key] = await transform(value);
  for (const layer of next.decorations || []) if (typeof layer.asset === 'string') layer.asset = await transform(layer.asset);
  for (const reference of next.assetRefs || []) if (typeof reference.reference === 'string') reference.reference = await transform(reference.reference);
  return next;
}
export async function createAssetStore(dataDir) {
  const dir = path.join(dataDir, 'assets'), indexFile = path.join(dir, 'index.json');
  await mkdir(dir, { recursive: true });
  let entries = [];
  const commit = serialQueue();
  try { entries = JSON.parse(await readFile(indexFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  async function save(entry) {
    return commit(async () => {
    const existing = entries.find(x => x.id === entry.id);
    if (existing) return existing;
    const next = [...entries, { ...entry, createdAt: new Date().toISOString() }];
    await atomicJson(indexFile, next); entries = next;
    return next.at(-1);
    });
  }
  async function put(bytes, name = '导入的装饰') {
    if (!bytes.length || bytes.length > MAX_ASSET_BYTES) throw Object.assign(new Error('单张素材需为 1 字节至 32 MiB；可先缩小静态图片，或使用外链。'), { status: 413 });
    const ext = imageType(bytes), id = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
    try { await writeFile(path.join(dir, id), bytes, { flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    return save({ id, kind: 'local', name: String(name).slice(0, 120), size: bytes.length, mime: mime[ext], reference: assetReference(id) });
  }
  async function read(id) {
    if (!ASSET_ID.test(id)) throw new Error('素材编号无效。');
    const bytes = await readFile(path.join(dir, id));
    if (!id.startsWith(createHash('sha256').update(bytes).digest('hex') + '.')) throw new Error(`素材哈希不匹配：${id}；原文件已保留。`);
    return { bytes, mime: mime[id.split('.').at(-1)] };
  }
  async function extract(css) {
    if (typeof css !== 'string') return css;
    const matches = [...css.matchAll(DATA_IMAGE)];
    for (const match of matches.reverse()) {
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) throw new Error('内嵌图片的 base64 无效。');
      const entry = await put(bytes);
      css = css.slice(0, match.index) + entry.reference + css.slice(match.index + match[0].length);
    }
    // Missing local files must never silently produce a broken portable export.
    for (const id of new Set([...css.matchAll(ASSET_RE)].map(m => m[1]))) await read(id);
    for (const ref of dependencies(css).filter(r => r.startsWith('tts-asset://'))) await read(ref.slice(12));
    return css;
  }
  async function embed(css) {
    const values = new Map();
    for (const id of new Set([...css.matchAll(ASSET_RE)].map(m => m[1]))) {
      const { bytes, mime } = await read(id); values.set(id, `data:${mime};base64,${bytes.toString('base64')}`);
    }
    css = css.replace(ASSET_RE, (_, id) => values.get(id));
    const escaped = new Map();
    for (const ref of dependencies(css).filter(r => r.startsWith('tts-asset://'))) {
      const { bytes, mime } = await read(ref.slice(12)); escaped.set(ref, `data:${mime};base64,${bytes.toString('base64')}`);
    }
    return escaped.size ? rewriteDependencies(css, escaped, css.includes('{') || /^\s*@/.test(css) ? 'stylesheet' : 'value') : css;
  }
  return {
    list: () => structuredClone(entries), put, read, extract, embed,
    async archive(ids, archived) {
      return commit(async () => {
      if (!Array.isArray(ids) || !ids.length || ids.some(id => !entries.some(e => e.id === id))) throw new Error('请选择存在的素材。');
      const next = entries.map(e => ids.includes(e.id) ? { ...e, archived: archived === true } : e);
      await atomicJson(indexFile, next); entries = next; return structuredClone(entries);
      });
    },
    async external(value, name) {
      const url = externalImageUrl(value);
      return save({ id: createHash('sha256').update(url).digest('hex'), kind: 'external', name: String(name || new URL(url).hostname).slice(0, 120), reference: url, size: null });
    },
    async command(command, project) {
      if (command?.type === 'optimize-assets') return { type: 'import-project', project: await mapProjectCss(project, extract) };
      if (command?.type === 'import-project') return { ...command, project: await mapProjectCss(command.project, extract) };
      if (['import-theme', 'base-theme', 'source-refresh'].includes(command?.type)) return { ...command, theme: { ...command.theme, custom_css: await extract(command.theme?.custom_css ?? '') } };
      if (command?.type === 'custom-css') return { ...command, css: await extract(command.css) };
      if (command?.type === 'variable' && typeof command.value === 'string') return { ...command, value: await extract(command.value) };
      if (command?.type === 'decoration-add' && command.asset) return { ...command, asset: await extract(command.asset) };
      if (command?.type === 'decoration-update' && command.patch?.asset) return { ...command, patch: { ...command.patch, asset: await extract(command.patch.asset) } };
      return command;
    },
    portableProject: project => mapProjectCss(project, embed),
  };
}
