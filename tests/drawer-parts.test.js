import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, applyCommand, exportTheme, validateProject, ProjectHistory } from '../shared/core.js';
import { canvasPatch, createCanvasRound, recordCanvasRound, canvasRestorePlan } from '../shared/canvas.js';
import { targetPath } from '../shared/object-tree.js';
import { supportsField } from '../shared/editing.js';
import { pickCandidates } from '../connector/picking.js';

test('drawer geometry uses viewport coordinates and fixed height, survives save and round restore', () => {
  const initial = { drawer: true, scaleX: .5, scaleY: .5, parentWidth: 30, width: 600, height: 400, marginLeft: 0, marginTop: 0, left: 20, top: 30 };
  const move = canvasPatch(initial, 'move', 40, 15);
  assert.deepEqual(move, { left: '100px', top: '60px' });
  assert.deepEqual(canvasPatch(initial, 'move', 40, 0, true), { left: '104px', top: '30px' });
  assert.deepEqual(canvasPatch(initial, 'resize', 100, -50), { width: '800px', height: '300px' });
  const history = new ProjectHistory(createProject());
  const state = () => ({projectId:'test',sessionId:'test',project:history.project});
  const round = createCanvasRound(state());
  const command = {type:'canvas-set',target:'drawer-settings',props:{...move,width:'800px',height:'300px'}};
  history.execute(command,history.revision); recordCanvasRound(round,state(),command);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(history.project))),history.project);
  const css = exportTheme(history.project).custom_css;
  assert.match(css, /position: fixed/); assert.match(css,/min-width: 0/); assert.match(css,/right: auto/);
  assert.match(css,/height: 300px/); assert.doesNotMatch(css,/display:/);
  assert.match(css, /#user-settings-block:not\(\.maximized\)/);
  history.execute({type:'canvas-restore',changes:canvasRestorePlan(round,state()).changes},history.revision);
  assert.equal(history.project.rules.base['drawer-settings'],undefined);
  history.execute({type:'undo'},history.revision);
  assert.equal(history.project.rules.base['drawer-settings'].left,'100px');
});

test('control overrides stay in their drawer and breakpoint; thumb rules stay separate for browser compatibility', () => {
  let p = createProject();
  for (const [target,property,value] of [['drawer-settings-thumb','width','23px'],['drawer-settings-thumb','border-width','2px'],['drawer-settings-tick','--tts-tick-shape','diamond'],['drawer-settings-tick','background-color','#ff0000']]) p=applyCommand(p,{type:'set',scope:'mobile',target,property,value});
  const css=exportTheme(p).custom_css;
  assert.match(css,/@media \(max-width: 767px\)/);
  assert.match(css, /input\[type="range"\]::-webkit-slider-thumb \{/);
  assert.match(css, /input\[type="range"\]::-moz-range-thumb \{/);
  assert.doesNotMatch(css, /thumb,|#rm_extensions_block/);
  assert.match(css,/border-style: solid/); assert.match(css,/clip-path: polygon\(50% 0/);
  assert.match(css,/box-shadow: none/); assert.doesNotMatch(css,/transform: scale/);
  assert.throws(()=>applyCommand(p,{type:'set',target:'drawer-settings-tick',property:'--tts-tick-shape',value:'bad; color:red'}));
  assert.throws(()=>applyCommand(p,{type:'set',target:'assistant',property:'height',value:'100px'}));
});

test('controls are picked before their drawer and expose related detail paths and only relevant fields', () => {
  const checkbox={matches:()=>false,closest:s => s === '#user-settings-block input[type="checkbox"]' ? checkbox : s === '#user-settings-block' ? drawer : null};
  const drawer={};
  assert.deepEqual(pickCandidates(checkbox).map(h=>h.target.id),['drawer-settings-checkbox','drawer-settings']);
  assert.deepEqual(targetPath('drawer-settings-tick').map(t=>t.id),['global','drawer-settings','drawer-settings-checkbox','drawer-settings-tick']);
  assert(supportsField('drawer-settings','height')); assert(supportsField('drawer-settings','top'));
  assert(supportsField('drawer-settings-tick','--tts-tick-shape')); assert(!supportsField('drawer-settings-checkbox','--tts-tick-shape'));
  assert(!supportsField('drawer-settings-thumb','margin-top')); assert(!supportsField('assistant-message-text','height'));
});
