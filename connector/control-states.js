import { controlVisible, auditControls, waitForVisualStability } from './visual-checks.js';

// Temporary native DOM states only. Never dispatch input/change/click or call generation.
export function createControlStateCheck({ allowed, idle, identity = () => null, doc = document, audit = auditControls, wait = waitForVisualStability }) {
  let active;
  function cancel() { active?.abort(); active?.restore?.(); }
  async function run() {
    if(active)throw new Error('控件检查正在运行');
    const initialIdentity=identity(), unchanged=()=>allowed()&&identity()===initialIdentity;
    if(!unchanged() || !await idle())throw new Error('请在空闲的专用测试对话运行控件检查');
    if(doc.querySelector('#form_sheld.isExecutingCommandsFromChatInput') || doc.querySelector('#send_textarea')?.value.trim() || doc.querySelector('.edit_textarea,.reasoning_edit_textarea'))throw new Error('请先结束脚本执行、未提交输入或消息编辑');
    if(!unchanged() || active)throw new Error('测试环境已改变，请重试');
    const controller=new AbortController(); active=controller;
    const modal=doc.querySelector('dialog[open]');
    const checks=[...doc.querySelectorAll('input[type="checkbox"]')].filter(el=>(!modal||modal.contains(el))&&controlVisible(el)&&!el.closest('[data-tts-ui]')).slice(0,12);
    const checkboxStates=checks.map(el=>({el,checked:el.checked,disabled:el.disabled,indeterminate:el.indeterminate}));
    const form=doc.querySelector('#form_sheld'), stop=doc.querySelector('#mes_stop'), send=doc.querySelector('#send_but');
    const composer=form&&stop&&send;
    const classes=composer?['isExecutingCommandsFromChatInput','script_paused'].map(key=>[key,form.classList.contains(key)]):[];
    const generating=doc.body.getAttribute('data-generating'), stopHadStyle=stop?.hasAttribute('style'), display=stop?.style.getPropertyValue('display'), priority=stop?.style.getPropertyPriority('display'), hidden=send?.classList.contains('displayNone');
    const restore=()=>{
      for(const {el,checked,disabled,indeterminate} of checkboxStates){el.checked=checked;el.disabled=disabled;el.indeterminate=indeterminate;}
      if(composer){for(const [key,value]of classes)form.classList.toggle(key,value);if(generating===null)doc.body.removeAttribute('data-generating');else doc.body.setAttribute('data-generating',generating);if(display)stop.style.setProperty('display',display,priority);else stop.style.removeProperty('display');if(!stopHadStyle&&!stop.style.cssText)stop.removeAttribute('style');send.classList.toggle('displayNone',hidden);}
    };
    controller.restore=restore;
    // An attempted interaction cancels and restores first, then consumes that event.
    const interrupt=e=>{controller.abort();restore();e.preventDefault();e.stopImmediatePropagation();};
    for(const type of ['pointerdown','click','keydown','submit'])doc.addEventListener(type,interrupt,true);
    doc.defaultView.addEventListener('pagehide',cancel);
    const results=[];
    try {
      for(const state of ['unchecked','checked','disabled','idle','generating','executing','paused']){
        if(controller.signal.aborted||!unchanged()||!await idle())throw new Error('环境或操作发生变化，已取消并恢复控件');
        if(controller.signal.aborted||!unchanged())throw new Error('检查已取消');
        restore();
        if(['unchecked','checked','disabled'].includes(state)){
          if(!checks.length){results.push({state,checks:[{name:'复选框',status:'skip',detail:'请先打开含复选框的原生抽屉或弹窗'}]});continue;}
          for(const el of checks){el.checked=state!=='unchecked';el.disabled=state==='disabled';el.indeterminate=false;}
        }else{
          if(modal){results.push({state,checks:[{name:'输入区',status:'skip',detail:'模态弹窗打开时不检查背景输入区，请关闭弹窗后再运行'}]});continue;}
          if(!composer){results.push({state,checks:[{name:'输入区',status:'skip',detail:'宿主未提供所需原生控件'}]});continue;}
          doc.body.dataset.generating=String(state==='generating');
          form.classList.toggle('isExecutingCommandsFromChatInput',['executing','paused'].includes(state));
          form.classList.toggle('script_paused',state==='paused');
          stop.style.display=state==='generating'?'flex':'none';send.classList.remove('displayNone');
        }
        const stability=await wait({doc,timeout:700,signal:controller.signal});
        if(!unchanged()||controller.signal.aborted)throw new Error('检查已取消');
        const report=audit();
        if(composer&&['idle','generating','executing','paused'].includes(state)){
          const expected={idle:['send_but'],generating:['mes_stop'],executing:['stscript_pause','stscript_stop'],paused:['stscript_continue','stscript_stop']}[state];
          for(const id of ['send_but','mes_stop','stscript_pause','stscript_continue','stscript_stop']){
            const el=doc.getElementById(id);
            report.checks.push({name:id,status:!el?'skip':controlVisible(el)===expected.includes(id)?'pass':'warn',detail:!el?'宿主没有此控件':expected.includes(id)?'此状态应显示':'此状态应隐藏'});
          }
        }
        results.push({state,stability,...report});
      }
      return {scene:'native-control-states',viewport:{width:doc.defaultView.innerWidth,height:doc.defaultView.innerHeight},createdAt:new Date().toISOString(),states:results,checks:results.flatMap(r=>[...(r.stability&&!r.stability.stable?[{name:r.state,status:'warn',detail:'等待画面稳定超时，结果需复查'}]:[]),...r.checks.map(c=>({...c,name:r.state+' / '+c.name}))]),limitations:'临时复现原生外观状态；不执行模型生成或脚本，不保存设置；复选框最多采样 12 个。'};
    }finally{
      restore();for(const type of ['pointerdown','click','keydown','submit'])doc.removeEventListener(type,interrupt,true);
      doc.defaultView.removeEventListener('pagehide',cancel);if(active===controller)active=null;
    }
  }
  return {run,cancel};
}
