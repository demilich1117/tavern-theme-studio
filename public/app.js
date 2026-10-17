import { TARGETS, FIELDS, applyCommand, compileOverrides, exportTheme, ruleCount } from '/shared/core.js';
import { attachInspector } from '/inspector.js';
import { matchesWidth } from '/shared/editing.js';
import { attachAdvanced } from '/advanced.js';
import { FIXTURE_SCENES } from '/shared/fixture.js';
import { attachWorkflow } from '/workflow.js';
import { attachSource } from '/source.js';
import { attachLayers } from '/layers.js';
import { attachLayouts } from '/layouts.js';
import { attachExport } from '/export.js';
import { attachSetup } from '/setup.js';
import { attachRuntimeManager } from '/runtime-manager.js';
import { attachThemeAnalysis } from '/theme-analysis.js';
import { attachCoDesign } from '/co-design.js';
import { attachNavigation, showEditor } from '/panels.js';
import { attachObjects } from '/objects.js';
import { attachArtworks } from '/artworks.js';
import { attachWorkImport } from '/work-import.js';
import { attachCanvas } from '/canvas.js';
import { sameCanvasBasis } from '/shared/canvas.js';
const $ = s => document.querySelector(s);
const CHANNEL = 'tavern-theme-studio/v1';
let state, token, selected = 'assistant', scope = 'base', device = 'desktop', inspection;
let peer, peerOrigin, session, ready = false, live = false, lastSeen = 0, isPicking = false, connectedTheme;
let commandQueue = Promise.resolve(), previewProject, toastTimer, helloTimer, heartbeat, advanced, workflow, source, layers, layouts, detailsExpanded = false;
let fixtureBusy = false, fixtureSupported = false;
let fixtureState, awaitingFirstPreview = false, connectorCapabilities;
let themeAnalysis, coDesign, artworks, workImport, inspector, hostViewport, exporter, canvasEditor;
let runtimeClosing = false, objects;
function updateFixture(fixture) {
  if (fixture) fixtureState = fixture;
  fixtureSupported = fixture?.supported === true;
  $('#fixture-tools').hidden = !live;
  $('#native-preview-controls').hidden = !live;
  $('#fixture-open').hidden = fixture?.active === true;
  $('#fixture-open').disabled = !ready || !fixtureSupported || fixtureBusy;
  $('#fixture-fresh').disabled = !ready || !fixtureSupported || fixtureBusy;
  $('#fixture-scene').disabled = !ready || !fixture?.active || fixtureBusy;
  $('#fixture-status').textContent = fixtureBusy ? '正在打开原生测试对话…' : !ready ? '酒馆连接已断开' : awaitingFirstPreview ? '正在应用主题预览…' : !fixtureSupported ? '更新连接器后可使用原生测试对话。' : fixture.active ? '当前为虚构测试对话 · 使用酒馆原生控件' : '连接已就绪 · 进入画布时自动打开测试对话';
  coDesign?.render();
  canvasEditor?.render();
  objects?.render();
}
function toast(text, error = false) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').classList.toggle('error', error); $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 5000); }
function send(type, payload = {}) { if (peer) peer.postMessage({ channel: CHANNEL, session, type, ...payload }, peerOrigin); }
function preview(project = previewProject || state?.project) { if (ready && project) send('preview', { project, basis: { projectId: state.projectId, sessionId: state.sessionId, revision: state.revision, fingerprint: state.fingerprint }, enabled: !$('#compare').checked }); }
async function command(value, expectedBasis) {
  if (runtimeClosing) throw new Error('后台正在关闭，请重新启动工作台后编辑。');
  $('#save-status').textContent = '保存中…';
  const run = async () => {
    if (expectedBasis && !sameCanvasBasis(expectedBasis, state)) throw new Error('工程已更新，此次拖动未保存，请重新操作。');
    const res = await fetch('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token }, body: JSON.stringify({ revision: state.revision, sessionId: state.sessionId, projectId: state.projectId, fingerprint: state.fingerprint, command: value }) });
    const data = await res.json();
    previewProject = null;
    if (!res.ok) { if ([403, 409, 428].includes(res.status)) await refreshSession(); render(); preview(); throw new Error(data.error); }
    if (data.sessionId !== state.sessionId) await refreshSession(); else receiveState(data);
    return data;
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
    const changedWork = state?.projectId !== data.projectId;
    token = data.token; state = data; previewProject = null;
    if (changedWork) {
      inspection = undefined; selected = 'assistant'; scope = 'base';
      for (const dialog of document.querySelectorAll('dialog:modal')) if (dialog.id !== 'work-import-dialog') dialog.close();
      setPicking(false); send('decoration-edit-stop'); send('canvas-stop');
      $('#match-count').textContent = '正在读取…'; send('select', { target: selected });
    }
    render(); preview();
  })().finally(() => { sessionRefresh = null; });
  return sessionRefresh;
}
function renderFields() { inspector?.render(); }
function setScope(next) {
  if (!Object.hasOwn(state.project.rules, next)) return;
  scope = next;
  if (!live) setDevice(scope === 'base' || state.project.breakpoints.find(b=>b.id===scope)?.condition.includes('min-width') ? 'desktop' : 'mobile');
  render();
}
function renderScope() {
  const choices = [{ id: 'base', name: '所有尺寸' }, ...state.project.breakpoints];
  if (!state.project.breakpoints.some(b=>b.condition==='(min-width: 768px)')) choices.push({id:'__desktop',name:'仅电脑'});
  const controls = $('#scope-controls'); controls.replaceChildren();
  for (const item of choices) {
    const button = document.createElement('button'); button.dataset.scope = item.id; button.textContent = item.name;
    button.classList.toggle('active', item.id === scope); button.setAttribute('aria-pressed', String(item.id === scope)); controls.append(button);
  }
  const breakpoint = state.project.breakpoints.find(b => b.id === scope);
  $('#scope-hint').textContent = !breakpoint ? '作用于所有尺寸；局部尺寸设置可覆盖。' : breakpoint.condition.replace('(max-width: ', '仅宽度不超过 ').replace('(min-width: ', '仅宽度不少于 ').replace('px)', ' px') + (hostViewport && !matchesWidth(breakpoint.condition, hostViewport.width) ? ' · 当前画面未进入此尺寸' : '');
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
  $('#target-select').value = selected;
  $('#storage-location').textContent = `自动保存在本机：${state.dataDir || '当前服务的数据目录'}`;
  $('#selected-name').textContent = target.name; $('#selected-selector').textContent = target.selector; $('#selected-note').textContent = target.note;
  $('#selection-breadcrumb').textContent = `${live ? '真实酒馆' : '示例场景'} / ${target.name} / ${scope === 'base' ? '所有尺寸' : state.project.breakpoints.find(b => b.id === scope)?.name}`;
  $('#rule-count').textContent = `${ruleCount(state.project)} 项样式修改`;
  $('#css-badge').textContent = state.project.customCss.trim() ? '●' : '';
  renderScope(); renderFields(); advanced?.render(); workflow?.render(); source?.render(); layers?.render(); layouts?.render(); artworks?.render();
  themeAnalysis?.render();
  workImport?.render();
  coDesign?.render();
  canvasEditor?.render();
  objects?.render();
}
function setSelected(id) { showEditor(); selected = id; inspection = undefined; $('#match-count').textContent = '正在读取…'; render(); send('select', { target: selected }); }
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
    if (peer.closed || Date.now() - lastSeen > 16000) { ready = false; updateFixture(); $('#connection-caption').textContent = '连接已断开'; $('#connection-dot').classList.remove('connected'); toast('预览连接已断开，工程仍保存在本机。', true); }
    else send('ping');
  }, 4000);
}
window.addEventListener('message', event => {
  if (runtimeClosing) return;
  const data = event.data;
  if (event.source !== peer || event.origin !== peerOrigin || data?.channel !== CHANNEL || data?.session !== session) return;
  lastSeen = Date.now();
  workflow?.receive(data);
  layers?.receive(data);
  layouts?.receive(data);
  themeAnalysis?.receive(data);
  workImport?.receive(data);
  exporter?.receive(data);
  canvasEditor?.receive(data);
  switch (data.type) {
    case 'ready': {
      connectorCapabilities = data.capabilities;
      if (data.capabilities?.projectSchema !== 3 || data.capabilities?.directEditing !== 1 || (state.project.recipe && data.capabilities?.decorations !== 1)) {
        ready = false; $('#connection-caption').textContent = '连接器需要更新';
        canvasEditor?.render();
        toast('请安装与工作台配套的新版连接器，再刷新专用测试标签。工程会保留。', true); break;
      }
      const first = !ready; ready = true; clearInterval(helloTimer); connectedTheme = data.theme;
      if (first) awaitingFirstPreview = data.capabilities?.decorationEditor === 1;
      $('#preview-label').textContent = live ? '真实酒馆' : '示例预览'; $('#connection-caption').textContent = live ? peerOrigin : '未连接酒馆';
      $('#connection-dot').classList.toggle('connected', live); $('#connect-button').textContent = live ? '已连接' : '连接酒馆';
      $('#connection-message').textContent = live ? `已连接 ${peerOrigin}` : '当前预览是示例，尚未连接真实酒馆。';
      if (live && first) {
        $('#live-details').textContent = `已识别 ${data.targets.filter(x => x.count).length} / ${TARGETS.length} 类部件 · ${data.hostName}`;
        if (!ruleCount(state.project) && !state.project.customCss && state.project.baseTheme.name === '新主题') act({ type: 'base-theme', theme: data.theme });
      }
      layers?.capabilities(data.capabilities); updateFixture(data.fixture); preview(); send('select', { target: selected }); workflow?.ready(); canvasEditor?.render(); break;
    }
    case 'inspection': inspection = data.inspection; if (inspection.id === selected) { $('#match-count').textContent = inspection.visible ? `匹配 ${inspection.count} 个 · ${inspection.pseudo ? '附着元素 ' : ''}${inspection.rect.width} × ${inspection.rect.height}` : `匹配 ${inspection.count} 个 · 当前不可见`; renderFields(); objects?.render(); } break;
    case 'open-objects': showEditor(); objects?.open(); break;
    case 'viewport': hostViewport = data; renderScope(); break;
    case 'pick-unsupported': toast(data.message); break;
    case 'diagnosis': case 'audit-result': advanced?.receive(data); break;
    case 'picked': setPicking(false); setSelected(data.target); if (document.body.classList.contains('embedded') && innerHeight < 600) $('#property-fields').scrollIntoView({ block: 'start' }); toast(`已选中${TARGETS.find(x => x.id === data.target)?.name || '部件'}`); break;
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
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `${(data.name || state.project.name).replace(/[<>:"/\\|?*]/g, '_')}${suffix}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function buildControls() {
  const groups = new Map();
  for (const [id, label] of [['page', '页面与输入'], ['assistant', '角色部件'], ['user', '用户部件'], ['shared', '全部消息 · 通用样式']]) {
    const group = document.createElement('optgroup'); group.label = label; $('#target-select').append(group); groups.set(id, group);
  }
  for (const target of TARGETS) {
    const group = target.shared ? 'shared' : target.role || (['assistant', 'assistant-before', 'assistant-after'].includes(target.id) ? 'assistant' : target.id === 'user' ? 'user' : 'page');
    groups.get(group).append(new Option(target.name, target.id));
    const button = document.createElement('button'); button.dataset.target = target.id; button.dataset.detail = String(!!target.detail);
    const icon = document.createElement('span'); icon.className = 'target-icon'; icon.textContent = target.icon;
    const name = document.createElement('span'); name.textContent = target.name;
    const count = document.createElement('span'); count.className = 'target-count';
    button.append(icon, name, count); button.addEventListener('click', () => setSelected(target.id)); $('#target-list').append(button);
  }
}
function buildInspector() {
  inspector = attachInspector({
    getContext: () => ({ project: state.project, target: selected, scope, inspection, comparing: $('#compare').checked, drafting: !!previewProject }),
    select: setSelected,
    openLayer: id => layers.open(id).catch(e => toast(e.message, true)),
    resetScope: (target, scope) => act({ type: 'reset-target', target, scope }),
    change: (property, value, draft) => {
      const cmd = { type: 'set', target: selected, scope, property, value };
      try { if (draft) { previewProject = applyCommand(state.project, cmd); preview(); } else act(cmd); }
      catch (e) { toast(e.message, true); renderFields(); }
    }
  });
}
function bindControls() {
  $('#target-select').addEventListener('change', () => setSelected($('#target-select').value));
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
  const editHistory=action=>{if(!canvasEditor?.history(action))act({type:action});};
  $('#undo').addEventListener('click', () => editHistory('undo')); $('#redo').addEventListener('click', () => editHistory('redo'));
  $('#reset-target').addEventListener('click', () => act({ type: 'reset-target', target: selected, scope }));
  $('#scope-controls').addEventListener('click', async e => { let next=e.target.dataset.scope; if(!next)return;try{if(next==='__desktop'){const existing=state.project.breakpoints.find(b=>b.condition==='(min-width: 768px)');next=existing?.id||'desktop-'+crypto.randomUUID();if(!existing)await command({type:'breakpoints',breakpoints:[...state.project.breakpoints,{id:next,name:'仅电脑',condition:'(min-width: 768px)'}]});}setScope(next);}catch(error){toast(error.message,true);} });
  $('#device-controls').addEventListener('click', e => { if (e.target.dataset.device) setDevice(e.target.dataset.device); });
  $('#pick-button').addEventListener('click', () => { if (!ready) return toast('请等待预览连接。', true); setPicking(!isPicking); if (live && isPicking) peer.focus(); });
  $('#focus-host').addEventListener('click', () => { if (ready) { setPicking(true); peer.focus(); } else toast('请从酒馆扩展面板重新打开工作台。', true); });
  $('#compare').addEventListener('change', () => { preview(); canvasEditor?.render(); $('#canvas').classList.toggle('comparing', $('#compare').checked); });
  $('#scene').addEventListener('change', () => send('scene', { scene: $('#scene').value }));
  $('#files-button').addEventListener('click', () => $('#files-dialog').showModal()); $('#connect-button').addEventListener('click', () => $('#connect-dialog').showModal());
  const exportFile = async (url, suffix, message) => {
    try { await commandQueue; const response = await fetch(url), data = await response.json(); if (!response.ok) throw new Error(data.error); download(data, suffix); toast(message); } catch (e) { toast(e.message, true); }
  };
  exporter = attachExport({ download, toast, settled: () => commandQueue, getName: () => state.project.name, connection: () => ({ ready, live, capabilities: connectorCapabilities }), send, onApplied: () => { $('#compare').checked = false; preview(); renderFields(); toast('主题已保存到酒馆，可关闭工作台继续使用。'); } });
  $('#save-project').addEventListener('click', () => exportFile('/api/backup', '.studio', '工程备份已导出，包含本地素材。'));
  $('#import-file').addEventListener('change', async e => {
    try { const file = e.target.files[0]; if (!file) return; if (file.size > 48 * 1024 * 1024) throw new Error('工程导入上限 48 MiB；更大素材请单独上传或使用外链。'); const data = JSON.parse(await file.text()); $('#files-dialog').close(); if (data.schemaVersion === undefined) { await workImport.open(data); return; } await command({ type: 'import-project', project: data }); toast('已恢复工程，恢复前的草稿已留快照。'); } catch (error) { toast(error.message, true); } finally { e.target.value = ''; }
  });
  $('#advanced-button').addEventListener('click', () => { $('#css-editor').value = state.project.customCss; $('#css-editor').readOnly = false; $('#css-dialog-title').textContent = '高级 CSS'; $('#save-css').hidden = false; $('#css-help').textContent = '在可视化规则之后应用。可覆盖部件设置；外部资源引用会由浏览器加载。'; $('#css-dialog').showModal(); });
  $('#view-css').addEventListener('click', () => { $('#css-editor').value = compileOverrides(state.project) || '/* 尚未添加样式修改 */'; $('#css-editor').readOnly = true; $('#css-dialog-title').textContent = '生成的 CSS'; $('#save-css').hidden = true; $('#css-help').textContent = '由部件规则和高级 CSS 生成。导出的主题还会保留原主题 CSS。'; $('#css-dialog').showModal(); });
  $('#save-css').addEventListener('click', async () => { try { await command({ type: 'custom-css', css: $('#css-editor').value }); $('#css-dialog').close(); } catch {} });
  $('#capture-theme').addEventListener('click', () => { if (connectedTheme) act({ type: 'base-theme', theme: connectedTheme }); $('#base-dialog').close(); });
  document.addEventListener('keydown', e => { if (e.target.matches('input:not([type=range]):not([type=color]), textarea, [contenteditable]') || document.querySelector('dialog:modal')) return; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); editHistory(e.shiftKey ? 'redo' : 'undo'); } if (e.key === 'Escape') setPicking(false); });
  new ResizeObserver(resizePreview).observe($('#canvas'));
}
try {
  const response = await fetch('/api/session'); if (!response.ok) throw new Error('本地服务无法连接。');
  const data = await response.json(); token = data.token; state = data;
  buildControls(); buildInspector(); bindControls();
  advanced = attachAdvanced({ getState: () => state, command, preview, send, toast, getSelected: () => selected, isLive: () => live, isReady: () => ready, setDevice, getDevice: () => device, getCapabilities: () => connectorCapabilities });
  workflow = attachWorkflow({ getState: () => state, getToken: () => token, getScope: () => scope, command, send, toast, isReady: () => ready, stopPicking: () => setPicking(false), download });
  attachSetup(() => ({ ready, live, capabilities: connectorCapabilities, fixture: $('#fixture-status').textContent }));
  const runtimeManager = attachRuntimeManager({ getToken: () => token, settled: () => commandQueue });
  source = attachSource({ getState: () => state, getToken: () => token, toast });
  layers = attachLayers({ getState: () => state, command, preview, toast, send, getScope: () => scope, setScope });
  themeAnalysis = attachThemeAnalysis({ openLayer: id => layers.open(id), openAssets: item => workflow.openAssets(item), getState: () => state, getToken: () => token, command, send, toast, connection: () => ({ ready, live, capabilities: connectorCapabilities }) });
  workImport = attachWorkImport({ getState: () => state, command, send, toast, connection: () => ({ ready, live, capabilities: connectorCapabilities }), settled: () => commandQueue });
  layouts = attachLayouts({ getState: () => state, command, toast, getSelected: () => selected, getScope: () => scope, setScope });
  coDesign = attachCoDesign({ getState: () => state, connection: () => ({ ready, live, fixtureActive: fixtureSupported && fixtureState?.active && !fixtureBusy && !awaitingFirstPreview }), selectTarget: setSelected, stopPicking: () => setPicking(false), toast });
  canvasEditor = attachCanvas({ getState: () => state, getScope: () => scope, connection: () => ({ ready, live, capabilities: connectorCapabilities, comparing: $('#compare').checked, fixtureActive: fixtureState?.active && !fixtureBusy && !awaitingFirstPreview }), command, settled: () => commandQueue, send, preview, preparePreview: () => { $('#compare').checked = false; $('#canvas').classList.remove('comparing'); preview(); renderFields(); }, stopPicking: () => setPicking(false), toast });
  artworks = attachArtworks({ getState: () => state, getToken: () => token, settled: () => commandQueue, toast, command, newWork: () => workImport.open().catch(e => toast(e.message, true)) });
  attachNavigation();
  objects = attachObjects({ getContext: () => ({ project:state.project, scope, selected, inspection }), select:setSelected, send, openLayer:id => layers.open(id).catch(e => toast(e.message,true)) });
  render(); connect();
  $('#artworks-button').click();
  const events = new EventSource('/api/events'); events.onmessage = e => receiveState(JSON.parse(e.data)); events.onerror = () => { $('#save-status').textContent = '本地连接中断'; }; events.onopen = () => { refreshSession().catch(e => toast(e.message, true)); };
  events.addEventListener('runtime-closing', () => {
    runtimeClosing = true; send('disconnect'); ready = false;
    clearInterval(helloTimer); clearInterval(heartbeat); events.close();
    $('#save-status').textContent = '后台正在关闭'; runtimeManager.stopping();
  });
  window.addEventListener('pagehide', () => { events.close(); clearInterval(helloTimer); clearInterval(heartbeat); }, { once: true });
  workflow.events(events);
  source.events(events);
  layers.events(events);
  artworks.events(events);
} catch (e) { $('#save-status').textContent = '启动失败'; toast(e.message, true); }
