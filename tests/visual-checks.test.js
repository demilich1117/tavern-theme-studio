import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, finiteRunning, waitForVisualStability } from '../connector/visual-checks.js';
import { createControlStateCheck } from '../connector/control-states.js';

test('contrast reports opaque solid colors and declines unknown or transparent colors',()=>{
  assert.equal(contrastRatio('rgb(255, 255, 255)','rgb(255, 255, 255)'),1);
  assert.equal(contrastRatio('rgb(255, 255, 255)','rgb(0, 0, 0)'),21);
  assert.equal(contrastRatio('rgba(255, 255, 255, 0.4)','rgb(0, 0, 0)'),null);
  assert.equal(contrastRatio('color(srgb 1 1 1)','rgb(0, 0, 0)'),null);
});
test('visual settling ignores infinite animation, waits finite motion, bounds loading fonts',async()=>{
  const animation={playState:'running',effect:{getTiming:()=>({iterations:Infinity})}};
  assert.equal(finiteRunning(animation),false);
  const doc={querySelectorAll:()=>[],getAnimations:()=>[animation],fonts:{status:'loaded'}};
  assert.equal((await waitForVisualStability({doc,timeout:600})).stable,true);
  animation.effect.getTiming=()=>({iterations:1});assert.equal(finiteRunning(animation),true);
  assert.equal((await waitForVisualStability({doc,timeout:100})).stable,false);
  animation.playState='finished';assert.equal((await waitForVisualStability({doc,timeout:600})).stable,true);
  doc.fonts.status='loading';assert.equal((await waitForVisualStability({doc,timeout:100})).stable,false);
  const controller=new AbortController();controller.abort();await assert.rejects(waitForVisualStability({doc,signal:controller.signal}),/取消/);
});
test('native checkbox probes restore values and listeners on completion, failure and cancellation',async()=>{
  const original=globalThis.getComputedStyle;globalThis.getComputedStyle=()=>({visibility:'visible'});
  try {
    const listeners=new Map(), el={checked:false,disabled:true,indeterminate:true,getClientRects:()=>[{}],getBoundingClientRect:()=>({width:20}),closest:()=>null};
    const doc={querySelector:()=>null,querySelectorAll:()=>[el],body:{getAttribute:()=>null},defaultView:{innerWidth:390,innerHeight:844,addEventListener(){},removeEventListener(){}},addEventListener:(t,f)=>listeners.set(t,f),removeEventListener:t=>listeners.delete(t)};
    const config={doc,allowed:()=>true,idle:async()=>true,wait:async()=>({stable:true}),audit:()=>({checks:[]})};
    const states=[];const checker=createControlStateCheck({...config,audit:()=>{states.push([el.checked,el.disabled,el.indeterminate]);return{checks:[]};}});
    const result=await checker.run();assert.equal(result.states.length,7);assert.deepEqual(states,[[false,false,false],[true,false,false],[true,true,false]]);
    assert.deepEqual([el.checked,el.disabled,el.indeterminate],[false,true,true]);assert.equal(listeners.size,0);
    await assert.rejects(createControlStateCheck({...config,audit:()=>{throw new Error('measurement failed');}}).run(),/measurement failed/);
    assert.deepEqual([el.checked,el.disabled,el.indeterminate],[false,true,true]);assert.equal(listeners.size,0);
    let cancelCheck;cancelCheck=createControlStateCheck({...config,wait:async()=>{cancelCheck.cancel();return{stable:true};}});
    await assert.rejects(cancelCheck.run(),/取消/);assert.equal(el.disabled,true);assert.equal(el.indeterminate,true);assert.equal(listeners.size,0);
    await assert.rejects(createControlStateCheck({...config,allowed:()=>false}).run(),/专用测试/);
    let chat='first';const switched=createControlStateCheck({...config,identity:()=>chat,wait:async()=>{chat='second';return{stable:true};}});
    await assert.rejects(switched.run(),/取消/);assert.deepEqual([el.checked,el.disabled,el.indeterminate],[false,true,true]);assert.equal(listeners.size,0);
  }finally{globalThis.getComputedStyle=original;}
});
