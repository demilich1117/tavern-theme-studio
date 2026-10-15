import { attachBridge } from './bridge.js';
import { nativeFixtureHost, focusFixtureScene } from './fixture-host.js';
import { applyNativeTheme, canApplyNativeTheme } from './native-theme.js';
import { nativeHost } from './host-adapter.js';
import { workspaceUrl } from '../shared/workspace.js';

const ID = 'tts-connector';
let bridge, drawerObserver;
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
const readTheme = () => nativeHost.readTheme();
function mount() {
  if (document.getElementById(ID)) return;
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has('tts-lab') && !params.has('tts-responsive')) {
    try { location.replace(workspaceUrl(location.href, params.get('studio') || 'http://127.0.0.1:19323', new URL('./responsive.html', import.meta.url))); return; }
    catch { /* Invalid old links fall back to the settings entry below. */ }
  }
  const container = document.createElement('div'); container.id = ID; container.dataset.ttsUi = '';
  const style = document.createElement('style'); style.textContent = settingsCss;
  const drawer = document.createElement('div'); drawer.className = 'inline-drawer';
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'inline-drawer-toggle inline-drawer-header tts-settings-toggle';
  toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'tts-settings-content');
  const title = document.createElement('b'); title.textContent = '喵喵美化工作台';
  const icon = document.createElement('span'); icon.className = 'inline-drawer-icon fa-solid fa-circle-chevron-down down'; icon.setAttribute('aria-hidden', 'true');
  toggle.append(title, icon);
  const content = document.createElement('div'); content.id = 'tts-settings-content'; content.className = 'inline-drawer-content'; content.style.display = 'none';
  const body = document.createElement('div'); body.className = 'tts-settings-body';
  const addressLabel = document.createElement('label'); addressLabel.className = 'tts-url-label'; addressLabel.htmlFor = 'tts-address'; addressLabel.textContent = '工作台地址';
  const input = document.createElement('input'); input.id = 'tts-address'; input.type = 'url'; input.value = params.get('studio') || 'http://127.0.0.1:19323'; input.className = 'text_pole tts-address';
  const actions = document.createElement('div'); actions.className = 'tts-actions';
  const open = document.createElement('a'); open.className = 'menu_button'; open.textContent = '打开设计工作台 ↗'; open.target = '_blank'; open.rel = 'noopener';
  const status = document.createElement('small'); status.className = 'tts-status'; status.setAttribute('role', 'status');
  const updateEntry = () => {
    try { open.href = workspaceUrl(location.href, input.value, new URL('./responsive.html', import.meta.url)); open.removeAttribute('aria-disabled'); status.textContent = '在同一页预览电脑 / 手机、调整布局、共创与应用导出。自动使用虚构测试对话。'; }
    catch (error) { open.removeAttribute('href'); open.setAttribute('aria-disabled', 'true'); status.textContent = error.message; }
  };
  input.addEventListener('input', updateEntry); updateEntry();
  const connection = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = '连接设置';
  connection.append(summary, addressLabel, input);
  actions.append(open); body.append(actions, status, connection); content.append(body); drawer.append(toggle, content); container.append(style, drawer);
  // SillyTavern's delegated handler performs the only toggle. Observe its icon
  // state solely to expose the expanded state to assistive technology.
  drawerObserver = new MutationObserver(() => toggle.setAttribute('aria-expanded', String(icon.classList.contains('up'))));
  drawerObserver.observe(icon, { attributes: true, attributeFilter: ['class'] });
  (document.getElementById('extensions_settings2') || document.getElementById('extensions_settings') || document.body).append(container);
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
        const address = new URLSearchParams(location.hash.slice(1)).get('studio');
        if (address) input.value = address;
        document.title = '喵喵美化工作台 · 原生测试对话';
        const responsive = new URLSearchParams(location.hash.slice(1)).get('tts-responsive');
        if (responsive && window.parent !== window) {
          // The host may suppress document.referrer. Same-origin parent access
          // verifies the actual container without relying on that header.
          const parentUrl = new URL(window.parent.location.href); if(parentUrl.origin!==location.origin || !parentUrl.pathname.endsWith('/connector/responsive.html'))throw new Error('设计工作台来源无效。');
          const studio = new URL(input.value); if(studio.protocol!=='http:'||!['127.0.0.1','localhost'].includes(studio.hostname))throw new Error('工作台地址无效。');
          const toolbarMount = window.parent.document.getElementById('canvas-tools');
          bridge?.dispose(); bridge = attachBridge({peer:window.parent,origin:studio.origin,transportOrigin:location.origin,session:responsive,readTheme,fixture,toolbarMount,applyNativeTheme:canApplyNativeTheme()?applyNativeTheme:undefined,onFixtureScene:(id,position)=>focusFixtureScene(fixture,id,position)});
          window.parent.postMessage({channel:'tavern-theme-studio/v1',session:responsive,type:'responsive-host-ready'},location.origin);
        } else throw new Error('请从设计工作台打开测试对话。');
        shield.remove();
      } catch (error) {
        if (textarea && !textarea.value && draft !== undefined) textarea.value = draft;
        progress.textContent = error.message; retry.hidden = false; status.textContent = error.message;
        const responsive = new URLSearchParams(location.hash.slice(1)).get('tts-responsive');
        if (responsive && window.parent !== window) window.parent.postMessage({channel:'tavern-theme-studio/v1',session:responsive,type:'responsive-host-error',error:error.message},location.origin);
      }
    };
    retry.addEventListener('click', launchLab);
    // APP_READY is memoized by this host, including when mounted after readiness.
    const ctx = SillyTavern.getContext();
    ctx.eventSource.once(ctx.event_types.APP_READY, () => { void launchLab(); });
  }
}
export function disable() { bridge?.dispose(); drawerObserver?.disconnect(); drawerObserver = undefined; document.getElementById(ID)?.remove(); }
export function activate() { mount(); }
if (globalThis.SillyTavern) {
  const { eventSource, event_types } = SillyTavern.getContext();
  eventSource.once(event_types.APP_READY, mount);
  if (document.getElementById('extensions_settings')) mount();
}
