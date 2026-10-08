// Build-time format conversion only. Preserve generated alpha and all original paintings.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require(process.argv[2]);
const root = path.resolve(__dirname, '../examples/moonveil-covenant/assets/night');
(async () => {
  const entries = [
    ['dragon-perch', 'dragon-perch', 940, 62],
    ['avatar-talons-v2', 'avatar-talons', 200, 72],
    ['silver-frame', 'silver-frame', 400, 68],
    ['castle-night', 'castle-night', 900, 46],
    ['right-talons', 'right-talons', 128, 68],
  ];
  const report = [];
  for (const [input, output, width, quality] of entries) {
    const info = await sharp(path.join(root, `${input}.original.png`)).resize({ width }).webp({ quality, alphaQuality:90, effort:6 }).toFile(path.join(root, `${output}.webp`));
    report.push({ file:`${output}.webp`, ...info });
  }
  await fs.writeFile(path.join(root, 'encoding.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
})().catch(e => { console.error(e); process.exitCode=1; });
