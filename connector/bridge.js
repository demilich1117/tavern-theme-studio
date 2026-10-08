import { TARGETS, FIELDS, exportTheme, validateProject } from '../shared/core.js';
import { targetElement, diagnose, auditScene } from './diagnostics.js';
import { createThemeIsolation, createThemePresentation } from './theme-isolation.js';
import { resolveAssetUrls } from '../shared/assets.js';
import { captureAnchor, createAnnotationPins } from './annotations.js';

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
export function themeVariablesCss(project) {
  const theme = exportTheme(project);
  const declarations = Object.entries(themeColors).flatMap(([key, variable]) => {
    const value = theme[key];
    return typeof value === 'string' && CSS.supports('color', value) && !/[;{}]/.test(value) ? [`${variable}: ${value} !important;`] : [];
  });
  for (const [key, variable, suffix] of [['font_scale', '--fontScale', ''], ['blur_strength', '--blurStrength', ''], ['shadow_width', '--shadowWidth', '']]) {
    if (Number.isFinite(theme[key])) declarations.push(`${variable}: ${theme[key]}${suffix} !important;`);
  }
  if (Number.isFinite(theme.chat_width) && theme.chat_width >= 0 && theme.chat_width <= 100) declarations.push(`--sheldWidth: ${theme.chat_width}vw !important;`);
  return `:root { ${declarations.join(' ')} }`;
}
export function inspectTarget(id, preferred) {
  const target = TARGETS.find(x => x.id === id);
  if (!target) throw new Error('未知部件。');
  const { matches, element: el } = targetElement(target, preferred);
  if (!el) return { id, count: matches.length, visible: false, values: {} };
  const computed = getComputedStyle(el, target.pseudo || null);
  const values = Object.fromEntries(FIELDS.map(field => [field.key, computed.getPropertyValue(field.key)]));
  const width = el.parentElement?.getBoundingClientRect().width;
  if (width) values.width = `${(el.getBoundingClientRect().width / width * 100).toFixed(1)}%`;
  if (values['line-height'].endsWith('px')) values['line-height'] = String(parseFloat(values['line-height']) / parseFloat(values['font-size']));
  const visible = !target.pseudo || (!['none', 'normal'].includes(computed.content) && computed.display !== 'none');
  return { id, count: matches.length, visible, pseudo: target.pseudo || null, values, rect: { width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height) } };
}
export function attachBridge({ peer, origin, session, readTheme, hostName = 'SillyTavern', isDemo = false, fixture, onFixtureScene = () => {}, onCollapse = () => {}, onScene = () => {}, onClose = () => {}, onPickChange = () => {} }) {
  if (!peer || !/^https?:\/\//.test(origin) || !session) throw new Error('连接信息不完整。');
  let picking = false, annotating = false, selected = 'assistant', lastSeen = Date.now(), closed = false, pending = false;
  let currentProject, previewEnabled = true, pickedElement;
  const isolation = createThemeIsolation(() => isDemo ? null : document.getElementById('custom-style'));
  const presentation = createThemePresentation(() => isDemo ? null : document.body, () => isDemo ? null : document.getElementById('send_form'));
  const headObserver = new MutationObserver(() => isolation.refresh());
  headObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  const send = (type, payload = {}) => peer.postMessage({ channel: CHANNEL, session, type, ...payload }, origin);
  const pins = createAnnotationPins({ send, fixtureActive: () => fixture?.status().active === true, onReveal: () => onPickChange(false) });
  const variables = document.createElement('style'); variables.id = VARS_ID;
  document.getElementById(VARS_ID)?.remove(); document.head.append(variables);
  const style = document.createElement('style'); style.id = STYLE_ID;
  document.getElementById(STYLE_ID)?.remove(); document.head.append(style);
  const overlay = document.createElement('div'); overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483646', border: '2px solid #e6aa64', borderRadius: '4px', boxShadow: '0 0 0 1px #131517', display: 'none', boxSizing: 'border-box' });
  document.getElementById(OVERLAY_ID)?.remove(); document.body.append(overlay);
  function outline(element) {
    if (!element) { overlay.style.display = 'none'; return; }
    const rect = element.getBoundingClientRect();
    Object.assign(overlay.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }
  function match(element) {
    if (!(element instanceof Element) || element.closest('[data-tts-ui]')) return null;
    for (const id of ['avatar', 'input', 'name', 'timestamp', 'reasoning-header', 'reasoning', 'quote', 'code', 'table', 'message-buttons', 'message-text', 'composer', 'assistant', 'user', 'chat', 'left', 'right', 'global']) {
      const target = TARGETS.find(x => x.id === id), el = element.closest(target.selector);
      if (el) return { target, el };
    }
    return null;
  }
  const inspect = () => send('inspection', { inspection: inspectTarget(selected, pickedElement) });
  const move = event => { if (picking) outline(match(event.target)?.el); };
  const click = event => {
    if (!picking) return;
    let hit = match(event.target); if (!hit) return;
    event.preventDefault(); event.stopImmediatePropagation();
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
  const key = event => { if (event.key === 'Escape' && picking) { picking = annotating = false; overlay.style.display = 'none'; onPickChange(false); send('pick-cancelled'); } };
  async function message(event) {
    const data = event.data;
    if (event.source !== peer || event.origin !== origin || data?.channel !== CHANNEL || data?.session !== session) return;
    lastSeen = Date.now();
    try {
      switch (data.type) {
        case 'hello': send('ready', { capabilities: { projectSchema: 3, stableBindings: true }, theme: await readTheme(), hostName, isDemo, fixture: fixture?.status(), targets: TARGETS.map(x => ({ id: x.id, count: targetElement(x).matches.length })) }); inspect(); break;
        case 'ping': send('pong', { fixture: fixture?.status() }); break;
        case 'preview': {
          const project = validateProject(data.project);
          currentProject = project; previewEnabled = data.enabled !== false;
          isolation.setEnabled(previewEnabled);
          if (previewEnabled) presentation.apply(exportTheme(project)); else presentation.restore();
          // Keep imports first in their own stylesheet. Separate variables override
          // host inline variables without mutating them; advanced CSS follows.
          variables.textContent = data.enabled === false ? '' : themeVariablesCss(project);
          style.textContent = data.enabled === false ? '' : resolveAssetUrls(exportTheme(project).custom_css, origin);
          requestAnimationFrame(inspect); break;
        }
        case 'select': if (!TARGETS.some(x => x.id === data.target)) throw new Error('未知部件。'); if (selected !== data.target) pickedElement = undefined; selected = data.target; inspect(); break;
        case 'pick': annotating = false; picking = !!data.enabled; if (!picking) overlay.style.display = 'none'; onPickChange(picking); break;
        case 'annotate': annotating = picking = !!data.enabled; if (!picking) overlay.style.display = 'none'; onPickChange(picking); break;
        case 'annotations': pins.set(Array.isArray(data.tickets) ? data.tickets : []); break;
        case 'annotation-focus': pins.focus(data.anchor); break;
        case 'read-theme': send('theme', { theme: await readTheme() }); break;
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
          const mobileActive = matchMedia('(max-width: 767px)').matches;
          const requested = (mobileActive ? currentProject?.rules.mobile[target.id]?.[data.property] : undefined) ?? currentProject?.rules.base[target.id]?.[data.property];
          send('diagnosis', { requestId: data.requestId, result: diagnose(target, data.property, requested, previewEnabled, selected === target.id ? pickedElement : undefined) }); break;
        }
        case 'audit': requestAnimationFrame(() => { if (!closed) send('audit-result', { requestId: data.requestId, result: { ...auditScene(), hostName, isDemo, enabled: previewEnabled } }); }); break;
        case 'disconnect': dispose(); break;
      }
    } catch (e) { send('error', { error: e.message }); }
  }
  const observer = new MutationObserver(records => {
    if (pending || !records.some(r => r.target !== style && !overlay.contains(r.target))) return;
    pending = true; requestAnimationFrame(() => { pending = false; if (!closed) inspect(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('message', message);
  document.addEventListener('pointermove', move, true); document.addEventListener('click', click, true); document.addEventListener('keydown', key, true);
  const timer = setInterval(() => { if (peer.closed || Date.now() - lastSeen > 30000) dispose(); }, 3000);
  function dispose() {
    if (closed) return; closed = true;
    send('disconnected'); clearInterval(timer); observer.disconnect(); headObserver.disconnect(); isolation.dispose(); presentation.restore();
    window.removeEventListener('message', message); window.removeEventListener('pagehide', dispose);
    document.removeEventListener('pointermove', move, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true);
    pins.dispose(); variables.remove(); style.remove(); overlay.remove(); onPickChange(false); onClose();
  }
  window.addEventListener('pagehide', dispose);
  return { dispose };
}
