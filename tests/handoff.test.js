import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../server.js';
import { formatAgentHandoff } from '../shared/handoff.js';
import { validateTicketResult } from '../shared/tickets.js';
import { readArtifact } from '../src/ticket-review.js';
const anchor = { target: 'assistant', occurrence: 0, point: { x: .5, y: .5 }, viewport: { width: 1440, height: 900 }, rect: { left: 0, top: 10, width: 900, height: 60 }, fixture: true };
test('handoff copies only explicit receipts with complete CLI context and excludes secrets/chat/HTML', () => {
  const id = 'a'.repeat(32), other = 'b'.repeat(32);
  const text = formatAgentHandoff([{ id, number: 1, version: 3, comment: '调整留白', state: 'open', scope: 'base', token: 'secret-ticket', anchor: { ...anchor, html: 'private-html', chat: 'private-chat', avatar: 'private-avatar' }, basis: { projectId: 'project', snapshotId: 'c'.repeat(32), fingerprint: 'd'.repeat(64), token: 'secret-basis' } }], { address: 'http://127.0.0.1:19323', studioPath: "D:\\RUA\\O'Brien", projectPath: 'D:\\RUA\\theme', version: '0.5.0', token: 'secret-session', current: { projectId: 'project', name: '工程', revision: 9, fingerprint: 'e'.repeat(64) }, queue: [other] });
  for (const value of ['secret-ticket', 'private-html', 'private-chat', 'private-avatar', 'secret-basis', 'secret-session', other]) assert.equal(text.includes(value), false);
  for (const value of [id, 'c'.repeat(32), 'ticket-claim', 'ticket-review', '#fixture-status', 'revision：9', "'D:\\RUA\\O''Brien'"]) assert.ok(text.includes(value), value);
  assert.throws(() => formatAgentHandoff([], {}));
});
test('structured results require a real baseline, distinguish verification and discard unrelated payloads', () => {
  const result = validateTicketResult({ summary: '已调整', baseline: { projectId: 'project', revision: 3, fingerprint: 'a'.repeat(64), token: 'private' }, checks: [{ name: '真实宿主', status: 'passed', detail: '虚构测试状态与计算值已检查' }], unverified: ['真实流式'], artifacts: [{ label: '报告', reference: 'output/report.json' }], html: 'private' });
  assert.equal(result.summary, '已调整'); assert.equal(JSON.stringify(result).includes('private'), false);
  assert.throws(() => validateTicketResult({ summary: 'done' }));
  assert.throws(() => validateTicketResult({ summary: 'done', baseline: { projectId: 'p', revision: 1, fingerprint: 'a'.repeat(64) }, checks: [{ name: 'x', status: 'guess', detail: 'x' }] }));
});
test('compact handoff retains explicit IDs, live-read instructions and fixture boundaries', () => {
  const ticket = { id: 'f'.repeat(32), number: 4, comment: '修改圆角', state: 'open', anchor, basis: { projectId: 'p' } };
  const context = { current: { projectId: 'p' }, address: 'http://127.0.0.1:19323', projectPath: '/theme', studioPath: '/studio' };
  const compact = formatAgentHandoff([ticket], context, { compact: true });
  for (const text of [ticket.id, 'basis.snapshotId', '#fixture-status', '不遍历其他票', '不发真实消息', '修改圆角', '待验收']) assert.ok(compact.includes(text), text);
  assert.ok(compact.length < formatAgentHandoff([ticket], context).length);
});

