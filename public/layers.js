import { openStudioPanel } from '/panels.js';
import { TARGETS, applyCommand } from '/shared/core.js';
import { decorationDiagnostics, effectiveLayer, layerAsset } from '/shared/decorations.js';
import { resolveAssetUrls } from '/shared/assets.js';
const $ = s => document.querySelector(s);
const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
export function attachLayers({ getState, command, preview, toast, send }) {
  let selected, assets = [], scope = 'base', queue = Promise.resolve(), lastProjectId, hostIssues = [], canEdit = false, viewport;
  const button = node('button', '◇ 装饰图层'); button.id = 'layers-button'; $('.studio-tools').append(button);
  const dialog = node('dialog', undefined, 'wide-dialog'); dialog.id = 'layers-dialog';
  dialog.innerHTML = `<form method="dialog" class="dialog-header"><h2>可调装饰 <small id="layers-total"></small></h2><button aria-label="关闭装饰图层">×</button></form>
  <div class="dialog-body"><p id="layers-recipe" class="panel-hint"></p><div class="inline-controls"><input id="layers-search" type="search" placeholder="搜索中文用途、分组或图层" aria-label="搜索图层"><select id="layers-group" aria-label="图层分组"></select></div>
  <div id="layers-list" class="layers-list"></div><div id="layer-editor"></div>
  <details><summary>新增装饰与配方</summary><form id="layer-add" class="workflow-form"><label for="layer-target">目标部件</label><select id="layer-target"></select><label for="layer-pseudo">绘制插槽</label><select id="layer-pseudo"><option value="::before">前装饰 ::before</option><option value="::after">后装饰 ::after</option></select><label for="layer-method">绘制方式</label><select id="layer-method"><option value="background">背景图片</option><option value="nine-slice">九切片边框</option></select><button type="submit">新增图层</button></form><button id="recipe-import-button" type="button">导入配方（替换图层）</button><input id="recipe-import" type="file" accept=".json,application/json" hidden><p class="panel-hint">新增时检查插槽占用。导入配方替换受控图层，可用撤销返回；未识别 CSS 保留。</p></details></div>`;
  document.body.append(dialog);
  for (const t of TARGETS.filter(t => !t.pseudo)) $('#layer-target').add(new Option(t.name, t.id));
  const run = action => e => { e?.preventDefault(); const task = queue.then(() => action(e)).then(render); queue = task.catch(error => { toast(error.message, true); preview(); }); return queue; };
  const selectedLayer = () => getState().project.decorations.find(l => l.id === selected);
  async function assetList() { const res = await fetch('/api/assets'); if (!res.ok) throw new Error('无法读取本地素材列表。'); assets = await res.json(); }
  function field(parent, label, input) { const wrap = node('label', undefined, 'layer-field'); wrap.append(node('span', label), input); parent.append(wrap); return input; }
  function renderEditor() {
    const panel = $('#layer-editor'); panel.replaceChildren(); const p = getState().project, layer = selectedLayer(); if (!layer) return;
    const slot = p.recipe?.slots.find(s => s.id === layer.slotId), props = effectiveLayer(p, layer, scope).props;
    const editScope = scope, update = patch => command({ type: 'decoration-update', id: layer.id, scope: editScope, patch });
    panel.append(node('h3', layer.name), node('p', slot?.note || '目标插槽不存在，请重新选择。', 'panel-hint'));
    const actions = node('div', undefined, 'inline-controls');
    for (const [label, action, disabled] of [
      [layer.visible ? '隐藏' : '显示', () => update({ visible: !layer.visible }), layer.locked],
      [layer.locked ? '解锁' : '锁定', () => update({ locked: !layer.locked }), false],
      ['复制图层', async () => { await command({ type: 'decoration-duplicate', id: layer.id }); selected = getState().project.decorations.at(-1).id; toast('副本已创建，请选择空闲插槽后应用。'); }, false],
      ['移除', () => command({ type: 'decoration-remove', id: layer.id }), layer.locked]
    ]) { const b = node('button', label); b.disabled = disabled; b.addEventListener('click', run(action)); actions.append(b); }
    panel.append(actions); const form = node('div', undefined, 'layer-fields');
    const edit = node('button', '在真实画面定位'); edit.id = 'layer-locate'; edit.disabled = !canEdit || !slot?.geometry || layer.locked || !layer.visible;
    edit.addEventListener('click', () => { const s = getState(); dialog.close(); send('decoration-edit', { id: layer.id, scope, basis: { projectId: s.projectId, sessionId: s.sessionId, revision: s.revision, fingerprint: s.fingerprint } }); }); panel.append(edit);
    if (viewport) panel.append(node('p', `${viewport.width} × ${viewport.height}px · ${p.breakpoints.filter(b => matchWidth(b.condition, viewport.width)).map(b => b.name).join(' / ') || '基础尺寸'}${slot?.condition ? ' · 插槽 ' + slot.condition + (matchWidth(slot.condition, viewport.width) ? ' 已命中' : ' 未命中') : ''}`, 'panel-hint'));
    const changeProps = (k, value) => { const current = getState().project.decorations.find(l => l.id === layer.id); const next = { ...(editScope === 'base' ? current?.props : current?.overrides[editScope]) }; if (value === undefined) delete next[k]; else next[k] = value; return { props: next }; };
    const input = (label, k, value, action, type = 'text') => { const el = node('input'); el.id = 'layer-' + k; el.type = type; if (type === 'checkbox') el.checked = value; else el.value = value; el.disabled = layer.locked; el.addEventListener('change', e => { const submitted = type === 'checkbox' ? el.checked : el.value; run(() => action(submitted))(e); }); field(form, label, el); return el; };
    const select = (label, k, value, options, action, unlocked = false) => { const el = node('select'); el.id = 'layer-' + k; for (const [caption, v] of options) el.add(new Option(caption, v)); el.value = value; el.disabled = !unlocked && layer.locked; el.addEventListener('change', e => { const submitted = el.value; run(() => action(submitted))(e); }); field(form, label, el); return el; };
    input('中文名称', 'name', layer.name, name => update({ name })).maxLength = 120;
    select('目标与绘制方式', 'slot', layer.slotId, (p.recipe?.slots || []).map(s => [s.name + (p.decorations.some(l => l.id !== layer.id && l.slotId === s.id) ? ' · 已占用' : ''), s.id]), slotId => update({ slotId }));
    const assetOptions = [['沿用源码素材', ''], ...assets.map(a => [a.name, a.reference])]; if (layer.asset && !assets.some(a => a.reference === layer.asset)) assetOptions.push(['当前替换素材', layer.asset]);
    select('素材', 'asset', layer.asset || '', assetOptions, asset => update({ asset: asset || null }));
    select('尺寸覆盖', 'scope', scope, [['所有尺寸', 'base'], ...p.breakpoints.map(b => [`${b.name} · ${b.condition}`, b.id])], value => { scope = value; }, true);
    if (slot?.geometry) {
      for (const [label, k, min, max, step, fallback] of [['水平偏移 px', 'x', -10000, 10000, 1, 0], ['垂直偏移 px', 'y', -10000, 10000, 1, 0], ['等比缩放', 'scale', 0.05, 10, 0.05, 1], ['旋转 °', 'rotation', -360, 360, 1, 0], ['不透明度', 'opacity', 0, 1, 0.05, 1], ['叠放顺序', 'order', -9999, 9999, 1, 0]]) {
        const el = input(label, k, props[k] ?? fallback, value => update(changeProps(k, Number(value))), 'number'); el.min = min; el.max = max; el.step = step;
        el.addEventListener('input', () => { try { preview(applyCommand(getState().project, { type: 'decoration-update', id: layer.id, scope, patch: changeProps(k, Number(el.value)) })); } catch {} });
      }
      for (const [k, label] of [['width', '宽度 px/%/vw/vh'], ['height', '高度 px/%/vw/vh']]) input(label, k, props[k] || '', value => update(changeProps(k, value || undefined))).placeholder = '沿用源码';
      input('宽度调整保持比例', 'ratio', layer.preserveRatio, preserveRatio => update({ preserveRatio }), 'checkbox');
      input('定义容器/图片锚点', 'anchor-enabled', !!props.anchor, enabled => update(changeProps('anchor', enabled ? { containerX: 0.5, containerY: 0.5, imageX: 0.5, imageY: 0.5 } : undefined)), 'checkbox');
      if (props.anchor) for (const [k, label] of [['containerX', '容器水平锚点'], ['containerY', '容器垂直锚点'], ['imageX', '图片水平锚点'], ['imageY', '图片垂直锚点']]) select(label, k, String(props.anchor[k]), [['起边 0%', '0'], ['居中 50%', '0.5'], ['末边 100%', '1']], value => update(changeProps('anchor', { ...props.anchor, [k]: Number(value) })));
    }
    if (slot?.method === 'nine-slice') for (const [k, label] of [['slice', '九切片边界'], ['edgeWidth', '九切片绘制边宽']]) input(label, k, props[k] || '', value => update(changeProps(k, value || undefined))).placeholder = '沿用源码';
    if (slot?.method === 'background') select('背景适配', 'fit', props.fit || '', [['沿用源码', ''], ['完整显示 contain', 'contain'], ['覆盖 cover', 'cover']], value => update(changeProps('fit', value || undefined)));
    const reset = node('button', '还原当前尺寸参数'); reset.disabled = layer.locked; reset.addEventListener('click', run(() => update({ props: {} }))); form.append(reset); panel.append(form);
    panel.append(node('code', slot ? `${slot.selector}${slot.pseudo} · ${slot.method === 'nine-slice' ? '九切片' : '背景'}${slot.condition ? ' · ' + slot.condition : ''}` : layer.slotId, 'layer-selector'));
  }
  function render() {
    if (!dialog.open) return;
    const p = getState().project, diagnostics = decorationDiagnostics(p), search = $('#layers-search').value.trim().toLowerCase(), group = $('#layers-group').value;
    if (!Object.hasOwn(p.rules, scope)) scope = 'base';
    $('#layers-total').textContent = p.decorations.length; $('#layers-recipe').textContent = p.recipe ? `${p.recipe.name} · ${p.recipe.version}。先选择中文用途，再调整参数；未识别 CSS 继续保留。` : '还没有可直接调整的装饰。先查看主题图片，再让 AI 接入。';
    const groups = [...new Set((p.recipe?.slots || []).map(s => s.group))]; $('#layers-group').replaceChildren(new Option('全部用途', '')); for (const g of groups) $('#layers-group').add(new Option(g, g)); $('#layers-group').value = groups.includes(group) ? group : '';
    const list = $('#layers-list'); list.replaceChildren();
    for (const layer of p.decorations) {
      const slot = p.recipe?.slots.find(s => s.id === layer.slotId);
      if ((group && slot?.group !== group) || !`${layer.name} ${slot?.name} ${slot?.group}`.toLowerCase().includes(search)) continue;
      const row = node('button', undefined, 'layer-choice'); row.dataset.layer = layer.id; row.classList.toggle('active', layer.id === selected); row.setAttribute('aria-pressed', String(layer.id === selected));
      const art = layerAsset(p, layer); if (art) { const img = node('img'); img.src = resolveAssetUrls(art, location.origin); img.loading = 'lazy'; img.alt = ''; img.referrerPolicy = 'no-referrer'; row.append(img); }
      const caption = node('span'); caption.append(node('b', layer.name), node('small', `${slot?.group || '目标缺失'} · ${layer.locked ? '已锁定' : layer.visible ? '显示' : '隐藏'}`)); row.append(caption); row.addEventListener('click', () => { selected = layer.id; render(); $('#layer-editor h3')?.scrollIntoView({ block: 'nearest' }); }); list.append(row);
      for (const d of diagnostics.filter(d => d.layerId === layer.id)) list.append(node('p', d.message, d.level === 'error' ? 'workflow-error' : 'diagnostic-warning'));
      for (const d of hostIssues.filter(d => d.layerId === layer.id)) list.append(node('p', d.message, 'workflow-error'));
    }
    if (!list.children.length) { const empty=node('div',undefined,'material-help'); empty.append(node('p',p.decorations.length ? '没有匹配的装饰，试试其他关键词。' : '找到图片不代表已经可以拖动。接入后，就能在这里调整大小、位置和透明度。')); if (!p.decorations.length) { const next=node('button','查看主题图片','primary'); next.addEventListener('click',()=>document.querySelector('#theme-analysis-open').click()); empty.append(next); } list.append(empty); }
    $('#layers-search').parentElement.hidden = !p.decorations.length; $('#layer-editor').hidden = !p.decorations.length;
    for (const d of diagnostics.filter(d => d.layerId.startsWith('hidden-'))) list.append(node('p', d.message, 'workflow-error'));
    for (const d of hostIssues.filter(d => d.layerId.startsWith('hidden-'))) list.append(node('p', d.message, 'workflow-error'));
    if (!selectedLayer()) selected = p.decorations[0]?.id;
    renderEditor();
  }
  button.addEventListener('click', run(async () => { await assetList(); openStudioPanel('layers-dialog'); }));
  $('#layers-search').addEventListener('input', render); $('#layers-group').addEventListener('change', render);
  $('#layer-add').addEventListener('submit', run(async () => { await command({ type: 'decoration-add', target: $('#layer-target').value, pseudo: $('#layer-pseudo').value, method: $('#layer-method').value }); selected = getState().project.decorations.at(-1).id; $('#layers-search').value = ''; $('#layers-group').value = ''; }));
  $('#recipe-import-button').addEventListener('click', () => $('#recipe-import').click());
  $('#recipe-import').addEventListener('change', run(async e => { const file = e.target.files[0]; try { if (file) { if (file.size > 1048576) throw new Error('配方超过 1 MiB。'); await command({ type: 'recipe', recipe: JSON.parse((await file.text()).replace(/^\uFEFF/, '')) }); selected = undefined; } } finally { e.target.value = ''; } }));
  dialog.addEventListener('close', () => preview());
  function matchWidth(condition, width) { const m=condition.match(/\((min|max)-width: (\d+)px\)/); return m && (m[1]==='max'?width<=Number(m[2]):width>=Number(m[2])); }
  return { capabilities(c) { canEdit=c?.decorationEditor===1;render(); }, render() { const p = getState().project; if (p.projectId !== lastProjectId) { lastProjectId = p.projectId; selected = undefined; scope = 'base'; } button.textContent = `可调装饰 ${p.decorations.length}`; if (!$('#layer-editor').contains(document.activeElement) || !document.activeElement.matches('input,select')) render(); }, receive(data) {
    if (data.type==='viewport') { viewport=data;render(); }
    else if (data.type==='decoration-commit') { const s=getState(); if (!['projectId','sessionId','fingerprint','revision'].every(k=>data.basis?.[k]===s[k])) { send('decoration-commit-result',{ok:false,error:'工程更新，此次拖动未保存。'});preview();toast('工程更新，请重新定位。',true);return; } command({type:'decoration-update',id:data.id,scope:data.scope,patch:{props:data.props}}).then(()=>send('decoration-commit-result',{ok:true})).catch(e=>send('decoration-commit-result',{ok:false,error:e.message})); }
    else if (data.type==='decoration-editor-status'&&data.message) toast(data.message);
    else if (data.type === 'decoration-status') { const changed = JSON.stringify(hostIssues) !== JSON.stringify(data.issues); hostIssues = data.issues || []; if (changed) render(); } else if (data.type === 'disconnected') { hostIssues = [];canEdit=false;render(); }
  }, events(events) { events.addEventListener('assets', () => { if (dialog.open) assetList().then(render).catch(e => toast(e.message, true)); }); } };
}
