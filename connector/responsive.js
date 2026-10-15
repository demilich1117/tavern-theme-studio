import { workspaceUrl } from '../shared/workspace.js';

const CHANNEL = 'tavern-theme-studio/v1', $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.hash.slice(1)), session = crypto.randomUUID();
const status = (message, error = false) => { $('#status').textContent = message; $('.hint').classList.toggle('error', error); $('#retry').hidden = !error; };
$('#retry').addEventListener('click', () => location.reload());
try {
  const host = new URL(params.get('host') || '/', location.origin);
  if (host.origin !== location.origin) throw new Error('设计工作台必须使用当前酒馆。');
  workspaceUrl(host.href, params.get('studio'), location.href);
  const studio = new URL(params.get('studio')), native = $('#host'), editor = $('#editor');
  const narrow = matchMedia('(max-width:850px)');
  let loaded = false, connected = false, canvasActive = false, width = 390, height = 844;
  host.hash = new URLSearchParams({ 'tts-lab': '', studio: studio.origin, 'tts-responsive': session }).toString();
  studio.pathname = '/'; studio.search = ''; studio.hash = new URLSearchParams({ origin: location.origin, session }).toString();
  const view = name => {
    document.body.dataset.view = name;
    for (const button of document.querySelectorAll('button[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === name));
  };
  const showEditor = () => {
    document.body.classList.remove('editor-hidden'); $('#toggle-editor').textContent = '收起编辑'; $('#toggle-editor').setAttribute('aria-expanded', 'true');
    if (narrow.matches) view('editor');
  };
  function fit() {
    const space = $('.viewport-space'), padding = narrow.matches ? 24 : 40;
    const scale = $('#zoom').value === 'fit' ? Math.min(1, Math.max(.1, (space.clientWidth - padding) / width), Math.max(.1, (space.clientHeight - padding - 26) / height)) : Math.min(2, Math.max(.5, Number($('#zoom').value) || 1));
    native.style.transform = `scale(${scale})`;
    $('.viewport-frame').style.width = `${width * scale}px`; $('.viewport-frame').style.height = `${height * scale}px`;
    $('#size').textContent = `${width} × ${height} · ${width <= 767 ? '手机' : '电脑'}视口 · 显示 ${Math.round(scale * 100)}%`;
    $('#canvas-tools').dispatchEvent(new Event('tts-viewport-change'));
  }
  function resize(nextWidth, nextHeight) {
    if (!Number.isInteger(nextWidth) || nextWidth < 320 || nextWidth > 2560 || !Number.isInteger(nextHeight) || nextHeight < 480 || nextHeight > 1600) { status('宽度请填 320–2560，高度请填 480–1600。', true); return; }
    width = nextWidth; height = nextHeight; $('#width').value = width; $('#height').value = height;
    native.style.width = `${width}px`; native.style.height = `${height}px`;
    for (const button of document.querySelectorAll('[data-size]')) button.setAttribute('aria-pressed', String(button.dataset.size === `${width},${height}`));
    if (narrow.matches) view('preview'); fit();
  }
  window.addEventListener('message', event => {
    const data = event.data; if (data?.channel !== CHANNEL || data.session !== session) return;
    if (event.source === native.contentWindow && event.origin === location.origin) {
      if (data.type === 'responsive-host-ready' && !loaded) { loaded = true; editor.src = studio.href; status('虚构测试对话已准备，正在连接编辑器…'); return; }
      if (data.type === 'responsive-host-error') { status(data.error, true); return; }
      if (data.type === 'ready') { connected = true; status('预览尺寸只改变画面；编辑区“应用到”决定修改影响的设备。'); }
      if (data.type === 'disconnected') { connected = false; status('连接已断开。请确认本地工作台仍在运行，再重新连接。刷新前请先保存蓝图小票。', true); }
      if (data.type === 'canvas-status') { canvasActive = data.active; document.body.classList.toggle('canvas-active', canvasActive); }
      if (['annotation', 'canvas-capture', 'open-objects'].includes(data.type) || data.type === 'picked' && !canvasActive) showEditor();
      if (loaded) editor.contentWindow.postMessage(data, studio.origin);
    } else if (loaded && event.source === editor.contentWindow && event.origin === studio.origin) {
      if(data.type==='objects-selected'){if(narrow.matches)view('preview');return;}
      if (narrow.matches && (['canvas-start', 'annotate'].includes(data.type) || data.type === 'pick' && data.enabled)) view('preview');
      native.contentWindow.postMessage(data, location.origin);
    }
  });
  $('#dimensions-form').addEventListener('submit', event => { event.preventDefault(); resize(Number($('#width').value), Number($('#height').value)); $('.dimensions').open = false; });
  for (const button of document.querySelectorAll('[data-size]')) button.addEventListener('click', () => resize(...button.dataset.size.split(',').map(Number)));
  for (const button of document.querySelectorAll('button[data-view]')) button.addEventListener('click', () => view(button.dataset.view));
  $('#zoom').addEventListener('change', fit);
  $('#canvas-tools').addEventListener('tts-view-command',event=>{
    const space=$('.viewport-space'), data=event.detail;
    if(data.action==='pan')space.scrollBy({left:data.dx,top:data.dy,behavior:'instant'});
    else if(data.action==='fit'||data.action==='actual'){ $('#zoom').value=data.action==='fit'?'fit':'1';fit(); }
    else if(data.action==='focus'){
      const r=native.getBoundingClientRect(), bounds=space.getBoundingClientRect(), scale=r.width/width;
      space.scrollBy({left:r.left+(data.rect.left+data.rect.width/2)*scale-(bounds.left+bounds.width/2),top:r.top+(data.rect.top+data.rect.height/2)*scale-(bounds.top+bounds.height/2),behavior:'instant'});
    }
  });
  $('#toggle-editor').addEventListener('click', () => {
    const hidden = document.body.classList.toggle('editor-hidden'); $('#toggle-editor').textContent = hidden ? '显示编辑' : '收起编辑'; $('#toggle-editor').setAttribute('aria-expanded', String(!hidden));
  });
  new ResizeObserver(fit).observe($('.viewport-space'));
  native.src = host.href; fit();
  setTimeout(() => { if (!connected) status(loaded ? '编辑器尚未连接。请确认本地工作台已启动，再重新连接。' : '酒馆尚未准备完成。请确认已登录酒馆且连接器已更新，再重新连接。', true); }, 30000);
} catch (error) { status(error.message, true); }
