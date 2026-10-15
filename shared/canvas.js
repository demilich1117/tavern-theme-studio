import { DRAWERS } from './drawer-parts.js';
import { validateBlueprint } from './blueprint.js';
import { rolePartIds, messagePart } from './message-parts.js';
// Geometry uses the same rules, scopes and history as the property inspector.
const messageTargets = ['avatar', 'message-text', 'message-body', 'name', 'reasoning', 'reasoning-block', 'quote', 'code', 'table', 'media', 'attachments'];
export const CANVAS_TARGETS = [...DRAWERS.map(([id]) => id).filter(id => !['left', 'right'].includes(id)), 'stage', 'chat', 'composer', 'input', 'assistant', 'user', 'left', 'right', ...messageTargets, ...rolePartIds(messageTargets)];
export const canvasAutoHeight = id => ['reasoning-block', 'message-body', 'media', 'attachments', 'table'].includes(messagePart(id));
export const CANVAS_PROPERTIES = ['margin-left', 'margin-top', 'width', 'min-height', 'left', 'top', 'height'];
// Keep visible pointer targets separate even for tiny or edge-clipped parts.
// Coordinates stay in host pixels; size is compensated for workspace zoom.
export function canvasHandleCenters(rect, { width, height, top = 0, size = 40 }) {
  const half = size / 2, gap = size + 4;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const move = { x: clamp(rect.left - 4, half, width - half), y: clamp(rect.top - 4, top + half, height - half) };
  const resize = { x: clamp(rect.left + rect.width, half, width - half), y: clamp(rect.top + rect.height, top + half, height - half) };
  if (Math.abs(move.x - resize.x) < size && Math.abs(move.y - resize.y) < size) {
    const candidates = [
      [resize, 'y', move.y + gap, top + half, height - half],
      [move, 'y', resize.y - gap, top + half, height - half],
      [resize, 'x', move.x + gap, half, width - half],
      [move, 'x', resize.x - gap, half, width - half],
    ].filter(([, , value, min, max]) => value >= min && value <= max);
    candidates.sort((a, b) => Math.abs(a[2] - a[0][a[1]]) - Math.abs(b[2] - b[0][b[1]]));
    if (candidates.length) { const [handle, axis, value] = candidates[0]; handle[axis] = value; }
  }
  return { move, resize };
}
export const sameCanvasBasis = (a, b) => !!a && !!b && ['projectId', 'sessionId', 'revision', 'fingerprint'].every(key => a[key] === b[key]);
export function canvasAvailability(connection) {
  if (!connection.ready) return { disabled: true, reason: '预览尚未连接，请等待连接完成；连接中断时从酒馆扩展重新打开工作台。' };
  if (connection.capabilities?.canvasEditor !== 1 || connection.capabilities?.canvasWorkflow !== 1) return { disabled: true, reason: connection.live
    ? '当前酒馆标签尚未加载画布功能。更新连接器后刷新整个酒馆标签，再重新打开工作台；只刷新工作台面板不会更新连接器。'
    : '示例预览尚未加载画布功能，请刷新工作台。' };
  return { disabled: false, reason: connection.live && !connection.fixtureActive ? '进入时自动打开虚构测试对话；拖动后可还原本轮调整。' : '' };
}
export function createCanvasRound(state) {
  return { version: 1, projectId: state.projectId, sessionId: state.sessionId, rules: structuredClone(state.project.rules), entries: [] };
}
export function recordCanvasRound(round, state, command) {
  if (!round || round.projectId !== state.projectId || round.sessionId !== state.sessionId) return;
  for (const property of Object.keys(command.props)) {
    const { scope = 'base', target } = command;
    let entry = round.entries.find(e => e.scope === scope && e.target === target && e.property === property);
    if (!entry) { entry = { scope, target, property, before: round.rules[scope]?.[target]?.[property] ?? null, values: [] }; round.entries.push(entry); }
    const value = state.project.rules[scope]?.[target]?.[property] ?? null;
    if (!entry.values.includes(value)) entry.values.push(value);
  }
}
export function canvasRestorePlan(round, state) {
  const changes = [], conflicts = [];
  if (!round || round.projectId !== state.projectId || round.sessionId !== state.sessionId) return { changes, conflicts };
  for (const entry of round.entries) {
    if (!Object.hasOwn(state.project.rules, entry.scope)) { conflicts.push(entry); continue; }
    const current = state.project.rules[entry.scope]?.[entry.target]?.[entry.property] ?? null;
    if (current === entry.before) continue;
    if (!entry.values.includes(current)) { conflicts.push(entry); continue; }
    changes.push({ scope: entry.scope, target: entry.target, property: entry.property, expected: current, value: entry.before });
  }
  return { changes, conflicts };
}
export function canvasPatch(initial, kind, dx, dy, snap = false) {
  if (![dx, dy, initial.scaleX, initial.scaleY, initial.parentWidth, initial.width, initial.height, initial.marginLeft, initial.marginTop].every(Number.isFinite) || initial.scaleX <= 0 || initial.scaleY <= 0 || initial.parentWidth <= 0) throw new Error('无法测量当前布局。');
  const step = snap ? 8 : 1, round = n => Math.round(n / step) * step;
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  if (initial.drawer) {
    if (kind === 'move') return { left: `${clamp(dx ? round(initial.left + dx / initial.scaleX) : initial.left, -2048, 4096)}px`, top: `${clamp(dy ? round(initial.top + dy / initial.scaleY) : initial.top, -2048, 4096)}px` };
    if (kind !== 'resize') throw new Error('未知画布操作。');
    return { ...(dx !== 0 && {width: `${clamp(round(initial.width + dx / initial.scaleX), 1, 4096)}px`}), ...(dy !== 0 && {height: `${clamp(round(initial.height + dy / initial.scaleY), 1, 4096)}px`}) };
  }
  if (kind === 'move') return { ...(dx !== 0 && { 'margin-left': `${clamp(round(initial.marginLeft + dx / initial.scaleX), -2048, 2048)}px` }), ...(dy !== 0 && { 'margin-top': `${clamp(round(initial.marginTop + dy / initial.scaleY), -2048, 2048)}px` }) };
  if (kind !== 'resize') throw new Error('未知画布操作。');
  // Width remains relative to its containing block. Text gets a minimum height,
  // never a fixed height or font scaling, so longer messages can still grow.
  return { ...(dx !== 0 && { width: initial.pixelWidth ? `${clamp(round(initial.width + dx / initial.scaleX), 8, 512)}px` : `${+clamp(round(initial.width + dx / initial.scaleX) / initial.parentWidth * 100, 20, 100).toFixed(3)}%` }), ...(dy !== 0 && !initial.autoHeight && { 'min-height': `${clamp(round(initial.height + dy / initial.scaleY), 0, 4096)}px` }) };
}
export function validateCanvasProposal(value) {
  if (value == null) return undefined;
  if (value.kind === 'blueprint') return validateBlueprint(value);
  if (value.kind !== 'layout-intent') throw new Error('画布提案类型无效。');
  const rect = input => Object.fromEntries(['left', 'top', 'width', 'height'].map(key => {
    const n = input?.[key];
    if (!Number.isFinite(n) || Math.abs(n) > 100000 || (['width', 'height'].includes(key) && n < 1)) throw new Error('画布提案尺寸无效。');
    return [key, Math.round(n * 100) / 100];
  }));
  return { kind: 'layout-intent', before: rect(value.before), after: rect(value.after) };
}
