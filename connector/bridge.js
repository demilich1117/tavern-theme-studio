import { TARGETS, FIELDS, exportTheme, validateProject } from '../shared/core.js';
import { targetElement, diagnose, auditScene } from './diagnostics.js';
import { createThemeIsolation, createThemePresentation } from './theme-isolation.js';
import { resolveAssetUrls } from '../shared/assets.js';
import { captureAnchor, createAnnotationPins } from './annotations.js';
import { layerAsset } from '../shared/decorations.js';
import { createDecorationEditor } from './decoration-editor.js';
import { pickCandidates, relatedLayers } from './picking.js';
import { activeRules } from '../shared/editing.js';
import { createCanvasEditor } from './canvas-editor.js';

export const CHANNEL = 'tavern-theme-studio/v1';
const STYLE_ID = 'tts-preview-style';
const VARS_ID = 'tts-preview-vars';
const OVERLAY_ID = 'tts-picker-overlay';
const themeColors = {
  main_text_color: '--SmartThemeBodyColor', italics_text_color: '--SmartThemeEmColor',
  underline_text_color: '--SmartThemeUnderlineColor', quote_text_color: '--SmartThemeQuoteColor',
  blur_tint_color: '--SmartThemeBlurTintColor', chat_tint_color: '--SmartThemeChatTintColor',
  user_mes_blur_tint_color: '--SmartThemeUserMesBlurTintColor', bot_mes_blur_tint_color: '--SmartThemeBotMesBlurTintColor',
  shadow_color: '--SmartThemeShadowColor', border_color: '--SmartThemeBorderColor',
};
export function themeVariablesCss(project, { followHostPageWidth = false } = {}) {
  const theme = exportTheme(project);
  const declarations = Object.entries(themeColors).flatMap(([key, variable]) => {
    const value = theme[key];
    return typeof value === 'string' && CSS.supports('color', value) && !/[;{}]/.test(value) ? [`${variable}: ${value} !important;`] : [];
  });
  for (const [key, variable, suffix] of [['font_scale', '--fontScale', ''], ['blur_strength', '--blurStrength', ''], ['shadow_width', '--shadowWidth', '']]) {
    if (Number.isFinite(theme[key])) declarations.push(`${variable}: ${theme[key]}${suffix} !important;`);
  }
  if (!followHostPageWidth && Number.isFinite(theme.chat_width) && theme.chat_width >= 0 && theme.chat_width <= 100) declarations.push(`--sheldWidth: ${theme.chat_width}vw !important;`);
  return `:root { ${declarations.join(' ')} }`;
}
export function inspectTarget(id, preferred) {
  const target = TARGETS.find(x => x.id === id);
  if (!target) throw new Error('未知部件。');
  const { matches, element: el } = targetElement(target, preferred);
  if (!el) return { id, count: matches.length, visible: false, values: {} };
  const computed = getComputedStyle(el, target.pseudo || null);
  const values = Object.fromEntries(FIELDS.map(field => [field.key, computed.getPropertyValue(field.key)]));
  values['width-px'] = computed.width;
  const width = el.parentElement?.getBoundingClientRect().width;
  if (width) values.width = `${(el.getBoundingClientRect().width / width * 100).toFixed(1)}%`;
  if (values['line-height'].endsWith('px')) values['line-height'] = String(parseFloat(values['line-height']) / parseFloat(values['font-size']));
  const visible = !target.pseudo || (!['none', 'normal'].includes(computed.content) && computed.display !== 'none');
  return { id, count: matches.length, visible, pseudo: target.pseudo || null, values, rect: { width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height) } };
}
export function attachBridge({ peer, origin, transportOrigin = origin, session, readTheme, applyNativeTheme, hostName = 'SillyTavern', isDemo = false, fixture, onFixtureScene = () => {}, onCollapse = () => {}, onScene = () => {}, onClose = () => {}, onPickChange = () => {} }) {
  if (!peer || !/^https?:\/\//.test(origin) || !session) throw new Error('连接信息不完整。');
  let picking = false, annotating = false, selected = 'assistant', lastSeen = Date.now(), closed = false, pending = false;
  let currentProject, previewEnabled = true, pickedElement, applying = false, canvasLaunch = 0;
  const isolation = createThemeIsolation(() => isDemo ? null : document.getElementById('custom-style'));
  const presentation = createThemePresentation(() => isDemo ? null : document.body, () => isDemo ? null : document.getElementById('send_form'));
  const headObserver = new MutationObserver(() => isolation.refresh());
  headObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  const send = (type, payload = {}) => peer.postMessage({ channel: CHANNEL, session, type, ...payload }, transportOrigin);
  const pins = createAnnotationPins({ send, fixtureActive: () => fixture?.status().active === true, onReveal: () => onPickChange(false), getBasis: () => currentBasis });
  const variables = document.createElement('style'); variables.id = VARS_ID;
  document.getElementById(VARS_ID)?.remove(); document.head.append(variables);
  const style = document.createElement('style'); style.id = STYLE_ID;
  document.getElementById(STYLE_ID)?.remove(); document.head.append(style);
  let hostBlocked = new Set();
  function renderPreview(project, enabled) {
    if (!enabled) { style.textContent = ''; send('decoration-status', { issues: [] }); return; }
    // Probe authored CSS without editor decorations. Existing host extension
    // pseudo content must not become an invisible casualty of a new layer.
    const base = { ...project, recipe: null, decorations: [] };
    style.textContent = resolveAssetUrls(exportTheme(base).custom_css, origin);
    const issues = [], blocked = new Set();
    const hidden = (project.recipe?.hiddenSlots || []).map(slotId => ({ id: `hidden-${slotId}`, slotId, asset: null }));
    for (const layer of [...project.decorations, ...hidden]) {
      const slot = project.recipe?.slots.find(s => s.id === layer.slotId);
      if (!slot || !slot.pseudo || slot.pseudo === '::-webkit-scrollbar-thumb' || (slot.condition && !matchMedia(slot.condition).matches)) continue;
      let elements; try { elements = [...document.querySelectorAll(slot.selector)].filter(e => !e.closest('[data-tts-ui]')).slice(0, 200); } catch { continue; }
      if (!elements.length) { issues.push({ layerId: layer.id, message: '当前画面没有目标部件；展开原生控件或对照快照定位。' }); continue; }
      for (const element of elements) {
        if (slot.exclude?.some(s => element.matches(s))) continue;
        const css = getComputedStyle(element, slot.pseudo), content = css.content;
        const expected = layerAsset(project, { ...layer, asset: null });
        const expectedUrl = expected ? resolveAssetUrls(expected, origin) : null;
        const image = slot.method === 'nine-slice' ? css.borderImageSource : css.backgroundImage;
        const occupied = content && !['none', 'normal'].includes(content);
        const mismatch = slot.sourceOwned ? occupied && ((!['""', "''"].includes(content)) || (expectedUrl && !image.includes(expectedUrl))) : occupied;
        if (mismatch) { blocked.add(layer.id); issues.push({ layerId: layer.id, message: '真实宿主伪元素被其他规则占用；保留现有效果，请检查样式诊断与插槽所有权。' }); break; }
      }
    }
    const display = { ...project, recipe: project.recipe ? { ...project.recipe, hiddenSlots: project.recipe.hiddenSlots.filter(id => !blocked.has(`hidden-${id}`)) } : null, decorations: project.decorations.filter(l => !blocked.has(l.id)) };
    hostBlocked = blocked;
    style.textContent = resolveAssetUrls(exportTheme(display).custom_css, origin);
    send('decoration-status', { issues });
  }
  let currentBasis;
  let canvasInspectionFrame = 0;
  function renderCanvasPreview(project) {
    renderPreview(project, previewEnabled);
    // Geometry drafts replace only the style element in <head>, outside the
    // body observer. Refresh computed values after both preview and restore.
    if (!canvasInspectionFrame && !closed) canvasInspectionFrame = requestAnimationFrame(() => {
      canvasInspectionFrame = 0;
      if (!closed) inspect();
    });
  }
  const editor = createDecorationEditor({ getProject: () => currentProject, getBasis: () => currentBasis, renderPreview: project => renderPreview(project, previewEnabled), isBlocked: id => hostBlocked.has(id), send, onActive: onPickChange });
  const canvasEditor = createCanvasEditor({ getProject: () => currentProject, getBasis: () => currentBasis, getSelection: () => ({ id: selected, element: pickedElement }), select: hit => { selected = hit.target.id; pickedElement = hit.el; send('picked', { target: selected }); inspect(); onPickChange(false); }, renderPreview: renderCanvasPreview, send, fixtureActive: () => fixture?.status().active === true, isDemo, onActive: onPickChange });
  const viewport = () => { send('viewport', { width: innerWidth, height: innerHeight }); editor.refresh(); canvasEditor.refresh(); };
  window.addEventListener('resize', viewport);
  const overlay = document.createElement('div'); overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483646', border: '2px solid #e6aa64', borderRadius: '4px', boxShadow: '0 0 0 1px #131517', display: 'none', boxSizing: 'border-box' });
  document.getElementById(OVERLAY_ID)?.remove(); document.body.append(overlay);
  const pickHint = document.createElement('div'); pickHint.dataset.ttsUi = ''; pickHint.setAttribute('role', 'status');
  pickHint.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);max-width:90vw;padding:8px 12px;z-index:2147483647;background:#17191d;color:#e7e8ea;border:1px solid #e6aa64;border-radius:6px;font:13px/1.5 sans-serif;pointer-events:none';
  pickHint.hidden = true; document.body.append(pickHint);
  function outline(element) {
    if (!element) { overlay.style.display = 'none'; return; }
    const rect = element.getBoundingClientRect();
    Object.assign(overlay.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }
  function match(element) {
    if (!(element instanceof Element) || element.closest('[data-tts-ui]')) return null;
    return pickCandidates(element)[0] || null;
  }
  const inspect = () => {
    const target = TARGETS.find(t => t.id === selected), el = targetElement(target, pickedElement).element;
    const inner = ['assistant', 'user'].includes(selected) ? TARGETS.filter(t => ['message-text', 'avatar', 'name'].includes(t.id) && targetElement(t).matches.some(child => el?.contains(child))) : [];
    send('inspection', { inspection: { ...inspectTarget(selected, pickedElement), width: innerWidth,
      related: [...inner, ...pickCandidates(el).filter(hit => hit.target.id !== selected).map(hit => hit.target)].map(t => ({ id: t.id, name: t.name })),
      layers: relatedLayers(currentProject, el, condition => matchMedia(condition).matches) } });
  };
  const move = event => { if (picking) { const hit = match(event.target); outline(hit?.el); pickHint.textContent = hit ? `${hit.target.name} · 点击选择 · Esc 退出` : '此位置暂不支持直接编辑 · 继续选择或按 Esc 退出'; } };
  const click = event => {
    if (!picking && canvasEditor.active() && !event.target.closest?.('[data-tts-ui]')) {
      const hit = match(event.target);
      if (hit) { event.preventDefault(); event.stopImmediatePropagation(); canvasEditor.select(hit); }
      return;
    }
    if (!picking) return;
    if (event.target.closest?.('[data-tts-ui]')) return;
    let hit = match(event.target);
    event.preventDefault(); event.stopImmediatePropagation();
    if (!hit) { pickHint.textContent = '此位置暂不支持直接编辑 · 继续选择或按 Esc 退出'; send('pick-unsupported', { message: '这个位置暂不支持直接编辑。请继续选择消息、头像或输入区，或按 Esc 退出。' }); return; }
    pickHint.hidden = true;
    if (annotating) {
      const target = TARGETS.find(t => t.id === selected);
      const pseudoHost = target?.pseudo && event.target.closest(target.elementSelector);
      if (pseudoHost) hit = { target, el: pseudoHost };
      const anchor = captureAnchor(hit.target, hit.el, event, fixture?.status().active === true);
      picking = annotating = false; overlay.style.display = 'none'; onPickChange(false); send('annotation', { anchor }); return;
    }
    selected = hit.target.id; pickedElement = hit.el; picking = false; overlay.style.display = 'none'; onPickChange(false);
    send('picked', { target: selected }); inspect();
  };
  const key = event => { if (event.key === 'Escape' && picking) { picking = annotating = false; pickHint.hidden = true; overlay.style.display = 'none'; onPickChange(false); send('pick-cancelled'); } };
  async function message(event) {
    const data = event.data;
    if (event.source !== peer || event.origin !== transportOrigin || data?.channel !== CHANNEL || data?.session !== session) return;
    lastSeen = Date.now();
    try {
      switch (data.type) {
        case 'hello': send('ready', { capabilities: { connectorVersion: STUDIO_VERSION, projectSchema: 3, stableBindings: true, decorations: 1, decorationEditor: 1, themeAnalysis: 1, directEditing: 1, canvasEditor: 1, canvasWorkflow: 1, blueprint: 1, nativeThemeApply: !!applyNativeTheme }, theme: await readTheme(), hostName, isDemo, fixture: fixture?.status(), targets: TARGETS.map(x => ({ id: x.id, count: targetElement(x).matches.length })) }); inspect(); viewport(); break;
        case 'ping': send('pong', { fixture: fixture?.status() }); break;
        case 'preview': {
          if (applying) break;
          const project = validateProject(data.project);
          currentProject = project; currentBasis = data.basis; previewEnabled = data.enabled !== false;
          if (!previewEnabled) { editor.stop(); canvasEditor.stop(); }
          isolation.setEnabled(previewEnabled);
          if (previewEnabled) presentation.apply(exportTheme(project)); else presentation.restore();
          // Keep imports first in their own stylesheet. Separate variables override
          // host inline variables without mutating them; advanced CSS follows.
          // Native page width remains controlled by the host's settings slider.
          variables.textContent = data.enabled === false ? '' : themeVariablesCss(project, { followHostPageWidth: !isDemo });
          renderPreview(project, data.enabled !== false);
          editor.update();
          canvasEditor.update();
          requestAnimationFrame(() => { if (!closed) { inspect(); requestAnimationFrame(() => { if (!closed) send('preview-applied', { basis: data.basis }); }); } }); break;
        }
        case 'select': {
          const target = TARGETS.find(t => t.id === data.target); if (!target) throw new Error('未知部件。');
          if (selected !== data.target) {
            const context = pickedElement, selector = target.elementSelector || target.selector;
            pickedElement = context?.closest(selector) || targetElement(target).matches.find(el => context?.contains(el));
          }
          selected = data.target; canvasEditor.selected(); inspect(); break;
        }
        case 'pick': editor.stop(); if (data.enabled) canvasEditor.stop(); annotating = false; picking = !!data.enabled; pickHint.hidden = !picking; pickHint.textContent = '点击画面中的部件 · Esc 退出'; if (!picking) overlay.style.display = 'none'; onPickChange(picking); break;
        case 'canvas-start': {
          const request = ++canvasLaunch, projectId = currentProject?.projectId;
          try {
            if (!previewEnabled) throw new Error('请先关闭「查看原样」。');
            editor.stop(); picking = annotating = false; pickHint.hidden = true; overlay.style.display = 'none';
            if (!isDemo && !fixture?.status().active) {
              if (!fixture) throw new Error('连接器不支持测试对话，请更新后重试。');
              send('canvas-status', { active: false, preparing: true, message: '正在打开虚构测试对话…' });
              try { await fixture.open({ fresh: false }); }
              finally { if (!closed) send('fixture-status', { fixture: fixture.status() }); }
            }
            if (closed || request !== canvasLaunch) break;
            if (projectId !== currentProject?.projectId) throw new Error('作品已切换，请重新进入画布。');
            canvasEditor.start(data);
          } catch (error) { if (!closed && request === canvasLaunch) send('canvas-start-result', { ok: false, error: error.message }); }
          break;
        }
        case 'canvas-stop': canvasLaunch++; canvasEditor.stop(); break;
        case 'canvas-round-state': canvasEditor.roundState(data); break;
        case 'canvas-cancel-gesture': canvasEditor.cancelGesture(); break;
        case 'canvas-restored': canvasEditor.restored(data); break;
        case 'canvas-configure': canvasEditor.configure(data); break;
        case 'blueprint-history': canvasEditor.history(data.action); break;
        case 'canvas-commit-result': canvasEditor.result(data); break;
        case 'canvas-proposal-saved': canvasEditor.proposalSaved(); break;
        case 'decoration-edit': canvasEditor.stop(); picking = annotating = false; overlay.style.display = 'none'; editor.start(data); break;
        case 'decoration-edit-stop': editor.stop(); break;
        case 'decoration-commit-result': editor.receive(data); break;
        case 'annotate': if (data.enabled) canvasEditor.stop(); annotating = picking = !!data.enabled; if (!picking) overlay.style.display = 'none'; onPickChange(picking); break;
        case 'annotations': pins.set(Array.isArray(data.tickets) ? data.tickets : []); break;
        case 'annotation-focus': pins.focus(data.anchor); break;
        case 'read-theme': send('theme', { theme: await readTheme() }); break;
        case 'apply-native-theme': {
          if (!applyNativeTheme || applying) { send('native-theme-result', { requestId: data.requestId, ok: false, error: '当前无法直接应用，请稍后重试或下载主题。' }); break; }
          applying = true; editor.stop(); canvasEditor.stop(); const enabled = previewEnabled;
          isolation.setEnabled(false); presentation.restore(); variables.textContent = ''; style.textContent = ''; onPickChange(true);
          try { const result = await applyNativeTheme(data.theme); previewEnabled = false; send('native-theme-result', { requestId: data.requestId, ok: true, ...result }); }
          catch (error) { send('native-theme-result', { requestId: data.requestId, ok: false, error: error.message }); if (enabled && currentProject) { isolation.setEnabled(true); presentation.apply(exportTheme(currentProject)); variables.textContent = themeVariablesCss(currentProject, { followHostPageWidth: !isDemo }); renderPreview(currentProject, true); } }
          finally { applying = false; onPickChange(false); }
          break;
        }
        case 'read-theme-for-analysis': send('theme-for-analysis', { requestId: data.requestId, theme: await readTheme() }); break;
        case 'scene': if (isDemo) { onScene(data.scene); requestAnimationFrame(inspect); } break;
        case 'fixture-open': {
          if (!fixture || isDemo) throw new Error('请连接支持测试对话的酒馆连接器。');
          try { await fixture.open({ fresh: data.fresh === true }); }
          finally { if (!closed) send('fixture-status', { fixture: fixture.status() }); }
          if (!closed) inspect(); break;
        }
        case 'fixture-scene': if (fixture && !isDemo) { onFixtureScene(data.scene); requestAnimationFrame(inspect); } break;
        case 'collapse': onCollapse(); break;
        case 'diagnose': {
          const target = TARGETS.find(x => x.id === data.target);
          if (!target || !FIELDS.some(f => f.key === data.property)) throw new Error('诊断目标或属性无效。');
          const requested = activeRules(currentProject, target.id, innerWidth)[data.property];
          send('diagnosis', { requestId: data.requestId, result: diagnose(target, data.property, requested, previewEnabled, selected === target.id ? pickedElement : undefined) }); break;
        }
        case 'audit': requestAnimationFrame(() => { if (!closed) send('audit-result', { requestId: data.requestId, result: { ...auditScene(), hostName, isDemo, enabled: previewEnabled } }); }); break;
        case 'disconnect': dispose(); break;
      }
    } catch (e) { send('error', { error: e.message }); }
  }
  const observer = new MutationObserver(records => {
    if (pending || !records.some(r => r.target !== style && !overlay.contains(r.target) && !r.target.closest?.('[data-tts-ui]') && ![...r.addedNodes,...r.removedNodes].every(n=>n.nodeType===1&&n.hasAttribute('data-tts-ui')))) return;
    pending = true; requestAnimationFrame(() => { pending = false; if (!closed) { inspect(); editor.refresh(); canvasEditor.refresh(); } });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('message', message);
  document.addEventListener('pointermove', move, true); document.addEventListener('click', click, true); document.addEventListener('keydown', key, true);
  const timer = setInterval(() => { if (peer.closed || Date.now() - lastSeen > 30000) dispose(); }, 3000);
  function dispose() {
    if (closed) return; closed = true;
    send('disconnected'); clearInterval(timer); cancelAnimationFrame(canvasInspectionFrame); observer.disconnect(); headObserver.disconnect(); isolation.dispose(); presentation.restore();
    window.removeEventListener('message', message); window.removeEventListener('pagehide', dispose);
    document.removeEventListener('pointermove', move, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true);
    window.removeEventListener('resize', viewport); editor.dispose(); canvasEditor.dispose();
    pins.dispose(); variables.remove(); style.remove(); overlay.remove(); pickHint.remove(); onPickChange(false); onClose();
  }
  window.addEventListener('pagehide', dispose);
  return { dispose };
}
import { STUDIO_VERSION } from '../shared/version.js';
