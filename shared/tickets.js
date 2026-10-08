import { TARGETS, FIELDS } from './core.js';
export const TICKET_STATES = { open: '待处理', working: '处理中', review: '待验收', done: '已完成' };
export function ticketText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}需为 1–${max} 字。`);
  return value.trim();
}
function number(value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error('标注坐标或视口无效。');
  return Math.round(value * 1000) / 1000;
}
export function validateAnchor(input) {
  const target = TARGETS.find(x => x.id === input?.target);
  if (!target) throw new Error('标注部件无效。');
  const anchor = { target: target.id, selector: target.selector, pseudo: target.pseudo || null,
    occurrence: number(input.occurrence ?? 0, 0, 10000),
    point: { x: number(input.point?.x, 0, 1), y: number(input.point?.y, 0, 1) },
    viewport: { width: number(input.viewport?.width, 1, 20000), height: number(input.viewport?.height, 1, 20000), dpr: number(input.viewport?.dpr ?? 1, 0.1, 10) },
    rect: Object.fromEntries(['left', 'top', 'width', 'height'].map(k => [k, number(input.rect?.[k], k === 'width' || k === 'height' ? 0 : -100000, 100000)])),
    fixture: input.fixture === true, values: {} };
  if (!Number.isInteger(anchor.occurrence)) throw new Error('部件序号无效。');
  if (anchor.fixture && Number.isInteger(input.messageIndex) && input.messageIndex >= 0 && input.messageIndex < 1000) anchor.messageIndex = input.messageIndex;
  for (const f of FIELDS) if (typeof input.values?.[f.key] === 'string') anchor.values[f.key] = input.values[f.key].slice(0, 100);
  return anchor;
}
export function validateTicketResult(value) {
  if (typeof value === 'string') return { summary: ticketText(value, 8000, '处理结果'), details: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('处理结果需为文本或结构化结果。');
  const summary = ticketText(value.summary, 4000, '改动摘要'), baseline = value.baseline;
  if (!baseline || typeof baseline.projectId !== 'string' || !Number.isInteger(baseline.revision) || baseline.revision < 0 || !/^[a-f0-9]{64}$/.test(baseline.fingerprint)) throw new Error('结构化结果需记录实际使用的工程 ID、revision 与指纹。');
  const used = { projectId: baseline.projectId, revision: baseline.revision, fingerprint: baseline.fingerprint };
  if (/^[a-f0-9]{32}$/.test(baseline.snapshotId)) used.snapshotId = baseline.snapshotId;
  if (/^[a-f0-9]{64}$/.test(baseline.sourceFingerprint)) used.sourceFingerprint = baseline.sourceFingerprint;
  const checks = value.checks || [], unverified = value.unverified || [], artifacts = value.artifacts || [];
  if (!Array.isArray(checks) || checks.length > 100 || !Array.isArray(unverified) || unverified.length > 100 || !Array.isArray(artifacts) || artifacts.length > 40) throw new Error('结果检查/未验证项/证据列表无效。');
  return { summary, details: { schemaVersion: 1, summary, baseline: used,
    checks: checks.map(c => { if (!['passed', 'failed', 'skipped'].includes(c?.status)) throw new Error('验证状态应为 passed/failed/skipped。'); return { name: ticketText(c.name, 160, '验证名称'), status: c.status, detail: ticketText(c.detail, 2000, '验证说明') }; }),
    unverified: unverified.map(v => ticketText(v, 2000, '未验证项')),
    artifacts: artifacts.map(a => ({ label: ticketText(a?.label, 160, '证据名称'), reference: ticketText(a?.reference, 2000, '证据路径/链接') })),
  } };
}
