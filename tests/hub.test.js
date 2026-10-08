import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAssetStore } from '../asset-store.js';
import { createHubClient } from '../hub-client.js';

test('Hub caches verified immutable bytes, rejects corrupt data, strips tokens and survives offline restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tts-hub-'));
  const image = await readFile(new URL('../public/folio-art/nav-pendant.webp', import.meta.url));
  const hash = createHash('sha256').update(image).digest('hex');
  const a = { id: hash, hash, path: 'assets/test/1/image.webp', name: '测试', collection: 'test', version: '1', bytes: image.length, ext: 'webp', mime: 'image/webp', committed: true };
  let corrupt = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/hub.json') return res.end(JSON.stringify({ mode: 'local', token: 'never-cache-this', repository: 'owner/repo', commit: 'a'.repeat(40) }));
    if (req.url === '/catalog.json') return res.end(JSON.stringify({ schemaVersion: 1, revision: 1, assets: [a] }));
    res.setHeader('Content-Type', 'image/webp'); res.end(corrupt ? Buffer.from('broken') : image);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const assets = await createAssetStore(dir), hub = await createHubClient(dir, assets);
    await hub.refresh(`http://127.0.0.1:${server.address().port}`);
    assert.equal(hub.status().assets[0].cached, false);
    corrupt = true; await assert.rejects(hub.fetchAsset(hash), /图片|请选择/);
    corrupt = false; await hub.fetchAsset(hash);
    assert.equal(hub.status().assets[0].cached, true);
    assert.equal(hub.status().assets[0].verification, null);
    const text = await readFile(path.join(dir, 'hub-cache.json'), 'utf8'); assert.ok(!text.includes('never-cache-this'));
    await new Promise(r => server.close(r));
    const reopened = await createHubClient(dir, assets); await reopened.refresh();
    assert.equal(reopened.status().offline, true); assert.equal(reopened.status().assets[0].cached, true);
    assert.equal((await reopened.fetchAsset(hash)).reference, `tts-asset://${hash}.webp`);
    assert.equal(reopened.candidates({ asset: `tts-asset://${hash}.webp` })[0].verified, false);
    await assert.rejects(reopened.replace({ asset: `tts-asset://${hash}.webp` }, [hash]), /验证/);
    await assert.rejects(reopened.refresh('http://example.com'), /HTTPS/);
  } finally { server.closeAllConnections(); server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Hub ingestion forwards bytes with fresh token and optimistic revision; conflicts remain errors', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tts-hub-ingest-'));
  const image = await readFile(new URL('../public/folio-art/nav-pendant.webp', import.meta.url));
  let revision = 7, accepted = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/hub.json') return res.end(JSON.stringify({mode:'local',token:'fresh-local-token',repository:'owner/repo',commit:'a'.repeat(40)}));
    if (req.url === '/catalog.json') return res.end(JSON.stringify({schemaVersion:1,revision,assets:[]}));
    const chunks=[]; for await(const c of req)chunks.push(c);
    if(req.headers['if-match']!==String(revision)){res.statusCode=409;return res.end(JSON.stringify({error:'revision conflict'}));}
    assert.equal(req.headers['x-hub-token'],'fresh-local-token'); assert.deepEqual(Buffer.concat(chunks),image);
    assert.equal(new URL(req.url,'http://localhost').searchParams.get('name'),'test image');
    accepted++;revision++;res.end(JSON.stringify({revision}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
    const assets=await createAssetStore(dir),hub=await createHubClient(dir,assets),saved=await assets.put(image,'test.webp');
    await hub.refresh(`http://127.0.0.1:${server.address().port}`);
    await assert.rejects(hub.ingest(saved.id,{name:'test image'},6),/revision conflict/);
    assert.equal(accepted,0);assert.equal((await hub.ingest(saved.id,{name:'test image'},7)).revision,8);assert.equal(accepted,1);
    assert.ok(!(await readFile(path.join(dir,'hub-cache.json'),'utf8')).includes('fresh-local-token'));
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
