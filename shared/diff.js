import { scanVariables } from './variables.js';
import { TARGETS, FIELDS } from './core.js';
// Compact, semantic project comparison. Large authored CSS is summarized, never copied into the report.
export function diffProjects(before, after) {
  const changes = [];
  const add = (path, a, b, label = path) => { if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ path, label, before: a ?? null, after: b ?? null }); };
  add('工程名称', before.name, after.name);
  add('projectId', before.projectId, after.projectId, '工程身份');
  for (const key of ['breakpoints', 'decorations', 'assetRefs', 'bindingConflicts']) add(key, before[key], after[key]);
  for (const scope of new Set([...Object.keys(before.rules), ...Object.keys(after.rules)])) {
    const a = before.rules[scope] || {}, b = after.rules[scope] || {};
    for (const target of new Set([...Object.keys(a), ...Object.keys(b)])) {
      for (const key of new Set([...Object.keys(a[target] || {}), ...Object.keys(b[target] || {})])) add(`${scope}/${target}/${key}`, a[target]?.[key], b[target]?.[key], `${scope === 'base' ? '所有尺寸' : '仅手机'} / ${TARGETS.find(t => t.id === target)?.name || target} / ${FIELDS.find(f => f.key === key)?.label || key}`);
    }
  }
  const variables = new Map([...scanVariables(before.baseTheme.custom_css || ''), ...scanVariables(after.baseTheme.custom_css || '')].map(v => [v.id, v]));
  for (const id of new Set([...Object.keys(before.variableEdits || {}), ...Object.keys(after.variableEdits || {})])) {
    const v = variables.get(id); add(`变量/${id}`, before.variableEdits?.[id], after.variableEdits?.[id], v ? `${v.name} · 第 ${v.line} 行 · ${v.context}` : `变量/${id}`);
  }
  for (const key of new Set([...Object.keys(before.baseTheme), ...Object.keys(after.baseTheme)])) {
    if (key === 'custom_css') continue;
    add(`基础主题/${key}`, before.baseTheme[key], after.baseTheme[key]);
  }
  for (const [name, a, b] of [['基础主题 CSS', before.baseTheme.custom_css || '', after.baseTheme.custom_css || ''], ['高级 CSS', before.customCss, after.customCss]]) {
    if (a !== b) changes.push({ path: name, before: `${a.length} 字符`, after: `${b.length} 字符（内容有变化）` });
  }
  return changes;
}
