import { openStudioPanel } from '/panels.js';
import { copyClipboard as copyText } from "/clipboard.js";
import { TARGETS } from '/shared/core.js';
import { scanVariables } from '/shared/variables.js';
import { TICKET_STATES } from '/shared/tickets.js';
import { resolveAssetUrls, cssImage } from '/shared/assets.js';
import { formatAgentHandoff } from '/shared/handoff.js';
import { attachHub } from '/hub.js';
import { attachRunner } from '/runner.js';
import { createImageVariant } from '/asset-optimize.js';
import { locationStatus } from '/shared/ticket-location.js';
import { sameCanvasBasis } from '/shared/canvas.js';

const $ = s => document.querySelector(s);
const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
const size = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
export function attachWorkflow({ getState, getToken, getScope, command, send, toast, isReady, stopPicking, download }) {
  let tickets = [], assets = [], variants = [], draft, marking = false, busy = false, lastProjectId;
  const layerTargetLabel = node('label', '选择目标图层（也可使用下方图片变量）', 'panel-hint'), layerTarget = node('select');
  layerTarget.id = 'asset-layer'; layerTarget.setAttribute('aria-label', '选择素材替换图层'); layerTargetLabel.append(layerTarget); $('#assets-dialog .dialog-body').prepend(layerTargetLabel);
  layerTarget.addEventListener('change', () => { if (layerTarget.value) $('#asset-variable').value = ''; });
  $('#asset-variable').addEventListener('change', () => { if ($('#asset-variable').value) layerTarget.value = ''; });
  const selectedTickets = new Set();
  const locationTarget = node('select'), locationScope = node('select');
  for (const [input, text] of [[locationTarget, '小票关联目标'], [locationScope, '小票关联断点']]) { const label = node('label', text); input.setAttribute('aria-label', text); label.append(input); $('#annotation-comment').before(label); }
  const copyClipboard = (text, message) => copyText(text, toast, message);
  async function api(url, body, raw = false) {
    const state = getState();
    const res = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'X-Studio-Token': getToken(), ...(!raw && { 'Content-Type': 'application/json' }) }, body: raw ? body : JSON.stringify({ sessionId: state.sessionId, projectId: state.projectId, fingerprint: state.fingerprint, revision: state.revision, ...body }) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error); return data;
  }
  function reportError(error) {
    toast(error.message, true);
    const dialog = document.querySelector('dialog:modal') || document.querySelector('dialog[open]');
    if (!dialog) return;
    let message = dialog.querySelector('[data-workflow-error]');
    if (!message) { message = node('p', undefined, 'workflow-error'); message.dataset.workflowError = ''; message.setAttribute('role', 'alert'); dialog.querySelector('.dialog-body').prepend(message); }
    message.textContent = error.message; message.scrollIntoView({ block: 'nearest' });
  }
  const run = action => async event => { event?.preventDefault(); document.querySelectorAll('[data-workflow-error]').forEach(el => el.remove()); try { await action(event); } catch (e) { reportError(e); } };
  attachHub({ api, command, getState, reportError, layerTarget, download });
  attachRunner({ api, getIds: () => [...selectedTickets], reportError });
  const assetScope = node('select'); assetScope.setAttribute('aria-label', '素材范围');
  assetScope.add(new Option('全部本地素材', 'local')); assetScope.add(new Option('当前工程引用', 'project')); assetScope.add(new Option('已归档（可恢复）', 'archived'));
  $('#assets-list').before(assetScope); assetScope.addEventListener('change', renderAssets);
  const relevant = () => tickets.filter(t => t.basis.projectId === getState().project.projectId);
  function sendPins() { if (isReady()) send('annotations', { tickets: relevant().filter(t => t.locationStatus?.valid !== false).map(({ id, number, state, anchor, canvas, basis }) => ({ id, number, state, anchor, canvas, basis })) }); }
  function mark(value) {
    marking = value; $('#annotate-button').setAttribute('aria-pressed', String(value)); $('#annotate-button').classList.toggle('active', value);
    $('#annotate-button').textContent = value ? '点击画面 · Esc 取消' : '＋ 标点评论';
  }
  function describe(anchor) { return `${TARGETS.find(t => t.id === anchor.target)?.name || anchor.target} · ${anchor.viewport.width} × ${anchor.viewport.height}${anchor.fixture ? ' · 虚构测试对话' : ''}`; }
  async function loadTickets() { tickets = await api('/api/tickets'); renderTickets(); sendPins(); }
  async function copyAgent(ids, compact = true) {
    if (!ids.length) throw new Error('请先明确选择需要处理的小票。');
    const selected = await Promise.all(ids.map(id => api(`/api/tickets/${id}`)));
    const context = await api('/api/handoff-context');
    await copyClipboard(formatAgentHandoff(selected, context, { compact }), `已复制 ${ids.length} 张小票的${compact ? '简明' : '完整'}交接内容，可粘贴到已打开项目的 harness 对话。`);
  }
  function updateSelection() { $('#copy-harness').textContent = `复制给 AI (${selectedTickets.size})`; $('#copy-harness').disabled = !selectedTickets.size; }
  function reviewPanel(ticket) {
    const panel = node('details', undefined, 'ticket-evidence');
    panel.append(node('summary', '查看变更与证据'));
    const body = node('div', undefined, 'evidence-body'); panel.append(body);
    panel.addEventListener('toggle', run(async () => {
      if (!panel.open || panel.dataset.loaded) return;
      panel.dataset.loaded = 'true'; body.textContent = '正在读取提交快照与证据…';
      try {
        const report = await api(`/api/tickets/${ticket.id}/review`); body.replaceChildren(node('p', report.note, 'panel-hint'));
        if (report.stale) body.append(node('p', '提交后工程已有变化；以下证据对应提交时版本。请核对当前画面。', 'diagnostic-warning'));
        if (report.error) body.append(node('p', report.error, 'workflow-error'));
        if (report.changes) {
          const value = v => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s == null ? '未覆盖' : s.length > 240 ? s.slice(0, 240) + '…' : s; };
          body.append(node('b', `工程变更 · ${report.changes.length} 项`));
          for (const change of report.changes) {
            const row = node('div', undefined, 'evidence-change');
            row.append(node('span', change.label || change.path), node('code', value(change.before)), node('span', '→'), node('code', value(change.after))); body.append(row);
          }
        }
        const grid = node('div', undefined, 'evidence-grid');
        for (const artifact of report.artifacts) {
          const card = node('div', undefined, 'evidence-card');
          if (artifact.url) {
            const link = node('a', artifact.label); link.href = artifact.url; link.target = '_blank'; link.rel = 'noopener';
            if (artifact.type.startsWith('image/')) { const image = node('img'); image.src = artifact.url; image.alt = artifact.label; image.loading = 'lazy'; link.prepend(image); }
            card.append(link);
          } else card.append(node('b', artifact.label), node('small', artifact.unavailable, 'panel-hint'));
          card.append(node('code', artifact.reference)); grid.append(card);
        }
        body.append(grid);
        if (!report.artifacts.length) body.append(node('p', '处理者未附证据文件。', 'panel-hint'));
      } catch (e) { delete panel.dataset.loaded; body.textContent = e.message; }
    }));
    return panel;
  }
  function renderTickets() {
    $('#ticket-count').textContent = relevant().filter(t => t.state !== 'done').length;
    const filter = $('#ticket-filter').value;
    const pool = $('#ticket-project-filter').value === 'all' ? tickets : relevant();
    const shown = pool.filter(t => filter === 'all' || (filter === 'active' ? t.state !== 'done' : t.state === filter));
    for (const id of selectedTickets) if (!shown.some(t => t.id === id)) selectedTickets.delete(id);
    updateSelection();
    $('#tickets-total').textContent = shown.length;
    const list = $('#tickets-list'); list.replaceChildren();
    if (!shown.length) { list.append(node('p', '还没有这类小票。在真实酒馆中点击「标点评论」，点一下想调整的位置。', 'empty-state')); return; }
    for (const ticket of shown.toReversed()) {
      const row = node('article', undefined, 'ticket-row'); row.dataset.ticket = ticket.id;
      const head = node('div', undefined, 'ticket-heading'); head.append(node('b', `#${ticket.number}`), node('span', TICKET_STATES[ticket.state], `ticket-state ${ticket.state}`));
      const selectLabel = node('label', undefined, 'ticket-select'), select = node('input'); select.type = 'checkbox'; select.checked = selectedTickets.has(ticket.id); select.setAttribute('aria-label', `选择小票 #${ticket.number}`);
      select.addEventListener('change', () => { if (select.checked) selectedTickets.add(ticket.id); else selectedTickets.delete(ticket.id); updateSelection(); }); selectLabel.append(select, node('span', '选择')); head.append(selectLabel);
      const meta = node('small', `${describe(ticket.anchor)} · ${ticket.canvas?.kind === 'blueprint' ? '各部件范围见蓝图' : ticket.location?.condition || (ticket.scope === 'mobile' ? '仅手机' : '所有尺寸')} · ${ticket.basis.name}`, 'ticket-meta');
      const comment = node('p', ticket.comment, 'ticket-comment');
      if (ticket.canvas?.kind === 'blueprint') {
        row.append(node('p', `场景蓝图 · ${ticket.canvas.items.length} 个部件 · ${ticket.canvas.viewport.width} × ${ticket.canvas.viewport.height}px（待 Agent 落实）`, 'panel-hint'));
        const parts = node('details'); parts.append(node('summary','查看整张蓝图的部件'));
        for (const item of ticket.canvas.items) {
          const r = item.after;
          const scopeName = item.scope === 'base' ? '所有尺寸' : getState().project.breakpoints.find(b => b.id === item.scope)?.name || item.scope;
          parts.append(node('p', `${TARGETS.find(t => t.id === item.anchor.target)?.name || item.anchor.target}${item.appliesTo === 'matching-elements' ? ' · 全部同类部件 · ' + scopeName : ''} · ${r.left}, ${r.top} · ${r.width} × ${r.height}px${item.note ? ' · ' + item.note : ''}`));
        }
        row.append(parts);
      } else if (ticket.canvas) { const r = ticket.canvas.after; row.append(node('p', `画布提案 · 待 Agent 落实：位置 ${r.left}, ${r.top} · 尺寸 ${r.width} × ${r.height}px（未写入 CSS）`, 'panel-hint')); }
      const actions = node('div', undefined, 'ticket-actions');
      const locate = node('button', '定位标点'); locate.disabled = !isReady() || ticket.basis.projectId !== getState().project.projectId;
      if (ticket.locationStatus?.valid === false) locate.disabled = true;
      locate.addEventListener('click', () => {
        $('#tickets-dialog').close(); const s = getState();
        if (ticket.location?.kind === 'layer') send('decoration-edit', { id: ticket.location.id, scope: ticket.location.scope, basis: { projectId: s.projectId, sessionId: s.sessionId, fingerprint: s.fingerprint, revision: s.revision } });
        else send('annotation-focus', { anchor: ticket.location?.kind === 'container' ? { ...ticket.anchor, target: ticket.location.id, occurrence: 0, messageIndex: undefined, point: { x: .5, y: .5 } } : ticket.anchor });
      });
      const copy = node('button', '复制 JSON'); copy.addEventListener('click', run(async () => { await copyClipboard(JSON.stringify(await api(`/api/tickets/${ticket.id}`), null, 2), '纯 JSON 已复制。'); }));
      const agent = node('button', '复制任务给 AI'); agent.title = '简明交接：Agent 会重新读取完整小票与快照'; agent.addEventListener('click', run(() => copyAgent([ticket.id])));
      const full = node('button', '复制完整交接'); full.addEventListener('click', run(() => copyAgent([ticket.id], false)));
      actions.append(locate, agent);
      const extra = node('details', undefined, 'ticket-secondary'); extra.append(node('summary', '交接详情')); const extraActions=node('div'); extraActions.append(full,copy); extra.append(extraActions);
      if (ticket.state === 'review') {
        const stale = ticket.completedBasis?.fingerprint !== getState().fingerprint;
        const acknowledge = node('input'); acknowledge.type = 'checkbox';
        const accept = node('button', '验收通过', 'primary'); accept.disabled = stale || ticket.basis.projectId !== getState().projectId;
        if (stale) { const label = node('label', undefined, 'review-acknowledge'); label.append(acknowledge, node('span', '提交后工程已有变化。我已核对当前效果。')); row.append(label); acknowledge.addEventListener('change', () => { accept.disabled = !acknowledge.checked || ticket.basis.projectId !== getState().projectId; }); }
        accept.addEventListener('click', run(async () => { await api(`/api/tickets/${ticket.id}`, { action: 'accept', version: ticket.version, acknowledgeChanged: acknowledge.checked }); await loadTickets(); })); actions.append(accept);
      }
      if (ticket.state !== 'open') {
        const reopen = node('button', '重新待办'); reopen.addEventListener('click', run(async () => { await api(`/api/tickets/${ticket.id}`, { action: 'reopen', version: ticket.version }); await loadTickets(); })); actions.append(reopen);
      }
      row.append(head, comment, meta);
      if (ticket.location) row.append(node('p', `${ticket.location.kind} · ${ticket.location.name} · ${ticket.location.condition || '所有尺寸'} · ${ticket.locationStatus?.reason || '请核对快照'}`, ticket.locationStatus?.valid === false ? 'workflow-error' : 'ticket-meta'));
      if (ticket.basis.projectId !== getState().project.projectId) row.append(node('p', '工程身份不同或旧票归属待核实；请对照快照重新定位。', 'workflow-error'));
      if (ticket.owner) row.append(node('small', `处理者：${ticket.owner}`, 'ticket-meta'));
      if (ticket.result) {
        const result = node('div', undefined, 'ticket-result'); result.append(node('b', '处理结果'), node('p', ticket.result));
        if (ticket.resultDetails) {
          const details = ticket.resultDetails;
          result.append(node('small', `使用基线：revision ${details.baseline.revision} · ${details.baseline.fingerprint.slice(0, 12)}`));
          for (const check of details.checks) result.append(node('p', `${({ passed: '通过', failed: '失败', skipped: '跳过' })[check.status]} · ${check.name}：${check.detail}`));
          for (const item of details.unverified) result.append(node('p', `未验证：${item}`, 'diagnostic-warning'));
        }
        row.append(result, reviewPanel(ticket));
      }
      row.append(actions, extra); list.append(row);
    }
    updateSelection();
  }
  async function loadAssets() { [assets, variants] = await Promise.all([api('/api/assets'), api('/api/assets/variants')]); renderAssets(); }
  function renderAssetVariables() {
    const previousLayer = layerTarget.value; layerTarget.replaceChildren(new Option('选择图层', ''));
    for (const layer of getState().project.decorations) { const option = new Option(layer.name + (layer.locked ? ' · 已锁定' : ''), layer.id); option.disabled = layer.locked; layerTarget.add(option); }
    if ([...layerTarget.options].some(o => o.value === previousLayer)) layerTarget.value = previousLayer;
    const select = $('#asset-variable'), old = select.value;
    const variables = scanVariables(getState().project.baseTheme.custom_css || '');
    select.replaceChildren();
    const empty = node('option', '选择图片变量，或复制 CSS 值'); empty.value = ''; select.append(empty);
    for (const v of variables.filter(v => /url\(/i.test(v.value) || /(?:^|[-_])(?:art|image|texture|mask|decor|src|url)$/i.test(v.name))) {
      const option = node('option', `${v.name} · 第 ${v.line} 行`); option.value = v.id; select.append(option);
    }
    if ([...select.options].some(o => o.value === old)) select.value = old;
    $('#asset-css-size').textContent = size(new TextEncoder().encode(getState().project.baseTheme.custom_css || '').length);
  }
  function renderAssets() {
    renderAssetVariables(); const list = $('#assets-list'); list.replaceChildren();
    if (!assets.length) { list.append(node('p', '还没有素材。上传图片、添加外链，或提取主题中已有的装饰。', 'empty-state')); return; }
    for (const asset of assets.toReversed()) {
      if ((assetScope.value === 'archived') !== (asset.archived === true)) continue;
      if (variants.some(v => v.kind === 'thumbnail' && v.variantId === asset.id && v.originalId !== asset.id)) continue;
      if (assetScope.value === 'project' && !JSON.stringify(getState().project).includes(asset.reference)) continue;
      const row = node('article', undefined, 'asset-row'), image = node('img'); image.alt = asset.name; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
      const thumbnail = variants.find(v => v.originalId === asset.id && v.kind === 'thumbnail');
      if (thumbnail) image.src = resolveAssetUrls(thumbnail.reference, location.origin);
      image.alt = asset.name + ' · 点击预览原图'; image.tabIndex = 0;
      const showOriginal = () => { image.src = resolveAssetUrls(asset.reference, location.origin); };
      image.addEventListener('click', showOriginal); image.addEventListener('keydown', e => { if (e.key === 'Enter') showOriginal(); });
      const usedBy = scanVariables(getState().project.baseTheme.custom_css || '').filter(v => v.value.includes(asset.reference)).map(v => v.name);
      if (asset.name === '导入的装饰' && usedBy.length) image.alt = usedBy.join(' · ');
      const info = node('div', undefined, 'asset-info'), caption = node('small', asset.kind === 'local' ? `${size(asset.size)} · 本地素材` : '外链 · 导出保留 URL');
      image.addEventListener('load', () => { caption.textContent += ` · 预览 ${image.naturalWidth} × ${image.naturalHeight}`; }, { once: true });
      image.addEventListener('error', () => { caption.textContent = '图片暂时无法加载，请检查直链或网络'; image.classList.add('asset-broken'); }, { once: true });
      info.append(node('b', image.alt), caption);
      const actions = node('div', undefined, 'asset-actions');
      const replace = node('button', '替换'); replace.addEventListener('click', run(async () => {
        if (layerTarget.value) { await command({ type: 'decoration-update', id: layerTarget.value, patch: { asset: asset.reference } }); return toast('素材已应用到图层，真实酒馆同步预览。'); }
        const id = $('#asset-variable').value; if (!id) throw new Error('请先选择要替换的图片变量。');
        await command({ type: 'variable', id, value: cssImage(asset.reference) }); toast('装饰已替换，真实酒馆同步预览。');
      }));
      const copy = node('button', '复制 CSS'); copy.addEventListener('click', run(async () => { await copyClipboard(cssImage(asset.reference), '已复制，可粘贴到主题变量或高级 CSS。导出时会处理本地引用。'); }));
      actions.append(replace, copy); row.append(image, info, actions); list.append(row);
      const archive = node('button', asset.archived ? '恢复到素材库' : '归档未引用素材'); archive.addEventListener('click', run(async () => { await api('/api/assets/archive', { ids: [asset.id], archived: !asset.archived }); await loadAssets(); })); actions.append(archive);
      if (asset.kind === 'local') {
        const thumb = node('button', '生成缩略图'); thumb.addEventListener('click', run(async () => { await createImageVariant(asset, { api }); await loadAssets(); }));
        const width = node('input'); width.type = 'number'; width.min = '16'; width.max = '8192'; width.value = '800'; width.setAttribute('aria-label', asset.name + ' 优化宽度 px');
        const optimize = node('button', '等比 WebP 变体'); optimize.addEventListener('click', run(async () => { const saved = await createImageVariant(asset, { api, width: Number(width.value), kind: 'optimized' }); toast(`变体 ${size(saved.size)}；原图保留。预览透明边缘后再选择替换。`); await loadAssets(); })); actions.append(thumb, width, optimize);
      }
    }
  }
  $('#annotate-button').addEventListener('click', () => {
    if (!isReady()) return toast('请先连接酒馆预览。', true);
    const next = !marking; stopPicking(); mark(next); send('annotate', { enabled: marking });
  });
  $('#annotation-form').addEventListener('submit', run(async () => {
    if (!draft || busy) return;
    busy = true; const button = $('#annotation-form button[type=submit]'); button.disabled = true;
    try {
      const [kind, id] = locationTarget.value.split(':');
      const saved = await api('/api/tickets', { ...draft, location: { kind, id, scope: locationScope.value }, comment: $('#annotation-comment').value });
      const blueprint = draft.canvas?.kind === 'blueprint';
      if (draft.canvas) send('canvas-proposal-saved');
      draft = null; $('#annotation-dialog').close();
      $('#ticket-filter').value = 'active'; $('#ticket-project-filter').value = 'current';
      selectedTickets.clear(); selectedTickets.add(saved.id);
      await loadTickets(); openStudioPanel('tickets-dialog');
      toast(blueprint ? '蓝图已保存为小票，尚未写入主题。告诉当前 Agent「蓝图已保存」即可继续。' : '小票已保存。告诉当前 Agent「标好了」即可继续。');
    } finally { busy = false; button.disabled = false; }
  }));
  $('#tickets-button').addEventListener('click', run(async () => { openStudioPanel('tickets-dialog'); await loadTickets(); }));
  $('#ticket-filter').addEventListener('change', () => { selectedTickets.clear(); renderTickets(); }); $('#ticket-project-filter').addEventListener('change', () => { selectedTickets.clear(); renderTickets(); });
  $('#export-tickets').addEventListener('click', () => download({ schemaVersion: 1, tickets }, '.tickets'));
  $('#copy-harness').addEventListener('click', run(() => copyAgent([...selectedTickets])));
  $('#assets-button').addEventListener('click', run(async () => { openStudioPanel('assets-dialog'); await loadAssets(); }));
  $('#extract-assets').addEventListener('click', run(async () => {
    const before = new TextEncoder().encode(getState().project.baseTheme.custom_css || '').length;
    await command({ type: 'optimize-assets' }); await loadAssets();
    const after = new TextEncoder().encode(getState().project.baseTheme.custom_css || '').length;
    toast(after < before ? `CSS 从 ${size(before)} 减至 ${size(after)}，图片保持原样。` : '当前没有需要提取的图片。');
  }));
  $('#asset-upload').addEventListener('change', run(async event => {
    const input = event.target; input.disabled = true;
    try {
      for (const file of input.files) {
        if (file.size > 32 * 1048576) throw new Error(`${file.name} 超过 32 MiB，可先缩小图片或使用外链。`);
        $('#asset-progress').textContent = `正在存储 ${file.name}…`;
        await api(`/api/assets?name=${encodeURIComponent(file.name)}`, file, true);
      }
      $('#asset-progress').textContent = '素材已保存。选择目标变量后可直接替换。';
    } finally { input.disabled = false; input.value = ''; await loadAssets(); }
  }));
  $('#asset-link-form').addEventListener('submit', run(async () => { await api('/api/assets/link', { url: $('#asset-url').value }); $('#asset-url').value = ''; await loadAssets(); toast('外链已添加，选择图片变量后可替换。'); }));
  loadTickets().catch(e => toast(e.message, true));
  return {
    async openAssets(item) {
      openStudioPanel('assets-dialog'); await loadAssets();
      const p = getState().project, variables = scanVariables(p.baseTheme.custom_css || '');
      const matches = variables.filter(v => (p.variableEdits[v.id] ?? v.value).includes(item.reference));
      layerTarget.value = '';
      $('#asset-variable').value = matches.length === 1 ? matches[0].id : '';
      if (matches.length > 1) toast('这张图片用于多个位置，请在图片变量中选择要替换的位置。');
      else if (!matches.length) toast('图片变量已变化，请刷新主题图片后再选择。');
      $('#asset-variable').focus();
    },
    render() { tickets = tickets.map(t => ({ ...t, locationStatus: locationStatus(t, getState().project) })); $('#ticket-count').textContent = relevant().filter(t => t.state !== 'done').length; if (lastProjectId !== getState().project.projectId) { lastProjectId = getState().project.projectId; selectedTickets.clear(); $('#ticket-project-filter').value = 'current'; updateSelection(); } sendPins(); if ($('#tickets-dialog').open) renderTickets(); if ($('#assets-dialog').open) renderAssetVariables(); },
    ready() { sendPins(); },
    events(events) { events.addEventListener('tickets', () => loadTickets().catch(e => toast(e.message, true))); events.addEventListener('assets', () => { if ($('#assets-dialog').open) loadAssets().catch(e => toast(e.message, true)); }); },
    receive(data) {
      if (data.type === 'annotation') {
        const state = getState();
        if (data.basis && !sameCanvasBasis(data.basis, state)) { toast('工程已更新，请重新标注。', true); return; }
        mark(false); draft = { anchor: data.anchor, scope: getScope(), revision: state.revision, sessionId: state.sessionId, projectId: state.projectId, fingerprint: state.fingerprint };
        if (data.canvas) draft.canvas = data.canvas;
        locationTarget.replaceChildren(new Option('画面部件 · ' + data.anchor.target, 'component:' + data.anchor.target));
        for (const layer of state.project.decorations) locationTarget.add(new Option('图层 · ' + layer.name, 'layer:' + layer.id));
        for (const target of TARGETS.filter(t => ['stage', 'chat', 'composer', 'left', 'right', 'message-text', 'assistant-message-text', 'user-message-text'].includes(t.id))) locationTarget.add(new Option('容器 · ' + target.name, 'container:' + target.id));
        locationScope.replaceChildren(new Option('所有尺寸', 'base')); for (const b of state.project.breakpoints) locationScope.add(new Option(b.name + ' · ' + b.condition, b.id)); locationScope.value = getScope();
        $('#annotation-context').textContent = describe(data.anchor) + (data.canvas?.kind === 'blueprint' ? ` · 整张蓝图 ${data.canvas.items.length} 个部件，各自范围随蓝图保存；关联目标仅用于定位。尚未写入主题。` : data.canvas ? ' · 包含期望位置和尺寸；尚未写入主题 CSS' : ''); $('#annotation-comment').value = ''; $('#annotation-dialog').showModal(); $('#annotation-comment').focus();
      } else if (data.type === 'annotation-ticket') { $('#ticket-filter').value = 'all'; renderTickets(); openStudioPanel('tickets-dialog'); document.querySelector(`[data-ticket="${data.id}"]`)?.scrollIntoView({ block: 'center' }); }
      else if (data.type === 'pick-cancelled' || data.type === 'disconnected') mark(false);
    },
  };
}