test('blueprint handoff preserves per-item scopes and class-wide intent in full and compact formats', () => {
  const canvas = { kind: 'blueprint', viewport: anchor.viewport, items: ['avatar', 'name'].map((target, i) => ({
    id: `part-${i}`, anchor: { ...anchor, target }, scope: i ? 'base' : 'mobile',
    props: { 'margin-left': `${8 + i}px` }, before: anchor.rect, after: { ...anchor.rect, left: 8 + i }, note: `调整 ${target}`,
  })) };
  const ticket = { id: 'f'.repeat(32), number: 1, comment: '调整整张蓝图', state: 'open', anchor, canvas, basis: { projectId: 'p' } };
  const context = { current: { projectId: 'p' }, address: 'http://127.0.0.1:19323', projectPath: '/theme', studioPath: '/studio' };
  const full = formatAgentHandoff([ticket], context);
  const receipt = JSON.parse(full.split('```json\n')[1].split('\n```')[0])[0];
  assert.deepEqual(receipt.canvas.items.map(i => [i.scope, i.props, i.appliesTo]), [
    ['mobile', { 'margin-left': '8px' }, 'matching-elements'], ['base', { 'margin-left': '9px' }, 'matching-elements'],
  ]);
  for (const compact of [false, true]) {
    const handoff = formatAgentHandoff([ticket], context, { compact });
    for (const concept of ['docs/canvas-mode.md', 'items[]', 'scope', 'props', 'matching-elements', 'layout-intent', '不重复应用']) assert.ok(handoff.includes(concept), concept);
  }
  assert.equal(canvas.items[0].appliesTo, undefined, 'handoff must not mutate the source draft');
});
test('artifact preview rejects arbitrary files, traversal and active document types', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  for (const reference of ['package.json', 'output/../package.json', '../outside.png', 'https://example.org/x.png', 'output/page.html', 'output/script.svg']) {
    await assert.rejects(readArtifact(root, { resultDetails: { artifacts: [{ reference }] } }, 0), /预览支持/);
  }
});
test('evidence permits declared output files but rejects symlinked files and output roots', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tts-evidence-'));
  try {
    const project = path.join(dir, 'project'), outside = path.join(dir, 'outside');
    await mkdir(path.join(project, 'output'), { recursive: true }); await mkdir(outside);
    await writeFile(path.join(project, 'output/proof.txt'), 'synthetic evidence'); await writeFile(path.join(outside, 'secret.txt'), 'not public');
    const ticket = reference => ({ resultDetails: { artifacts: [{ label: 'proof', reference }] } });
    assert.equal((await readArtifact(project, ticket('output/proof.txt'), 0, true)).content.toString(), 'synthetic evidence');
    await symlink(outside, path.join(project, 'output/link'), 'junction');
    await assert.rejects(readArtifact(project, ticket('output/link/secret.txt'), 0), /超出/);
    const second = path.join(dir, 'second'); await mkdir(second); await symlink(outside, path.join(second, 'output'), 'junction');
    await assert.rejects(readArtifact(second, ticket('output/secret.txt'), 0), /重定向/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('frozen review differences survive later edits and stale acceptance requires acknowledgement', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tts-review-'));
  const app = await createServer({ dataDir: dir, port: 0 });
  const get = async route => (await fetch(app.address + route)).json();
  const post = async (route, value) => { const s = await get('/api/session'); return fetch(app.address + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': s.token }, body: JSON.stringify({ ...s, ...value }) }); };
  try {
    const ticket = await (await post('/api/tickets', { anchor, comment: 'Isolated review test' })).json(), route = '/api/tickets/' + ticket.id;
    const claimed = await (await post(route, { action: 'claim', owner: 'test', version: 1 })).json();
    await post('/api/commands', { command: { type: 'set', target: 'assistant', property: 'border-radius', value: '12px' } });
    const reviewed = await (await post(route, { action: 'review', owner: 'test', version: claimed.version, result: 'Synthetic result' })).json();
    assert.ok(claimed.claimedBasis.snapshotId && reviewed.completedBasis.snapshotId);
    const before = await get(route + '/review'); assert.equal(before.stale, false);
    assert.equal(before.changes.find(c => c.path === 'base/assistant/border-radius').after, '12px');
    await post('/api/commands', { command: { type: 'set', target: 'assistant', property: 'border-radius', value: '16px' } });
    const after = await get(route + '/review'); assert.equal(after.stale, true); assert.deepEqual(after.changes, before.changes);
    assert.equal((await post(route, { action: 'accept', version: reviewed.version })).status, 409);
    assert.equal((await get(route)).state, 'review');
    assert.equal((await post(route, { action: 'accept', version: reviewed.version, acknowledgeChanged: true })).status, 200);
    assert.equal((await get(route)).state, 'done');
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
test('renamed projects keep tickets, same-name imports cannot claim, structured review persists', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tts-handoff-'));
  let app = await createServer({ dataDir: dir, port: 0 });
  const get = async route => (await fetch(app.address + route)).json();
  const post = async (route, body) => { const session = await get('/api/session'); return fetch(app.address + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': session.token }, body: JSON.stringify({ revision: session.revision, sessionId: session.sessionId, projectId: session.projectId, fingerprint: session.fingerprint, ...body }) }); };
  try {
    const ticket = await (await post('/api/tickets', { anchor, comment: '调整留白' })).json();
    await post('/api/commands', { command: { type: 'rename', name: '改名' } }); const renamed = await get('/api/project');
    assert.equal(ticket.basis.projectId, renamed.projectId);
    await post('/api/commands', { command: { type: 'import-theme', theme: { name: '改名', custom_css: '' } } });
    assert.equal((await post(`/api/tickets/${ticket.id}`, { action: 'claim', version: 1, owner: 'agent' })).status, 409);
    await post('/api/commands', { command: { type: 'import-project', project: renamed.project } });
    const claimed = await (await post(`/api/tickets/${ticket.id}`, { action: 'claim', version: 1, owner: 'agent' })).json();
    const current = await get('/api/project');
    const reviewed = await (await post(`/api/tickets/${ticket.id}`, { action: 'review', version: claimed.version, owner: 'agent', result: { summary: '修改并检查', baseline: current, checks: [{ name: '计算值', status: 'passed', detail: '测试结果' }], unverified: ['流式'], artifacts: [{ label: '证据', reference: 'output/proof.png' }] } })).json();
    assert.equal(reviewed.state, 'review'); assert.equal(reviewed.resultDetails.baseline.projectId, current.projectId);
    await app.close(); app = await createServer({ dataDir: dir, port: 0 });
    assert.deepEqual((await get(`/api/tickets/${ticket.id}`)).resultDetails, reviewed.resultDetails);
    const context = await get('/api/handoff-context'); assert.equal(context.current.projectId, current.projectId); assert.equal(context.token, undefined);
  } finally {
    await app.close(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('tts-handoff-')); await rm(dir, { recursive: true, force: true });
  }
});
