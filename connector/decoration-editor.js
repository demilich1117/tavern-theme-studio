import { applyCommand } from '../shared/core.js';
import { decorationDiagnostics, effectiveLayer } from '../shared/decorations.js';
import { localDelta, scaleRatio } from '../shared/layouts.js';

const svgNode = (tag, attributes) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k,v] of Object.entries(attributes)) el.setAttribute(k,v); return el; };
const sameBasis = (a,b) => a && b && ['projectId','sessionId','revision','fingerprint'].every(k=>a[k]===b[k]);
const point = el => { const r=el.getBoundingClientRect(); return {x:r.left,y:r.top}; };
function probe(parent, position, left, top) {
  const el=document.createElement('div'); el.dataset.ttsUi='';
  el.style.cssText='all:initial!important;display:block!important;width:0!important;height:0!important;border:0!important;padding:0!important;margin:0!important;pointer-events:none!important;opacity:0!important;transform:none!important;translate:none!important;rotate:none!important;scale:none!important;';
  for(const [k,v] of Object.entries({position,left:left+'px',top:top+'px'})) el.style.setProperty(k,v,'important');
  parent.append(el); return el;
}
// A temporary, invisible calibration box uses the browser's own containing
// block and transform calculation. No screenshot pixels are persisted.
export function measureDecoration(element, pseudo) {
  const css=getComputedStyle(element,pseudo), nodes=[];
  if(css.display==='none'||['none','normal'].includes(css.content)) throw new Error('装饰当前不可见；请展开部件或切换视口。');
  if(!['absolute','fixed'].includes(css.position)) throw new Error('画面编辑需要 absolute/fixed 独立装饰插槽。');
  try {
    const zero=probe(element,css.position,0,0), px=probe(element,css.position,100,0), py=probe(element,css.position,0,100), pxy=probe(element,css.position,100,100); nodes.push(zero,px,py,pxy);
    const o=point(zero), x=point(px), y=point(py), basis={a:(x.x-o.x)/100,b:(x.y-o.y)/100,c:(y.x-o.x)/100,d:(y.y-o.y)/100};
    localDelta(basis,0,0);
    const xy=point(pxy);if(Math.abs(xy.x-x.x-y.x+o.x)>.2||Math.abs(xy.y-x.y-y.y+o.y)>.2)throw new Error('容器包含非线性透视，请用配方参数或源码调整。');
    const box=document.createElement('div');box.dataset.ttsUi='';box.style.cssText='all:initial!important;display:block!important;opacity:0!important;pointer-events:none!important;';nodes.push(box);
    for(const k of ['position','left','right','top','bottom','width','height','box-sizing','padding-top','padding-right','padding-bottom','padding-left','border-top-width','border-right-width','border-bottom-width','border-left-width','border-style','transform','transform-origin','translate','rotate','scale','zoom','margin-top','margin-right','margin-bottom','margin-left']) box.style.setProperty(k,css.getPropertyValue(k),'important');
    element.append(box);
    const width=box.offsetWidth,height=box.offsetHeight;
    if(width<2||height<2) throw new Error('装饰没有可编辑尺寸。');
    const at=(left,top)=>point(probe(box,'absolute',left-box.clientLeft,top-box.clientTop));
    const corners=[at(0,0),at(width,0),at(width,height),at(0,height)];
    if(['x','y'].some(k=>Math.abs(corners[2][k]-corners[1][k]-corners[3][k]+corners[0][k])>.5))throw new Error('装饰包含非线性透视，请用配方参数或源码调整。');
    const origin=css.transformOrigin.split(/\s+/).map(parseFloat), pivot=at(Number.isFinite(origin[0])?origin[0]:width/2,Number.isFinite(origin[1])?origin[1]:height/2);
    return {corners,pivot,basis,containerOrigin:o,width,height,scale:parseFloat(css.scale)||1,translate:css.translate};
  } finally { for(const el of nodes) el.remove(); }
}

