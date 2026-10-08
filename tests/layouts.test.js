import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createProject, exportTheme, ProjectHistory, validateProject } from '../shared/core.js';
import { localDelta, scaleRatio } from '../shared/layouts.js';
test('measured coordinates invert rotated/scaled containers and uniform scaling ignores screen axes',()=>{
  assert.deepEqual(localDelta({a:0,b:2,c:-3,d:0},-30,20),{x:10,y:10});
  assert.deepEqual(localDelta({a:.75,b:0,c:0,d:.75},15,-30),{x:20,y:-40});
  assert.throws(()=>localDelta({a:0,b:0,c:0,d:0},1,1),/不可逆/);
  assert.equal(scaleRatio({a:0,b:2,c:-3,d:0},{x:0,y:0},{x:-30,y:20},{x:-60,y:40}),2);
});
test('custom scopes retain 767px, compile controlled layouts, discard removed overrides atomically and undo the entire edit',()=>{
  const h=new ProjectHistory(createProject());
  const breakpoints=[...h.project.breakpoints,{id:'tablet',name:'平板',condition:'(max-width: 1000px)'}];
  h.execute({type:'breakpoints',breakpoints},0);
  h.execute({type:'set',target:'stage',scope:'tablet',property:'max-width',value:'90vw'},1);
  h.execute({type:'set',target:'composer',scope:'base',property:'display',value:'flex'},2);
  h.execute({type:'set',target:'composer',scope:'base',property:'gap',value:'8px'},3);
  assert.match(exportTheme(h.project).custom_css,/@media \(max-width: 1000px\)/);assert.match(exportTheme(h.project).custom_css,/#sheld \{\n  max-width: 90vw/);
  const before=structuredClone(h.project);h.execute({type:'breakpoints',breakpoints:breakpoints.slice(0,1)},4);assert(!Object.hasOwn(h.project.rules,'tablet'));
  h.execute({type:'undo'},5);assert.deepEqual(h.project,before);assert.deepEqual(validateProject(JSON.parse(JSON.stringify(before))),before);
  assert.throws(()=>applyCommand(before,{type:'breakpoints',breakpoints:[{id:'mobile',name:'旧',condition:'(max-width: 1000px)'}]}),/767px/);
  assert.throws(()=>applyCommand(before,{type:'set',target:'composer',property:'flex-direction',value:'row-reverse'}),/DOM/);
  assert.throws(()=>applyCommand(before,{type:'set',target:'input',property:'display',value:'grid'}),/容器/);
  assert.throws(()=>applyCommand(before,{type:'set',target:'composer',property:'gap',value:'0; order: -1'}),/单位/);
});
