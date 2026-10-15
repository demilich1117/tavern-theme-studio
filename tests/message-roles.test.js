import test from 'node:test';
import assert from 'node:assert/strict';
import { TARGETS, createProject, applyCommand, exportTheme, validateProject, ProjectHistory } from '../shared/core.js';
import { MESSAGE_PARTS } from '../shared/message-parts.js';
import { blueprintProject, validateBlueprint } from '../shared/blueprint.js';
import { createCanvasRound, recordCanvasRound, canvasRestorePlan, canvasAutoHeight, canvasPatch } from '../shared/canvas.js';
import { validateAnchor } from '../shared/tickets.js';

test('compound message parts keep role and scope through canvas, blueprint, export and undo', () => {
  for (const part of ['reasoning-block', 'message-body', 'media', 'attachments', 'table']) {
    for (const role of ['user', 'assistant']) {
      const target = `${role}-${part}`, h = new ProjectHistory(createProject());
      h.execute({ type: 'canvas-set', target, scope: 'mobile', props: { width: '80%', 'margin-left': '8px' } }, 0);
      const css = exportTheme(h.project).custom_css;
      assert(css.includes(`[is_user="${role === 'user'}"]`)); assert(!css.includes(`[is_user="${role !== 'user'}"]`));
      assert.equal(h.project.rules.base[target], undefined);
      const rect = { left: 0, top: 0, width: 300, height: 40 }, viewport = { width: 390, height: 844 };
      const board = validateBlueprint({ kind: 'blueprint', viewport, items: [{ id: target, scope: 'mobile', props: { width: '75%' }, anchor: { target, viewport, rect, point: { x: .5, y: .5 } }, before: rect, after: rect, note: '' }] });
      assert.equal(blueprintProject(h.project, board.items).rules.mobile[target].width, '75%');
      h.execute({ type: 'undo' }, 1); assert.equal(h.project.rules.mobile[target], undefined);
      assert(canvasAutoHeight(target));
    }
  }
});

test('resizing collapsible and media groups changes width without freezing expanded height', () => {
  const initial = { scaleX: 1, scaleY: 1, parentWidth: 400, width: 300, height: 700, marginLeft: 0, marginTop: 0, autoHeight: true };
  assert.deepEqual(canvasPatch(initial, 'resize', -20, 100), { width: '70%' });
  assert.deepEqual(canvasPatch(initial, 'resize', 0, 100), {});
  assert.deepEqual(canvasPatch(initial, 'move', 0, 10), { 'margin-top': '10px' });
  assert.equal(canvasAutoHeight('assistant-reasoning'), false, 'keep prior inner-text behavior');
});

test('all message subparts have role selectors; avatar geometry and images stay inside that role', () => {
  for (const [role,user] of [['user',true],['assistant',false]]) {
    for (const part of Object.keys(MESSAGE_PARTS)) {
      const target=TARGETS.find(t=>t.id===`${role}-${part}`);
      assert(target);assert(target.selector.split(',').every(s=>s.includes(`[is_user="${user}"]`)));
    }
    let project=applyCommand(createProject(),{type:'canvas-set',target:`${role}-avatar`,props:{'margin-left':'16px',width:'64px'}});
    project=applyCommand(project,{type:'set',target:`${role}-avatar`,property:'border-radius',value:'8px'});
    const css=exportTheme(project).custom_css;
    assert(css.includes(`#chat .mes[is_user="${user}"] .avatar {\n  margin-left: 16px`));
    assert(css.includes(`#chat .mes[is_user="${user}"] .avatar img { width: 100%`));
    assert(!css.includes(`[is_user="${!user}"]`));assert(!css.includes('#chat .mes .avatar'));
    assert(!css.includes('.avatar img {\n  margin-left'));
  }
});

test('legacy shared rules survive import while role edits, undo and round restore stay independent', () => {
  assert.equal(TARGETS.find(t=>t.id==='avatar').elementSelector,undefined,'preserve legacy ticket occurrence indexing');
  const old=applyCommand(createProject(),{type:'canvas-set',target:'avatar',scope:'mobile',props:{width:'48px','margin-left':'8px'}});
  const history=new ProjectHistory(validateProject(JSON.parse(JSON.stringify(old))));
  const state=()=>({projectId:old.projectId,sessionId:'test',project:history.project});
  const round=createCanvasRound(state());
  for(const [target,value] of [['user-avatar','16px'],['assistant-avatar','24px'],['user-message-text','32px']]) {
    const command={type:'canvas-set',target,scope:'mobile',props:{'margin-left':value}};
    history.execute(command,history.revision);recordCanvasRound(round,state(),command);
  }
  assert.deepEqual(history.project.rules.mobile.avatar,old.rules.mobile.avatar);
  assert.equal(history.project.rules.mobile['assistant-message-text'],undefined);
  history.execute({type:'undo'},history.revision);assert.equal(history.project.rules.mobile['user-message-text'],undefined);
  assert.equal(history.project.rules.mobile['assistant-avatar']['margin-left'],'24px');
  const plan=canvasRestorePlan(round,state());history.execute({type:'canvas-restore',changes:plan.changes},history.revision);
  assert.deepEqual(history.project,old);
});

test('blueprints and tickets keep user and character avatars as separate items through export and import', () => {
  const rect={left:10,top:20,width:40,height:40},viewport={width:390,height:844};
  const items=['user-avatar','assistant-avatar'].map((target,i)=>({id:target,scope:'mobile',props:{'margin-left':`${(i+1)*8}px`},anchor:{target,viewport,rect,point:{x:.5,y:.5}},before:rect,after:rect,note:''}));
  const board=validateBlueprint({kind:'blueprint',viewport,items});
  assert.equal(board.items.length,2);
  assert(board.items[0].anchor.selector.includes('[is_user="true"]'));assert(board.items[1].anchor.selector.includes('[is_user="false"]'));
  assert.equal(validateAnchor(board.items[0].anchor).target,'user-avatar');
  const project=createProject(),draft=blueprintProject(project,board.items);
  assert.equal(project.rules.mobile['user-avatar'],undefined);
  assert.equal(draft.rules.mobile['user-avatar']['margin-left'],'8px');assert.equal(draft.rules.mobile['assistant-avatar']['margin-left'],'16px');
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(draft))),draft);
  assert(exportTheme(draft).custom_css.includes('@media (max-width: 767px)'));
});
