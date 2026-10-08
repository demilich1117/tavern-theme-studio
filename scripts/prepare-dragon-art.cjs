// Development-only asset encoding. Uses a locally supplied Sharp installation, not a runtime dependency.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require(process.argv[2]);
async function main() {
  const root = path.resolve(__dirname, '../examples/moonveil-covenant');
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  const source = process.argv[3];
  const version = process.argv[4] || '';
  await fs.copyFile(source, path.join(root, `assets/dragon-keyart${version}.original.png`));
  const result = await sharp(source).webp({ quality: 74, effort: 6 }).toFile(path.join(root, `assets/dragon-keyart${version}.webp`));
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

