import { TARGETS, FIELDS, applyCommand, compileOverrides, exportTheme, ruleCount } from '/shared/core.js';
import { attachAdvanced } from '/advanced.js';
import { FIXTURE_SCENES } from '/shared/fixture.js';
import { attachWorkflow } from '/workflow.js';
import { attachSource } from '/source.js';
import { attachLayers } from '/layers.js';
import { attachLayouts } from '/layouts.js';
import { attachExport } from '/export.js';
import { attachSetup } from '/setup.js';
import { attachThemeAnalysis } from '/theme-analysis.js';
const $ = s => document.querySelector(s);
const CHANNEL = 'tavern-theme-studio/v1';
let state, token, selected = 'assistant', scope = 'base', device = 'desktop', inspection;
let peer, peerOrigin, session, ready = false, live = false, lastSeen = 0, isPicking = false, connectedTheme;
let commandQueue = Promise.resolve(), previewProject, toastTimer, helloTimer, heartbeat, advanced, workflow, source, layers, layouts, detailsExpanded = false;
let fixtureBusy = false, fixtureSupported = false;
let fixtureState, awaitingFirstPreview = false, connectorCapabilities;
let themeAnalysis;
function updateFixture(fixture) {
  if (fixture) fixtureState = fixture;
  fixtureSupported = fixture?.supported === true;
  $('#fixture-tools').hidden = !live;
  $('#fixture-open').disabled = !ready || !fixtureSupported || fixtureBusy;
  $('#fixture-fresh').disabled = !ready || !fixtureSupported || fixtureBusy;
  $('#fixture-scene').disabled = !ready || !fixture?.active || fixtureBusy;
  $('#fixture-status').textContent = fixtureBusy ? '正在打开原生测试对话…' : !ready ? '酒馆连接已断开' : awaitingFirstPreview ? '正在应用主题预览…' : !fixtureSupported ? '更新连接器后可使用原生测试对话。' : fixture.active ? '当前为虚构测试对话 · 使用酒馆原生控件' : '测试对话独立保存；已有输入或编辑会阻止切换。';
}
function toast(text, error = false) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').classList.toggle('error', error); $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 5000); }
function send(type, payload = {}) { if (peer) peer.postMessage({ channel: CHANNEL, session, type, ...payload }, peerOrigin); }
function preview(project = previewProject || state?.project) { if (ready && project) send('preview', { project, basis: { projectId: state.projectId, sessionId: state.sessionId, revision: state.revision, fingerprint: state.fingerprint }, enabled: !$('#compare').checked }); }
async function command(value) {
  $('#save-status').textContent = '保存中…';
  const run = async () => {
    const res = await fetch('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token }, body: JSON.stringify({ revision: state.revision, sessionId: state.sessionId, projectId: state.projectId, fingerprint: state.fingerprint, command: value }) });
    const data = await res.json();
    previewProject = null;
    if (!res.ok) { if ([403, 409, 428].includes(res.status)) await refreshSession(); render(); preview(); throw new Error(data.error); }
    receiveState(data); return data;
  };
  const task = commandQueue.then(run); commandQueue = task.catch(() => {});
  try { return await task; } catch (e) { $('#save-status').textContent = '保存失败'; toast(e.message, true); throw e; }
}
function act(value) { command(value).catch(() => {}); }
function receiveState(next) {
  if (state?.sessionId !== next.sessionId) { refreshSession().catch(e => toast(e.message, true)); return; }
  if (state && next.revision < state.revision) return;
  state = next; render(); preview();
}
let sessionRefresh;
function refreshSession() {
  if (sessionRefresh) return sessionRefresh;
  sessionRefresh = (async () => {
    const response = await fetch('/api/session'), data = await response.json();
    if (!response.ok) throw new Error(data.error || '本地服务无法连接。');
    token = data.token; state = data; previewProject = null; render(); preview();
  })().finally(() => { sessionRefresh = null; });
  return sessionRefresh;
}
function fieldValue(field) {
  const own = state.project.rules[scope][selected]?.[field.key];
  const inherited = scope === 'mobile' ? state.project.rules.base[selected]?.[field.key] : undefined;
  const actual = inspection?.id === selected ? inspection.values?.[field.key] : undefined;
  return { own, value: own ?? inherited ?? actual, source: own !== undefined ? '已修改' : inherited !== undefined ? '继承基础' : actual !== undefined ? '当前效果' : '未覆盖' };
}
function colorHex(value, fallback) {
  if (/^#[a-f\d]{6}/i.test(value)) return value.slice(0, 7);
  const nums = String(value).match(/[\d.]+/g);
  if (String(value).startsWith('rgb') && nums?.length >= 3) return '#' + nums.slice(0, 3).map(n => Math.round(Number(n)).toString(16).padStart(2, '0')).join('');
  return fallback;
}
function renderFields() {
  for (const field of FIELDS) {
    const { own, value, source } = fieldValue(field);
    const row = document.getElementById(`field-${field.key}`), input = row.querySelector('input'), output = row.querySelector('output');
    row.classList.toggle('modified', own !== undefined); row.querySelector('.field-source').textContent = source;
    row.querySelector('.reset-property').disabled = own === undefined;
    if (document.activeElement === input && previewProject) continue;
    if (field.type === 'color') { input.value = colorHex(value, field.fallback); output.textContent = value || '未覆盖'; }
    else { const n = parseFloat(value); input.value = Number.isFinite(n) ? Math.min(field.max, Math.max(field.min, n)) : field.fallback; output.textContent = value ? (Number.isFinite(n) && !String(value).includes(' ') ? `${Math.round(n * 100) / 100}${field.unit}` : value) : '未覆盖'; }
    output.title = value || '未覆盖';
  }
}
function render() {
  if (!state) return;
  if (!Object.hasOwn(state.project.rules, scope)) scope = 'base';
  if (document.activeElement !== $('#project-name')) $('#project-name').value = state.project.name;
  $('#save-status').textContent = '已保存到本机'; $('#undo').disabled = !state.canUndo; $('#redo').disabled = !state.canRedo;
  for (const button of $('#target-list').children) {
    const active = button.dataset.target === selected; button.classList.toggle('active', active); button.setAttribute('aria-current', active ? 'true' : 'false');
    button.hidden = button.dataset.detail === 'true' && !detailsExpanded && !active;
    const count = Object.keys(state.project.rules[scope][button.dataset.target] || {}).length;
    button.querySelector('.target-count').textContent = count || ''; button.querySelector('.target-count').hidden = !count;
  }
  const target = TARGETS.find(x => x.id === selected);
  $('#selected-name').textContent = target.name; $('#selected-selector').textContent = target.selector; $('#selected-note').textContent = target.note;
  $('#selection-breadcrumb').textContent = `${live ? '真实酒馆' : '示例场景'} / ${target.name} / ${scope === 'base' ? '所有尺寸' : '仅手机'}`;
  $('#rule-count').textContent = `${ruleCount(state.project)} 项样式修改`;
  $('#css-badge').textContent = state.project.customCss.trim() ? '●' : '';
  renderFields(); advanced?.render(); workflow?.render(); source?.render(); layers?.render(); layouts?.render();
  themeAnalysis?.render();
}
function setSelected(id) { selected = id; inspection = undefined; $('#match-count').textContent = '正在读取…'; render(); send('select', { target: selected }); }
function setDevice(next) {
  device = next;
  for (const button of $('#device-controls').children) { button.classList.toggle('active', button.dataset.device === device); button.setAttribute('aria-pressed', String(button.dataset.device === device)); }
  $('#preview-frame-wrap').classList.toggle('mobile', device === 'mobile');
  resizePreview();
}
function resizePreview() {
  const canvas = $('#canvas'), wrap = $('#preview-frame-wrap');
  const available = canvas.clientWidth - 48, width = device === 'mobile' ? 390 : 1000;
  const scale = Math.min(1, Math.max(0.1, available / (width + 2)));
  wrap.style.width = `${width + 2}px`; wrap.style.height = `${Math.max(500, (canvas.clientHeight - 48) / scale)}px`; wrap.style.transform = `scale(${scale})`;
  $('#frame-size').textContent = `${width} px`;
}
function setPicking(value) { isPicking = value; workflow?.receive({ type: 'pick-cancelled' }); $('#pick-button').classList.toggle('active', value); $('#pick-button').setAttribute('aria-pressed', String(value)); $('#pick-button').textContent = value ? '⌖ 点击目标 · Esc 取消' : '⌖ 拾取元素'; send('pick', { enabled: value }); }
function connect() {
  ready = false; clearInterval(helloTimer); clearInterval(heartbeat);
  const params = new URLSearchParams(location.hash.slice(1));
  const embedded = window.parent !== window;
  if (params.has('origin') && params.has('session') && (window.opener || embedded)) {
    try { const parsed = new URL(params.get('origin')); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); peerOrigin = parsed.origin; peer = embedded ? window.parent : window.opener; session = params.get('session'); live = true; document.body.classList.toggle('embedded', embedded); } catch { toast('连接地址无效。', true); }
  }
  if (!live) {
    peerOrigin = location.origin; session = crypto.randomUUID();
    $('#demo').src = '/demo.html#' + new URLSearchParams({ session }).toString();
    peer = $('#demo').contentWindow;
    if (window.innerWidth <= 800) setDevice('mobile');
  }
  $('#preview-frame-wrap').hidden = live; $('#live-panel').hidden = !live; $('#device-controls').hidden = live; $('#scene').hidden = live;
  $('#connection-caption').textContent = live ? '连接中…' : '未连接酒馆';
  let attempts = 0;
  helloTimer = setInterval(() => {
    if (ready) { clearInterval(helloTimer); return; }
    if (attempts++ >= 20) { clearInterval(helloTimer); $('#connection-caption').textContent = '连接失败'; toast('连接没有响应。请在酒馆扩展面板重新打开工作台。', true); return; }
    send('hello');
  }, 500);
  heartbeat = setInterval(() => {
    if (!ready) return;
    if (peer.closed || Date.now() - lastSeen > 16000) { ready = false; $('#connection-caption').textContent = '连接已断开'; $('#connection-dot').classList.remove('connected'); toast('预览连接已断开，工程仍保存在本机。', true); }
    else send('ping');
  }, 4000);
}
window.addEventListener('message', event => {
  const data = event.data;
  if (event.source !== peer || event.origin !== peerOrigin || data?.channel !== CHANNEL || data?.session !== session) return;
  lastSeen = Date.now();
  workflow?.receive(data);
  layers?.receive(data);
  layouts?.receive(data);
  themeAnalysis?.receive(data);
  switch (data.type) {
    case 'ready': {
      connectorCapabilities = data.capabilities;
      if (data.capabilities?.projectSchema !== 3 || (state.project.recipe && data.capabilities?.decorations !== 1)) {
        ready = false; $('#connection-caption').textContent = '连接器需要更新';
        toast('此工程使用 v3。请安装新版连接器，再刷新专用测试标签。', true); break;
      }
      const first = !ready; ready = true; clearInterval(helloTimer); connectedTheme = data.theme;
      if (first) awaitingFirstPreview = data.capabilities?.decorationEditor === 1;
      $('#preview-label').textContent = live ? '真实酒馆' : '示例预览'; $('#connection-caption').textContent = live ? peerOrigin : '未连接酒馆';
      $('#connection-dot').classList.toggle('connected', live); $('#connect-button').textContent = live ? '已连接' : '连接酒馆';
      $('#connection-message').textContent = live ? `已连接 ${peerOrigin}` : '当前预览是示例，尚未连接真实酒馆。';
      if (live && first) {
        $('#live-details').textContent = `已识别 ${data.targets.filter(x => x.count).length} / ${TARGETS.length} 类部件 · ${data.hostName}`;
        if (!ruleCount(state.project) && !state.project.customCss && state.project.baseTheme.name === '新主题') act({ type: 'base-theme', theme: data.theme });
        else if (!state.sourceBound && JSON.stringify(state.project.baseTheme) !== JSON.stringify(data.theme)) $('#base-dialog').showModal();
      }
      layers?.capabilities(data.capabilities); updateFixture(data.fixture); preview(); send('select', { target: selected }); workflow?.ready(); break;
    }
    case 'inspection': inspection = data.inspection; if (inspection.id === selected) { $('#match-count').textContent = inspection.visible ? `匹配 ${inspection.count} 个 · ${inspection.pseudo ? '附着元素 ' : ''}${inspection.rect.width} × ${inspection.rect.height}` : `匹配 ${inspection.count} 个 · 当前不可见`; renderFields(); } break;
    case 'diagnosis': case 'audit-result': advanced?.receive(data); break;
    case 'picked': setPicking(false); setSelected(data.target); toast(`已选中${TARGETS.find(x => x.id === data.target)?.name || '部件'}`); break;
    case 'pick-cancelled': setPicking(false); break;
    case 'theme': act({ type: 'base-theme', theme: data.theme }); break;
    case 'fixture-status': fixtureBusy = false; updateFixture(data.fixture); break;
    case 'preview-applied': if (awaitingFirstPreview && data.basis?.projectId === state.projectId) { awaitingFirstPreview = false; updateFixture(fixtureState); } break;
    case 'pong': updateFixture(data.fixture); break;
    case 'error': toast(data.error, true); break;
    case 'disconnected': ready = false; fixtureBusy = false; updateFixture(); $('#connection-caption').textContent = '预览已停止'; $('#connection-dot').classList.remove('connected'); break;
  }
});
window.addEventListener('pagehide', () => send('disconnect'));

function download(data, suffix) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `${state.project.name.replace(/[<>:"/\\|?*]/g, '_')}${suffix}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function buildControls() {
  for (const target of TARGETS) {
    const button = document.createElement('button'); button.dataset.target = target.id; button.dataset.detail = String(!!target.detail);
    const icon = document.createElement('span'); icon.className = 'target-icon'; icon.textContent = target.icon;
    const name = document.createElement('span'); name.textContent = target.name;
    const count = document.createElement('span'); count.className = 'target-count';
    button.append(icon, name, count); button.addEventListener('click', () => setSelected(target.id)); $('#target-list').append(button);
  }
  let group;
  for (const field of FIELDS) {
    if (field.group !== group) { group = field.group; const h = document.createElement('h3'); h.textContent = group; $('#property-fields').append(h); }
    const row = document.createElement('div'); row.className = 'field'; row.id = `field-${field.key}`;
    const labelRow = document.createElement('div'); labelRow.className = 'field-label';
    const label = document.createElement('label'); label.htmlFor = `prop-${field.key}`; label.textContent = field.label;
    const source = document.createElement('span'); source.className = 'field-source';
    labelRow.append(label, source);
    const inputRow = document.createElement('div'); inputRow.className = 'field-input';
    const input = document.createElement('input'); input.id = `prop-${field.key}`; input.type = field.type; input.setAttribute('aria-label', field.label);
    if (field.type === 'range') { input.min = field.min; input.max = field.max; input.step = field.step; }
    const output = document.createElement('output'); output.htmlFor = input.id;
    const reset = document.createElement('button'); reset.className = 'reset-property'; reset.textContent = '↺'; reset.setAttribute('aria-label', `还原${field.label}`); reset.title = '删除此覆盖，恢复底层样式';
    const value = () => field.type === 'color' ? input.value : `${input.value}${field.unit}`;
    input.addEventListener('input', () => {
      const cmd = { type: 'set', target: selected, scope, property: field.key, value: value() };
      try { previewProject = applyCommand(state.project, cmd); output.textContent = value(); source.textContent = '预览中'; preview(); } catch (e) { toast(e.message, true); }
    });
    input.addEventListener('change', () => act({ type: 'set', target: selected, scope, property: field.key, value: value() }));
    reset.addEventListener('click', () => act({ type: 'set', target: selected, scope, property: field.key, value: null }));
    inputRow.append(input, output, reset); row.append(labelRow, inputRow); $('#property-fields').append(row);
  }
}
function bindControls() {
  for (const scene of FIXTURE_SCENES) { const option = document.createElement('option'); option.value = scene.id; option.textContent = scene.label; $('#fixture-scene').append(option); }
  const openFixture = fresh => {
    if (!ready || !fixtureSupported || fixtureBusy) return;
    fixtureBusy = true; updateFixture({ supported: true }); send('fixture-open', { fresh });
  };
  $('#fixture-open').addEventListener('click', () => openFixture(false));
  $('#fixture-fresh').addEventListener('click', () => openFixture(true));
  $('#fixture-scene').addEventListener('change', () => { if ($('#fixture-scene').value) send('fixture-scene', { scene: $('#fixture-scene').value }); });
  $('#component-count').textContent = TARGETS.length;
  $('#toggle-details').addEventListener('click', () => { detailsExpanded = !detailsExpanded; $('#toggle-details').textContent = detailsExpanded ? '收起消息细节与装饰' : '展开消息细节与装饰'; render(); });
  $('#project-name').addEventListener('change', () => act({ type: 'rename', name: $('#project-name').value }));
  $('#undo').addEventListener('click', () => act({ type: 'undo' })); $('#redo').addEventListener('click', () => act({ type: 'redo' }));
  $('#reset-target').addEventListener('click', () => act({ type: 'reset-target', target: selected, scope }));
  $('#scope-controls').addEventListener('click', e => { const next = e.target.dataset.scope; if (!next) return; scope = next; for (const b of $('#scope-controls').children) { b.classList.toggle('active', b.dataset.scope === scope); b.setAttribute('aria-pressed', String(b.dataset.scope === scope)); } $('#scope-hint').textContent = scope === 'mobile' ? '仅宽度不超过 767 px 时覆盖基础样式。' : '基础样式作用于所有屏幕尺寸。'; if (!live) setDevice(scope === 'mobile' ? 'mobile' : 'desktop'); render(); });
  $('#device-controls').addEventListener('click', e => { if (e.target.dataset.device) setDevice(e.target.dataset.device); });
  $('#pick-button').addEventListener('click', () => { if (!ready) return toast('请等待预览连接。', true); setPicking(!isPicking); if (live && isPicking) peer.focus(); });
  $('#focus-host').addEventListener('click', () => { if (ready) { setPicking(true); peer.focus(); } else toast('请从酒馆扩展面板重新打开工作台。', true); });
  $('#compare').addEventListener('change', () => { preview(); $('#canvas').classList.toggle('comparing', $('#compare').checked); });
  $('#scene').addEventListener('change', () => send('scene', { scene: $('#scene').value }));
  $('#files-button').addEventListener('click', () => $('#files-dialog').showModal()); $('#connect-button').addEventListener('click', () => $('#connect-dialog').showModal());
  const exportFile = async (url, suffix, message) => {
    try { await commandQueue; const response = await fetch(url), data = await response.json(); if (!response.ok) throw new Error(data.error); download(data, suffix); toast(message); } catch (e) { toast(e.message, true); }
  };
  attachExport({ download, toast });
  $('#save-project').addEventListener('click', () => exportFile('/api/backup', '.studio', '工程备份已导出，包含本地素材。'));
  $('#import-file').addEventListener('change', async e => {
    try { const file = e.target.files[0]; if (!file) return; if (file.size > 48 * 1024 * 1024) throw new Error('工程导入上限 48 MiB；更大素材请单独上传或使用外链。'); const data = JSON.parse(await file.text()); await command(data.schemaVersion !== undefined ? { type: 'import-project', project: data } : { type: 'import-theme', theme: data }); $('#files-dialog').close(); toast('已导入并提取内嵌图片，可用撤销恢复。'); } catch (error) { toast(error.message, true); } finally { e.target.value = ''; }
  });
  $('#advanced-button').addEventListener('click', () => { $('#css-editor').value = state.project.customCss; $('#css-editor').readOnly = false; $('#css-dialog-title').textContent = '高级 CSS'; $('#save-css').hidden = false; $('#css-help').textContent = '在可视化规则之后应用。可覆盖部件设置；外部资源引用会由浏览器加载。'; $('#css-dialog').showModal(); });
  $('#view-css').addEventListener('click', () => { $('#css-editor').value = compileOverrides(state.project) || '/* 尚未添加样式修改 */'; $('#css-editor').readOnly = true; $('#css-dialog-title').textContent = '生成的 CSS'; $('#save-css').hidden = true; $('#css-help').textContent = '由部件规则和高级 CSS 生成。导出的主题还会保留原主题 CSS。'; $('#css-dialog').showModal(); });
  $('#save-css').addEventListener('click', async () => { try { await command({ type: 'custom-css', css: $('#css-editor').value }); $('#css-dialog').close(); } catch {} });
  $('#capture-theme').addEventListener('click', () => { if (connectedTheme) act({ type: 'base-theme', theme: connectedTheme }); $('#base-dialog').close(); });
  document.addEventListener('keydown', e => { if (e.target.matches('input, textarea, [contenteditable]') || document.querySelector('dialog[open]')) return; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); act({ type: e.shiftKey ? 'redo' : 'undo' }); } if (e.key === 'Escape') setPicking(false); });
  new ResizeObserver(resizePreview).observe($('#canvas'));
}
try {
  const response = await fetch('/api/session'); if (!response.ok) throw new Error('本地服务无法连接。');
  const data = await response.json(); token = data.token; state = data;
  buildControls(); bindControls();
  advanced = attachAdvanced({ getState: () => state, command, preview, send, toast, getSelected: () => selected, isLive: () => live, isReady: () => ready, setDevice, getDevice: () => device });
  workflow = attachWorkflow({ getState: () => state, getToken: () => token, getScope: () => scope, command, send, toast, isReady: () => ready, stopPicking: () => setPicking(false), download });
  attachSetup(() => ({ ready, live, capabilities: connectorCapabilities, fixture: $('#fixture-status').textContent }));
  source = attachSource({ getState: () => state, getToken: () => token, toast });
  layers = attachLayers({ getState: () => state, command, preview, toast, send });
  themeAnalysis = attachThemeAnalysis({ getState: () => state, getToken: () => token, command, send, toast, connection: () => ({ ready, live, capabilities: connectorCapabilities }) });
  layouts = attachLayouts({ getState: () => state, command, toast, getSelected: () => selected });
  render(); connect();
  const events = new EventSource('/api/events'); events.onmessage = e => receiveState(JSON.parse(e.data)); events.onerror = () => { $('#save-status').textContent = '本地连接中断'; }; events.onopen = () => { refreshSession().catch(e => toast(e.message, true)); };
  window.addEventListener('pagehide', () => { events.close(); clearInterval(helloTimer); clearInterval(heartbeat); }, { once: true });
  workflow.events(events);
  source.events(events);
  layers.events(events);
} catch (e) { $('#save-status').textContent = '启动失败'; toast(e.message, true); }
