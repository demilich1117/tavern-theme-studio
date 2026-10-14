import { TARGETS } from '../shared/core.js';
import { blueprintProject, validateBlueprint } from '../shared/blueprint.js';
import { sameCanvasBasis } from '../shared/canvas.js';
import { captureAnchor } from './annotations.js';
import { targetElement } from './diagnostics.js';

const node=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
const rectOf=el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};};

// Blueprint owns only an in-memory draft and history. Picking, geometry,
// dragging and CSS rendering are shared with actual-layout editing.
export function createBlueprintEditor({shadow,bar,selection,getProject,getBasis,getScope,renderPreview,fixtureActive,send,reveal,notify}) {
  const style=node('style');style.textContent=`.bp-tools{display:flex;flex-wrap:wrap;gap:4px;align-items:center;flex-basis:100%;border-top:1px solid #ffffff24;padding-top:4px}.bp-summary{font:12px/1.5 "Segoe UI",sans-serif;color:#9acbdf;flex-basis:100%}.bp-tools input:not([type=checkbox]){min-height:40px;min-width:120px;flex:1;padding:6px 10px;border:1px solid #ffffff30;border-radius:6px;background:#25282e;color:#e7e8ea;font:13px/1.4 "Segoe UI",sans-serif}.bp-grid{position:fixed;inset:0;pointer-events:none;background:radial-gradient(#9acbdf55 1px,transparent 1px);background-size:24px 24px}`;
  const tools=node('div');tools.className='bp-tools';tools.hidden=true;
  const summary=node('span');summary.className='bp-summary';
  const note=node('input');note.setAttribute('aria-label','选中部件的蓝图备注');note.placeholder='此类部件的备注（拖动后选填）';note.maxLength=1000;
  const undo=node('button','撤销摆放'),redo=node('button','重做摆放'),remove=node('button','还原此类部件'),gridLabel=node('label'),gridCheck=node('input');gridCheck.type='checkbox';gridLabel.append(gridCheck,'辅助网格');
  const historyTools=node('div');historyTools.className='bp-history';historyTools.hidden=true;
  historyTools.append(undo,redo);bar.parentElement.before(historyTools);
  tools.append(summary,note,remove,gridLabel);bar.append(tools);
  const grid=node('div');grid.className='bp-grid';grid.hidden=true;shadow.prepend(style,grid);
  let enabled=false,key,board={items:[],past:[],future:[]};const boards=new Map();
  const current=()=>{try{return board.items.find(i=>i.anchor.target===selection().target.id&&i.scope===getScope());}catch{return undefined;}};
  const remember=()=>{board.past.push(structuredClone(board.items));if(board.past.length>60)board.past.shift();board.future=[];};
  const project=()=>blueprintProject(getProject(),board.items);
  function apply(){renderPreview(enabled?project():getProject());}
  function sync(){
    const next=`${getBasis()?.projectId}:${innerWidth}x${innerHeight}`;if(next===key)return false;
    if(key)boards.set(key,board);key=next;board=boards.get(key)||{items:[],past:[],future:[],basis:structuredClone(getBasis())};return true;
  }
  function rebase(){
    const basis=getBasis();if(!basis||sameCanvasBasis(board.basis,basis))return;
    renderPreview(getProject());
    board.items=board.items.filter(i=>Object.hasOwn(getProject().rules,i.scope));
    for(const item of board.items){const target=TARGETS.find(t=>t.id===item.anchor.target),el=targetElement(target).element;if(!el)continue;item.before=rectOf(el);item.anchor=captureAnchor(target,el,{clientX:item.before.left+item.before.width/2,clientY:item.before.top+item.before.height/2},fixtureActive());}
    board.basis=structuredClone(basis);board.past=[];board.future=[];
  }
  function render(){
    tools.hidden=historyTools.hidden=!enabled;grid.hidden=!enabled||!gridCheck.checked;if(!enabled)return;
    const item=current();summary.textContent=`蓝图 · 已调整 ${board.items.length} 类部件 · 同类一起变化 · 未写入主题`;
    note.disabled=remove.disabled=!item;if(shadow.activeElement!==note)note.value=item?.note||'';
    undo.disabled=!board.past.length;redo.disabled=!board.future.length;
  }
  function changed(message){apply();render();notify(message||`蓝图已暂存 ${board.items.length} 类部件；可继续选择和拖动，最后保存整张蓝图。`);}
  function history(action){const from=action==='undo'?board.past:board.future,to=action==='undo'?board.future:board.past;if(!from.length)return;to.push(structuredClone(board.items));board.items=from.pop();changed();}
  undo.addEventListener('click',()=>history('undo'));redo.addEventListener('click',()=>history('redo'));
  remove.addEventListener('click',()=>{const item=current();if(!item)return;remember();board.items=board.items.filter(i=>i!==item);changed();});
  note.addEventListener('change',()=>{const item=current();if(!item)return;remember();item.note=note.value;changed('部件备注已暂存，可与整张蓝图一起保存。');});gridCheck.addEventListener('change',render);
  return {project,render,history,count:()=>board.items.length,
    activate(value){const switched=value!==enabled;enabled=value;if(enabled){const resized=sync();if(switched||resized){rebase();apply();notify(`蓝图 · ${board.items.length} 类已调整；直接选择并拖动，同类一起变化。`);}}else if(switched)apply();render();},
    historyState:()=>({canUndoBlueprint:!!board.past.length,canRedoBlueprint:!!board.future.length}),
    canRecord:()=>!!current()||board.items.length<30,
    update(){if(!enabled)return;sync();rebase();apply();render();},
    selected:render,
    record({selection:s,scope,props,anchor}){
      remember();let item=board.items.find(i=>i.scope===scope&&i.anchor.target===s.target.id);
      if(!item){item={id:`${scope}-${s.target.id}`,scope,anchor,before:s.rect,after:rectOf(s.el),props:{},note:''};board.items.push(item);}
      item.props={...item.props,...props};item.after=rectOf(s.el);board.basis=structuredClone(getBasis());changed();
    },
    clear(){if(!board.items.length)return;remember();board.items=[];changed('蓝图已清空，原布局已恢复；可撤销。');},
    save(){
      if(!board.items.length)throw new Error('先直接拖动部件，再保存蓝图；不需要逐个加入。');
      const items=board.items.map(item=>{const target=TARGETS.find(t=>t.id===item.anchor.target),matches=targetElement(target).matches;const el=matches.find(e=>e.closest('.mes')?.getAttribute('mesid')===String(item.anchor.messageIndex))||matches[item.anchor.occurrence],r=el?rectOf(el):null;return {...item,after:r?.width&&r.height?r:item.after};});
      const canvas=validateBlueprint({kind:'blueprint',viewport:{width:innerWidth,height:innerHeight},appearance:gridCheck.checked?'wireframe':'content',items});
      send('annotation',{anchor:items[0].anchor,canvas,basis:board.basis});reveal();
    },
    saved(){notify(`整张蓝图已保存（${board.items.length} 类部件）；可继续调整并保存下一版。`);},
    dispose(){if(enabled){enabled=false;apply();}style.remove();grid.remove();tools.remove();historyTools.remove();}
  };
}
