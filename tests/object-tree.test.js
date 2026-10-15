import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, TARGETS } from '../shared/core.js';
import { targetPath, objectRows } from '../shared/object-tree.js';

test('semantic navigation preserves role ancestry and covers every target exactly once',()=>{
  assert.deepEqual(targetPath('user-code').map(t=>t.id),['global','stage','chat','user','user-message-body','user-message-text','user-code']);
  assert.deepEqual(targetPath('assistant-reasoning').map(t=>t.id),['global','stage','chat','assistant','assistant-message-body','assistant-reasoning-block','assistant-reasoning']);
  assert.deepEqual(targetPath('assistant-avatar').map(t=>t.id),['global','stage','chat','assistant','assistant-avatar']);
  assert.deepEqual(targetPath('avatar').map(t=>t.id),['avatar']);
  const rows=objectRows(createProject(),'base');
  assert.equal(new Set(rows.map(r=>r.target.id)).size,TARGETS.length);
  assert.equal(rows.length,TARGETS.length);
});
test('search keeps parents without pulling in the opposite role; markers use editing scope',()=>{
  const p=createProject();p.rules.mobile['user-avatar']={width:'48px'};
  const before=JSON.stringify(p), rows=objectRows(p,'mobile','用户');
  assert(rows.some(r=>r.target.id==='user'));
  assert(!rows.some(r=>r.target.role==='assistant'||r.target.shared));
  assert.equal(rows.find(r=>r.target.id==='user-avatar').modified,1);
  assert.equal(objectRows(p,'base','用户头像').find(r=>r.target.id==='user-avatar').modified,0);
  assert.equal(JSON.stringify(p),before);
});
