import { TARGETS } from './core.js';
export function captureLocation(project, { kind = 'component', id, scope = 'base' } = {}, anchor) {
  const breakpoint = scope === 'base' ? null : project.breakpoints.find(b => b.id === scope);
  if (scope !== 'base' && !breakpoint) throw new Error('小票断点已不存在。');
  const location = { kind, id: id || anchor.target, scope, condition: breakpoint?.condition || null };
  if (kind === 'layer') {
    const layer = project.decorations.find(l => l.id === id), slot = project.recipe?.slots.find(s => s.id === layer?.slotId);
    if (!layer || !slot) throw new Error('小票图层或插槽已不存在。');
    Object.assign(location, { name: layer.name, slotId: slot.id, selector: slot.selector, pseudo: slot.pseudo, slotCondition: slot.condition || null, geometry: structuredClone(layer) });
  } else {
    if (!['component', 'container', 'breakpoint'].includes(kind)) throw new Error('小票定位类型无效。');
    const target = TARGETS.find(t => t.id === location.id); if (!target) throw new Error('小票目标部件不存在。');
    Object.assign(location, { name: target.name, selector: target.selector, pseudo: target.pseudo || '', rules: structuredClone(project.rules[scope]?.[target.id] || {}) });
  }
  return location;
}
export function locationStatus(ticket, project) {
  if (ticket.basis.projectId !== project.projectId) return { valid: false, reason: '工程身份不同，需要重新定位' };
  if (!ticket.location) return { valid: true, reason: '旧票部件定位，请对照快照' };
  try {
    const current = captureLocation(project, ticket.location, ticket.anchor), old = ticket.location;
    const changed = ['slotId', 'selector', 'pseudo', 'condition', 'slotCondition'].some(k => current[k] !== old[k]);
    const edited = JSON.stringify(current.geometry || current.rules) !== JSON.stringify(old.geometry || old.rules);
    return { valid: !changed, reason: changed ? '目标或断点条件已变更，需要重新定位' : edited ? '目标属性已变更；修改前对照快照' : '稳定目标仍有效；修改前核对快照', current };
  } catch (e) { return { valid: false, reason: e.message + '，需要重新定位' }; }
}
