import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canvasPatch, sameCanvasBasis, validateCanvasProposal, canvasAvailability, createCanvasRound, recordCanvasRound, canvasRestorePlan, canvasHandleCenters } from '../shared/canvas.js';
import { ProjectHistory, createProject, applyCommand, exportTheme, validateProject } from '../shared/core.js';
import { createServer } from '../server.js';
import { publicReceipt } from '../shared/handoff.js';
import { blueprintProject } from '../shared/blueprint.js';

const initial = { scaleX: .5, scaleY: .5, parentWidth: 800, width: 640, height: 200, marginLeft: 0, marginTop: 16 };
test('canvas handles remain separate and within phone edges at fitted and enlarged zoom', () => {
  for (const scale of [.35, .65, 1, 2]) {
    const size=40/scale, half=size/2;
    for (const [left,top] of [[0,0],[180,100],[380,830],[-20,-10]]) {
      const {move,resize}=canvasHandleCenters({left,top,width:12,height:8},{width:390,height:844,size});
      assert(Math.abs(move.x-resize.x)>=size || Math.abs(move.y-resize.y)>=size);
      for (const point of [move,resize]) {
        assert(point.x>=half && point.x<=390-half);
        assert(point.y>=half && point.y<=844-half);
      }
    }
  }
});
test('canvas availability explains stale host scripts, comparison and disconnected preview', () => {
  const connected = { ready: true, live: true, fixtureActive: true, capabilities: { canvasEditor: 1, canvasWorkflow: 1 } };
  assert.deepEqual(canvasAvailability(connected), { disabled: false, reason: '' });
  const stale = canvasAvailability({ ...connected, capabilities: { directEditing: 1 } });
  assert(stale.disabled); assert.match(stale.reason, /刷新整个酒馆标签/);
  const comparing = canvasAvailability({ ...connected, comparing: true });
  assert(!comparing.disabled);
  const disconnected = canvasAvailability({ ...connected, ready: false });
  assert(disconnected.disabled); assert.match(disconnected.reason, /连接/);
  const noFixture = canvasAvailability({ ...connected, fixtureActive: false });
  assert(!noFixture.disabled); assert.match(noFixture.reason, /自动打开虚构测试对话/);
  assert.deepEqual(canvasAvailability({ ...connected, live: false, fixtureActive: false }), { disabled: false, reason: '' });
});
test('one canvas round restores across targets and scopes atomically and can undo the restore', () => {
  const history = new ProjectHistory(createProject());
  history.execute({ type: 'set', target: 'assistant', property: 'margin-left', value: '3px' }, history.revision);
  const state = () => ({ projectId: 'round-project', sessionId: 'session', project: history.project });
  const round = createCanvasRound(state());
  for (const cmd of [
    { type: 'canvas-set', target: 'assistant', scope: 'base', props: { 'margin-left': '19px' } },
    { type: 'canvas-set', target: 'assistant', scope: 'base', props: { 'margin-left': '27px' } },
    { type: 'canvas-set', target: 'composer', scope: 'mobile', props: { width: '80%' } },
  ]) { history.execute(cmd, history.revision); recordCanvasRound(round, state(), cmd); }
  history.execute({ type: 'set', target: 'assistant', property: 'color', value: '#ffffff' }, history.revision);
  const before = structuredClone(history.project), plan = canvasRestorePlan(round, state());
  assert.equal(plan.changes.length, 2);
  history.execute({ type: 'canvas-restore', changes: plan.changes }, history.revision);
  assert.equal(history.project.rules.base.assistant['margin-left'], '3px');
  assert.equal(history.project.rules.base.assistant.color, '#ffffff');
  assert.equal(history.project.rules.mobile.composer, undefined);
  assert.equal(canvasRestorePlan(round, state()).changes.length, 0);
  history.execute({ type: 'undo' }, history.revision); assert.deepEqual(history.project, before);
  assert.equal(canvasRestorePlan(round, state()).changes.length, 2);
  // After undoing a gesture, its earlier round value is still restorable.
  history.execute({ type: 'set', target: 'assistant', property: 'margin-left', value: '19px' }, history.revision);
  assert.equal(canvasRestorePlan(round, state()).changes.length, 2);
  // A later independent edit on a touched property is preserved.
  history.execute({ type: 'set', target: 'assistant', property: 'margin-left', value: '41px' }, history.revision);
  const concurrent = canvasRestorePlan(round, state());
  assert.equal(concurrent.changes.length, 1); assert.equal(concurrent.conflicts.length, 1);
  const stable = structuredClone(history.project);
  assert.throws(() => history.execute({ type: 'canvas-restore', changes: plan.changes }, history.revision), /新修改/);
  assert.deepEqual(history.project, stable);
  assert.equal(canvasRestorePlan(round, { ...state(), projectId: 'other' }).changes.length, 0);
  assert.equal(canvasRestorePlan(round, { ...state(), sessionId: 'restarted' }).changes.length, 0);
});
test('canvas gestures account for zoom, use flow properties and keep text height flexible', () => {
  assert.deepEqual(canvasPatch(initial, 'move', 16, -16), { 'margin-left': '32px', 'margin-top': '-16px' });
  assert.deepEqual(canvasPatch(initial, 'resize', 40, 16), { width: '90%', 'min-height': '232px' });
  assert.deepEqual(canvasPatch(initial, 'resize', 9000, -9000), { width: '100%', 'min-height': '0px' });
  assert.deepEqual(canvasPatch(initial, 'resize', -40, 0), { width: '70%' });
  assert.deepEqual(canvasPatch(initial, 'move', 16, 0), { 'margin-left': '32px' });
  assert.deepEqual(canvasPatch({ ...initial, pixelWidth: true, width: 48 }, 'resize', 8, 0), { width: '64px' });
  assert.throws(() => canvasPatch({ ...initial, scaleX: 0 }, 'move', 1, 1));
  assert.throws(() => canvasPatch(initial, 'move', NaN, 1));
});
test('canvas, inspector and exported CSS share one reversible state across responsive scopes', () => {
  const h = new ProjectHistory(createProject());
  h.execute({ type: 'canvas-set', target: 'assistant', scope: 'mobile', props: { 'margin-left': '16px', 'margin-top': '8px', width: '88%', 'min-height': '220px' } }, 0);
  assert.equal(h.past.length, 1);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(h.project))), h.project);
  h.execute({ type: 'set', scope: 'mobile', target: 'assistant', property: 'margin-left', value: '24px' }, 1);
  assert.match(exportTheme(h.project).custom_css, /@media \(max-width: 767px\)/);
  assert.match(exportTheme(h.project).custom_css, /margin-left: 24px/);
  assert.doesNotMatch(exportTheme(h.project).custom_css, /(?:^|\n)  (?:height|position|transform):/);
  h.execute({ type: 'undo' }, 2); assert.equal(h.project.rules.mobile.assistant['margin-left'], '16px');
  h.execute({ type: 'undo' }, 3); assert.deepEqual(h.project.rules.mobile, {});
  h.execute({ type: 'redo' }, 4); assert.equal(h.project.rules.mobile.assistant.width, '88%');
  h.execute({type:'breakpoints',breakpoints:[...h.project.breakpoints,{id:'desktop',name:'仅电脑',condition:'(min-width: 768px)'}]},5);
  h.execute({type:'canvas-set',target:'assistant',scope:'desktop',props:{width:'68%','margin-left':'32px'}},6);
  assert.equal(h.project.rules.mobile.assistant.width,'88%');
  assert.equal(h.project.rules.desktop.assistant.width,'68%');
  assert.match(exportTheme(h.project).custom_css,/@media \(min-width: 768px\)/);
  h.execute({type:'undo'},7);assert.deepEqual(h.project.rules.desktop,{});assert.equal(h.project.rules.mobile.assistant.width,'88%');
  assert.throws(() => applyCommand(h.project, { type: 'canvas-set', target: 'global', props: { 'margin-left': '20px' } }));
  assert.throws(() => applyCommand(h.project, { type: 'canvas-set', target: 'assistant', props: { position: 'absolute' } }));
  assert.throws(() => applyCommand(h.project, { type: 'canvas-set', target: 'assistant', props: { 'margin-top': '9000px' } }));
});
test('avatar geometry never translates both image and container; basis comparison rejects stale gestures', () => {
  const p = applyCommand(createProject(), { type: 'canvas-set', target: 'avatar', props: { 'margin-left': '12px' } });
  assert.match(exportTheme(p).custom_css, /#chat \.mes \.avatar \{\n  margin-left: 12px/);
  assert.doesNotMatch(exportTheme(p).custom_css, /img/);
  const basis = { projectId: 'a', sessionId: 'b', revision: 1, fingerprint: 'c' };
  assert(sameCanvasBasis(basis, { ...basis })); assert(!sameCanvasBasis(basis, { ...basis, revision: 2 })); assert(!sameCanvasBasis(null, basis));
});

test('blueprint drafts use identical class-wide CSS and scoped geometry commands without changing the saved project',()=>{
  const project=createProject(),before=structuredClone(project);
  const items=[{scope:'mobile',anchor:{target:'avatar'},props:{'margin-left':'16px',width:'72px'}},{scope:'mobile',anchor:{target:'name'},props:{'margin-top':'8px'}}];
  const actual=items.reduce((p,i)=>applyCommand(p,{type:'canvas-set',scope:i.scope,target:i.anchor.target,props:i.props}),project);
  const draft=blueprintProject(project,items);
  assert.deepEqual(draft,actual);assert.deepEqual(project,before);
  const css=exportTheme(draft).custom_css;
  assert.match(css,/#chat \.mes \.avatar \{\n  margin-left: 16px/);
  assert.match(css,/#chat \.mes \.name_text \{\n  margin-top: 8px/);
  assert.match(css,/@media \(max-width: 767px\)/);assert.doesNotMatch(css,/mesid|nth-child/);
  assert.deepEqual(blueprintProject(project,items.slice(0,1)).rules.mobile.name,undefined);
  assert.equal(exportTheme(blueprintProject(project,[])).custom_css,exportTheme(before).custom_css);
});
test('layout proposals persist with tickets and handoff but never enter theme CSS', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tts-canvas-')); let app;
  try {
    app = await createServer({ dataDir: dir, port: 0, runtimeHome: path.join(dir, 'runtime') });
    const get = async route => (await fetch(app.address + route)).json();
    const s = await get('/api/session');
    const canvas = { kind: 'layout-intent', before: { left: 10, top: 10, width: 100, height: 100 }, after: { left: 80, top: 40, width: 180, height: 120 }, html: '<script>bad</script>' };
    const anchor = { target: 'assistant', point: { x: .5, y: .5 }, viewport: { width: 1000, height: 800 }, rect: canvas.before };
    const response = await fetch(app.address + '/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': s.token }, body: JSON.stringify({ revision: s.revision, projectId: s.projectId, sessionId: s.sessionId, fingerprint: s.fingerprint, comment: '移动到右侧', anchor, canvas }) });
    assert.equal(response.status, 200); const ticket = await response.json();
    assert.deepEqual(ticket.canvas, validateCanvasProposal(canvas)); assert.equal(publicReceipt(ticket).canvas.after.left, 80);
    assert.equal(ticket.canvas.html, undefined); assert.equal((await get('/api/project')).fingerprint, s.fingerprint);
    assert.throws(() => validateCanvasProposal({ ...canvas, after: { ...canvas.after, width: -1 } }));
    await app.close(); app = await createServer({ dataDir: dir, port: 0, runtimeHome: path.join(dir, 'runtime') });
    assert.equal((await get('/api/tickets'))[0].canvas.after.width, 180);
  } finally { await app?.close(); assert.equal(path.dirname(dir), os.tmpdir()); assert(path.basename(dir).startsWith('tts-canvas-')); await rm(dir, { recursive: true, force: true }); }
});

