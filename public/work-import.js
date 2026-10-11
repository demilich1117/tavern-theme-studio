import { showEditor } from '/panels.js';

export function attachWorkImport({ getState, command, send, toast, connection, settled }) {
  let theme, basis, requestId, timer, reading = false, saving = false, blank = false;
  const dialog = document.createElement('dialog'); dialog.id = 'work-import-dialog';
  dialog.innerHTML = `<form method="dialog" class="dialog-header"><h2>新建作品</h2><button aria-label="关闭新建作品">×</button></form><div class="dialog-body">
    <p class="panel-hint">从空白开始，或接入已有美化。新作品独立保存，当前作品会保留。</p>
    <div class="work-import-options"><button id="work-blank" class="file-action"><b>从空白开始</b><span>使用基础外观，自动准备源码与实时同步。</span></button><button id="work-read-host" class="file-action"><b>接入酒馆当前主题</b><span>读取酒馆中保存的主题，作为独立作品继续调整。</span></button>
    <label class="file-action"><b>导入主题文件</b><span>选择酒馆原生主题 JSON。</span><input id="work-import-file" type="file" accept=".json,application/json"></label></div>
    <p id="work-connection-hint" class="panel-hint"></p><p id="work-import-status" role="status" aria-live="polite"></p>
    <form id="work-create-form" class="artwork-form" hidden><label for="work-create-name">作品名称</label><input id="work-create-name" required maxlength="120">
    <p class="panel-hint">新作品的工程、素材和定稿独立保存。同名主题也会创建新作品；已有作品请从作品页打开。</p><button type="submit" class="primary">创建作品并开始编辑</button></form></div>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const sameBasis = () => basis && ['projectId', 'sessionId', 'fingerprint', 'revision'].every(key => basis[key] === getState()[key]);
  function status(text, error = false) { $('#work-import-status').textContent = text; $('#work-import-status').classList.toggle('workflow-error', error); }
  function endRequest() { clearTimeout(timer); requestId = undefined; reading = false; }
  function render() {
    if (!dialog.open) return;
    const connected = connection(), canRead = connected.ready && connected.live && connected.capabilities?.themeAnalysis === 1;
    $('#work-read-host').disabled = reading || saving || !canRead;
    $('#work-import-file').disabled = reading || saving;
    $('#work-blank').disabled = reading || saving;
    $('#work-create-form button').disabled = reading || saving || !theme || !sameBasis();
    $('#work-create-name').disabled = saving;
    dialog.querySelector('[aria-label]').disabled = saving;
    $('#work-connection-hint').textContent = canRead ? '' : '接入当前主题需要连接真实酒馆；也可以直接导入主题文件。';
    if (theme && !sameBasis() && !saving) status('当前作品已变化，请重新读取主题或选择文件。', true);
  }
  function accept(value) {
    blank = false;
    if (value?.schemaVersion !== undefined || typeof value?.name !== 'string') throw new Error('请选择酒馆主题 JSON。工程备份请使用“备份”中的恢复入口。');
    theme = value; $('#work-create-name').value = value.name; $('#work-create-form').hidden = false;
    status('主题已读取，确认名称后即可开始。'); render(); $('#work-create-name').focus();
  }
  async function open(value) {
    await settled();
    endRequest(); theme = undefined; basis = { ...getState() }; $('#work-create-form').hidden = true; status('');
    if (!dialog.open) dialog.showModal();
    if (value) accept(value); render();
  }
  $('#work-read-host').addEventListener('click', async () => {
    await settled(); basis = { ...getState() }; theme = undefined; $('#work-create-form').hidden = true;
    requestId = crypto.randomUUID(); reading = true; status('正在读取酒馆保存的主题…'); render();
    send('read-theme-for-analysis', { requestId });
    timer = setTimeout(() => { endRequest(); status('读取超时，请检查酒馆连接后重试。', true); render(); }, 10000);
  });
  $('#work-blank').addEventListener('click', async () => {
    await settled(); basis = { ...getState() }; accept({ name: '新主题', custom_css: '' }); blank = true;
    status('填写名称即可开始。源码和自动同步会一起准备好。'); $('#work-create-name').select();
  });
  $('#work-import-file').addEventListener('change', async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      await settled(); basis = { ...getState() };
      if (file.size > 48 * 1024 * 1024) throw new Error('主题文件超过 48 MiB，请先精简素材。');
      accept(JSON.parse(await file.text()));
    } catch (e) { theme = undefined; $('#work-create-form').hidden = true; status(e.message, true); }
    finally { event.target.value = ''; render(); }
  });
  $('#work-create-form').addEventListener('submit', async event => {
    event.preventDefault(); if (saving || !theme || !sameBasis()) return;
    saving = true; status('正在保存当前作品，并创建独立作品…'); render();
    try {
      const name = $('#work-create-name').value.trim();
      const result = await command({ ...(blank ? { type: 'work-create-blank', name } : { type: 'work-create-theme', theme: { ...theme, name } }), scanFingerprint: basis.fingerprint });
      dialog.close(); showEditor(); toast(`已开始编辑“${result.project.name}”。原作品可从“作品”页打开。`);
    } catch (e) { status(e.message, true); }
    finally { saving = false; render(); }
  });
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => { endRequest(); theme = undefined; });
  return { open, render, receive(data) {
    if (data.type === 'theme-for-analysis' && requestId && data.requestId === requestId && dialog.open) {
      endRequest(); try { accept(data.theme); } catch (e) { status(e.message, true); } render();
    }
  } };
}
