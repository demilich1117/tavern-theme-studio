import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from '../server.js';
import { createAssetStore } from '../src/asset-store.js';
import { createProject } from '../shared/core.js';
const exec = promisify(execFile);
const table = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function chunk(type, bytes) { const head = Buffer.alloc(4); head.writeUInt32BE(bytes.length); const data = Buffer.concat([Buffer.from(type), bytes]); let crc = 0xffffffff; for (const b of data) crc = table[(crc ^ b) & 255] ^ (crc >>> 8); const tail = Buffer.alloc(4); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0); return Buffer.concat([head, data, tail]); }
function png() { const header = Buffer.alloc(13); header.writeUInt32BE(3000); header.writeUInt32BE(2000, 4); header[8] = 8; header[9] = 2; const pixels = randomBytes(9001 * 2000); for (let row = 0; row < 2000; row++) pixels[row * 9001] = 0; return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels, { level: 0 })), chunk('IEND', Buffer.alloc(0))]); }
test('over-48-MiB engineering backup restores through per-file CLI transfers and rejects corruption before project mutation', { timeout: 60000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tts-files-')); let source, target;
  try {
    const dir = path.join(root, 'source'), store = await createAssetStore(dir), refs = [];
    for (let i = 0; i < 3; i++) refs.push((await store.put(png(), `large-${i}`)).reference);
    const project = createProject({ name: '大工程测试', custom_css: refs.map((ref, i) => `.test-${i}{background:url("${ref}")}`).join('\n') });
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(project));
    source = await createServer({ dataDir: dir, port: 0 }); target = await createServer({ dataDir: path.join(root, 'target'), port: 0 });
    const cli = (address, ...args) => exec(process.execPath, ['scripts/cli.js', ...args], { env: { ...process.env, STUDIO_URL: address }, windowsHide: true });
    const backup = path.join(root, 'backup'); await cli(source.address, 'backup-files', backup);
    const manifest = JSON.parse(await readFile(path.join(backup, 'manifest.json'), 'utf8')); assert.ok(manifest.assets.reduce((n, a) => n + a.bytes, 0) > 48 * 1048576);
    await cli(target.address, 'restore-files', backup);
    const restored = await (await fetch(target.address + '/api/project')).json(); assert.deepEqual(restored.project, project);
    await writeFile(path.join(backup, manifest.assets.at(-1).path), 'corrupted');
    await assert.rejects(cli(target.address, 'restore-files', backup), /校验失败/);
    assert.deepEqual((await (await fetch(target.address + '/api/project')).json()).project, project);
  } finally { await source?.close(); await target?.close(); await rm(root, { recursive: true, force: true }); }
});
