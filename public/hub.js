import { resolveAssetUrls } from '/shared/assets.js';
const el = (tag, text) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
export function attachHub({ api, command, getState, reportError, layerTarget, download }) {
  const host = document.querySelector('#assets-dialog .dialog-body');
  const panel = el('details'), title = el('summary', 'Source Hub · 目录、固定引用与离线缓存'); panel.id = 'hub-panel'; panel.append(title);
  const source = el('input'); source.setAttribute('aria-label', 'Source Hub 地址'); source.value = 'http://127.0.0.1:19325/';
  const refresh = el('button', '加载 / 重试'), status = el('p'); status.setAttribute('role', 'status');
  const search = el('input'); search.placeholder = '搜索名称或标签'; search.setAttribute('aria-label', '搜索 Source Hub');
  const collection = el('select'), version = el('select'); collection.setAttribute('aria-label', '筛选图集'); version.setAttribute('aria-label', '筛选版本');
  const list = el('div'), replacements = el('div'); panel.append(source, refresh, status, search, collection, version, list, replacements); host.append(panel);
  const ingest = el('details'); ingest.append(el('summary', '将本地素材入库（不提交或发布）'));
  const local = el('select'), name = el('input'), album = el('input'), release = el('input'), upload = el('button', '入库到已配置 Hub');
  for (const [input, label] of [[local, '本地素材'], [name, '入库名称'], [album, '图集 ASCII ID'], [release, '版本 ASCII ID']]) { const wrap = el('label', label); input.setAttribute('aria-label', label); wrap.append(input); ingest.append(wrap); }
  ingest.append(upload); panel.append(ingest);
  let data;
  const run = action => async () => { try { await action(); } catch (e) { reportError(e); } };
  const lock = el('button', '下载素材锁定清单'); lock.onclick = run(async () => download(await api('/api/hub/lock'), '.assets-lock')); panel.append(lock);
  const action = async body => { await api('/api/hub', body); await load(); };
  async function load() { data = await api('/api/hub'); source.value = data.source; render(); const old = local.value; local.replaceChildren(); for (const a of (await api('/api/assets')).filter(a => a.kind === 'local')) local.add(new Option(a.name, a.id)); if (old) local.value = old; }
  function render() {
    status.textContent = `${data.offline ? '离线缓存' : '目录已读取'} · ${data.assets.length} 张 · ${data.refreshedAt || '尚未加载'}${data.error ? ' · ' + data.error : ''}。提交、推送、部署和链接验证分别判断；未知发布状态不视为成功。`;
    for (const [select, key, name] of [[collection, 'collection', '全部图集'], [version, 'version', '全部版本']]) {
      const old = select.value; select.replaceChildren(new Option(name, '')); for (const value of new Set(data.assets.map(a => a[key]))) select.add(new Option(value, value)); select.value = old;
    }
    list.replaceChildren();
    for (const a of data.assets.filter(a => !a.archived && (!collection.value || a.collection === collection.value) && (!version.value || a.version === version.value) && `${a.name} ${(a.tags || []).join(' ')}`.toLowerCase().includes(search.value.toLowerCase()))) {
      const row = el('article'); row.className = 'asset-row';
      if (a.preview) { const img = el('img'); img.alt = a.name + ' · 点击查看缓存图'; img.tabIndex = 0; img.loading = 'lazy'; const show = () => { img.src = resolveAssetUrls(a.preview, location.origin); }; img.onclick = show; img.onkeydown = e => { if (e.key === 'Enter') show(); }; row.append(img); }
      const info = el('div'); info.append(el('b', a.name), el('p', `${a.collection} / ${a.version} · ${a.width}×${a.height} · ${a.ext} · ${(a.bytes / 1024).toFixed(1)} KiB`), el('small', `${a.cached ? '已有离线字节' : '未缓存，图片不可离线使用'} · ${a.committed === true ? '已本地提交' : '提交状态未知或未提交'} · ${a.verification?.url === a.pinned && a.pinned ? '固定公开链接已验证' : '公开地址未验证'}`));
      const buttons = el('div'); buttons.className = 'asset-actions';
      for (const [label, actionName] of [['缓存 / 预览', 'cache'], ['验证公开地址', 'verify']]) { const b = el('button', label); b.disabled = actionName === 'verify' && !a.pinned; b.onclick = run(() => action({ action: actionName, id: a.id })); buttons.append(b); }
      const apply = el('button', '应用到所选图层'); apply.onclick = run(async () => { if (!layerTarget.value) throw new Error('先选择面板顶部的目标图层。'); await command({ type: 'hub-apply', id: a.id, layerId: layerTarget.value }); await load(); }); buttons.append(apply); row.append(info, buttons); list.append(row);
    }
    replacements.replaceChildren(el('h3', '按内容哈希替换预览'));
    const selected = new Set();
    for (const c of data.candidates) { const label = el('label'), check = el('input'); check.type = 'checkbox'; check.disabled = !c.verified; check.onchange = () => check.checked ? selected.add(c.id) : selected.delete(c.id); label.append(check, el('span', `${c.name}：${c.from} → ${c.to || '无固定提交'}${c.verified ? '' : '（先验证）'}`)); replacements.append(label); }
    const replace = el('button', '应用勾选的替换（可撤销）'); replace.onclick = run(async () => { await command({ type: 'hub-replace', ids: [...selected] }); await load(); }); replacements.append(replace);
  }
  refresh.onclick = run(() => action({ action: 'refresh', source: source.value }));
  upload.onclick = run(() => action({ action: 'ingest', id: local.value, catalogRevision: data.revision, metadata: { name: name.value, collection: album.value, version: release.value } }));
  for (const input of [search, collection, version]) input.addEventListener('input', () => data && render());
  panel.addEventListener('toggle', () => { if (panel.open) load().catch(reportError); });
}
