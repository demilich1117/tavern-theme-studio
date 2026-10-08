import { attachBridge } from './bridge.js';
import { nativeFixtureHost, focusFixtureScene } from './fixture-host.js';

const ID = 'tts-connector';
let bridge, studioWindow, dock, drawerObserver;
let labStarted = false;
const fixture = nativeFixtureHost();
// A compact native settings drawer. Layout rules are scoped to this connector;
// host/theme colors and native drawer behavior remain in charge.
const settingsCss = `
#tts-connector { display:block; box-sizing:border-box; width:100%; max-width:100%; min-width:0; padding:0; writing-mode:horizontal-tb; }
#tts-connector .tts-settings-toggle { box-sizing:border-box; width:100%; min-width:0; min-height:36px; margin:0; padding:7px 0; border:0; background:transparent; color:inherit; font:inherit; text-align:left; gap:12px; white-space:normal; writing-mode:horizontal-tb; }
#tts-connector .tts-settings-toggle b { flex:1; min-width:0; }
#tts-connector .tts-settings-toggle .inline-drawer-icon { flex:0 0 auto; }
#tts-connector .tts-settings-toggle:focus-visible { outline:2px solid var(--SmartThemeQuoteColor,currentColor); outline-offset:2px; }
#tts-connector .tts-settings-body { display:grid; grid-template-columns:minmax(0,1fr); gap:8px; min-width:0; padding:8px 0 12px; }
#tts-connector .tts-url-label { display:block; margin:0; font-size:13px; }
#tts-connector .tts-address { box-sizing:border-box; width:100%; max-width:100%; min-width:0; margin:0; writing-mode:horizontal-tb; }
#tts-connector .tts-actions { display:flex; flex-direction:row; flex-wrap:wrap; align-items:center; gap:8px; min-width:0; }
#tts-connector .tts-actions > .menu_button { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; width:auto !important; max-width:100%; min-width:0; min-height:32px; height:auto; margin:0; padding:6px 10px; font-size:13px; line-height:1.4; white-space:nowrap !important; writing-mode:horizontal-tb !important; word-break:normal; overflow-wrap:normal; }
#tts-connector .tts-actions > .menu_button:disabled { opacity:.45; cursor:default; }
#tts-connector .tts-status { display:block; margin:0; font-size:12px; line-height:1.5; opacity:.75; overflow-wrap:anywhere; writing-mode:horizontal-tb; }
`;
async function readTheme() {
  // Verified against SillyTavern 1.19.0, 06bde939f. Keep internal imports here.
  const { getThemeObject } = await import('/scripts/power-user.js');
  const context = SillyTavern.getContext();
  return getThemeObject(context.powerUserSettings.theme || '酒馆当前主题');
}
function mount() {
  if (document.getElementById(ID)) return;
  const container = document.createElement('div'); container.id = ID; container.dataset.ttsUi = '';
  const style = document.createElement('style'); style.textContent = settingsCss;
  const drawer = document.createElement('div'); drawer.className = 'inline-drawer';
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'inline-drawer-toggle inline-drawer-header tts-settings-toggle';
  toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'tts-settings-content');
  const title = document.createElement('b'); title.textContent = '主题工作台';
  const icon = document.createElement('span'); icon.className = 'inline-drawer-icon fa-solid fa-circle-chevron-down down'; icon.setAttribute('aria-hidden', 'true');
  toggle.append(title, icon);
  const content = document.createElement('div'); content.id = 'tts-settings-content'; content.className = 'inline-drawer-content'; content.style.display = 'none';
  const body = document.createElement('div'); body.className = 'tts-settings-body';
  const addressLabel = document.createElement('label'); addressLabel.className = 'tts-url-label'; addressLabel.htmlFor = 'tts-address'; addressLabel.textContent = '工作台地址';
  const input = document.createElement('input'); input.id = 'tts-address'; input.type = 'url'; input.value = 'http://127.0.0.1:19321'; input.className = 'text_pole tts-address';
  const actions = document.createElement('div'); actions.className = 'tts-actions';
  const lab = document.createElement('a'); lab.className = 'menu_button'; lab.textContent = '在新标签打开测试工作台'; lab.target = '_blank'; lab.rel = 'noopener';
  const labUrl = new URL(location.pathname, location.origin); labUrl.hash = 'tts-lab'; lab.href = labUrl.href;
  const open = document.createElement('button'); open.type = 'button'; open.className = 'menu_button'; open.textContent = '打开可视化工作台';
  const popup = document.createElement('button'); popup.type = 'button'; popup.className = 'menu_button'; popup.textContent = '在独立窗口中打开';
  const stop = document.createElement('button'); stop.type = 'button'; stop.className = 'menu_button'; stop.textContent = '停止预览'; stop.disabled = true;
  const status = document.createElement('small'); status.className = 'tts-status'; status.setAttribute('role', 'status'); status.textContent = '先启动本地工作台，再连接。预览不会保存到酒馆设置。';
  actions.append(open, popup, lab, stop); body.append(addressLabel, input, actions, status); content.append(body); drawer.append(toggle, content); container.append(style, drawer);
  // SillyTavern's delegated handler performs the only toggle. Observe its icon
  // state solely to expose the expanded state to assistive technology.
  drawerObserver = new MutationObserver(() => toggle.setAttribute('aria-expanded', String(icon.classList.contains('up'))));
  drawerObserver.observe(icon, { attributes: true, attributeFilter: ['class'] });
  (document.getElementById('extensions_settings2') || document.getElementById('extensions_settings') || document.body).append(container);
  const launch = (embedded) => {
    try {
      const url = new URL(input.value);
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('第一版仅支持本机 HTTP 工作台。');
      bridge?.dispose();
      let collapseDock = () => {};
      let disposeDock = () => {};
      const session = crypto.randomUUID();
      url.pathname = '/'; url.search = ''; url.hash = new URLSearchParams({ origin: location.origin, session }).toString();
      dock?.remove();
      if (embedded) {
        dock = document.createElement('div'); dock.id = 'tts-dock'; dock.dataset.ttsUi = '';
        Object.assign(dock.style, { position: 'fixed', right: '0', top: '0', height: '100dvh', width: 'min(440px, 100vw)', zIndex: '2147483640', background: '#17191d', boxShadow: '-8px 0 32px #0006', display: 'flex', flexDirection: 'column' });
        const bar = document.createElement('div'); Object.assign(bar.style, { display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: '#25282e', color: '#e7e8ea' });
        const label = document.createElement('span'); label.textContent = '主题工作台 · 实时预览'; label.style.fontSize = '12px';
        const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭并恢复原样'; close.style.cssText = 'font:12px sans-serif;color:#e7e8ea;background:transparent;border:0;cursor:pointer;padding:6px'; close.addEventListener('click', () => bridge?.dispose());
        bar.append(label, close);
        const frame = document.createElement('iframe'); frame.title = '酒馆主题工作台编辑面板'; frame.src = url.href; frame.allow = 'clipboard-write'; Object.assign(frame.style, { width: '100%', flex: '1', minHeight: '0', border: '0' });
        const resize = document.createElement('div'); resize.setAttribute('role','separator'); resize.setAttribute('aria-label','调整工作台宽度'); resize.setAttribute('aria-orientation','vertical'); resize.tabIndex=0;
        resize.style.cssText='position:absolute;left:0;top:32px;bottom:0;width:7px;cursor:ew-resize;touch-action:none;background:linear-gradient(90deg,#e6aa6440,transparent);';
        let panelWidth = 440, resizing;
        const width = value => { panelWidth=Math.max(Math.min(320,innerWidth),Math.min(900,innerWidth,value)); if(!collapsed)dock.style.width=panelWidth+'px'; resize.setAttribute('aria-valuenow',Math.round(panelWidth));resize.setAttribute('aria-valuemin',Math.min(320,innerWidth));resize.setAttribute('aria-valuemax',Math.min(900,innerWidth)); };
        resize.addEventListener('pointerdown',e=>{if(e.button!==0)return;resizing={x:e.clientX,width:panelWidth};resize.setPointerCapture(e.pointerId);e.preventDefault();});
        resize.addEventListener('pointermove',e=>{if(resizing)width(resizing.width+resizing.x-e.clientX);});
        resize.addEventListener('pointerup',()=>{resizing=undefined;});resize.addEventListener('pointercancel',()=>{resizing=undefined;});
        resize.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();width(panelWidth+(e.key==='ArrowLeft'?1:-1)*(e.shiftKey?50:10));}});
        const onResize=()=>width(panelWidth);window.addEventListener('resize',onResize);disposeDock=()=>window.removeEventListener('resize',onResize);
        const fold = document.createElement('button'); fold.type = 'button'; fold.textContent = '收起面板'; fold.setAttribute('aria-expanded', 'true'); fold.style.cssText = close.style.cssText;
        let collapsed = false;
        collapseDock = () => {
          collapsed = !collapsed; frame.style.display = collapsed ? 'none' : '';
          Object.assign(dock.style, { height: collapsed ? 'auto' : '100dvh', width: collapsed ? 'auto' : panelWidth+'px', top: collapsed ? 'auto' : '0', bottom: collapsed ? '0' : 'auto' }); resize.hidden=collapsed;
          label.hidden = collapsed; close.hidden = collapsed;
          fold.textContent = collapsed ? '显示工作台' : '收起面板'; fold.setAttribute('aria-expanded', String(!collapsed));
        };
        fold.addEventListener('click', collapseDock); bar.prepend(fold);
        dock.append(bar, frame, resize); document.body.append(dock); width(panelWidth); studioWindow = frame.contentWindow;
      } else {
        studioWindow = window.open(url.href, 'tavern-theme-studio', 'popup,width=1440,height=960');
        if (!studioWindow) throw new Error('浏览器阻止了新窗口，可使用酒馆内的面板入口。');
      }
      bridge = attachBridge({ peer: studioWindow, origin: url.origin, session, readTheme, fixture,
        onFixtureScene: id => focusFixtureScene(fixture, id), onCollapse: collapseDock,
        onPickChange: picking => { if (embedded && dock) dock.style.visibility = picking ? 'hidden' : 'visible'; },
        onClose: () => { disposeDock(); dock?.remove(); dock = undefined; stop.disabled = true; status.textContent = '预览已停止，酒馆恢复原样。'; } });
      stop.disabled = false; status.textContent = '已打开工作台，等待连接。';
    } catch (e) { status.textContent = e.message; }
  };
  open.addEventListener('click', () => launch(true)); popup.addEventListener('click', () => launch(false));
  input.addEventListener('change', () => {
    try { const url = new URL(input.value); if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) return; labUrl.hash = new URLSearchParams({ 'tts-lab': '', studio: url.origin }).toString(); lab.href = labUrl.href; } catch {}
  });
  stop.addEventListener('click', () => bridge?.dispose());
  if (!labStarted && new URLSearchParams(location.hash.slice(1)).has('tts-lab')) {
    labStarted = true;
    const shield = document.createElement('div'); shield.id = 'tts-lab-startup'; shield.dataset.ttsUi = '';
    shield.style.cssText = 'position:fixed;inset:0;z-index:2147483641;background:#17191d;color:#e7e8ea;display:grid;place-content:center;gap:16px;padding:32px;font:16px/1.8 sans-serif';
    const shieldStyle = document.createElement('style'); shieldStyle.textContent = '#sheld{visibility:hidden!important}';
    const progress = document.createElement('div'); progress.setAttribute('role', 'status'); progress.textContent = '正在准备虚构测试对话…';
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重新准备测试对话'; retry.hidden = true;
    shield.append(shieldStyle, progress, retry); document.body.append(shield);
    const launchLab = async () => {
      let draft, textarea;
      try {
        retry.hidden = true; progress.textContent = '正在准备虚构测试对话…';
        status.textContent = '正在准备虚构测试对话…';
        // The 1.19 host restores a shared input draft and schedules a 300 ms
        // storage write during startup. Let it settle, then clear only this
        // dedicated tab's DOM field, without input events or storage writes.
        await new Promise(resolve => setTimeout(resolve, 350));
        textarea = document.getElementById('send_textarea'); draft = textarea?.value;
        if (textarea) textarea.value = '';
        await fixture.open();
        shield.remove();
        const address = new URLSearchParams(location.hash.slice(1)).get('studio');
        if (address) input.value = address;
        document.title = '酒馆主题工作台 · 原生测试对话';
        launch(true);
      } catch (error) {
        if (textarea && !textarea.value && draft !== undefined) textarea.value = draft;
        progress.textContent = error.message; retry.hidden = false; status.textContent = error.message;
      }
    };
    retry.addEventListener('click', launchLab);
    // APP_READY is memoized by this host, including when mounted after readiness.
    const ctx = SillyTavern.getContext();
    ctx.eventSource.once(ctx.event_types.APP_READY, () => { void launchLab(); });
  }
}
export function disable() { bridge?.dispose(); dock?.remove(); drawerObserver?.disconnect(); drawerObserver = undefined; document.getElementById(ID)?.remove(); }
export function activate() { mount(); }
if (globalThis.SillyTavern) {
  const { eventSource, event_types } = SillyTavern.getContext();
  eventSource.once(event_types.APP_READY, mount);
  if (document.getElementById('extensions_settings')) mount();
}
