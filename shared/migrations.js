import { scanVariables, validateVariableValue } from './variables.js';

export const PROJECT_SCHEMA = 3;
export const PROJECT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const newProjectId = () => globalThis.crypto.randomUUID();
export const defaultBreakpoints = () => [{ id: 'mobile', name: '仅手机', condition: '(max-width: 767px)' }];
export function bindingRecords(css) {
  return Object.fromEntries(scanVariables(css).map(v => [v.id, { name: v.name, context: v.context, key: v.bindingKey, ambiguous: v.ambiguous }]));
}

// Legacy offsets are read only against their original CSS. They are never used
// to match a different build. The caller backs up disk files before migration.
export function migrateProject(value, { projectId } = {}) {
  if (!value || ![1, 2, 3].includes(value.schemaVersion)) throw new Error('不支持的工程格式或版本。');
  const next = structuredClone(value);
  const css = next.baseTheme?.custom_css || '';
  if (typeof css !== 'string') throw new Error('基础 CSS 格式错误。');
  if (value.schemaVersion === 3) {
    if (!PROJECT_ID.test(next.projectId)) throw new Error('工程缺少有效的稳定 projectId。');
    return next;
  }
  next.projectId = projectId || (PROJECT_ID.test(value.projectId) ? value.projectId : newProjectId());
  next.schemaVersion = 3;
  next.breakpoints = defaultBreakpoints(); next.decorations = []; next.assetRefs = [];
  const variables = scanVariables(css);
  const ids = new Map(variables.flatMap(v => [[v.legacyId, v.id], [v.id, v.id]]));
  next.variableEdits = {};
  if (value.schemaVersion === 2) {
    if (!value.variableEdits || typeof value.variableEdits !== 'object' || Array.isArray(value.variableEdits)) throw new Error('主题变量格式错误。');
    for (const [id, edit] of Object.entries(value.variableEdits)) {
      if (!ids.has(id)) throw new Error(`旧变量 ${id} 无法在原始 CSS 定位；迁移中止，原数据保留。`);
      next.variableEdits[ids.get(id)] = validateVariableValue(edit);
    }
  }
  next.variableBindings = bindingRecords(css);
  next.bindingConflicts = variables.filter(v => v.ambiguous && v.id in next.variableEdits).map(v => ({ id: v.id, name: v.name, context: v.context, reason: '相同上下文含重复声明；继续源码同步前需解除歧义。' }));
  return next;
}

export function mergeSourceTheme(project, theme) {
  const old = scanVariables(project.baseTheme.custom_css || ''), fresh = scanVariables(theme.custom_css || '');
  const next = structuredClone(project), edits = {}, conflicts = [];
  for (const [id, value] of Object.entries(project.variableEdits)) {
    const variable = old.find(v => v.id === id);
    const matches = fresh.filter(v => v.bindingKey === variable?.bindingKey);
    if (!variable || variable.ambiguous || matches.length !== 1 || matches[0].ambiguous) {
      conflicts.push({ id, name: variable?.name || id, context: variable?.context || '', value, reason: matches.length ? '变量绑定不唯一' : '源码已删除或移动变量声明' });
    } else edits[matches[0].id] = value;
  }
  if (conflicts.length) throw Object.assign(new Error('源码构建与界面变量存在冲突；上一次成功预览已保留。'), { status: 409, conflicts });
  next.baseTheme = structuredClone(theme); next.variableEdits = edits;
  next.variableBindings = bindingRecords(theme.custom_css || ''); next.bindingConflicts = [];
  return next;
}
