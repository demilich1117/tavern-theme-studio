import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { validateProject, createProject } from './shared/core.js';
import { migrateProject } from './shared/migrations.js';

export const projectFingerprint = project => createHash('sha256').update(JSON.stringify(project)).digest('hex');
export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2)); await rename(temp, file);
}

// Validate every candidate before replacing anything. Original bytes (including
// legacy tickets/snapshots) remain in a migration journal if any write fails.
export async function migrateStorage(dataDir) {
  const sources = new Map();
  async function read(relative, fallback) {
    try { const text = await readFile(path.join(dataDir, relative), 'utf8'); sources.set(relative, text); return JSON.parse(text); }
    catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error(`读取 ${relative} 失败；原数据已保留：${e.message}`); }
  }
  const original = await read('project.json', null);
  const project = original ? validateProject(original) : createProject();
  const currentLegacyHash = original && projectFingerprint(original);
  const candidates = new Map([['project.json', project]]), snapshotMap = new Map();
  let snapshotFiles = [];
  try { snapshotFiles = await readdir(path.join(dataDir, 'snapshots')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const file of snapshotFiles.filter(f => /^[a-f0-9]{32}\.json$/.test(f))) {
    const saved = await read(`snapshots/${file}`);
    const legacyHash = projectFingerprint(saved.project);
    const same = legacyHash === currentLegacyHash;
    const migrated = validateProject(migrateProject(saved.project, { projectId: same ? project.projectId : undefined }));
    snapshotMap.set(saved.id, { legacyHash, projectId: migrated.projectId });
    candidates.set(`snapshots/${file}`, { ...saved, project: migrated, ...(saved.project.schemaVersion < 3 && { identityStatus: same ? 'verified-current' : 'legacy-snapshot-only' }) });
  }
  const tickets = await read('tickets.json', []);
  if (!Array.isArray(tickets)) throw new Error('小票存储格式错误；原数据已保留。');
  candidates.set('tickets.json', tickets.map(ticket => {
    if (ticket.basis?.projectId) return ticket;
    const snapshot = snapshotMap.get(ticket.basis?.snapshotId);
    const verified = snapshot && snapshot.legacyHash === ticket.basis?.fingerprint;
    return { ...ticket, basis: { ...ticket.basis, projectId: verified ? snapshot.projectId : null }, association: verified ? (snapshot.projectId === project.projectId ? 'verified-snapshot' : 'legacy-snapshot-only') : 'needs-location' };
  }));
  const changed = [...candidates].filter(([file, value]) => !sources.has(file) || JSON.stringify(JSON.parse(sources.get(file))) !== JSON.stringify(value));
  if (!changed.length) return { project, recovery: null };
  const relativeRecovery = `migrations/${Date.now()}-${randomUUID()}`;
  const recovery = path.join(dataDir, relativeRecovery);
  await mkdir(recovery, { recursive: true });
  for (const [file, text] of sources) {
    await mkdir(path.dirname(path.join(recovery, file)), { recursive: true });
    await writeFile(path.join(recovery, file), text, { flag: 'wx' });
  }
  await atomicJson(path.join(recovery, 'manifest.json'), { createdAt: new Date().toISOString(), targetSchema: 3, projectId: project.projectId, files: [...sources.keys()], changed: changed.map(([file]) => file) });
  for (const [file, value] of changed) await atomicJson(path.join(dataDir, file), value);
  return { project, recovery: relativeRecovery };
}