export function createDecorationEditor({getProject,getBasis,renderPreview,send,isBlocked=()=>false,onActive=()=>{}}) {
  let selection, gesture, geometry, currentElement, frame, disposed=false;
  const root=document.createElement('div');root.id='tts-decoration-editor';root.dataset.ttsUi='';root.style.cssText='position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:none!important;';
  const sheet=document.createElement('style');sheet.textContent=`#tts-decoration-editor .tts-edit-bar{position:fixed;top:8px;left:8px;max-width:calc(100vw - 16px);padding:8px 12px;border:1px solid #ffffff30;border-radius:6px;background:#17191df5;color:#e7e8ea;font:12px/1.6 "Segoe UI",sans-serif;pointer-events:auto;display:flex;gap:12px;align-items:center;flex-wrap:wrap}#tts-decoration-editor button{all:unset;cursor:pointer;padding:6px 10px;min-height:24px;border:1px solid #ffffff30;border-radius:4px;color:#e7e8ea;background:#25282e}#tts-decoration-editor :focus-visible{outline:2px solid #e6aa64;outline-offset:3px}#tts-decoration-editor svg{position:fixed;inset:0;width:100vw;height:100vh;overflow:visible;pointer-events:none}#tts-decoration-editor [data-action]{pointer-events:all;touch-action:none;cursor:move}#tts-decoration-editor [data-action=scale]{cursor:nwse-resize}`;
  const canvas=svgNode('svg',{'aria-label':'装饰画面编辑'}), guide=svgNode('path',{fill:'none',stroke:'#a0a4ad','stroke-dasharray':'4 4','vector-effect':'non-scaling-stroke'});
  canvas.style.setProperty('touch-action','none','important');root.style.setProperty('touch-action','none','important');
  const box=svgNode('polygon',{fill:'#e6aa6408',stroke:'#e6aa64','stroke-width':'2','vector-effect':'non-scaling-stroke','data-action':'move',tabindex:'0',role:'button','aria-label':'拖动装饰，方向键微调'});
  const anchor=svgNode('circle',{r:'5',fill:'#17191d',stroke:'#e6aa64'}), handle=svgNode('circle',{r:'9',fill:'#e6aa64',stroke:'#17191d','data-action':'scale',tabindex:'0',role:'button','aria-label':'等比缩放装饰'});
  const bar=document.createElement('div');bar.className='tts-edit-bar';const label=document.createElement('span'),info=document.createElement('span'),finish=document.createElement('button');finish.textContent='返回工作台';finish.addEventListener('click',()=>stop());bar.append(label,info,finish);
  canvas.append(guide,box,anchor,handle);root.append(sheet,canvas,bar);document.body.append(root);
  function notify(text) { info.textContent=text; send('decoration-editor-status',{id:selection?.id,active:!!selection,message:text,width:innerWidth,height:innerHeight}); }
  function layerState() {
    const project=getProject(),layer=project?.decorations.find(l=>l.id===selection?.id),slot=project?.recipe?.slots.find(s=>s.id===layer?.slotId);
    if(!layer||!slot||layer.locked||!layer.visible||!slot.geometry) throw new Error('图层已删除、锁定、隐藏或不可定位。');
    if(effectiveLayer(project,layer,selection.scope).props.frame==='container') throw new Error('此边框随容器伸展，请在长文适配中调整切片与边宽。');
    if(isBlocked(layer.id))throw new Error('真实宿主已占用此插槽，请先修复所有权。');
    if(slot.condition&&!matchMedia(slot.condition).matches) throw new Error('插槽条件尚未命中：'+slot.condition);
    const breakpoint=project.breakpoints.find(b=>b.id===selection.scope);
    if(breakpoint&&!matchMedia(breakpoint.condition).matches) throw new Error('编辑断点尚未命中：'+breakpoint.condition);
    if(selection.scope==='base'&&project.breakpoints.some(b=>matchMedia(b.condition).matches&&Object.keys(layer.overrides[b.id]||{}).length)) throw new Error('当前视口有图层覆盖，请选择命中的尺寸编辑。');
    if(decorationDiagnostics(project).some(d=>d.layerId===layer.id&&d.level==='error')) throw new Error('插槽冲突，先在工作台修复。');
    const elements=[...document.querySelectorAll(slot.selector)].filter(el=>!el.closest('[data-tts-ui]')&&!slot.exclude?.some(s=>el.matches(s)));
    const element=elements.find(el=>{const r=el.getBoundingClientRect();return (el===document.body||r.width&&r.height)&&r.bottom>=0&&r.top<=innerHeight;});
    if(!element) throw new Error('当前画面没有可见目标，展开部件后重新定位。');
    return {project,layer,slot,element,count:elements.length};
  }
  function draw() {
    if(!selection||disposed) return;
    geometry=undefined;
    try {
      const {layer,slot,element,count}=layerState();currentElement=element;geometry=measureDecoration(element,slot.pseudo);
      box.setAttribute('points',geometry.corners.map(p=>`${p.x},${p.y}`).join(' '));
      for(const [node,p] of [[anchor,geometry.pivot],[handle,geometry.corners[2]]]) {node.setAttribute('cx',node===handle?Math.min(innerWidth-10,Math.max(10,p.x)):p.x);node.setAttribute('cy',node===handle?Math.min(innerHeight-10,Math.max(10,p.y)):p.y);}
      guide.setAttribute('d',`M0 ${geometry.pivot.y}H${innerWidth}M${geometry.pivot.x} 0V${innerHeight}`);
      label.textContent=`${layer.name} · ${selection.scope} · ${count} 个匹配`;notify('拖动 / 等比缩放 · 方向键 1px · Shift 10px · Esc 取消');
    } catch(error) {box.setAttribute('points','');handle.setAttribute('cx','-100');guide.setAttribute('d','');notify(error.message);}
  }
  function start(data) {
    stop();selection={id:data.id,scope:data.scope||'base'};
    try { if(!sameBasis(data.basis,getBasis())) throw new Error('工程基线已变化，请重新定位图层。'); layerState(); root.style.setProperty('display','block','important');onActive(true);draw();box.focus(); }
    catch(error) {stop();send('error',{error:error.message});}
  }
  function begin(kind) {
    if(gesture) return;
    const {project,layer}=layerState();draw();
    if(!geometry) throw new Error('装饰几何不可用。');
    const props=effectiveLayer(project,layer,selection.scope).props;
    if(geometry.translate!=='none'&&!props.anchor&&props.x===undefined&&props.y===undefined) throw new Error('源码已有独立 translate，请先声明锚点或在源码配方中处理。');
    gesture={kind,project:structuredClone(project),basis:structuredClone(getBasis()),id:layer.id,scope:selection.scope,props:{...(selection.scope==='base'?layer.props:layer.overrides[selection.scope])},effective:props,element:currentElement,geometry:structuredClone(geometry),draft:null};
  }
  function draft(patch) {
    const props={...gesture.props,...patch};gesture.draft=props;
    renderPreview(applyCommand(gesture.project,{type:'decoration-update',id:gesture.id,scope:gesture.scope,patch:{props}}));draw();
  }
  function cancel(message) { if(!gesture)return;gesture=null;renderPreview(getProject());draw();if(message)notify(message); }
  function commit() {
    if(!gesture)return;const saved=gesture;gesture=null;
    if(!sameBasis(saved.basis,getBasis())) {renderPreview(getProject());draw();notify('工程更新，此次操作已取消。');return;}
    if(saved.draft&&JSON.stringify(saved.draft)!==JSON.stringify(saved.props)) send('decoration-commit',{id:saved.id,scope:saved.scope,props:saved.draft,basis:saved.basis});
    else renderPreview(getProject());
  }
  const down=e=>{
    if(e.button!==0||!selection)return;
    try {begin(e.target.dataset.action);gesture.pointer=e.pointerId;gesture.initial={x:e.clientX,y:e.clientY};e.target.setPointerCapture(e.pointerId);e.preventDefault();e.target.focus();}
    catch(error){notify(error.message);}
  };
  const move=e=>{
    if(!gesture||gesture.pointer!==e.pointerId)return;e.preventDefault();
    try {
      if(gesture.kind==='scale') {
        const ratio=scaleRatio(gesture.geometry.basis,gesture.geometry.pivot,gesture.initial,{x:e.clientX,y:e.clientY});
        draft({scale:Math.min(10,Math.max(.05,(gesture.effective.scale??gesture.geometry.scale)*ratio))});
      } else {const delta=localDelta(gesture.geometry.basis,e.clientX-gesture.initial.x,e.clientY-gesture.initial.y);draft({x:(gesture.effective.x||0)+delta.x,y:(gesture.effective.y||0)+delta.y});}
    } catch(error){cancel(error.message);}
  };
  for(const el of [box,handle]) {el.addEventListener('pointerdown',down);el.addEventListener('pointermove',move);el.addEventListener('pointerup',e=>{if(gesture?.pointer===e.pointerId)commit();});el.addEventListener('pointercancel',()=>cancel('触摸操作已取消。'));}
  const key=e=>{
    if(!selection||e.target.matches('input,textarea,[contenteditable]'))return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(gesture)cancel('此次操作已取消。');else stop();return;}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||![box,handle].includes(document.activeElement))return;
    e.preventDefault();e.stopImmediatePropagation();try {begin('keyboard');const step=e.shiftKey?10:1,props=gesture.draft||gesture.effective;draft({x:(props.x||0)+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),y:(props.y||0)+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0)});}catch(error){notify(error.message);}
  };
  const keyup=e=>{if(gesture?.kind==='keyboard'&&e.key.startsWith('Arrow'))commit();};
  root.addEventListener('touchstart',e=>{if(e.target.dataset.action)e.preventDefault();},{passive:false});root.addEventListener('touchmove',e=>{if(gesture)e.preventDefault();},{passive:false});
  function refresh(event) {if(frame||!selection)return;const moved=event===true||['scroll','resize'].includes(event?.type);frame=requestAnimationFrame(()=>{frame=null;if(gesture){let changed=moved;try{const {element,slot}=layerState(),measured=measureDecoration(element,slot.pseudo);changed ||= element!==gesture.element||['a','b','c','d'].some(k=>Math.abs(measured.basis[k]-gesture.geometry.basis[k])>.001)||['x','y'].some(k=>Math.abs(measured.containerOrigin[k]-gesture.geometry.containerOrigin[k])>.5);}catch{changed=true;}if(changed)cancel('容器滚动、变换或重绘，此次操作已取消。');}draw();});}
  function stop() {cancel();selection=undefined;geometry=undefined;currentElement=undefined;root.style.setProperty('display','none','important');onActive(false);send('decoration-editor-status',{active:false});}
  window.addEventListener('keydown',key,true);window.addEventListener('keyup',keyup,true);window.addEventListener('resize',refresh);window.addEventListener('scroll',refresh,true);
  return {start,stop,refresh,update(){if(gesture&&!sameBasis(gesture.basis,getBasis()))cancel('工程更新，此次操作已取消。');if(selection)draw();},receive(data){if(data.type==='decoration-commit-result'&&!data.ok){renderPreview(getProject());draw();notify(data.error||'保存失败，此次预览已恢复。');}},dispose(){stop();disposed=true;if(frame)cancelAnimationFrame(frame);window.removeEventListener('keydown',key,true);window.removeEventListener('keyup',keyup,true);window.removeEventListener('resize',refresh);window.removeEventListener('scroll',refresh,true);root.remove();}};
}
