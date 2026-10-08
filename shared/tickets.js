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
