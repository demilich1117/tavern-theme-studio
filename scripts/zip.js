import { deflateRawSync, inflateRawSync } from 'node:zlib';
const table = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
export function crc32(bytes) { let crc = 0xffffffff; for (const b of bytes) crc = table[(crc ^ b) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
export function zipFiles(files) {
  const chunks = [], central = []; let offset = 0;
  for (const [filename, bytes] of files) {
    if (!/^[\w./-]+$/.test(filename) || filename.startsWith('/') || filename.split('/').includes('..')) throw new Error('Unsafe ZIP path');
    const name = Buffer.from(filename), packed = deflateRawSync(bytes), crc = crc32(bytes);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, packed);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(8, 10); entry.writeUInt16LE(33, 14); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, name); offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
// Used only to smoke-test our generated archives, not as a user upload parser.
export function readGeneratedZip(zip) {
  const files = []; let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8), size = zip.readUInt32LE(offset + 18), unpacked = zip.readUInt32LE(offset + 22), length = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
    const name = zip.toString('utf8', offset + 30, offset + 30 + length), start = offset + 30 + length + extra;
    if (unpacked > 64 * 1024 * 1024) throw new Error('Unexpectedly large package member');
    const data = zip.subarray(start, start + size), bytes = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 }) : null;
    if (!bytes || bytes.length !== unpacked || crc32(bytes) !== zip.readUInt32LE(offset + 14)) throw new Error('ZIP integrity failure: ' + name);
    files.push([name, bytes]); offset = start + size;
  }
  if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('Missing ZIP directory');
  return files;
}
