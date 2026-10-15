import { TARGETS, applyCommand } from '../shared/core.js';
import { isDrawer } from '../shared/drawer-parts.js';
import { CANVAS_TARGETS, canvasPatch, sameCanvasBasis, canvasHandleCenters, canvasAutoHeight } from '../shared/canvas.js';
import { matchesWidth } from '../shared/editing.js';
import { targetElement } from './diagnostics.js';
import { captureAnchor } from './annotations.js';
import { createBlueprintEditor } from './blueprint-editor.js';
import { messagePart } from '../shared/message-parts.js';
import { createCanvasNavigation } from './canvas-navigation.js';

const rectOf = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
const node = (tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; return el; };

export function createCanvasEditor({ getProject, getBasis, getSelection, select, renderPreview, send, fixtureActive, isDemo, onActive, onCanvasActive = () => {}, toolbarMount }) {
  let active = false, scope = 'base', mode = 'layout', gesture, proposal, frame, disposed = false, saving = false, capturing = false;
  const host = node('div'); host.id = 'tts-canvas-editor'; host.dataset.ttsUi = '';
  // The editor is in a separate pane; old comment pins must not cover tools.
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483645!important;pointer-events:none!important;';
  const shadow = host.attachShadow({ mode: 'open' }), style = node('style');
  style.textContent = `:host([hidden]){display:none!important}*{box-sizing:border-box}[hidden]{display:none!important}button,select,label{font:13px/1.4 "Segoe UI","Microsoft YaHei",sans-serif}button,select{min-height:40px;border:1px solid #ffffff30;border-radius:6px;background:#25282e;color:#e7e8ea;padding:6px 10px;pointer-events:auto}button{cursor:pointer}button:hover{background:#343840}button:disabled{opacity:.45;cursor:default}button:focus-visible,select:focus-visible{outline:2px solid #e6aa64;outline-offset:2px}.bar{position:fixed;left:8px;top:8px;max-width:calc(100vw - 16px);display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:4px;background:#17191df5;border:1px solid #ffffff24;border-radius:8px;pointer-events:auto;color:#e7e8ea}.bar label{display:flex;align-items:center;gap:4px;padding:4px}.status{flex-basis:100%;font:12px/1.5 "Segoe UI",sans-serif;color:#bac0c9;padding:0 6px 4px;max-width:660px}.box,.origin{position:fixed;border:1px solid #e6aa64;pointer-events:none}.box.intent{background:#e6aa641a;border-style:dashed}.origin{border:1px dashed #aaa7}.handle{--handle-fill:#e6aa64;position:fixed;touch-action:none;isolation:isolate;display:grid;place-items:center;width:40px;height:40px;min-width:40px;min-height:40px;padding:0;border:0;border-radius:50%;background:transparent;color:#241c12;font-size:12px;line-height:1;font-weight:600}.handle::before{content:"";position:absolute;inset:11px;z-index:-1;border-radius:50%;background:var(--handle-fill);box-shadow:0 1px 4px #0005;pointer-events:none}.handle:hover,.handle:active{background:transparent}.handle:hover::before{box-shadow:0 0 0 2px #17191d88,0 1px 4px #0005}.handle:focus-visible{outline:0}.handle:focus-visible::before{outline:2px solid #fff;outline-offset:2px}.handle:active::before{box-shadow:0 0 0 2px #17191d,0 1px 4px #0005}.move{cursor:move}.resize{cursor:nwse-resize}.title{position:absolute;bottom:100%;left:0;max-width:280px;background:#17191df5;color:#e6aa64;font:12px/1.5 "Segoe UI",sans-serif;padding:4px 8px;white-space:nowrap}`;
  const bar = node('div'); bar.className = 'bar';
  const context = node('div'); context.className = 'canvas-context'; context.setAttribute('role', 'status');
  const choice = node('select'); choice.setAttribute('aria-label', '画布操作方式'); choice.add(new Option('实际布局', 'layout')); choice.add(new Option('蓝图', 'intent')); choice.title='实际布局自动保存；蓝图暂存方案，最后保存修改小票';
  const snapLabel = node('label'), snap = node('input'); snap.type = 'checkbox'; snap.checked = true; snapLabel.append(snap, '8px 吸附');
  const comment = node('button', '评论此部件'), capture = node('button', '截取此标签'), restore = node('button', '还原本轮'), exit = node('button', '退出画布'), status = node('div'); status.className = 'status'; status.setAttribute('role', 'status');
  let canRestore = false;
  restore.disabled = true; restore.title = '还原本轮拖动与缩放；可用撤销返回。';
  const more = node('details'), moreTitle = node('summary', '吸附、还原、截图与备注'), moreBody = node('div');
  more.className = 'canvas-more'; moreBody.className = 'canvas-more-body';
  moreBody.append(snapLabel, restore, capture, status); more.append(moreTitle, moreBody);
  exit.className='canvas-exit';comment.className='canvas-comment';
  bar.append(choice, comment, exit, context, more);
  const origin = node('div'); origin.className = 'origin';
  const box = node('div'); box.className = 'box'; const title = node('span'); title.className = 'title'; box.append(title);
  // Small canvas markers retain 40px pointer targets and keyboard controls.
  const move = node('button', '✥'); move.className = 'handle move'; move.setAttribute('aria-label', '移动选中部件，方向键微调');
  const resize = node('button', '↘'); resize.className = 'handle resize'; resize.setAttribute('aria-label', '调整选中部件尺寸，方向键微调');
  shadow.append(style, origin, box, move, resize, bar); document.body.append(host); host.hidden = true;
  style.textContent += '.title{left:28px;max-width:calc(100vw - 72px);overflow:hidden;text-overflow:ellipsis}.bar{z-index:100}';
  style.textContent += '.box.intent{border-color:#9acbdf;border-style:solid;background:transparent}.box.intent .title{color:#9acbdf}.handle.blueprint{--handle-fill:#9acbdf;color:#142128}';
  style.textContent += '.resize{font-size:0}.resize::before{inset:15px;border-radius:2px;background:#17191d;border:1px solid var(--handle-fill);box-shadow:0 0 0 1px #17191d88}.resize:hover::before,.resize:active::before{background:var(--handle-fill)}';
  style.textContent += '.canvas-context{flex-basis:100%;padding:0 6px;font:12px/1.5 "Segoe UI",sans-serif;color:#bac0c9}.bp-history{display:flex;gap:4px}.bp-history button{min-height:36px}';
  style.textContent += '.canvas-more{flex-basis:100%;font:12px/1.5 "Segoe UI",sans-serif}.canvas-more summary{cursor:pointer;padding:6px;color:#bac0c9}.canvas-more-body{display:flex;flex-wrap:wrap;gap:4px;align-items:center}.canvas-more summary:focus-visible{outline:2px solid #e6aa64}';
  style.textContent += 'button,select{min-height:32px;padding:4px 8px;border-radius:4px;font-size:12px;border-color:#ffffff18}.box{border-color:#82b6ff}.handle{--handle-fill:#82b6ff}.bar{background:#22252b}.canvas-context{font-size:11px}.bp-history button{min-height:32px}@media(pointer:coarse){button,select{min-height:40px}}';
  // The verified same-origin workspace owns the chrome. Move the existing
  // controls there so history, focus and drafts still have a single owner.
  let toolbarHost, toolbarShadow = shadow;
  if (toolbarMount) {
    toolbarHost = node('div'); toolbarHost.dataset.ttsUi = ''; toolbarMount.append(toolbarHost);
    toolbarShadow = toolbarHost.attachShadow({ mode: 'open' });
    const dockStyle = style.cloneNode(true);
    dockStyle.textContent += '.bar{position:relative;inset:auto;max-width:none;width:100%;border:0;border-bottom:1px solid #ffffff18;border-radius:0;padding:6px 12px;box-shadow:none}.bar>select{min-width:88px;width:88px}.canvas-context{flex:1;min-width:150px;padding:0 2px}.canvas-more{flex-basis:auto;margin-left:auto;order:6}.canvas-more[open]{flex-basis:100%}.canvas-more summary{min-height:28px;display:flex;align-items:center;padding:4px 6px}.canvas-more-body{padding-top:4px}.bp-history{flex-basis:auto}';
    dockStyle.textContent += '.bp-history button{min-height:40px}@media(max-width:600px){.bar:has(.bp-history:not([hidden])) .canvas-context{flex-basis:100%}}';
    dockStyle.textContent += '.bar .nav-tools{flex:0 1 auto}.bar .canvas-more{order:0}.bar .nav-path{order:5}.bar .canvas-more[open]{order:6}';
    dockStyle.textContent += '@media(max-width:600px){.bar{padding:4px 8px;gap:3px}.bar .nav-tools{flex-basis:100%}.bar>.canvas-context{flex-basis:100%;font-size:10px;min-width:0}.bar>.canvas-more{margin-left:auto}.bar>.canvas-more[open]{flex-basis:100%}.bar .nav-path{min-height:20px}.bar .nav-path button{font-size:10px;min-height:20px}.bar>select,.bar>.canvas-comment,.bar>.canvas-exit{min-height:30px;font-size:11px}.bar .canvas-more summary{min-height:30px;padding:3px}.bar .nav-path{order:3}.bar .canvas-context{order:4}.bar .canvas-more{order:0}}';
    dockStyle.textContent += '@media(pointer:coarse){.bar>select,.bar>.canvas-comment,.bar>.canvas-exit,.bar .canvas-more summary{min-height:40px}.bar .nav-path button{min-height:28px}}';
    toolbarShadow.append(dockStyle, bar); toolbarMount.hidden = true;
    moreTitle.textContent = '更多操作';
    title.hidden = true;
  }
  const blueprint = createBlueprintEditor({shadow,toolbarShadow,bar:moreBody,selection,getProject,getBasis,getScope:()=>scope,renderPreview,fixtureActive,send,reveal:()=>onActive(false),notify});
  const navigation = createCanvasNavigation({ shadow, toolbarShadow, toolbarMount, bar, selection, select: hit => { cancel(); resetProposal(); select(hit); refresh(); }, send, isActive:()=>active, refresh, cancel, busy:()=>saving||capturing||!!gesture });
  more.addEventListener('toggle', refresh);
  function notify(message) { status.textContent = message; send('canvas-status', { active, mode, message, ...blueprint.historyState() }); }
  function selection({ allowOffscreen = false } = {}) {
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
    if (el && !onscreen(el) && !allowOffscreen) el = found.matches.find(onscreen);
    if (messagePart(target?.id) === 'avatar') el = el?.closest('.avatar');
    if (!el || !el.isConnected || !el.checkVisibility() || el.closest('[data-tts-ui]')) throw new Error('先点击酒馆部件，或用原有拾取与对象列表选择。');
    const r = rectOf(el); if (r.width < 1 || r.height < 1) throw new Error('部件当前不可见，请先展开。');
    return { target, el, rect: r };
  }
  function canLayout(target, el) {
    if (!CANVAS_TARGETS.includes(target.id) || target.pseudo) throw new Error('此部件暂不支持位置调整，可用标点评论说明。');
    if (isDrawer(target.id) && el.classList.contains('maximized')) throw new Error('先退出抽屉最大化，再调整位置与尺寸。');
    const p = mode === 'intent' ? blueprint.project() : getProject(), bp = p.breakpoints.find(b => b.id === scope);
    if (scope !== 'base' && (!bp || !matchesWidth(bp.condition, innerWidth))) throw new Error('当前酒馆宽度未命中所选尺寸，请调整窗口或切换编辑范围。');
    const later = scope === 'base' ? p.breakpoints : p.breakpoints.slice(p.breakpoints.findIndex(b => b.id === scope) + 1);
    if (later.some(b => matchesWidth(b.condition, innerWidth) && ['width','margin-left','margin-top','min-height','left','top','height'].some(k => p.rules[b.id]?.[target.id]?.[k] !== undefined))) throw new Error('当前画面有后续尺寸覆盖，请切换到生效的编辑范围。');
    for (let parent = el; parent; parent = parent.parentElement) {
      const c = getComputedStyle(parent), m = new DOMMatrix(c.transform === 'none' ? undefined : c.transform);
      if (!m.is2D || Math.abs(m.b) > .001 || Math.abs(m.c) > .001 || m.a <= 0 || m.d <= 0 || (c.rotate && c.rotate !== 'none' && parseFloat(c.rotate) !== 0) || (c.scale !== 'none' && c.scale.split(/\s+/).some(v => parseFloat(v) <= 0))) throw new Error('此处有旋转或透视，请用标点评论说明期望位置。');
    }
  }
  function position(el, r) { Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }); }
  function draw() {
    frame = 0; if (!active || disposed) return;
    navigation.sync();
    restore.textContent = mode === 'intent' ? '清空蓝图' : '还原本轮';
    restore.disabled = saving || (mode === 'intent' ? !blueprint.count() : !canRestore);
    comment.textContent = mode === 'intent' ? '保存整张蓝图' : '评论此部件';
    snapLabel.hidden = false;
    blueprint.activate(mode === 'intent');
    const scopeName = scope === 'base' ? '所有尺寸' : getProject().breakpoints.find(b => b.id === scope)?.name || scope;
    const targetName = TARGETS.find(t => t.id === getSelection().id)?.name || '未选部件';
    const target = TARGETS.find(t => t.id === getSelection().id);
    resize.title = isDrawer(target?.id) ? '拖动调整抽屉宽度与高度；最大高度可在属性中调整' : canvasAutoHeight(target?.id) ? '左右拖动调整宽度，高度随内容自动变化' : '拖动调整宽度和最小高度';
    resize.style.cursor = canvasAutoHeight(target?.id) ? 'ew-resize' : '';
    const count = target ? targetElement(target).matches.length : 0;
    const contextText = `${scopeName} · ${count} 个同类部件${canvasAutoHeight(target?.id) ? ' · 高度自动' : ''} · ${mode === 'intent' ? `蓝图 ${blueprint.count()} 类，待落实` : saving ? '保存中…' : '自动保存'}`;
    if (context.textContent !== contextText) context.textContent = contextText;
    for(const handle of [move,resize])handle.classList.toggle('blueprint',mode==='intent');
    try {
      const s = selection(), r = proposal?.after || s.rect;
      position(box, r); box.hidden = false; title.textContent = `${s.target.name} · 同类一起调整${mode==='intent'?' · 蓝图':''}`; box.classList.toggle('intent', mode === 'intent');
      const toolbarBottom = toolbarHost ? 0 : bar.getBoundingClientRect().bottom + 4;
      const displayScale = toolbarHost && window.frameElement ? window.frameElement.getBoundingClientRect().width / innerWidth : 1;
      const handleScale = 1 / Math.max(.1, displayScale);
      const labelLeft = Math.max(48, Math.min(innerWidth - 200, r.left + 28));
      Object.assign(title.style, { position: 'fixed', bottom: 'auto', left: `${labelLeft}px`, top: `${Math.max(toolbarBottom, Math.min(innerHeight - 28, r.top - 28))}px`, maxWidth: `${Math.max(80, innerWidth - labelLeft - 48)}px` });
      origin.hidden = !proposal; if (proposal) position(origin, proposal.before);
      const centers = canvasHandleCenters(r, { width: innerWidth, height: innerHeight, top: toolbarBottom, size: 40 * handleScale });
      for (const [el, center] of [[move, centers.move], [resize, centers.resize]]) { el.hidden = false; Object.assign(el.style, { left: `${center.x}px`, top: `${center.y}px`, transform: `translate(-50%, -50%) scale(${handleScale})` }); }
      comment.disabled = saving || (mode==='intent'&&!blueprint.count()); capture.disabled = saving || capturing; move.disabled = resize.disabled = saving;
      if (!navigation.manipulable()) box.hidden = origin.hidden = move.hidden = resize.hidden = true;
    } catch (error) { box.hidden = origin.hidden = move.hidden = resize.hidden = true; comment.disabled = saving || mode !== 'intent' || !blueprint.count(); status.textContent = error.message; }
  }
  function refresh() { if (active && !isDemo && !fixtureActive()) { stop(); return; } if (!frame && active) frame = requestAnimationFrame(draw); }
  function cancel(message) {
    if (gesture) renderPreview(gesture.mode==='intent'?blueprint.project():getProject());
    gesture = undefined; if (message) notify(message); refresh();
  }
  function resetProposal() { proposal = undefined; }
  function start(data) {
    if (!isDemo && !fixtureActive()) throw new Error('先打开专用虚构测试对话，再进入画布。');
    cancel(); active = true; scope = data.scope || 'base'; host.hidden = false; if(toolbarMount)toolbarMount.hidden=false; onCanvasActive(true); onActive(true); notify('点击选择 · 拖动左上圆点移动 · 拖动右下方点调尺寸 · Esc 退出 · Ctrl+Z 撤销'); draw();
  }
  function stop() { cancel(); resetProposal(); blueprint.activate(false); active = false; saving = false; navigation.sync(); host.hidden = true; if(toolbarMount)toolbarMount.hidden=true; onCanvasActive(false); onActive(false); send('canvas-status', { active: false, mode }); }
  function configure(data) { if (scope !== data.scope) { cancel(); resetProposal(); scope = data.scope || 'base'; } refresh(); }
  function begin(kind) {
    if (!active || saving || capturing) return false;
    const s = selection(); canLayout(s.target, s.el);
    if(mode==='intent'&&!blueprint.canRecord())throw new Error('一张蓝图最多记录 30 类部件 / 范围组合，请先保存。');
    const css = getComputedStyle(s.el), parent = s.el.parentElement;
    const parentCss = getComputedStyle(parent), parentWidth = parent.clientWidth - parseFloat(parentCss.paddingLeft) - parseFloat(parentCss.paddingRight);
    const horizontal = css.boxSizing === 'border-box' ? 0 : parseFloat(css.paddingLeft) + parseFloat(css.paddingRight) + parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth);
    const vertical = css.boxSizing === 'border-box' ? 0 : parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
    gesture = { kind, mode, basis: structuredClone(getBasis()), project: structuredClone(mode==='intent'?blueprint.project():getProject()), selection: s, scope,
      anchor: captureAnchor(s.target,s.el,{clientX:s.rect.left+s.rect.width/2,clientY:s.rect.top+s.rect.height/2},fixtureActive()),
      initial: { drawer: isDrawer(s.target.id), left: s.rect.left / (s.rect.width / s.el.offsetWidth), top: s.rect.top / (s.rect.height / s.el.offsetHeight), scaleX: s.rect.width / s.el.offsetWidth, scaleY: s.rect.height / s.el.offsetHeight, parentWidth, width: s.el.offsetWidth - horizontal, height: s.el.offsetHeight - vertical, marginLeft: parseFloat(css.marginLeft) || 0, marginTop: parseFloat(css.marginTop) || 0, pixelWidth: messagePart(s.target.id) === 'avatar', autoHeight: canvasAutoHeight(s.target.id) },
      rect: { ...(proposal?.after || s.rect) }, previous: proposal && structuredClone(proposal), changed: false };
    return true;
  }
  function change(dx, dy, free = false) {
    if (!gesture) return;
    if (!sameCanvasBasis(gesture.basis, getBasis()) || !gesture.selection.el.isConnected) { cancel('工程或目标变化，此次操作已取消。'); resetProposal(); return; }
    gesture.changed = Math.abs(dx) + Math.abs(dy) > 0;
    if (!gesture.changed) {renderPreview(gesture.project);draw();return;}
    gesture.props = canvasPatch(gesture.initial, gesture.kind, dx, dy, snap.checked && !free);
    gesture.changed = Object.keys(gesture.props).length > 0;
    if (!gesture.changed) { renderPreview(gesture.project); notify('此部件高度随内容变化；请左右拖动调整宽度。'); draw(); return; }
    renderPreview(applyCommand(gesture.project, { type: 'canvas-set', target: gesture.selection.target.id, scope: gesture.scope, props: gesture.props }));
    draw();
  }
  function finish() {
    if (!gesture) return;
    const saved = gesture; gesture = undefined;
    if (!sameCanvasBasis(saved.basis, getBasis())) { renderPreview(getProject()); resetProposal(); notify('工程已更新，请重新拖动。'); return; }
    if (saved.mode === 'layout' && saved.changed) { saving = true; send('canvas-commit', { basis: saved.basis, target: saved.selection.target.id, scope: saved.scope, props: saved.props }); notify('正在保存布局…'); }
    else if (saved.mode === 'intent' && saved.changed) blueprint.record(saved);
    else renderPreview(saved.mode==='intent'?blueprint.project():getProject());
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
  choice.addEventListener('change', () => { cancel(); resetProposal(); mode = choice.value; notify(mode === 'layout' ? '调整会作用于同类部件；右侧面板可输入精确值。' : '直接选择并拖动，同类部件一起变化；可连续调整，最后保存整张蓝图。'); draw(); });
  comment.addEventListener('click', () => {
    if (mode === 'intent') { try { blueprint.save(); } catch(error) { notify(error.message); } return; }
    try { const s = selection(); const anchor = captureAnchor(s.target, s.el, { clientX: s.rect.left + s.rect.width / 2, clientY: s.rect.top + s.rect.height / 2 }, fixtureActive()); send('annotation', { anchor, canvas: proposal, basis: getBasis() }); onActive(false); } catch (error) { notify(error.message); }
  });
  exit.addEventListener('click', stop);
  restore.addEventListener('click', () => { cancel(); if (mode === 'intent') { blueprint.clear(); refresh(); } else send('canvas-restore-request'); });
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
    if (!active || event.defaultPrevented || event.composedPath().some(el=>el.matches?.('input,textarea,select,[contenteditable]:not([contenteditable=false]),dialog[open]'))) return;
    if (event.key === 'Escape') { event.preventDefault(); if (gesture) cancel('操作已取消。'); else stop(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.composedPath()[0]?.matches?.('input,textarea,[contenteditable]')) { event.preventDefault(); cancel(); resetProposal(); if(mode==='intent')blueprint.history(event.shiftKey?'redo':'undo');else send('canvas-history', { action: event.shiftKey ? 'redo' : 'undo' }); }
  }
  const resized=()=>{cancel();refresh();};
  document.addEventListener('keydown', key, true); document.addEventListener('scroll', refresh, true); window.addEventListener('resize', resized);
  toolbarShadow !== shadow && toolbarShadow.addEventListener('keydown', key, true);
  toolbarMount?.addEventListener('tts-viewport-change', resized);
  return {
    start, stop, configure, refresh, active: () => active, selecting: () => active && navigation.selecting(),
    hover: event => navigation.hover(event), point: event => navigation.point(event), context: event => navigation.context(event), focusSelection:()=>navigation.focusSelection(),
    history(action){if(active&&mode==='intent'&&['undo','redo'].includes(action)){cancel();blueprint.history(action);}},
    roundState(data) { canRestore = data.canRestore === true; refresh(); },
    cancelGesture() { cancel(); resetProposal(); refresh(); },
    restored(data) { cancel(); resetProposal(); renderPreview(getProject()); notify(data.message); refresh(); },
    select(hit) { if (!active || saving) return; cancel(); resetProposal(); select(hit); refresh(); },
    update() { blueprint.update(); if (!isDemo && !fixtureActive()) { if (active) stop(); return; } if (gesture && !sameCanvasBasis(gesture.basis, getBasis())) cancel('工程已更新，此次操作已取消。'); if (proposal) resetProposal(); refresh(); },
    selected() { cancel(); resetProposal(); refresh(); },
    proposalSaved() { if(mode==='intent')blueprint.saved();else{resetProposal(); notify('提案小票已保存；同一视口和工程下显示编号虚线框。');} refresh(); },
    result(data) { saving = false; renderPreview(getProject()); notify(data.ok ? '布局已保存；可继续拖动、在属性面板微调，或撤销。' : data.error || '保存失败，已恢复。'); refresh(); },
    dispose() { stop(); navigation.dispose(); blueprint.dispose(); disposed = true; cancelAnimationFrame(frame); document.removeEventListener('keydown', key, true); document.removeEventListener('scroll', refresh, true); window.removeEventListener('resize', resized); toolbarShadow.removeEventListener('keydown',key,true); toolbarMount?.removeEventListener('tts-viewport-change', resized); toolbarHost?.remove(); host.remove(); },
  };
}
