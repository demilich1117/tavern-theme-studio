import path from 'node:path';
import { realpath, stat, readFile } from 'node:fs/promises';
import { diffProjects } from '../shared/diff.js';

const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.json': 'application/json', '.md': 'text/plain', '.txt': 'text/plain' };
const inside = (parent, child) => { const rel = path.relative(parent, child); return rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };

// Only a ticket's explicitly referenced evidence inside this project's output
// directory is readable. Realpath containment rejects symlinks and traversal;
// HTML/SVG and arbitrary paths never become a general file-serving endpoint.
export async function readArtifact(root, ticket, index, content = false) {
  const artifact = ticket.resultDetails?.artifacts[index];
  if (!artifact || !Number.isSafeInteger(index) || index < 0) throw new Error('证据不存在。');
  const file = path.resolve(root, artifact.reference), output = path.join(root, 'output');
  if (!inside(output, file) || !types[path.extname(file).toLowerCase()]) throw new Error('此证据仅显示路径：预览支持 output 内的图片与文本。');
  const resolved = await realpath(file), allowed = await realpath(output);
  if (path.relative(path.join(await realpath(root), 'output'), allowed)) throw new Error('output 目录本身不能通过链接重定向证据读取。');
  if (!inside(allowed, resolved)) throw new Error('证据路径超出 output 目录。');
  const info = await stat(resolved);
  if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error('证据文件不存在或超过 16 MiB。');
  const type = types[path.extname(file).toLowerCase()];
  return { ...artifact, type, bytes: info.size, ...(content && { content: await readFile(resolved) }) };
}

export async function reviewEvidence(ticket, current, readSnapshot, root) {
  const start = ticket.claimedBasis || ticket.basis;
  const completed = ticket.completedBasis;
  const stale = !!completed && (completed.projectId !== current.projectId || completed.fingerprint !== current.fingerprint);
  let changes = null, error = null;
  try {
    if (completed?.snapshotId) {
      const before = await readSnapshot(start.snapshotId), after = await readSnapshot(completed.snapshotId);
      if (before.project.projectId !== ticket.basis.projectId || after.project.projectId !== ticket.basis.projectId) throw new Error('快照归属与小票不同。');
      changes = diffProjects(before.project, after.project);
    }
  } catch (e) { error = e.message; }
  const artifacts = await Promise.all((ticket.resultDetails?.artifacts || []).map(async (artifact, index) => {
    try { const info = await readArtifact(root, ticket, index); return { ...info, url: `/api/tickets/${ticket.id}/artifacts/${index}` }; }
    catch (e) { return { ...artifact, unavailable: e.message }; }
  }));
  return { stale, from: start, completed, changes, error, artifacts,
    note: completed?.snapshotId ? '领取（或标注）至提交验收之间的工程变更；可能包含同期其他编辑。' : '旧票没有提交时的冻结快照，无法还原准确的处理前后差异。' };
}
