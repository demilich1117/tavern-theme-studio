import { TARGETS } from './core.js';

// Semantic navigation only: this order never changes the host DOM or stacking.
export function parentTarget(id) {
  const target = TARGETS.find(t => t.id === id);
  if (target?.parent) return target.parent;
  if (target?.drawer) return 'global';
  if (target?.shared || id === 'global') return null;
  if (target?.role) {
    const parent = ['quote', 'code', 'table'].includes(target.part) ? 'message-text' : ['reasoning', 'reasoning-header'].includes(target.part) ? 'reasoning-block' : ['avatar', 'message-body'].includes(target.part) ? null : 'message-body';
    return parent ? `${target.role}-${parent}` : target.role;
  }
  return { stage: 'global', chat: 'stage', assistant: 'chat', user: 'chat', composer: 'stage', input: 'composer', left: 'global', right: 'global', 'assistant-before': 'assistant', 'assistant-after': 'assistant' }[id] || null;
}
export function targetPath(id) {
  const path = [], seen = new Set();
  while (id && !seen.has(id)) { seen.add(id); const target = TARGETS.find(t => t.id === id); if (!target) break; path.unshift(target); id = parentTarget(id); }
  return path;
}
export function objectRows(project, scope, query = '') {
  const search = query.trim().toLowerCase(), visible = new Set();
  for (const t of TARGETS) if (!search || `${t.name} ${t.id}`.toLowerCase().includes(search)) targetPath(t.id).forEach(item => visible.add(item.id));
  const rows = [];
  function visit(parent, depth) {
    for (const target of TARGETS.filter(t => parentTarget(t.id) === parent && !t.shared)) {
      if (visible.has(target.id)) rows.push({ target, depth, modified: Object.keys(project.rules[scope]?.[target.id] || {}).length });
      visit(target.id, depth + 1);
    }
  }
  visit(null, 0);
  return [...rows, ...TARGETS.filter(t => t.shared && visible.has(t.id)).map(target => ({ target, depth: 0, modified: Object.keys(project.rules[scope]?.[target.id] || {}).length }))];
}
