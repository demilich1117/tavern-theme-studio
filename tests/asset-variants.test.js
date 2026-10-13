import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAssetStore } from '../src/asset-store.js';
import { createVariants } from '../src/asset-variants.js';
test('static variants preserve originals and immutable identity; animations are not flattened', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tts-variants-'));
  try {
    const assets = await createAssetStore(dataDir), variants = await createVariants(dataDir, assets);
    const original = await readFile(new URL('../public/folio-art/nav-pendant.webp', import.meta.url));
    const a = await assets.put(original), info = await variants.inspect(a.id); assert.equal(info.width, 160); assert.equal(info.height, 240);
    const saved = await variants.put(a.id, original, 'thumbnail'); assert.equal(saved.id, a.id); assert.deepEqual((await assets.read(a.id)).bytes, original);
    const gif = Buffer.from('47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b', 'hex');
    const animated = await assets.put(gif); assert.equal((await variants.inspect(animated.id)).animated, true);
    await assert.rejects(variants.put(animated.id, original, 'optimized'), /动画/);
    const reload = await createVariants(dataDir, assets); assert.equal(reload.list()[0].originalId, a.id);
    await assets.archive([animated.id], true); assert.equal(assets.list().find(a=>a.id===animated.id).archived,true); assert.deepEqual((await assets.read(animated.id)).bytes, gif);
    await assets.archive([animated.id], false); assert.equal(assets.list().find(a=>a.id===animated.id).archived,false);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
