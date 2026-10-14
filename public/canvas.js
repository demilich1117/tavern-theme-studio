import { sameCanvasBasis, canvasAvailability, createCanvasRound, recordCanvasRound, canvasRestorePlan } from '/shared/canvas.js';
import { publicReceipt, formatAgentHandoff } from '/shared/handoff.js';
import { copyClipboard } from '/clipboard.js';
import { showEditor } from '/panels.js';

const $ = selector => document.querySelector(selector);
const downloadBlob = (blob, filename) => { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
export function attachCanvas({ getState, getScope, connection, command, settled, send, preview, preparePreview, stopPicking, toast }) {
  let active = false, pending = false, lastProject, lastScope, screenshot, receipts = [], context, selected = new Set(), rendered, imageUrl, operation = 0;
  let status = '点击部件选择，再用手柄调整；与属性面板共用保存和撤销。';
  let round, roundKey, starting = false, startTimer, startError = '';
  const toggle = $('#canvas-mode'), dialog = $('#canvas-share-dialog'), hint = $('#canvas-mode-hint');
  const restore = $('#canvas-restore'), roundHint = $('#canvas-round-hint');
  function persistRound() { try { if (roundKey) sessionStorage.setItem(roundKey, JSON.stringify(round)); } catch {} }
  function finishStarting() { starting = false; clearTimeout(startTimer); }
  const run = action => async event => { try { await action(event); } catch (error) { toast(error.message, true); $('#canvas-share-status').textContent = error.message; } };
  async function read(url) { const res = await fetch(url), value = await res.json(); if (!res.ok) throw new Error(value.error); return value; }
  function render() {
    const s = getState(), c = connection();
    const key = `tts-canvas-round:${s.projectId}:${s.sessionId}`;
    if (roundKey !== key) {
      if (roundKey) { send('canvas-stop'); active = false; finishStarting(); startError = ''; }
      roundKey = key; round = undefined;
      try { const saved = JSON.parse(sessionStorage.getItem(key)); if (saved?.version === 1 && saved.projectId === s.projectId && saved.sessionId === s.sessionId && Array.isArray(saved.entries) && saved.entries.length <= 2048) { canvasRestorePlan(saved, s); round = saved; } } catch {}
    }
    if (lastProject && lastProject !== s.projectId) { send('canvas-stop'); active = false; finishStarting(); clearScreenshot(); if (dialog.open) dialog.close(); }
    lastProject = s.projectId;
    if (lastScope !== getScope()) { lastScope = getScope(); send('canvas-configure', { scope: lastScope }); }
    const availability = canvasAvailability(c);
    if (!c.ready) active = false;
    toggle.disabled = availability.disabled && !starting;
    toggle.title = availability.reason;
    toggle.setAttribute('aria-pressed', String(active)); toggle.classList.toggle('active', active); toggle.textContent = starting ? '取消准备' : active ? '退出画布' : '进入画布';
    $('#co-design-canvas').disabled = starting;
    hint.hidden = !starting && !active && !availability.reason && !startError;
    hint.textContent = starting ? '正在准备虚构测试对话，完成后自动进入画布…' : startError || availability.reason || status;
    const plan = canvasRestorePlan(round, s), canRestore = !!plan.changes.length && !pending && !starting;
    restore.disabled = !canRestore;
    $('#canvas-round-controls').hidden = !round;
    roundHint.textContent = plan.changes.length ? `本轮 ${plan.changes.length} 项位置 / 尺寸调整，可一次还原。` : '本轮没有待还原的拖动调整。';
    if (plan.conflicts.length) roundHint.textContent += ` ${plan.conflicts.length} 项后续修改将保留。`;
    send('canvas-round-state', { canRestore });
    if (screenshot && !sameCanvasBasis(screenshot.basis, s)) $('#canvas-share-status').textContent = '工程已有新修改。这里保留的是截图时的版本；需要当前效果请重新截取。';
  }
  async function start() {
    showEditor(); const c = connection();
    if (active || starting) return;
    const availability = canvasAvailability(c);
    if (availability.disabled) throw new Error(availability.reason);
    startError = ''; starting = true; render();
    try {
      await settled();
      if (!starting) return;
      preparePreview(); stopPicking(); send('canvas-start', { scope: getScope() });
      startTimer = setTimeout(() => { if (starting) { finishStarting(); startError = '准备测试对话超时，请检查酒馆加载状态后重试。'; send('canvas-stop'); render(); toast(startError, true); } }, 45000);
    } catch (error) { finishStarting(); render(); throw error; }
  }
  toggle.addEventListener('click', run(() => { if (active || starting) { finishStarting(); send('canvas-stop'); render(); } else return start(); }));
  $('#co-design-canvas').addEventListener('click', run(start));
  async function restoreRound() {
    if (pending || starting) return;
    send('canvas-cancel-gesture'); await settled();
    const s = getState(), plan = canvasRestorePlan(round, s);
    if (!plan.changes.length) { render(); toast('当前没有可还原的本轮拖动调整。'); return; }
    pending = true; render();
    try {
      await command({ type: 'canvas-restore', changes: plan.changes }, s);
      status = `已还原本轮 ${plan.changes.length} 项调整；点「撤销」可返回还原前。${plan.conflicts.length ? ` ${plan.conflicts.length} 项后续修改已保留。` : ''}`;
      send('canvas-restored', { message: status }); toast(status);
    } finally { pending = false; render(); }
  }
  restore.addEventListener('click', run(restoreRound));
  $('#canvas-share').addEventListener('click', () => { dialog.showModal(); $('#canvas-share-status').textContent = screenshot ? '可选择需要随截图交接的小票。' : '在酒馆画布点「截取此标签」，或在这里粘贴 / 选择系统截图。截图仅保存在当前页面，离开前请下载。'; });
  function clearScreenshot() { operation++; screenshot = rendered = context = undefined; receipts = []; selected.clear(); if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = undefined; $('#canvas-share-preview').removeAttribute('src'); $('#canvas-share-preview').hidden = true; $('#canvas-share-tickets').replaceChildren(); enable(false); }
  function enable(value) { for (const id of ['canvas-copy-image', 'canvas-copy-receipt', 'canvas-download-image', 'canvas-download-receipt']) $('#'+id).disabled = !value; }
  const chosen = () => receipts.filter(t => selected.has(t.id));
  function receiptText() {
    const tickets = chosen(), prefix = `画布截图交接 · ${screenshot.name}\n截图基线：${screenshot.basis.projectId} / revision ${screenshot.basis.revision}\n截图来源：${screenshot.source}\n截图是讨论证据，不代表全部尺寸和状态已验收。\n摆放提案的 before/after 是该视口中的矩形，尚未写入 CSS。请核对工程与真实布局后落实。\n`;
    return prefix + (tickets.length ? '\n' + formatAgentHandoff(tickets, context) : '\n本次未附修改小票，请结合对话说明处理。');
  }
  function wrap(ctx, text, width) {
    const lines = []; let line = '';
    for (const c of text) { if (c === '\n' || ctx.measureText(line + c).width > width) { lines.push(line); line = c === '\n' ? '' : c; } else line += c; }
    if (line) lines.push(line); return lines;
  }
  async function compose() {
    const version = ++operation, saved = screenshot; if (!saved) return; enable(false);
    const image = await createImageBitmap(saved.blob);
    try {
      const canvas = document.createElement('canvas'), width = Math.min(1600, Math.max(640, image.width)), imageHeight = Math.round(image.height * width / image.width), ctx = canvas.getContext('2d');
      ctx.font = '16px "Microsoft YaHei", sans-serif';
      const lines = [saved.name + ' · 画布交接', `工程 ${saved.basis.projectId} · revision ${saved.basis.revision}`, ...chosen().flatMap(t => wrap(ctx, `#${t.number} ${t.canvas ? '[摆放提案] ' : ''}${t.comment}`, width - 48))];
      const budget = Math.max(4, Math.floor((8192 - imageHeight - 48) / 26)), visible = lines.slice(0, budget);
      if (lines.length > budget) visible[visible.length - 1] = '更多意见见随附的小票 JSON / 交接文本。';
      canvas.width = width; canvas.height = imageHeight + visible.length * 26 + 48;
      ctx.fillStyle = '#17191d'; ctx.fillRect(0, 0, width, canvas.height); ctx.drawImage(image, 0, 0, width, imageHeight); ctx.fillStyle = '#e7e8ea'; ctx.font = '16px "Microsoft YaHei", sans-serif'; visible.forEach((line, i) => ctx.fillText(line, 24, imageHeight + 32 + i * 26));
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (version !== operation || screenshot !== saved) return;
      if (!blob) throw new Error('无法生成交接图片。'); rendered = blob;
      if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = URL.createObjectURL(blob); $('#canvas-share-preview').src = imageUrl; $('#canvas-share-preview').hidden = false; enable(true);
    } finally { image.close(); }
  }
  async function accept(blob, basis, source) {
    if (!(blob instanceof Blob) || !blob.type.startsWith('image/') || blob.size > 32 * 1024 * 1024) throw new Error('请选择不超过 32 MiB 的图片。');
    const s = getState(), id = ++operation; enable(false);
    const bitmap = await createImageBitmap(blob); const valid = bitmap.width <= 10000 && bitmap.height <= 10000 && bitmap.width * bitmap.height <= 20000000 && bitmap.height / bitmap.width <= 4; bitmap.close();
    if (!valid) throw new Error('请截取当前可见画面，图片过大或过长。');
    const [tickets, currentContext] = await Promise.all([read('/api/tickets'), read('/api/handoff-context')]);
    if (id !== operation || s.projectId !== getState().projectId || basis.projectId !== s.projectId) return;
    const baseline = Object.fromEntries(['projectId', 'sessionId', 'revision', 'fingerprint', 'name'].filter(k => basis[k] !== undefined).map(k => [k, basis[k]])); baseline.name ||= s.project.name;
    screenshot = { blob, basis: baseline, name: s.project.name, source }; context = { ...currentContext, current: baseline };
    receipts = tickets.filter(t => t.basis.projectId === basis.projectId && t.state !== 'done'); selected = new Set(receipts.map(t => t.id));
    const list = $('#canvas-share-tickets'); list.replaceChildren();
    for (const ticket of receipts) { const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = true; input.addEventListener('change', run(() => { if (input.checked) selected.add(ticket.id); else selected.delete(ticket.id); return compose(); })); label.append(input, document.createTextNode(`#${ticket.number} ${ticket.comment.slice(0, 100)}`)); list.append(label); }
    if (!dialog.open) dialog.showModal(); $('#canvas-share-status').textContent = `已读取 ${receipts.length} 张当前工程的未完成小票，可取消不相关项。检查截图是否为目标酒馆标签。`;
    await compose(); render();
  }
  $('#canvas-image-input').addEventListener('change', run(async event => { const file = event.target.files[0]; try { if (file) { await settled(); await accept(file, getState(), '用户选择的系统截图（请核对时间与工程）'); } } finally { event.target.value = ''; } }));
  dialog.addEventListener('paste', run(async event => { const file = [...(event.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))?.getAsFile(); if (file) { event.preventDefault(); await settled(); await accept(file, getState(), '用户粘贴的系统截图（请核对时间与工程）'); } }));
  $('#canvas-copy-image').addEventListener('click', run(async () => { if (!rendered) return; try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': rendered })]); toast('含小票摘要的截图已复制，可粘贴给 Agent。'); } catch { toast('浏览器未允许复制图片，请用「下载截图」附给 Agent。', true); } }));
  $('#canvas-copy-receipt').addEventListener('click', run(() => copyClipboard(receiptText(), toast)));
  $('#canvas-download-image').addEventListener('click', () => { if (rendered) downloadBlob(rendered, 'tavern-canvas.png'); });
  $('#canvas-download-receipt').addEventListener('click', () => { if (screenshot) downloadBlob(new Blob([JSON.stringify({ schemaVersion: 1, kind: 'tavern-canvas-handoff', image: 'tavern-canvas.png', basis: screenshot.basis, source: screenshot.source, tickets: chosen().map(publicReceipt), handoff: receiptText() }, null, 2)], { type: 'application/json' }), 'tavern-canvas.tickets.json'); });
  $('#canvas-download-css').addEventListener('click', run(async () => { await settled(); const result = await read('/api/export?mode=standard'); downloadBlob(new Blob([result.theme.custom_css], { type: 'text/css;charset=utf-8' }), 'tavern-theme.css'); toast('已下载当前主题 CSS；原生外观设置请用「应用 / 导出」保存主题 JSON。'); }));
  return { render, receive(data) {
    if (data.type === 'canvas-status') {
      active = data.active;
      if (active && starting) { finishStarting(); round = createCanvasRound(getState()); persistRound(); }
      if (data.message) status = data.message; render();
    }
    else if (data.type === 'canvas-start-result' && !data.ok) { finishStarting(); active = false; startError = data.error; render(); toast(data.error, true); }
    else if (data.type === 'canvas-restore-request') restoreRound().catch(error => toast(error.message, true));
    else if (data.type === 'canvas-commit') {
      if (pending || !sameCanvasBasis(data.basis, getState())) { send('canvas-commit-result', { ok: false, error: '工程更新，此次拖动未保存。' }); preview(); return; }
      const change = { type: 'canvas-set', target: data.target, scope: data.scope, props: data.props }, savedRound = round;
      pending = true; render(); command(change, data.basis).then(state => { if (round === savedRound) { recordCanvasRound(round, state, change); persistRound(); } send('canvas-commit-result', { ok: true }); }).catch(error => send('canvas-commit-result', { ok: false, error: error.message })).finally(() => { pending = false; render(); });
    } else if (data.type === 'canvas-history') { if (!pending && ['undo','redo'].includes(data.action)) command({ type: data.action }).catch(() => {}); }
    else if (data.type === 'canvas-capture') accept(data.blob, data.basis, '浏览器选择的标签截图').catch(error => toast(error.message, true));
    else if (data.type === 'disconnected') { active = false; finishStarting(); render(); }
  } };
}
