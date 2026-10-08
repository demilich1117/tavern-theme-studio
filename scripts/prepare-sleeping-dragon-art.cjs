// Lossless alpha crop and proportional WebP encoding; no illustration repainting.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');
const root = path.resolve(__dirname, '../examples/moonveil-crescent-folio/assets');
const jobs = [['sleeping-dragon-desktop', 1200, 92], ['sleeping-dragon-mobile', 400, 94], ['scroll-dragon-bookmark', 180, 94]];
(async () => {
  const records = [];
  for (const [name, width, quality] of jobs) {
    const source = path.join(root, 'originals', name + '.png');
    const {data, info} = await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    if (x0 >= x1 || y0 >= y1) throw new Error('Empty alpha silhouette: ' + name);
    const left = Math.max(0, x0 - 5), top = Math.max(0, y0 - 5);
    const crop = {left, top, width: Math.min(info.width, x1 + 6) - left, height: Math.min(info.height, y1 + 6) - top};
    const target = path.join(root, 'production', name + '.webp');
    await sharp(source).extract(crop).resize({width, withoutEnlargement: true}).webp({quality, alphaQuality: 100, effort: 6}).toFile(target);
    const m = await sharp(target).metadata(), stats = await sharp(target).stats();
    if (!m.hasAlpha || stats.channels[3].min !== 0) throw new Error('Missing genuine transparency: ' + name);
    records.push({name, original: {width: info.width, height: info.height}, crop, width: m.width, height: m.height, hasAlpha: true, bytes: (await fs.stat(target)).size});
  }
  const old = JSON.parse(await fs.readFile(path.join(root, 'encoding.json'), 'utf8'));
  await fs.writeFile(path.join(root, 'encoding.json'), JSON.stringify([...old.filter(r => !jobs.some(j => j[0] === r.name)), ...records], null, 2));
  console.log(JSON.stringify(records, null, 2));
})().catch(error => {console.error(error); process.exitCode = 1;});
