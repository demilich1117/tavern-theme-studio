import { targetPath } from '../shared/object-tree.js';
import { targetElement } from './diagnostics.js';
import { pickCandidates } from './picking.js';

const node = (tag, text, cls) => { const el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el; };
const editing = event => event.composedPath().some(el => el.matches?.('input,textarea,select,[contenteditable]:not([contenteditable=false]),dialog[open]'));

export function createCanvasNavigation({ shadow, toolbarShadow, toolbarMount, bar, selection, select, send, isActive, refresh, cancel, busy }) {
  let tool = 'select', temporary = false, lastPoint, pan, pathKey, activeBefore = false;
  const tools = node('div', '', 'nav-tools'); tools.setAttribute('role','group'); tools.setAttribute('aria-label','画布工具');
  const buttons = new Map();
  for (const [id,label,key,icon] of [['select','选择','V','M4 2l10 9-6 1-3 5z'],['hand','平移','H','M5 9V5a1 1 0 012 0v3-5a1 1 0 012 0v5-4a1 1 0 012 0v5-2a1 1 0 012 0v5c0 4-2 5-5 5-2 0-3-1-4-3L2 10c-1-2 1-3 3-1z'],['browse','浏览','B','M2 9s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z M11 9a2 2 0 11-4 0 2 2 0 014 0']]) {
    const b = node('button'); b.className = 'nav-tool'; b.title = `${label} (${key})`; b.setAttribute('aria-label', `${label}工具`);
    const mark=document.createElementNS('http://www.w3.org/2000/svg','svg');mark.classList.add('nav-icon');mark.setAttribute('viewBox','0 0 18 18');mark.setAttribute('width','16');mark.setAttribute('height','16');mark.setAttribute('fill','none');mark.setAttribute('stroke','currentColor');mark.setAttribute('stroke-width','1.3');mark.setAttribute('stroke-linejoin','round');mark.setAttribute('aria-hidden','true');const shape=document.createElementNS(mark.namespaceURI,'path');shape.setAttribute('d',icon);mark.append(shape);b.append(mark,node('span',label,'nav-tool-label'));
    b.addEventListener('click',()=>setTool(id)); tools.append(b); buttons.set(id,b);
  }
  const objects=node('button','部件与图层'), locate=node('button','定位'), overlap=node('button','此处对象'), help=node('button','?');
  objects.className='nav-objects'; objects.setAttribute('aria-label','部件与图层');overlap.className='nav-overlap';overlap.setAttribute('aria-label','此处对象');
  objects.addEventListener('click',()=>send('open-objects')); locate.title='定位选中部件 (Shift+2)'; locate.addEventListener('click',focusSelection);
  overlap.title='选择被覆盖的部件；也可在画布上右键'; overlap.addEventListener('click',()=>openCandidates()); help.setAttribute('aria-label','画布快捷键');
  tools.append(objects,locate,overlap,help); bar.prepend(tools);
  const path=node('nav','','nav-path'); path.setAttribute('aria-label','画布选择路径'); bar.append(path);
  const hover=node('div','','nav-hover'), label=node('span'); hover.append(label); hover.hidden=true; shadow.append(hover);
  const shield=node('div','','nav-pan'); shield.hidden=true; shield.tabIndex=0; shield.setAttribute('aria-label','拖动平移视图'); shadow.append(shield);
  const dialog=node('dialog','','nav-dialog'), heading=node('h2'), close=node('button','关闭'), content=node('div','','nav-dialog-content');
  heading.id='canvas-dialog-title';dialog.setAttribute('aria-labelledby',heading.id);
  const header=node('div','','nav-dialog-header'); header.append(heading,close); dialog.append(header,content); toolbarShadow.append(dialog);
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  const style=node('style'); style.textContent=`.nav-tools{display:flex;gap:2px;align-items:center;flex-wrap:wrap;flex:1 0 100%}.nav-tools button{border:0;min-height:32px;border-radius:4px;padding:5px 8px;font-size:12px;background:transparent}.nav-tool[aria-pressed=true]{background:#4389ec30;color:#9bc5ff}.nav-icon{margin-right:5px}.nav-path{display:flex;align-items:center;flex-wrap:wrap;gap:2px;flex-basis:100%;color:#a4adb9}.nav-path button{border:0;background:none;min-height:24px;padding:2px 4px;font-size:11px;color:inherit}.nav-path button:not(:last-child)::after{content:' /';color:#6a7280;margin-left:6px}.nav-path button:disabled{opacity:1;color:#dce7f6}.nav-hover{position:fixed;border:1px dashed #82b6ff;pointer-events:none}.nav-hover span{position:absolute;left:0;bottom:100%;font:11px/1.6 'Segoe UI','Microsoft YaHei',sans-serif;white-space:nowrap;color:#dce9ff;background:#202b3d;padding:2px 5px}.nav-pan{position:fixed;inset:0;pointer-events:auto;touch-action:none;cursor:grab;outline:none}.nav-pan.dragging{cursor:grabbing}.nav-dialog{box-sizing:border-box;width:min(420px,calc(100vw - 24px));max-height:75dvh;padding:0;color:#e7e8ea;background:#24272d;border:1px solid #454a54;border-radius:8px;font:13px/1.5 'Segoe UI','Microsoft YaHei',sans-serif;box-shadow:0 12px 40px #0006;pointer-events:auto}.nav-dialog::backdrop{background:#0005}.nav-dialog-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #ffffff18}.nav-dialog h2{font-size:14px;margin:0}.nav-dialog-content{display:grid;gap:4px;padding:12px;overflow:auto}.nav-dialog-content button{justify-content:flex-start;text-align:left;min-height:36px;border:0;border-radius:4px}.nav-dialog p{margin:4px;color:#b5bdc9}.nav-shortcut{display:flex;justify-content:space-between;gap:20px;padding:7px 4px;border-bottom:1px solid #ffffff0c}.nav-dialog kbd{color:#b6d4ff;font:12px monospace}@media(pointer:coarse){.nav-tools button{min-height:40px}.nav-path button{min-height:28px}}`;
  shadow.append(style); if(toolbarShadow!==shadow)toolbarShadow.append(style.cloneNode(true));
  const compact=node('style');compact.textContent='.nav-tool{display:inline-flex;align-items:center;justify-content:center}.nav-icon{flex-shrink:0;vertical-align:middle}@media(max-width:600px){.nav-tools{flex-wrap:nowrap}.nav-tool-label{display:none}.nav-tools .nav-tool{min-width:32px}.nav-icon{margin:0}.nav-tools .nav-objects,.nav-tools .nav-overlap{font-size:0}.nav-objects::after{content:"部件";font-size:12px}.nav-overlap::after{content:"内外层";font-size:12px}.nav-path button:nth-child(-n+3):not(:last-child){display:none}.nav-tools button{padding-inline:7px}}';shadow.append(compact);if(toolbarShadow!==shadow)toolbarShadow.append(compact.cloneNode(true));
  function view(action, detail={}) {
    if(toolbarMount)toolbarMount.dispatchEvent(new CustomEvent('tts-view-command',{detail:{action,...detail}}));
    else if(action==='pan')document.querySelector('#chat')?.scrollBy({left:detail.dx,top:detail.dy,behavior:'instant'});
  }
  function setTool(next) { if(busy())return; endPan(); cancel(); tool=next; temporary=false; hover.hidden=true; refresh(); sync(); }
  function sync() {
    const active=isActive();
    if(activeBefore!==active){activeBefore=active;if(active)tool='select';}
    if(!active){temporary=false;endPan();hover.hidden=true;if(dialog.open)dialog.close();}
    shield.hidden=!active || (tool!=='hand'&&!temporary);
    buttons.forEach((b,id)=>b.setAttribute('aria-pressed',String((temporary?'hand':tool)===id)));
    let s; try{s=selection({allowOffscreen:true});}catch{}
    locate.disabled=overlap.disabled=!s;
    const key=s?.target.id;
    if(key!==pathKey){hover.hidden=true;pathKey=key;path.replaceChildren();for(const target of targetPath(key)){const b=node('button',target.name);b.disabled=target.id===key;b.addEventListener('click',()=>{const current=selection({allowOffscreen:true});const el=current.el.closest(target.elementSelector||target.selector)||targetElement(target).element;if(el)select({target,el});});path.append(b);}}
  }
  function focusSelection() {
    lastPoint=undefined;
    try {
      const s=selection({allowOffscreen:true}); s.el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      const r=s.el.getBoundingClientRect();view('focus',{rect:{left:r.left,top:r.top,width:r.width,height:r.height}}); refresh();
    } catch {}
  }
  function candidates(point) {
    let elements=[]; if(point)elements=document.elementsFromPoint(point.x,point.y);
    if(!elements.length){try{elements=[selection().el];}catch{}}
    const ids=new Set(); return elements.flatMap(pickCandidates).filter(hit=>{if(ids.has(hit.target.id))return false;ids.add(hit.target.id);return true;});
  }
  function openCandidates(point=lastPoint) {
    if(busy())return;
    const hits=candidates(point); heading.textContent='此处的对象'; content.replaceChildren();
    if(!hits.length)content.append(node('p','请先点选一个部件，再选择它的内外层。'));
    for(const hit of hits){const b=node('button',hit.target.name);b.addEventListener('click',()=>{dialog.close();select(hit);});content.append(b);}
    if(!dialog.open)dialog.showModal();
  }
  help.addEventListener('click',()=>{
    heading.textContent='画布快捷键';content.replaceChildren(node('p','在预览或工具区使用；输入文字时保留原生按键。'));
    for(const [name,keys] of [['选择 / 平移 / 浏览','V / H / B'],['临时平移','按住空格'],['适合窗口 / 100%','Shift+1 / 0'],['定位选中对象','Shift+2'],['把手微调 / 大步微调','方向键 / Shift+方向键'],['暂时关闭吸附','Alt + 拖动'],['撤销 / 重做','Ctrl/⌘+Z / +Shift+Z'],['取消当前操作','Esc']]){const row=node('div','','nav-shortcut');row.append(node('span',name),node('kbd',keys));content.append(row);}
    if(!dialog.open)dialog.showModal();
  });
  shield.addEventListener('pointerdown',e=>{if(e.button!==0)return;pan={id:e.pointerId,x:e.screenX,y:e.screenY};shield.setPointerCapture(e.pointerId);shield.classList.add('dragging');e.preventDefault();});
  shield.addEventListener('pointermove',e=>{if(pan?.id!==e.pointerId)return;view('pan',{dx:pan.x-e.screenX,dy:pan.y-e.screenY});pan.x=e.screenX;pan.y=e.screenY;});
  const endPan=()=>{const pointer=pan?.id;pan=undefined;shield.classList.remove('dragging');if(pointer!==undefined&&shield.hasPointerCapture(pointer))shield.releasePointerCapture(pointer);};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])shield.addEventListener(type,endPan);
  function key(e){
    if(!isActive()||editing(e)||e.altKey||e.ctrlKey||e.metaKey)return;
    if(e.key==='Escape'){if(dialog.open)return;if(tool!=='select'||temporary){e.preventDefault();e.stopImmediatePropagation();setTool('select');}return;}
    const k=e.key.toLowerCase();
    if(k===' '&&!busy()){e.preventDefault();if(!temporary){temporary=true;hover.hidden=true;refresh();sync();}return;}
    if(!e.shiftKey&&['v','h','b'].includes(k)){e.preventDefault();setTool({v:'select',h:'hand',b:'browse'}[k]);}
    if(e.shiftKey&&e.code==='Digit1'){e.preventDefault();view('fit');}
    if(e.shiftKey&&e.code==='Digit2'){e.preventDefault();focusSelection();}
    if(!e.shiftKey&&e.code==='Digit0'){e.preventDefault();view('actual');}
  }
  const release=e=>{if(e?.key&&e.key!==' ')return;temporary=false;endPan();refresh();sync();};
  const parentBlur=()=>{if(toolbarMount.ownerDocument.activeElement!==window.frameElement)release();};
  const clearHover=()=>{hover.hidden=true;};
  document.addEventListener('pointerleave',clearHover);document.addEventListener('scroll',clearHover,true);
  // Register before the canvas history/Escape handler. Parent toolbar has its own document.
  document.addEventListener('keydown',key,true);document.addEventListener('keyup',release,true);window.addEventListener('blur',release);
  if(toolbarShadow!==shadow){toolbarShadow.addEventListener('keydown',key,true);toolbarShadow.addEventListener('keyup',release,true);toolbarMount.ownerDocument.defaultView.addEventListener('blur',parentBlur);}
  return {
    sync, focusSelection, selecting:()=>tool==='select'&&!temporary, manipulable:()=>tool==='select'&&!temporary,
    point(event){lastPoint={x:event.clientX,y:event.clientY};},
    hover(event){if(event.pointerType==='touch'||tool!=='select'||temporary||busy()||dialog.open){hover.hidden=true;return;}const hit=pickCandidates(event.target)[0];let selected;try{selected=selection().el;}catch{}if(!hit||hit.el===selected){hover.hidden=true;return;}const r=hit.el.getBoundingClientRect();hover.hidden=false;Object.assign(hover.style,{left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`});label.textContent=hit.target.name;},
    context(event){if(tool!=='select')return;event.preventDefault();event.stopImmediatePropagation();lastPoint={x:event.clientX,y:event.clientY};openCandidates(lastPoint);},
    dispose(){document.removeEventListener('pointerleave',clearHover);document.removeEventListener('scroll',clearHover,true);document.removeEventListener('keydown',key,true);document.removeEventListener('keyup',release,true);window.removeEventListener('blur',release);toolbarShadow.removeEventListener('keydown',key,true);toolbarShadow.removeEventListener('keyup',release,true);toolbarMount?.ownerDocument.defaultView.removeEventListener('blur',parentBlur);dialog.remove();}
  };
}
