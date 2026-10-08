import { TARGETS } from '/shared/core.js';
import { scanVariables } from '/shared/variables.js';
import { TICKET_STATES } from '/shared/tickets.js';
import { resolveAssetUrls, cssImage } from '/shared/assets.js';
import { formatAgentHandoff } from '/shared/handoff.js';
import { attachHub } from '/hub.js';
import { attachRunner } from '/runner.js';
import { createImageVariant } from '/asset-optimize.js';
import { locationStatus } from '/shared/ticket-location.js';

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
  async function copyClipboard(text, message) {
    try { await navigator.clipboard.writeText(text); toast(message); return true; }
    catch {
      let dialog = $('#clipboard-dialog');
      if (!dialog) {
        dialog = node('dialog', undefined, 'wide-dialog'); dialog.id = 'clipboard-dialog';
        const head = node('form', undefined, 'dialog-header'); head.method = 'dialog'; head.append(node('h2', '手动复制交接内容'));
        const close = node('button', '×'); close.setAttribute('aria-label', '关闭手动复制'); head.append(close);
        const body = node('div', undefined, 'dialog-body'); body.append(node('p', '当前浏览器没有允许直接复制。完整内容已准备，请选中文本后按 Ctrl+C 或使用系统复制。'));
        const area = node('textarea'); area.id = 'clipboard-text'; area.readOnly = true; area.rows = 18; area.setAttribute('aria-label', '可手动复制的完整内容');
        const select = node('button', '全选文本'); select.addEventListener('click', () => { area.focus(); area.select(); }); body.append(area, select); dialog.append(head, body); document.body.append(dialog);
      }
      $('#clipboard-text').value = text; dialog.showModal(); $('#clipboard-text').focus(); $('#clipboard-text').select();
      toast('完整文本已准备，请在弹出的文本框中手动复制。'); return false;
    }
  }
  async function api(url, body, raw = false) {
    const state = getState();
    const res = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'X-Studio-Token': getToken(), ...(!raw && { 'Content-Type': 'application/json' }) }, body: raw ? body : JSON.stringify({ sessionId: state.sessionId, projectId: state.projectId, fingerprint: state.fingerprint, revision: state.revision, ...body }) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error); return data;
  }
  function reportError(error) {
    toast(error.message, true);
    const dialog = document.querySelector('dialog[open]');
    if (!dialog) return;
    let message = dialog.querySelector('.workflow-error');
    if (!message) { message = node('p', undefined, 'workflow-error'); message.setAttribute('role', 'alert'); dialog.querySelector('.dialog-body').prepend(message); }
    message.textContent = error.message; message.scrollIntoView({ block: 'nearest' });
  }
  const run = action => async event => { event?.preventDefault(); document.querySelectorAll('.workflow-error').forEach(el => el.remove()); try { await action(event); } catch (e) { reportError(e); } };
  attachHub({ api, command, getState, reportError, layerTarget, download });
  attachRunner({ api, getIds: () => [...selectedTickets], reportError });
  const assetScope = node('select'); assetScope.setAttribute('aria-label', '素材范围');
  assetScope.add(new Option('全部本地素材', 'local')); assetScope.add(new Option('当前工程引用', 'project')); assetScope.add(new Option('已归档（可恢复）', 'archived'));
  $('#assets-list').before(assetScope); assetScope.addEventListener('change', renderAssets);
  const relevant = () => tickets.filter(t => t.basis.projectId === getState().project.projectId);
  function sendPins() { if (isReady()) send('annotations', { tickets: relevant().filter(t => t.locationStatus?.valid !== false).map(({ id, number, state, anchor }) => ({ id, number, state, anchor })) }); }
  function mark(value) {
    marking = value; $('#annotate-button').setAttribute('aria-pressed', String(value)); $('#annotate-button').classList.toggle('active', value);
    $('#annotate-button').textContent = value ? '点击画面 · Esc 取消' : '＋ 标点评论';
  }
  function describe(anchor) { return `${TARGETS.find(t => t.id === anchor.target)?.name || anchor.target} · ${anchor.viewport.width} × ${anchor.viewport.height}${anchor.fixture ? ' · 虚构测试对话' : ''}`; }
  async function loadTickets() { tickets = await api('/api/tickets'); renderTickets(); sendPins(); }
  async function copyAgent(ids) {
    if (!ids.length) throw new Error('请先明确选择需要处理的小票。');
    const selected = await Promise.all(ids.map(id => api(`/api/tickets/${id}`)));
    const context = await api('/api/handoff-context');
    await copyClipboard(formatAgentHandoff(selected, context), `已复制 ${ids.length} 张小票的完整交接内容，可粘贴到已打开项目的 harness 对话。`);
  }
  function updateSelection() { $('#copy-harness').textContent = `复制所选给 Agent (${selectedTickets.size})`; $('#copy-harness').disabled = !selectedTickets.size; }
  function renderTickets() {
    $('#ticket-count').textContent = relevant().filter(t => t.state !== 'done').length;
    const filter = $('#ticket-filter').value;
    const shown = tickets.filter(t => filter === 'all' || (filter === 'active' ? t.state !== 'done' : t.state === filter));
    $('#tickets-total').textContent = shown.length;
    const list = $('#tickets-list'); list.replaceChildren();
    if (!shown.length) { list.append(node('p', '还没有这类小票。在真实酒馆中点击「标点评论」，点一下想调整的位置。', 'empty-state')); return; }
    for (const ticket of shown.toReversed()) {
      const row = node('article', undefined, 'ticket-row'); row.dataset.ticket = ticket.id;
      const head = node('div', undefined, 'ticket-heading'); head.append(node('b', `#${ticket.number}`), node('span', TICKET_STATES[ticket.state], `ticket-state ${ticket.state}`));
      const selectLabel = node('label', undefined, 'ticket-select'), select = node('input'); select.type = 'checkbox'; select.checked = selectedTickets.has(ticket.id); select.setAttribute('aria-label', `选择小票 #${ticket.number}`);
      select.addEventListener('change', () => { if (select.checked) selectedTickets.add(ticket.id); else selectedTickets.delete(ticket.id); updateSelection(); }); selectLabel.append(select, node('span', '选择')); head.append(selectLabel);
      const meta = node('small', `${describe(ticket.anchor)} · ${ticket.location?.condition || (ticket.scope === 'mobile' ? '仅手机' : '所有尺寸')} · ${ticket.basis.name}`, 'ticket-meta');
      const comment = node('p', ticket.comment, 'ticket-comment');
      const actions = node('div', undefined, 'ticket-actions');
      const locate = node('button', '定位标点'); locate.disabled = !isReady() || ticket.basis.projectId !== getState().project.projectId;
      if (ticket.locationStatus?.valid === false) locate.disabled = true;
      locate.addEventListener('click', () => {
        $('#tickets-dialog').close(); const s = getState();
        if (ticket.location?.kind === 'layer') send('decoration-edit', { id: ticket.location.id, scope: ticket.location.scope, basis: { projectId: s.projectId, sessionId: s.sessionId, fingerprint: s.fingerprint, revision: s.revision } });
        else send('annotation-focus', { anchor: ticket.location?.kind === 'container' ? { ...ticket.anchor, target: ticket.location.id, occurrence: 0, messageIndex: undefined, point: { x: .5, y: .5 } } : ticket.anchor });
      });
      const copy = node('button', '复制 JSON'); copy.addEventListener('click', run(async () => { await copyClipboard(JSON.stringify(await api(`/api/tickets/${ticket.id}`), null, 2), '纯 JSON 已复制。'); }));
      const agent = node('button', '复制给 Agent'); agent.addEventListener('click', run(() => copyAgent([ticket.id])));
      actions.append(locate, agent, copy);
      if (ticket.state === 'review') {
        const accept = node('button', '验收通过', 'primary'); accept.addEventListener('click', run(async () => { await api(`/api/tickets/${ticket.id}`, { action: 'accept', version: ticket.version }); await loadTickets(); })); actions.append(accept);
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
          for (const artifact of details.artifacts) result.append(node('p', `${artifact.label}：${artifact.reference}`, 'ticket-meta'));
        }
        row.append(result);
      }
      row.append(actions); list.append(row);
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
      await api('/api/tickets', { ...draft, location: { kind, id, scope: locationScope.value }, comment: $('#annotation-comment').value });
      draft = null; $('#annotation-dialog').close(); await loadTickets(); $('#tickets-dialog').showModal(); toast('小票已进入本机待办队列。');
    } finally { busy = false; button.disabled = false; }
  }));
  $('#tickets-button').addEventListener('click', run(async () => { $('#tickets-dialog').showModal(); await loadTickets(); }));
  $('#ticket-filter').addEventListener('change', () => { selectedTickets.clear(); renderTickets(); });
  $('#export-tickets').addEventListener('click', () => download({ schemaVersion: 1, tickets }, '.tickets'));
  $('#copy-harness').addEventListener('click', run(() => copyAgent([...selectedTickets])));
  $('#assets-button').addEventListener('click', run(async () => { $('#assets-dialog').showModal(); await loadAssets(); }));
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
    render() { tickets = tickets.map(t => ({ ...t, locationStatus: locationStatus(t, getState().project) })); $('#ticket-count').textContent = relevant().filter(t => t.state !== 'done').length; if (lastProjectId !== getState().project.projectId) lastProjectId = getState().project.projectId; sendPins(); if ($('#tickets-dialog').open) renderTickets(); if ($('#assets-dialog').open) renderAssetVariables(); },
    ready() { sendPins(); },
    events(events) { events.addEventListener('tickets', () => loadTickets().catch(e => toast(e.message, true))); events.addEventListener('assets', () => { if ($('#assets-dialog').open) loadAssets().catch(e => toast(e.message, true)); }); },
    receive(data) {
      if (data.type === 'annotation') {
        const state = getState();
        mark(false); draft = { anchor: data.anchor, scope: getScope(), revision: state.revision, sessionId: state.sessionId, projectId: state.projectId, fingerprint: state.fingerprint };
        locationTarget.replaceChildren(new Option('画面部件 · ' + data.anchor.target, 'component:' + data.anchor.target));
        for (const layer of state.project.decorations) locationTarget.add(new Option('图层 · ' + layer.name, 'layer:' + layer.id));
        for (const target of TARGETS.filter(t => ['stage', 'chat', 'composer', 'left', 'right', 'message-text'].includes(t.id))) locationTarget.add(new Option('容器 · ' + target.name, 'container:' + target.id));
        locationScope.replaceChildren(new Option('所有尺寸', 'base')); for (const b of state.project.breakpoints) locationScope.add(new Option(b.name + ' · ' + b.condition, b.id)); locationScope.value = getScope();
        $('#annotation-context').textContent = describe(data.anchor); $('#annotation-comment').value = ''; $('#annotation-dialog').showModal(); $('#annotation-comment').focus();
      } else if (data.type === 'annotation-ticket') { $('#ticket-filter').value = 'all'; renderTickets(); $('#tickets-dialog').showModal(); document.querySelector(`[data-ticket="${data.id}"]`)?.scrollIntoView({ block: 'center' }); }
      else if (data.type === 'pick-cancelled' || data.type === 'disconnected') mark(false);
    },
  };
}
