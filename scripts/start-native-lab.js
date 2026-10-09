import path from 'node:path';
import { createServer } from '../server.js';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = process.env.STUDIO_DATA_DIR || path.join(root, '.local/native-lab');
const seedPath = process.argv[2];
const app = await createServer({ dataDir, seedPath, port: Number(process.env.STUDIO_PORT || 19323) });
const host = new URL(process.env.TAVERN_URL || 'http://127.0.0.1:8000');
host.hash = new URLSearchParams({ 'tts-lab': '', studio: app.address }).toString();
console.log(`Native test workbench: ${host.href}\nStudio API: ${app.address}\nProject: ${dataDir}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
