import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from '../server.js';
import { createProject, validateProject } from '../shared/core.js';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(root, '.local/native-lab');
await mkdir(dataDir, { recursive: true });
const seedPath = process.argv[2];
if (seedPath) {
  const seed = JSON.parse(await readFile(path.resolve(seedPath), 'utf8'));
  const project = seed.schemaVersion ? validateProject(seed) : createProject(seed);
  try { await writeFile(path.join(dataDir, 'project.json'), JSON.stringify(project, null, 2), { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; console.log('Keeping the existing lab project. Use the Studio import command to change it.'); }
}
const app = await createServer({ dataDir, port: Number(process.env.STUDIO_PORT || 19323) });
const host = new URL(process.env.TAVERN_URL || 'http://127.0.0.1:8000');
host.hash = new URLSearchParams({ 'tts-lab': '', studio: app.address }).toString();
console.log(`Native test workbench: ${host.href}\nStudio API: ${app.address}\nProject: ${dataDir}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
