import { exportTheme } from './shared/core.js';
import { ASSET_RE } from './shared/assets.js';
import { createHash } from 'node:crypto';

// Parse CSS URLs, including quoted data URLs; imports in strings are separate dependencies.
export function dependencies(text) {
  const urls = [...text.matchAll(/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s)]+))\s*\)/gi)].map(m => m[1] ?? m[2] ?? m[3]);
  for (const m of text.matchAll(/@import\s+["']([^"']+)["']/gi)) urls.push(m[1]);
  return [...new Set(urls)].filter(u => u && !u.startsWith('#'));
}
export function referenceIndex(project, histories = []) {
  const index = new Map();
  function walk(value, pointer) {
    if (typeof value === 'string') { const refs = new Set([...value.matchAll(ASSET_RE)].map(m => m[0])); for (const ref of dependencies(value)) if (!ref.startsWith('data:')) refs.add(ref); if (/^https?:\/\/[^\s"']+$/.test(value)) refs.add(value); for (const ref of refs) { if (!index.has(ref)) index.set(ref, []); index.get(ref).push(pointer); } }
    else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${pointer}/${i}`));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, `${pointer}/${k}`);
  }
  walk(project, 'project'); histories.forEach((p, i) => walk(p, `history/${i}`));
  return [...index].map(([reference, locations]) => ({ reference, locations }));
}
export function createExportService(assets, hub) {
  async function audit(project) {
    const theme = exportTheme(project), refs = dependencies(theme.custom_css), local = [], remote = [], unresolved = [];
    const css = theme.custom_css.replace(/\/\*[\s\S]*?\*\//g, '');
    if ((css.match(/url\s*\(/gi) || []).length > [...css.matchAll(/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s)]+))\s*\)/gi)].length) unresolved.push('包含无法可靠解析的 CSS url()；请改成普通引号包裹的完整地址。');
    for (const ref of refs) {
      if (ref.startsWith('data:')) { if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(ref)) unresolved.push(ref.slice(0, 120)); continue; }
      if (ref.startsWith('tts-asset://')) {
        try { const id = ref.slice(12), a = await assets.read(id); local.push({ reference: ref, id, bytes: a.bytes.length }); } catch (e) { unresolved.push(`${ref}: ${e.message}`); }
      } else if (/^https?:\/\//.test(ref)) {
        const lock = project.assetRefs.find(a => a.reference === ref || a.pinnedUrl === ref), verified = hub.status().assets.find(a => a.pinned === ref && a.verification?.url === ref);
        let cached = false;
        if (lock?.hash) { const stored = assets.list().find(a => a.id.startsWith(lock.hash + '.')); if (stored) { try { await assets.read(stored.id); cached = stored.reference; } catch {} } }
        remote.push({ reference: ref, cached, verified: !!verified, local: /^https?:\/\/(localhost|127\.|\[::1\])/.test(ref) });
      } else unresolved.push(ref);
    }
    return { local, remote, unresolved, cssBytes: Buffer.byteLength(theme.custom_css), approximateEmbeddedBytes: Buffer.byteLength(JSON.stringify(theme)) + Math.ceil(local.reduce((n, a) => n + a.bytes, 0) * 4 / 3), references: referenceIndex(project) };
  }
  return { audit,
    async theme(project, mode) {
      if (!['offline', 'external'].includes(mode)) throw new Error('导出模式需为 offline 或 external。');
      const report = await audit(project), theme = exportTheme(project);
      const missing = [...report.unresolved];
      if (mode === 'offline') {
        for (const a of report.remote) { if (!a.cached) missing.push(a.reference); else theme.custom_css = theme.custom_css.replaceAll(a.reference, a.cached); }
        if (missing.length) throw new Error('离线导出缺少依赖字节：' + missing.join('\n'));
        theme.custom_css = await assets.embed(theme.custom_css);
      } else {
        for (const a of report.local) {
          const match = hub.status().assets.find(h => h.hash === a.id.split('.')[0] && h.pinned && h.verification?.url === h.pinned);
          if (!match) missing.push(a.reference); else { await hub.fetchAsset(match.id, true); theme.custom_css = theme.custom_css.replaceAll(a.reference, match.pinned); }
        }
        for (const a of report.remote) {
          const match = hub.status().assets.find(h => h.pinned === a.reference);
          if (a.local || !match) missing.push(a.reference); else await hub.fetchAsset(match.id, true);
        }
        if (missing.length) throw new Error('外链导出存在未验证的固定公开引用：' + missing.join('\n'));
      }
      if (/tts-asset:\/\//.test(theme.custom_css)) throw new Error('导出仍包含未解析素材引用。');
      return { theme, report: { ...report, mode, actualBytes: Buffer.byteLength(JSON.stringify(theme, null, 2)) } };
    },
    async manifest(project) {
      const files = [];
      for (const entry of referenceIndex(project).filter(r => r.reference.startsWith('tts-asset://'))) { const id = entry.reference.slice(12), { bytes } = await assets.read(id); files.push({ id, path: `assets/${id}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
      return { format: 'tavern-theme-studio-files', version: 1, project, assets: files };
    },
  };
}
