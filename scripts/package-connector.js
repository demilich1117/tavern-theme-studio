import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const folder = 'tavern-theme-studio-connector';
const files = { 'manifest.json': 'connector/manifest.json', 'connector/index.js': 'connector/index.js', 'connector/bridge.js': 'connector/bridge.js', 'connector/diagnostics.js': 'connector/diagnostics.js', 'connector/theme-isolation.js': 'connector/theme-isolation.js', 'shared/core.js': 'shared/core.js', 'shared/variables.js': 'shared/variables.js' };
for (const file of ['connector/fixture-host.js', 'shared/fixture.js', 'connector/assets/fixture-user.svg', 'connector/assets/fixture-guide.svg', 'connector/assets/fixture-landscape.svg', 'connector/assets/fixture-note.txt']) files[file] = file;
for (const file of ['connector/annotations.js', 'shared/assets.js', 'shared/tickets.js']) files[file] = file;
files['shared/migrations.js'] = 'shared/migrations.js';
files['shared/decorations.js'] = 'shared/decorations.js';
files['shared/layouts.js'] = 'shared/layouts.js';
files['connector/decoration-editor.js'] = 'connector/decoration-editor.js';
for (const file of ['connector/picking.js', 'connector/native-theme.js', 'shared/editing.js']) files[file] = file;
for (const file of ['shared/version.js', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) files[file] = file;
// Standard ZIP, store method. No runtime or packaging dependencies.
const table = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
const chunks = [], central = []; let offset = 0;
for (const [destination, source] of Object.entries(files)) {
  const target = path.join(root, 'dist', folder, destination); await mkdir(path.dirname(target), { recursive: true }); await copyFile(path.join(root, source), target);
  const bytes = await readFile(target), name = Buffer.from(`${folder}/${destination}`), crc = crc32(bytes);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
  chunks.push(local, name, bytes);
  const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(33, 14); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(bytes.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
  central.push(entry, name); offset += local.length + name.length + bytes.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const zip = path.join(root, 'dist', `${folder}.zip`); await writeFile(zip, Buffer.concat([...chunks, directory, end]));
console.log(`Connector packaged: ${zip}`);
