import { TARGETS } from '/shared/core.js';
import { LAYOUT_FIELDS, LAYOUT_TARGETS } from '/shared/layouts.js';
const $=s=>document.querySelector(s),node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
const captions={block:'普通块',flex:'Flex',grid:'Grid',row:'横向',column:'纵向',nowrap:'保持一行',wrap:'允许换行',stretch:'拉伸',start:'起边',center:'居中',end:'末边','space-between':'两端对齐','space-around':'环绕间距','space-evenly':'等距'};
export function attachLayouts({getState,command,toast,getSelected}) {
  let scope='base',target='stage',viewport;
  const button=node('button','▥ 布局与断点');button.id='layouts-button';$('.studio-tools').append(button);
  const dialog=node('dialog');dialog.id='layouts-dialog';dialog.className='wide-dialog';dialog.innerHTML=`<form method="dialog" class="dialog-header"><h2>布局与断点</h2><button aria-label="关闭布局与断点">×</button></form><div class="dialog-body"><p id="layout-viewport" class="panel-hint"></p><div class="layer-fields"><label class="layer-field">受控容器<select id="layout-target"></select></label><label class="layer-field">编辑尺寸<select id="layout-scope"></select></label></div><div id="layout-fields" class="layer-fields"></div><p class="panel-hint">只修改 CSS 容器属性，不重排原生 DOM。先检查发送与抽屉行为；撤销可恢复。重叠断点按列表顺序覆盖。</p><h3>命名断点</h3><div id="breakpoint-list"></div><form id="breakpoint-add" class="workflow-form"><label>中文名称<input id="breakpoint-name" required maxlength="80"></label><label>条件<select id="breakpoint-kind"><option value="max">宽度不超过</option><option value="min">宽度不少于</option></select><input id="breakpoint-width" type="number" min="1" max="99999" value="1000" required aria-label="断点宽度 px">px</label><button>新增断点</button></form><button id="breakpoint-recipe" type="button">从配方建立实际断点</button></div>`;document.body.append(dialog);
  for(const t of TARGETS.filter(t=>LAYOUT_TARGETS.includes(t.id))) $('#layout-target').add(new Option(t.name,t.id));
  const act=async cmd=>{try{await command(cmd);render();}catch(e){toast(e.message,true);}};
  function render(force=false) {
    if(!dialog.open)return;const p=getState().project;
    if(!Object.hasOwn(p.rules,scope))scope='base';$('#layout-target').value=target;
    $('#layout-scope').replaceChildren(new Option('所有尺寸','base'));for(const b of p.breakpoints)$('#layout-scope').add(new Option(`${b.name} · ${b.condition}`,b.id));$('#layout-scope').value=scope;
    $('#layout-viewport').textContent=viewport?`真实宿主 ${viewport.width} × ${viewport.height}px；命中 ${p.breakpoints.filter(b=>{const m=b.condition.match(/(min|max)-width: (\d+)/);return m[1]==='min'?viewport.width>=Number(m[2]):viewport.width<=Number(m[2]);}).map(b=>b.name).join(' / ')||'基础尺寸'}`:'连接真实宿主后显示实际尺寸。';
    const fields=$('#layout-fields');if(force||!fields.contains(document.activeElement)){
      fields.replaceChildren();
      for(const f of LAYOUT_FIELDS){const own=p.rules[scope][target]?.[f.key],base=p.rules.base[target]?.[f.key],wrap=node('label');wrap.className='layer-field';wrap.append(node('span',f.label));const input=node(f.values?'select':'input');input.id='layout-'+f.key;
        if(f.values){input.add(new Option('沿用主题/基础',''));for(const v of f.values)input.add(new Option(captions[v]||v,v));}else input.placeholder=scope!=='base'&&base?`继承 ${base}`:'沿用主题';input.value=own||'';
        input.addEventListener('change',()=>{const value=input.value.trim();act({type:'set',scope,target,property:f.key,value:value||null});});wrap.append(input);fields.append(wrap);
      }
    }
    const list=$('#breakpoint-list');if(list.contains(document.activeElement))return;list.replaceChildren();
    for(const b of p.breakpoints){const row=node('div');row.className='breakpoint-row';row.append(node('b',b.name),node('code',b.condition));if(b.id!=='mobile'){const remove=node('button','删除此断点和覆盖（可撤销）');remove.addEventListener('click',()=>act({type:'breakpoints',breakpoints:getState().project.breakpoints.filter(x=>x.id!==b.id)}));row.append(remove);}else row.append(node('small','旧工程 767px 条件保留'));list.append(row);}
  }
  button.addEventListener('click',()=>{if(LAYOUT_TARGETS.includes(getSelected()))target=getSelected();dialog.showModal();render(true);});
  $('#layout-target').addEventListener('change',e=>{target=e.target.value;render(true);});$('#layout-scope').addEventListener('change',e=>{scope=e.target.value;render(true);});
  $('#breakpoint-add').addEventListener('submit',e=>{e.preventDefault();const b={id:'bp-'+crypto.randomUUID(),name:$('#breakpoint-name').value,condition:`(${$('#breakpoint-kind').value}-width: ${Number($('#breakpoint-width').value)}px)`};act({type:'breakpoints',breakpoints:[...getState().project.breakpoints,b]});});
  $('#breakpoint-recipe').addEventListener('click',()=>{const p=getState().project,list=[...p.breakpoints];for(const s of p.recipe?.slots||[])if(s.condition&&!list.some(b=>b.condition===s.condition))list.push({id:'bp-'+crypto.randomUUID(),name:s.group+' · '+s.condition,condition:s.condition});act({type:'breakpoints',breakpoints:list});});
  return {render,receive(data){if(data.type==='viewport'){viewport=data;render();}else if(data.type==='disconnected'){viewport=undefined;render();}}};
}
