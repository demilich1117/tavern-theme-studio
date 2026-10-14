import { TARGETS, applyCommand } from '../shared/core.js';
import { CANVAS_TARGETS, canvasPatch, sameCanvasBasis } from '../shared/canvas.js';
import { matchesWidth } from '../shared/editing.js';
import { targetElement } from './diagnostics.js';
import { captureAnchor } from './annotations.js';

const rectOf = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
const node = (tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; return el; };

export function createCanvasEditor({ getProject, getBasis, getSelection, select, renderPreview, send, fixtureActive, isDemo, onActive }) {
  let active = false, scope = 'base', mode = 'layout', gesture, proposal, frame, disposed = false, saving = false, capturing = false;
  const host = node('div'); host.id = 'tts-canvas-editor'; host.dataset.ttsUi = '';
  // Keep handles under the workbench dock, especially its mobile bottom sheet.
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483639!important;pointer-events:none!important;';
  const shadow = host.attachShadow({ mode: 'open' }), style = node('style');
  style.textContent = `:host([hidden]){display:none!important}*{box-sizing:border-box}[hidden]{display:none!important}button,select,label{font:13px/1.4 "Segoe UI","Microsoft YaHei",sans-serif}button,select{min-height:40px;border:1px solid #ffffff30;border-radius:6px;background:#25282e;color:#e7e8ea;padding:6px 10px;pointer-events:auto}button{cursor:pointer}button:hover{background:#343840}button:disabled{opacity:.45;cursor:default}button:focus-visible,select:focus-visible{outline:2px solid #e6aa64;outline-offset:2px}.bar{position:fixed;left:8px;top:8px;max-width:calc(100vw - 16px);display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:4px;background:#17191df5;border:1px solid #ffffff24;border-radius:8px;pointer-events:auto;color:#e7e8ea}.bar label{display:flex;align-items:center;gap:4px;padding:4px}.status{flex-basis:100%;font:12px/1.5 "Segoe UI",sans-serif;color:#bac0c9;padding:0 6px 4px;max-width:660px}.box,.origin{position:fixed;border:2px solid #e6aa64;pointer-events:none}.box.intent{background:#e6aa641a;border-style:dashed}.origin{border:1px dashed #aaa7}.handle{position:fixed;touch-action:none;background:#e6aa64;color:#241c12;font-weight:600;min-width:40px;min-height:40px}.move{cursor:move}.resize{cursor:nwse-resize}.title{position:absolute;bottom:100%;left:0;max-width:280px;background:#17191df5;color:#e6aa64;font:12px/1.5 "Segoe UI",sans-serif;padding:4px 8px;white-space:nowrap}`;
  const bar = node('div'); bar.className = 'bar';
  const choice = node('select'); choice.setAttribute('aria-label', '画布操作方式'); choice.add(new Option('实际布局 · 保存到主题', 'layout')); choice.add(new Option('摆放提案 · 交给 Agent', 'intent'));
  const snapLabel = node('label'), snap = node('input'); snap.type = 'checkbox'; snap.checked = true; snapLabel.append(snap, '8px 吸附');
  const comment = node('button', '评论此部件'), capture = node('button', '截取此标签'), restore = node('button', '还原本轮'), exit = node('button', '退出画布'), status = node('div'); status.className = 'status'; status.setAttribute('role', 'status');
  let canRestore = false;
  restore.disabled = true; restore.title = '还原本轮拖动与缩放；可用撤销返回。';
  bar.append(choice, snapLabel, restore, comment, capture, exit, status);
  const origin = node('div'); origin.className = 'origin';
  const box = node('div'); box.className = 'box'; const title = node('span'); title.className = 'title'; box.append(title);
  const move = node('button', '✥'); move.className = 'handle move'; move.setAttribute('aria-label', '移动选中部件，方向键微调');
  const resize = node('button', '↘'); resize.className = 'handle resize'; resize.setAttribute('aria-label', '调整选中部件尺寸，方向键微调');
  shadow.append(style, origin, box, move, resize, bar); document.body.append(host); host.hidden = true;
  function notify(message) { status.textContent = message; send('canvas-status', { active, mode, message }); }
  function selection() {
    const selected = getSelection(), target = TARGETS.find(t => t.id === selected.id);
    const found = target && targetElement(target, selected.element);
    let el = found?.element;
    const onscreen = element => {
      if (!element.checkVisibility()) return false;
      const r = element.getBoundingClientRect(); let left = Math.max(0, r.left), top = Math.max(0, r.top), right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const c = getComputedStyle(parent), clip = parent.getBoundingClientRect();
        if (c.overflowX !== 'visible') { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
        if (c.overflowY !== 'visible') { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
      }
      return right > left && bottom > top;
    };
    if (el && !onscreen(el)) el = found.matches.find(onscreen);
    if (target?.id === 'avatar') el = el?.closest('.avatar');
    if (!el || !el.isConnected || !el.checkVisibility() || el.closest('[data-tts-ui]')) throw new Error('先点击酒馆部件，或用原有拾取与对象列表选择。');
    const r = rectOf(el); if (r.width < 1 || r.height < 1) throw new Error('部件当前不可见，请先展开。');
    return { target, el, rect: r };
  }
  function canLayout(target, el) {
    if (!CANVAS_TARGETS.includes(target.id) || target.pseudo) throw new Error('此部件可标点评论；自由移动请切换「摆放提案」。');
    const p = getProject(), bp = p.breakpoints.find(b => b.id === scope);
    if (scope !== 'base' && (!bp || !matchesWidth(bp.condition, innerWidth))) throw new Error('当前酒馆宽度未命中所选尺寸，请调整窗口或切换编辑范围。');
    const later = scope === 'base' ? p.breakpoints : p.breakpoints.slice(p.breakpoints.findIndex(b => b.id === scope) + 1);
    if (later.some(b => matchesWidth(b.condition, innerWidth) && ['width','margin-left','margin-top','min-height'].some(k => p.rules[b.id]?.[target.id]?.[k] !== undefined))) throw new Error('当前画面有后续尺寸覆盖，请切换到生效的编辑范围。');
    for (let parent = el; parent; parent = parent.parentElement) {
      const c = getComputedStyle(parent), m = new DOMMatrix(c.transform === 'none' ? undefined : c.transform);
      if (!m.is2D || Math.abs(m.b) > .001 || Math.abs(m.c) > .001 || m.a <= 0 || m.d <= 0 || (c.rotate && c.rotate !== 'none' && parseFloat(c.rotate) !== 0) || (c.scale !== 'none' && c.scale.split(/\s+/).some(v => parseFloat(v) <= 0))) throw new Error('此处有旋转或透视，请用摆放提案表达位置。');
    }
  }
  function position(el, r) { Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }); }
  function draw() {
    frame = 0; if (!active || disposed) return;
    restore.textContent = mode === 'intent' ? '清除提案' : '还原本轮';
    restore.disabled = saving || (mode === 'intent' ? !proposal : !canRestore);
    try {
      const s = selection(), r = proposal?.after || s.rect;
      position(box, r); box.hidden = false; title.textContent = `${s.target.name}${mode === 'intent' ? ' · 布局意图' : ' · 同类部件'}`; box.classList.toggle('intent', mode === 'intent');
      origin.hidden = !proposal; if (proposal) position(origin, proposal.before);
      for (const [el, x, y] of [[move, r.left - 20, r.top - 20], [resize, r.left + r.width - 20, r.top + r.height - 20]]) { el.hidden = false; el.style.left = `${Math.max(0, Math.min(innerWidth - 40, x))}px`; el.style.top = `${Math.max(bar.getBoundingClientRect().bottom + 4, Math.min(innerHeight - 40, y))}px`; }
      comment.disabled = saving; capture.disabled = saving || capturing; move.disabled = resize.disabled = saving;
    } catch (error) { box.hidden = origin.hidden = move.hidden = resize.hidden = true; comment.disabled = true; status.textContent = error.message; }
  }
  function refresh() { if (active && !isDemo && !fixtureActive()) { stop(); return; } if (!frame && active) frame = requestAnimationFrame(draw); }
  function cancel(message) {
    if (gesture?.mode === 'layout') renderPreview(getProject());
    else if (gesture) proposal = gesture.previous;
    gesture = undefined; if (message) notify(message); refresh();
  }
  function resetProposal() { proposal = undefined; }
  function start(data) {
    if (!isDemo && !fixtureActive()) throw new Error('先打开专用虚构测试对话，再进入画布。');
    cancel(); active = true; scope = data.scope || 'base'; host.hidden = false; onActive(true); notify('点击选择 · 拖动 ✥ 移动 · 拖动 ↘ 调尺寸 · Esc 退出 · Ctrl+Z 撤销'); draw();
  }
  function stop() { cancel(); resetProposal(); active = false; saving = false; host.hidden = true; onActive(false); send('canvas-status', { active: false, mode }); }
  function configure(data) { if (scope !== data.scope) { cancel(); resetProposal(); scope = data.scope || 'base'; } refresh(); }
  function begin(kind) {
    if (!active || saving || capturing) return false;
    const s = selection(); if (mode === 'layout') canLayout(s.target, s.el);
    const css = getComputedStyle(s.el), parent = s.el.parentElement;
    const parentCss = getComputedStyle(parent), parentWidth = parent.clientWidth - parseFloat(parentCss.paddingLeft) - parseFloat(parentCss.paddingRight);
    const horizontal = css.boxSizing === 'border-box' ? 0 : parseFloat(css.paddingLeft) + parseFloat(css.paddingRight) + parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth);
    const vertical = css.boxSizing === 'border-box' ? 0 : parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
    gesture = { kind, mode, basis: structuredClone(getBasis()), project: structuredClone(getProject()), selection: s, scope,
      initial: { scaleX: s.rect.width / s.el.offsetWidth, scaleY: s.rect.height / s.el.offsetHeight, parentWidth, width: s.el.offsetWidth - horizontal, height: s.el.offsetHeight - vertical, marginLeft: parseFloat(css.marginLeft) || 0, marginTop: parseFloat(css.marginTop) || 0, pixelWidth: s.target.id === 'avatar' },
      rect: { ...(proposal?.after || s.rect) }, previous: proposal && structuredClone(proposal), changed: false };
    return true;
  }
  function change(dx, dy, free = false) {
    if (!gesture) return;
    if (!sameCanvasBasis(gesture.basis, getBasis()) || !gesture.selection.el.isConnected) { cancel('工程或目标变化，此次操作已取消。'); resetProposal(); return; }
    gesture.changed = Math.abs(dx) + Math.abs(dy) > 0;
    if (!gesture.changed) { if (gesture.mode === 'layout') renderPreview(gesture.project); else proposal = gesture.previous; draw(); return; }
    if (gesture.mode === 'layout') {
      gesture.props = canvasPatch(gesture.initial, gesture.kind, dx, dy, snap.checked && !free);
      renderPreview(applyCommand(gesture.project, { type: 'canvas-set', target: gesture.selection.target.id, scope: gesture.scope, props: gesture.props }));
    } else {
      const step = snap.checked && !free ? 8 : 1, r = { ...gesture.rect }, round = n => Math.round(n / step) * step;
      if (gesture.kind === 'move') { r.left += round(dx); r.top += round(dy); }
      else { r.width = Math.max(24, r.width + round(dx)); r.height = Math.max(24, r.height + round(dy)); }
      proposal = { kind: 'layout-intent', before: gesture.previous?.before || gesture.selection.rect, after: r };
    }
    draw();
  }
  function finish() {
    if (!gesture) return;
    const saved = gesture; gesture = undefined;
    if (!sameCanvasBasis(saved.basis, getBasis())) { renderPreview(getProject()); resetProposal(); notify('工程已更新，请重新拖动。'); return; }
    if (saved.mode === 'layout' && saved.changed) { saving = true; send('canvas-commit', { basis: saved.basis, target: saved.selection.target.id, scope: saved.scope, props: saved.props }); notify('正在保存布局…'); }
    else if (saved.mode === 'layout') renderPreview(getProject());
    else if (saved.changed) notify('虚线框是期望位置；点击「评论此部件」保存提案，尚未写入主题。');
    refresh();
  }
  for (const [el, kind] of [[move, 'move'], [resize, 'resize']]) {
    el.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      try { if (!begin(kind)) return; gesture.pointer = event.pointerId; gesture.x = event.clientX; gesture.y = event.clientY; el.setPointerCapture(event.pointerId); event.preventDefault(); el.focus(); } catch (error) { notify(error.message); }
    });
    el.addEventListener('pointermove', event => { if (gesture?.pointer === event.pointerId) { try { change(event.clientX - gesture.x, event.clientY - gesture.y, event.altKey); } catch (error) { cancel(error.message); } } });
    el.addEventListener('pointerup', event => { if (gesture?.pointer === event.pointerId) finish(); });
    el.addEventListener('pointercancel', () => { const previous = gesture?.previous; cancel('操作已取消。'); proposal = previous; });
    el.addEventListener('lostpointercapture', () => { if (gesture) cancel('操作已取消。'); });
    el.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); const amount = event.shiftKey ? 10 : 1;
      try { if (begin(kind)) { change(event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0, event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0, true); finish(); } } catch (error) { cancel(error.message); }
    });
  }
  choice.addEventListener('change', () => { cancel(); resetProposal(); mode = choice.value; notify(mode === 'layout' ? '调整会作用于同类部件；右侧面板可输入精确值。' : '拖动虚线框表达期望布局，再评论保存；不会写入主题 CSS。'); draw(); });
  comment.addEventListener('click', () => {
    try { const s = selection(); const anchor = captureAnchor(s.target, s.el, { clientX: s.rect.left + s.rect.width / 2, clientY: s.rect.top + s.rect.height / 2 }, fixtureActive()); send('annotation', { anchor, canvas: proposal, basis: getBasis() }); onActive(false); } catch (error) { notify(error.message); }
  });
  exit.addEventListener('click', stop);
  restore.addEventListener('click', () => { cancel(); if (mode === 'intent') { resetProposal(); notify('临时提案已清除，已保存的小票保留。'); refresh(); } else send('canvas-restore-request'); });
  // Native tab capture preserves the browser's actual pixels. No DOM rasterizer
  // silently drops masks, filters, pseudo elements or cross-origin artwork.
  capture.addEventListener('click', async () => {
    let stream, video;
    try {
      if (saving || gesture) throw new Error('请先完成并保存本次调整。');
      if (!isDemo && !fixtureActive()) throw new Error('截图仅用于当前虚构测试对话。');
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('此浏览器不支持标签截图，请使用系统截图，再到工作台「截图交接」粘贴。');
      capturing = true; const basis = structuredClone(getBasis());
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' });
      if (stream.getVideoTracks()[0].getSettings().displaySurface !== 'browser') throw new Error('请只选择当前酒馆标签，避免把其他窗口带入截图。');
      video = node('video'); video.muted = true; video.srcObject = stream; await video.play();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!sameCanvasBasis(basis, getBasis()) || (!isDemo && !fixtureActive())) throw new Error('截图期间工程或测试对话变化，请重试。');
      const image = document.createElement('canvas'), scale = Math.min(1, 2400 / video.videoWidth); image.width = Math.round(video.videoWidth * scale); image.height = Math.round(video.videoHeight * scale);
      image.getContext('2d').drawImage(video, 0, 0, image.width, image.height);
      const blob = await new Promise(resolve => image.toBlob(resolve, 'image/png')); if (!blob) throw new Error('截图未生成。');
      send('canvas-capture', { blob, basis, viewport: { width: innerWidth, height: innerHeight } }); onActive(false); notify('截图已交给工作台，请预览后复制或下载。');
    } catch (error) { notify(error.name === 'NotAllowedError' ? '已取消截图。也可使用系统截图后粘贴到工作台。' : error.message); }
    finally { stream?.getTracks().forEach(track => track.stop()); if (video) video.srcObject = null; capturing = false; refresh(); }
  });
  function key(event) {
    if (!active) return;
    if (event.key === 'Escape') { event.preventDefault(); if (gesture) cancel('操作已取消。'); else stop(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.target.matches('input,textarea,[contenteditable]')) { event.preventDefault(); cancel(); resetProposal(); send('canvas-history', { action: event.shiftKey ? 'redo' : 'undo' }); }
  }
  document.addEventListener('keydown', key, true); document.addEventListener('scroll', refresh, true); window.addEventListener('resize', refresh);
  return {
    start, stop, configure, refresh, active: () => active,
    roundState(data) { canRestore = data.canRestore === true; refresh(); },
    cancelGesture() { cancel(); resetProposal(); refresh(); },
    restored(data) { cancel(); resetProposal(); renderPreview(getProject()); notify(data.message); refresh(); },
    select(hit) { if (!active || saving) return; cancel(); resetProposal(); select(hit); refresh(); },
    update() { if (!isDemo && !fixtureActive()) { if (active) stop(); return; } if (gesture && !sameCanvasBasis(gesture.basis, getBasis())) cancel('工程已更新，此次操作已取消。'); if (proposal) resetProposal(); refresh(); },
    selected() { cancel(); resetProposal(); refresh(); },
    proposalSaved() { resetProposal(); notify('提案小票已保存；同一视口和工程下显示编号虚线框。'); refresh(); },
    result(data) { saving = false; renderPreview(getProject()); notify(data.ok ? '布局已保存；可继续拖动、在属性面板微调，或撤销。' : data.error || '保存失败，已恢复。'); refresh(); },
    dispose() { stop(); disposed = true; cancelAnimationFrame(frame); document.removeEventListener('keydown', key, true); document.removeEventListener('scroll', refresh, true); window.removeEventListener('resize', refresh); host.remove(); },
  };
}
