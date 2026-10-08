import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../server.js';
import { createAssetStore, mapProjectCss } from '../asset-store.js';
import { createProject, exportTheme } from '../shared/core.js';
import { scanVariables } from '../shared/variables.js';
import { resolveAssetUrls, externalImageUrl } from '../shared/assets.js';
import { validateAnchor } from '../shared/tickets.js';

async function temp(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tts-workflow-'));
  try { await fn(dir); } finally { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('tts-workflow-')); await rm(dir, { recursive: true, force: true }); }
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4r8AAAAASUVORK5CYII=', 'base64');
const inline = `data:image/png;base64,${png.toString('base64')}`;
const anchor = { target: 'assistant-before', occurrence: 2, fixture: true, messageIndex: 3, point: { x: 0.1, y: 0.8 }, viewport: { width: 393, height: 852, dpr: 2 }, rect: { left: 1, top: -10, width: 360, height: 400 }, values: { color: '#123456' } };

test('asset extraction preserves CSS, variable edits, portable backups and immutable data across restart', () => temp(async dir => {
  let store = await createAssetStore(dir);
  const theme = { name: '装饰', custom_css: `:root{--image:url("${inline}");--gap:12px;--second:url('${inline}')} .x{background:var(--image)}` };
  const project = createProject(theme), vars = scanVariables(theme.custom_css);
  project.variableEdits[vars[1].id] = '24px';
  const next = await mapProjectCss(project, store.extract);
  assert.equal(store.list().length, 1, 'duplicate artwork is content-addressed');
  assert.equal(scanVariables(next.baseTheme.custom_css)[1].id in next.variableEdits, true);
  assert.equal(await store.embed(exportTheme(next).custom_css), exportTheme(project).custom_css);
  assert.deepEqual(await store.portableProject(next), project, 'backup is independent of local assets');
  assert.deepEqual(await mapProjectCss(await store.portableProject(next), store.extract), next);
  const id = store.list()[0].id;
  assert.ok(resolveAssetUrls(next.baseTheme.custom_css, 'http://127.0.0.1:19323').includes(`/assets/${id}`));
  store = await createAssetStore(dir); assert.equal(store.list().length, 1); assert.deepEqual((await store.read(id)).bytes, png);
  await assert.rejects(() => store.read('../project.json'));
  await assert.rejects(() => store.put(Buffer.from('<svg onload="evil()"/>')));
  assert.throws(() => externalImageUrl('file:///private.png'));
  assert.throws(() => externalImageUrl('https://user:pass@example.com/x.png'));
  assert.equal(externalImageUrl('https://github.com/owner/art/blob/abcdef/assets/moon.webp?raw=true'), 'https://raw.githubusercontent.com/owner/art/abcdef/assets/moon.webp');
  const remote = await store.external('https://example.com/art.webp', '外链');
  assert.equal(remote.reference, 'https://example.com/art.webp');
  assert.equal(await store.embed('url("https://example.com/art.webp")'), 'url("https://example.com/art.webp")');
}));

test('annotations allow only fixed targets and style fields, never copy DOM/chat payloads', () => {
  const clean = validateAnchor({ ...anchor, selector: '#private', chat: 'secret', html: '<p>secret</p>', values: { color: '#fff', innerText: 'secret' } });
  assert.equal(clean.selector, '#chat .mes[is_user="false"]::before');
  assert.equal(JSON.stringify(clean).includes('secret'), false);
  assert.throws(() => validateAnchor({ ...anchor, target: 'arbitrary-selector' }));
  assert.throws(() => validateAnchor({ ...anchor, point: { x: Infinity, y: 0 } }));
  assert.equal(validateAnchor({ ...anchor, fixture: false }).messageIndex, undefined);
});

test('HTTP large-image import, asset headers, ticket claim races, review and persistence', () => temp(async dir => {
  let app = await createServer({ dataDir: dir, port: 0 });
  try {
    let session = await (await fetch(app.address + '/api/session')).json();
    const get = async route => (await fetch(app.address + route)).json();
    const post = async (route, data, headers = {}) => {
      const current = await get('/api/project');
      return fetch(app.address + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': session.token, ...headers }, body: JSON.stringify({ sessionId: current.sessionId, projectId: current.projectId, fingerprint: current.fingerprint, revision: current.revision, ...data }) });
    };
    assert.equal((await post('/api/tickets', {}, { 'X-Studio-Token': 'bad' })).status, 403);
    assert.equal((await post('/api/assets/link', { url: 'file:///bad' })).status, 400);
    // A valid PNG signature plus a large ancillary payload exercises the transport boundary.
    const large = Buffer.concat([png, Buffer.alloc(1600000)]).toString('base64');
    const importResponse = await post('/api/commands', { revision: 0, command: { type: 'import-theme', theme: { name: '大装饰', custom_css: `:root{--art:url(data:image/png;base64,${large});--gap:12px}` } } });
    assert.equal(importResponse.status, 200);
    const state = await importResponse.json(); assert.ok(state.project.baseTheme.custom_css.length < 300);
    const list = await get('/api/assets'); assert.equal(list.length, 1);
    const image = await fetch(`${app.address}/assets/${list[0].id}`, { headers: { Origin: 'http://127.0.0.1:8000' } });
    assert.equal(image.status, 200); assert.equal(image.headers.get('access-control-allow-origin'), '*'); assert.match(image.headers.get('cache-control'), /immutable/); await image.arrayBuffer();
    assert.ok((await get('/api/theme')).custom_css.includes(large));
    assert.ok((await get('/api/theme?mode=linked')).custom_css.includes(app.address));
    const ticketResponse = await post('/api/tickets', { revision: state.revision, anchor, comment: '测试：月牙小一些', scope: 'mobile' });
    assert.equal(ticketResponse.status, 200); const ticket = await ticketResponse.json();
    assert.equal((await get(`/api/snapshots/${ticket.basis.snapshotId}`)).project.name, '大装饰');
    const endpoint = `/api/tickets/${ticket.id}`;
    const claims = await Promise.all(['agent-a', 'agent-b'].map(owner => post(endpoint, { action: 'claim', version: ticket.version, owner })));
    assert.deepEqual(claims.map(r => r.status).sort(), [200, 409]);
    const claimed = await get(endpoint);
    assert.equal((await post(endpoint, { action: 'review', owner: 'wrong', version: claimed.version, result: 'done' })).status, 409);
    assert.equal((await post(endpoint, { action: 'review', owner: claimed.owner, version: claimed.version, result: '已缩小并检查手机' })).status, 200);
    const reviewed = await get(endpoint); assert.equal(reviewed.state, 'review');
    assert.equal((await post(endpoint, { action: 'accept', version: reviewed.version })).status, 200);
    assert.equal((await post('/api/tickets', { revision: 0, anchor, comment: 'stale' })).status, 409);
    await app.close(); app = await createServer({ dataDir: dir, port: 0 });
    session = await get('/api/session');
    assert.equal((await get(endpoint)).state, 'done'); assert.equal((await get('/api/assets')).length, 1);
    assert.equal((await post(endpoint, { action: 'reopen', version: reviewed.version + 1 })).status, 200);
    assert.equal((await get(endpoint)).state, 'open');
    assert.equal((await readFile(path.join(dir, 'tickets.json'), 'utf8')).includes('测试：月牙小一些'), true);
  } finally { await app.close(); }
}));
