import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { validateAnchor, ticketText, TICKET_STATES, validateTicketResult } from '../shared/tickets.js';

export async function createTicketStore(dataDir) {
  const file = path.join(dataDir, 'tickets.json'); let tickets = [];
  try { tickets = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  async function persist(next) { await writeFile(file + '.tmp', JSON.stringify(next, null, 2)); await rename(file + '.tmp', file); tickets = next; }
  const conflict = message => Object.assign(new Error(message), { status: 409 });
  return {
    list: () => structuredClone(tickets),
    async create(input, basis) {
      const ticket = { schemaVersion: 1, id: randomBytes(16).toString('hex'), number: tickets.length + 1, version: 1, state: 'open',
        comment: ticketText(input.comment, 4000, '修改意见'), anchor: validateAnchor(input.anchor), basis,
        scope: input.location?.scope || (input.scope === 'mobile' ? 'mobile' : 'base'), ...(input.location && { location: structuredClone(input.location) }), createdAt: new Date().toISOString(), result: '', owner: '' };
      await persist([...tickets, ticket]); return ticket;
    },
    async update(id, input, currentBasis, saveSnapshot) {
      const old = tickets.find(t => t.id === id); if (!old) throw Object.assign(new Error('小票不存在。'), { status: 404 });
      if (input.version !== old.version) throw conflict('小票已被更新，请重新读取后重试。');
      if (input.action !== 'reopen' && old.basis.projectId !== currentBasis.projectId) throw conflict('小票与当前工程身份不一致，请先核对快照并重新定位。');
      const next = { ...old, version: old.version + 1, updatedAt: new Date().toISOString() };
      if (input.action === 'claim') {
        if (old.state !== 'open') throw conflict('这张小票已被领取。');
        next.owner = ticketText(input.owner, 120, '处理者名称'); next.state = 'working';
      } else if (input.action === 'review') {
        if (old.state !== 'working' || input.owner !== old.owner) throw conflict('只有当前处理者能提交验收。');
        const result = validateTicketResult(input.result);
        if (result.details && result.details.baseline.projectId !== old.basis.projectId) throw conflict('结果使用的基线与小票工程 ID 不一致。');
        next.result = result.summary; next.resultDetails = result.details; next.state = 'review'; next.completedBasis = currentBasis;
      } else if (input.action === 'accept') {
        if (old.state !== 'review') throw conflict('请先提交处理结果。');
        if (old.completedBasis?.fingerprint !== currentBasis.fingerprint && input.acknowledgeChanged !== true) throw conflict('工程在提交验收后有新变化，请查看差异并明确确认当前版本后验收。');
        next.state = 'done'; next.acceptedBasis = currentBasis;
      } else if (input.action === 'reopen') { next.state = 'open'; next.owner = ''; }
      else throw new Error('不支持的小票操作。');
      if (!(next.state in TICKET_STATES)) throw new Error('小票状态无效。');
      if (saveSnapshot && ['claim', 'review'].includes(input.action)) {
        const snapshot = await saveSnapshot(`${input.action === 'claim' ? '领取' : '提交验收'} #${old.number}`);
        next[input.action === 'claim' ? 'claimedBasis' : 'completedBasis'] = { ...currentBasis, snapshotId: snapshot.id };
      }
      await persist(tickets.map(t => t.id === id ? next : t)); return next;
    },
  };
}
