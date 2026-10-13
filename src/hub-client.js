import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJson } from './storage-migrations.js';
import { MAX_ASSET_BYTES, imageType, mapProjectCss } from './asset-store.js';
import { serialQueue } from './serial-queue.js';

const HASH = /^[a-f0-9]{64}$/;
const ASSET_PATH = /^assets\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_-]+\.(png|jpg|webp|gif)$/;
function baseUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('素材源需为 HTTPS 或本机 HTTP 地址，不能包含凭据。');
  return url.href.replace(/\/?$/, '/');
}
async function bytes(url, max = MAX_ASSET_BYTES) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`素材源响应 ${response.status}`);
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.length; if (length > max) throw new Error('素材源响应超过大小上限。'); chunks.push(chunk); }
  return { bytes: Buffer.concat(chunks), type: response.headers.get('content-type') || '' };
}
export async function createHubClient(dataDir, assets) {
  const file = path.join(dataDir, 'hub-cache.json');
  let cache = { source: 'http://127.0.0.1:19325/', assets: [], revision: null, config: {}, checked: {} };
  try { cache = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const commit = serialQueue();
  const save = update => commit(async () => { const next = update(cache); await atomicJson(file, next); cache = next; });
  const verification = (hash, url) => cache.checked[`${hash}:${url}`] || (cache.checked[hash]?.url === url ? cache.checked[hash] : null);
  const item = id => { const found = cache.assets.find(a => a.id === id); if (!found) throw new Error('素材不存在，请刷新目录。'); return found; };
  function pinned(a) {
    if (a.committed === false || !/^[a-f0-9]{40}$/.test(cache.config.commit || '') || !/^[\w.-]+\/[\w.-]+$/.test(cache.config.repository || '')) return null;
    return `https://raw.githubusercontent.com/${cache.config.repository}/${cache.config.commit}/${a.path}`;
  }
  const cached = a => assets.list().find(v => v.id === `${a.hash}.${a.ext}`);
  const status = () => structuredClone({ ...cache, assets: cache.assets.map(a => ({ ...a, cached: !!cached(a), preview: cached(a)?.reference || null, pinned: pinned(a), verification: verification(a.hash, pinned(a)), publication: { local: cache.config.mode === 'local', committed: a.committed ?? null, pushed: null, deployed: null } })) });
  async function refresh(source = cache.source) {
    source = baseUrl(source);
    try {
      const [catalogData, configData] = await Promise.all([bytes(new URL('catalog.json', source), 8 * 1048576), bytes(new URL('hub.json', source), 32768)]);
      const catalog = JSON.parse(catalogData.bytes), config = JSON.parse(configData.bytes);
      if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.assets) || catalog.assets.length > 10000) throw new Error('不支持的 Source Hub 目录。');
      const entries = catalog.assets.map(a => {
        if (!HASH.test(a.hash) || !HASH.test(a.id) || !ASSET_PATH.test(a.path) || a.path.split('/').some(p => p === '..') || !['png', 'jpg', 'webp', 'gif'].includes(a.ext) || !a.path.endsWith('.' + a.ext) || !Number.isSafeInteger(a.bytes) || a.bytes < 1 || a.bytes > MAX_ASSET_BYTES) throw new Error('素材目录包含无效路径、哈希或大小。');
        return Object.fromEntries(['id', 'path', 'name', 'collection', 'version', 'hash', 'bytes', 'ext', 'mime', 'width', 'height', 'animated', 'tags', 'archived', 'committed'].map(k => [k, a[k]]));
      });
      await save(current => ({ source, assets: entries, revision: catalog.revision, config: Object.fromEntries(['repository', 'commit', 'pagesUrl', 'mode'].map(k => [k, config[k]])), checked: current.checked, refreshedAt: new Date().toISOString(), offline: false, error: null }));
    } catch (e) {
      if (source !== cache.source) throw e;
      await save(current => current.source === source ? { ...current, offline: true, error: e.message } : current);
    }
    return status();
  }
  async function fetchAsset(id, verify = false) {
    const a = item(id), url = verify ? pinned(a) : new URL(a.path, cache.source).href;
    if (!url) throw new Error('素材尚无固定提交引用；本地提交不代表已推送。');
    if (!verify && cached(a)) { await assets.read(cached(a).id); return cached(a); }
    const result = await bytes(url);
    if (!result.type.split(';')[0].startsWith('image/') || imageType(result.bytes) !== a.ext || result.bytes.length !== a.bytes || createHash('sha256').update(result.bytes).digest('hex') !== a.hash) throw new Error('图片类型、字节数或 SHA-256 不匹配，未接受素材。');
    const saved = await assets.put(result.bytes, a.name);
    if (verify) await recordVerification(a.hash, url, a.bytes);
    return saved;
  }
  async function recordVerification(hash, url, size) {
    await save(current => ({ ...current, checked: { ...current.checked, [`${hash}:${url}`]: { url, hash, bytes: size, verifiedAt: new Date().toISOString() } } }));
  }
  async function verifyLock(lock) {
    const url = lock?.pinnedUrl;
    if (!HASH.test(lock?.hash || '') || typeof url !== 'string' || !/^https:\/\/raw\.githubusercontent\.com\/[\w.-]+\/[\w.-]+\/[a-f0-9]{40}\/assets\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_-]+\.(png|jpg|webp|gif)$/.test(url)) throw new Error('素材锁缺少有效 SHA-256 或固定公开提交地址。');
    const result = await bytes(url), ext = url.split('.').at(-1);
    if (!result.type.startsWith('image/') || imageType(result.bytes) !== ext || createHash('sha256').update(result.bytes).digest('hex') !== lock.hash || (lock.bytes != null && result.bytes.length !== lock.bytes)) throw new Error('锁定素材的类型、大小或 SHA-256 不匹配。');
    const saved = await assets.put(result.bytes, lock.name || lock.assetId || '锁定素材');
    await recordVerification(lock.hash, url, result.bytes.length); return saved;
  }
  function lock(a, reference) { return { reference, source: 'source-hub', repository: cache.config.repository, assetId: a.id, hash: a.hash, bytes: a.bytes, ext: a.ext, collection: a.collection, version: a.version, pinnedUrl: pinned(a), verification: verification(a.hash, pinned(a)) }; }
  function candidates(project) {
    const text = JSON.stringify(project);
    return cache.assets.filter(a => !a.archived && text.includes(`tts-asset://${a.hash}.${a.ext}`)).map(a => ({ id: a.id, name: a.name, from: `tts-asset://${a.hash}.${a.ext}`, to: pinned(a), verified: !!verification(a.hash, pinned(a)) }));
  }
  return { status, refresh, fetchAsset, candidates, verifyLock, verification,
    locks(project) { const serialized = JSON.stringify(project); const discovered = cache.assets.filter(a => serialized.includes(`tts-asset://${a.hash}.${a.ext}`) || (pinned(a) && serialized.includes(pinned(a)))).map(a => lock(a, serialized.includes(`tts-asset://${a.hash}.${a.ext}`) ? `tts-asset://${a.hash}.${a.ext}` : pinned(a))); return { schemaVersion: 1, projectId: project.projectId, assets: [...new Map([...discovered, ...(project.assetRefs || []).filter(a => a.pinnedUrl)].map(a => [a.reference, a])).values()] }; },
    async apply(project, input) {
      const a = item(input.id), saved = await fetchAsset(a.id);
      const next = structuredClone(project), layer = next.decorations.find(l => l.id === input.layerId);
      if (!layer || layer.locked) throw new Error('请选择有效且未锁定的图层。');
      layer.asset = saved.reference;
      next.assetRefs = [...next.assetRefs.filter(r => r.reference !== saved.reference), lock(a, saved.reference)];
      return next;
    },
    async replace(project, ids) {
      if (!Array.isArray(ids) || !ids.length) throw new Error('请明确选择替换候选。');
      const selected = ids.map(id => { const c = candidates(project).find(c => c.id === id); if (!c?.to || !c.verified) throw new Error('替换前需验证固定公开地址。'); return c; });
      const next = await mapProjectCss(project, async text => selected.reduce((text, c) => text.replaceAll(c.from, c.to), text));
      for (const c of selected) next.assetRefs = [...next.assetRefs.filter(r => r.reference !== c.to), lock(item(c.id), c.to)];
      return next;
    },
    async ingest(id, metadata, expectedRevision) {
      if (!['127.0.0.1', 'localhost'].includes(new URL(cache.source).hostname) || cache.config.mode !== 'local') throw new Error('入库只支持已配置的本机 Source Hub。');
      const config = JSON.parse((await bytes(new URL('hub.json', cache.source), 32768)).bytes);
      const image = await assets.read(id), url = new URL('api/assets', cache.source);
      for (const k of ['name', 'collection', 'version']) url.searchParams.set(k, String(metadata[k] || ''));
      const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'X-Hub-Token': config.token, 'If-Match': String(expectedRevision) }, body: image.bytes });
      const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
      await refresh(); return result;
    },
  };
}