test('multi-part blueprints retain all anchors and notes across persistence without HTML or CSS changes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tts-blueprint-')); let app;
  try {
    app = await createServer({ dataDir: dir, port: 0, runtimeHome: path.join(dir, 'runtime') });
    const s = await (await fetch(app.address + '/api/session')).json();
    const rect = {left:10,top:180,width:120,height:80};
    const anchor = target => ({target,occurrence:0,fixture:true,point:{x:.5,y:.5},viewport:{width:390,height:844},rect});
    const canvas = {kind:'blueprint',viewport:{width:390,height:844},appearance:'content',html:'private markup',items:['avatar','name','message-text'].map((target,i)=>({id:'part-'+i,scope:'mobile',props:{'margin-left':`${i*8}px`},anchor:anchor(target),before:rect,after:{...rect,left:i*80,top:200+i*100},note:'部件 '+i,html:'not stored',image:'data:image/png;base64,ignored'}))};
    const response = await fetch(app.address + '/api/tickets',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':s.token},body:JSON.stringify({revision:s.revision,projectId:s.projectId,sessionId:s.sessionId,fingerprint:s.fingerprint,anchor:anchor('avatar'),canvas,comment:'手机整图布局'})});
    assert.equal(response.status,200);const ticket=await response.json();assert.equal(ticket.canvas.items.length,3);assert.equal(publicReceipt(ticket).canvas.items[2].note,'部件 2');
    assert.equal(ticket.canvas.items[1].appliesTo,'matching-elements');assert.equal(ticket.canvas.items[1].scope,'mobile');assert.deepEqual(ticket.canvas.items[1].props,{'margin-left':'8px'});
    assert.throws(()=>validateCanvasProposal({...canvas,items:[{...canvas.items[0],props:{position:'fixed'}}]}));
    assert(!JSON.stringify(ticket.canvas).includes('private markup'));assert(!JSON.stringify(ticket.canvas).includes('data:image'));assert.equal((await (await fetch(app.address+'/api/project')).json()).fingerprint,s.fingerprint);
    assert.throws(()=>validateCanvasProposal({...canvas,items:[]}));assert.throws(()=>validateCanvasProposal({...canvas,items:[canvas.items[0],canvas.items[0]]}));assert.throws(()=>validateCanvasProposal({...canvas,viewport:{width:-1,height:844}}));assert.throws(()=>validateCanvasProposal({...canvas,items:[{...canvas.items[0],anchor:anchor('invalid')}] }));
    await app.close();app=await createServer({dataDir:dir,port:0,runtimeHome:path.join(dir,'runtime')});const saved=(await (await fetch(app.address+'/api/tickets')).json())[0];assert.deepEqual(saved.canvas,validateCanvasProposal(canvas));
  } finally {await app?.close();assert.equal(path.dirname(dir),os.tmpdir());assert(path.basename(dir).startsWith('tts-blueprint-'));await rm(dir,{recursive:true,force:true});}
});
