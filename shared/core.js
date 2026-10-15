import { rewriteVariables, scanVariables, validateVariableValue } from './variables.js';
import { migrateProject, bindingRecords, mergeSourceTheme, newProjectId, defaultBreakpoints } from './migrations.js';
import { validateRecipe, validateLayer, validateLayerProps, layersFromRecipe, mergeRecipe, compileDecorations, layerAsset } from './decorations.js';
import { LAYOUT_FIELDS, LAYOUT_TARGETS, normalizeLayoutValue } from './layouts.js';
import { CANVAS_TARGETS, CANVAS_PROPERTIES } from './canvas.js';
import { drawerParts, drawerDeclarations, isDrawer, controlKind } from './drawer-parts.js';
import { MESSAGE_PARTS, MESSAGE_ROLES, messagePart } from './message-parts.js';
// Self-contained illustrated themes embed raster assets in their base CSS.
export const MAX_THEME_CSS_LENGTH = 1_000_000;
export const TARGETS = [
  ...drawerParts,
  { id: 'global', name: '全局界面', selector: 'body', icon: '◉', note: '页面底色与基础文字；局部主题样式可能覆盖继承值。' },
  { id: 'chat', name: '聊天区域', selector: '#chat', icon: '▤', note: '消息列表的背景、宽度与留白。' },
  { id: 'stage', name: '阅读面板', selector: '#sheld', icon: '▥', note: '原生阅读与输入外框；使用最大宽度与留白避免正文溢出。' },
  { id: 'assistant', name: '角色消息', selector: '#chat .mes[is_user="false"]', icon: '◇', note: '作用于全部角色消息，包括之后生成的消息。' },
  { id: 'user', name: '我的消息', selector: '#chat .mes[is_user="true"]', icon: '◈', note: '作用于全部用户消息。' },
  { id: 'avatar', name: '消息头像', selector: '#chat .mes .avatar, #chat .mes .avatar img', icon: '▣', note: '统一调整消息头像容器和图片。' },
  { id: 'composer', name: '输入区域', selector: '#send_form', icon: '▱', note: '包含输入框与发送按钮的区域。' },
  { id: 'input', name: '输入框', selector: '#send_textarea', icon: '⌨', note: '输入框自身的文字、背景与边距。' },
  { id: 'left', name: '左侧设置栏', selector: '#left-nav-panel', icon: '◧', note: '请先在酒馆中展开左侧设置栏。' },
  { id: 'right', name: '右侧角色栏', selector: '#right-nav-panel', icon: '◨', note: '请先在酒馆中展开右侧角色栏。' },
  { id: 'message-text', name: '消息正文', selector: '#chat .mes .mes_text', icon: '¶', detail: true, note: '消息正文容器，包含段落与 Markdown 内容。' },
  { id: 'name', name: '角色名字', selector: '#chat .mes .name_text', icon: 'Aa', detail: true, note: '仅名字文字；时间戳和操作按钮可分别调整。' },
  { id: 'timestamp', name: '时间戳', selector: '#chat .mes .timestamp', icon: '◷', detail: true, note: '酒馆需要开启消息时间戳。' },
  { id: 'reasoning', name: '思考正文', selector: '#chat .mes .mes_reasoning', icon: '◌', detail: true, note: '需要包含思考内容并展开思考区的消息。' },
  { id: 'reasoning-block', name: '整个推理块', selector: '#chat .mes .mes_reasoning_details', icon: '▧', detail: true, note: '包含折叠标题与思考正文；移动或调整宽度，高度随折叠和正文自动变化。' },
  { id: 'message-body', name: '消息内容组', selector: '#chat .mes .mes_block', icon: '▤', detail: true, note: '包含名字、推理、正文、媒体与附件，头像保持独立；高度随内容变化。' },
  { id: 'media', name: '图片与媒体区', selector: '#chat .mes .mes_media_wrapper', icon: '▧', detail: true, note: '调整原生媒体区域的位置与宽度，保留图片比例及原生打开操作。' },
  { id: 'attachments', name: '附件区', selector: '#chat .mes .mes_file_wrapper', icon: '▱', detail: true, note: '调整附件区域的位置与宽度，保留原生附件操作；无附件时不可见。' },
  { id: 'reasoning-header', name: '思考折叠栏', selector: '#chat .mes .mes_reasoning_summary', icon: '⌄', detail: true, note: '思考区域的标题与折叠栏。' },
  { id: 'quote', name: '引用块', selector: '#chat .mes .mes_text blockquote', icon: '❞', detail: true, note: 'Markdown 引用块；普通引号文字不属于此部件。' },
  { id: 'code', name: '代码块', selector: '#chat .mes .mes_text pre', icon: '{}', detail: true, note: '代码块外框；语法高亮可能单独控制文字颜色。' },
  { id: 'table', name: '表格', selector: '#chat .mes .mes_text table', icon: '▦', detail: true, note: 'Markdown 表格整体样式。' },
  { id: 'message-buttons', name: '消息操作栏', selector: '#chat .mes .mes_buttons', icon: '⋯', detail: true, note: '消息上的编辑、复制等操作区域。' },
  { id: 'assistant-before', name: '角色消息 · 前装饰', selector: '#chat .mes[is_user="false"]::before', elementSelector: '#chat .mes[is_user="false"]', pseudo: '::before', icon: '◁', detail: true, note: '已有 ::before 装饰的样式；不会自动生成 content。' },
  { id: 'assistant-after', name: '角色消息 · 后装饰', selector: '#chat .mes[is_user="false"]::after', elementSelector: '#chat .mes[is_user="false"]', pseudo: '::after', icon: '▷', detail: true, note: '已有 ::after 装饰的样式；伪元素通过列表选择。' },
];

// Preserve the meaning of saved shared rules and tickets; do not guess which
// role an older edit intended. Specific targets are the default picking path.
const sharedMessageTargets = TARGETS.filter(target => Object.hasOwn(MESSAGE_PARTS, target.id));
for (const [role, label] of Object.entries(MESSAGE_ROLES)) {
  const messageSelector = `#chat .mes[is_user="${role === 'user'}"]`;
  for (const target of sharedMessageTargets) {
    TARGETS.push({ ...target, id: `${role}-${target.id}`, role, part: target.id,
      name: label + MESSAGE_PARTS[target.id],
      selector: target.selector.replaceAll('#chat .mes', messageSelector),
      ...(target.id === 'avatar' && { elementSelector: `${messageSelector} .avatar` }),
      detail: !['avatar', 'message-text', 'name'].includes(target.id),
      note: `仅调整${label}消息中的${MESSAGE_PARTS[target.id]}，不修改${role === 'user' ? '角色' : '用户'}对应部件；当前尺寸范围内同类联动。${['reasoning-block','message-body','media','attachments'].includes(target.id) ? target.note : ''}`,
    });
  }
}
for (const target of sharedMessageTargets) {
  target.part = target.id; target.shared = true; target.detail = true;
  target.name = `全部消息 · ${MESSAGE_PARTS[target.id]}`;
  target.note = '通用样式，同时作用于用户与角色；只改一方请选择对应的用户 / 角色部件。身份专用覆盖优先。';
}

export const FIELDS = [
  ...[['left', '距视口左侧', -2048, 4096], ['top', '距视口顶部', -2048, 4096], ['height', '高度', 1, 4096], ['max-height', '最大高度', 1, 4096]].map(([key,label,min,max]) => ({key,label,min,max,type:'range',group:'位置与尺寸',step:1,unit:'px',fallback:24})),
  { key: '--tts-tick-shape', label: '勾选图案', type: 'select', group: '形状与留白', options: [['check','对勾'],['circle','圆点'],['square','方块'],['diamond','菱形'],['cross','叉号']], fallback: 'check' },
  { key: 'background-color', label: '背景颜色', type: 'color', group: '色彩', fallback: '#353941' },
  { key: 'color', label: '文字颜色', type: 'color', group: '色彩', fallback: '#e8e6e0' },
  { key: 'border-color', label: '边框颜色', type: 'color', group: '色彩', fallback: '#656970' },
  { key: 'opacity', label: '整体不透明度', type: 'range', group: '色彩', min: 0.1, max: 1, step: 0.05, unit: '', fallback: 1 },
  { key: 'font-size', label: '字号', type: 'range', group: '文字', min: 10, max: 36, step: 1, unit: 'px', fallback: 16 },
  { key: 'line-height', label: '行高', type: 'range', group: '文字', min: 1, max: 2.8, step: 0.05, unit: '', fallback: 1.7 },
  { key: 'border-radius', label: '圆角', type: 'range', group: '形状与留白', min: 0, max: 48, step: 1, unit: 'px', fallback: 12 },
  { key: 'padding', label: '内边距', type: 'range', group: '形状与留白', min: 0, max: 64, step: 1, unit: 'px', fallback: 16 },
  { key: 'margin-bottom', label: '下方间距', type: 'range', group: '形状与留白', min: 0, max: 48, step: 1, unit: 'px', fallback: 8 },
  { key: 'margin-left', label: '左侧外边距', type: 'range', group: '位置与尺寸', min: -2048, max: 2048, step: 1, unit: 'px', fallback: 0 },
  { key: 'margin-top', label: '上方外边距', type: 'range', group: '位置与尺寸', min: -2048, max: 2048, step: 1, unit: 'px', fallback: 0 },
  { key: 'min-height', label: '最小高度', type: 'range', group: '位置与尺寸', min: 0, max: 4096, step: 1, unit: 'px', fallback: 0 },
  { key: 'border-width', label: '边框粗细', type: 'range', group: '形状与留白', min: 0, max: 8, step: 1, unit: 'px', fallback: 0 },
  { key: 'width', label: '宽度', type: 'range', group: '形状与留白', min: 20, max: 100, step: 1, unit: '%', fallback: 100 },
];

const clone = x => structuredClone(x);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export function validateTheme(theme) {
  if (!object(theme) || typeof theme.name !== 'string' || !theme.name.trim() || theme.name.length > 120) throw new Error('主题需要有效名称（最多 120 字）。');
  if (theme.custom_css !== undefined && (typeof theme.custom_css !== 'string' || theme.custom_css.length > MAX_THEME_CSS_LENGTH)) throw new Error('主题 CSS 必须是文本且不超过 1,000,000 字符。');
  return clone(theme);
}
export function createProject(theme = { name: '新主题', custom_css: '' }, { projectId = newProjectId() } = {}) {
  return { schemaVersion: 3, projectId, name: theme.name, baseTheme: validateTheme(theme), rules: { base: {}, mobile: {} }, variableEdits: {}, variableBindings: bindingRecords(theme.custom_css || ''), bindingConflicts: [], breakpoints: defaultBreakpoints(), recipe: null, decorations: [], assetRefs: [], customCss: '' };
}
export function normalizeValue(key, value) {
  if (key === '--tts-tick-shape') { if (value === null) return null; if (!FIELDS.find(f => f.key === key).options.some(([v]) => v === value)) throw new Error('勾选图案无效。'); return value; }
  if (key === 'width' && typeof value === 'string' && /^\d+(?:\.\d+)?px$/.test(value)) {
    const n = parseFloat(value); if (n < 1 || n > 4096) throw new Error('像素宽度范围为 1–4096px。'); return `${+n.toFixed(3)}px`;
  }
  if (LAYOUT_FIELDS.some(f => f.key === key)) return normalizeLayoutValue(key, value);
  const field = FIELDS.find(x => x.key === key);
  if (!field) throw new Error('不支持的样式属性。');
  if (value === null) return null;
  if (field.type === 'color') {
    if (typeof value !== 'string' || !/^#[a-f\d]{6}([a-f\d]{2})?$/i.test(value)) throw new Error('颜色需使用 #RRGGBB 或 #RRGGBBAA。');
    return value.toLowerCase();
  }
  if (key === 'padding' && typeof value === 'string' && value.trim().includes(' ')) {
    const sides = value.trim().split(/\s+/);
    if (sides.length > 4) throw new Error('内边距最多包含上、右、下、左四个值。');
    return sides.map(v => normalizeValue(key, v)).join(' ');
  }
  const pattern = new RegExp(`^-?\\d+(?:\\.\\d+)?${field.unit}$`);
  const raw = typeof value === 'number' ? String(value) + field.unit : value;
  if (typeof raw !== 'string' || !pattern.test(raw)) throw new Error(`属性 ${key} 的单位应为 ${field.unit || '无单位'}。`);
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < field.min || n > field.max) throw new Error(`${field.label}超出范围。`);
  return `${Number(n.toFixed(3))}${field.unit}`;
}
export function validateProject(value) {
  if (!object(value)) throw new Error('不支持的工程格式或版本。');
  value = migrateProject(value);
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120) throw new Error('工程名称无效。');
  const p = createProject(validateTheme(value.baseTheme), { projectId: value.projectId });
  p.name = value.name;
  if (typeof value.customCss !== 'string' || value.customCss.length > 250000) throw new Error('高级 CSS 格式错误或过大。');
  p.customCss = value.customCss;
  if (value.schemaVersion === 3) {
    if (!object(value.variableEdits)) throw new Error('主题变量格式错误。');
    const variables = scanVariables(p.baseTheme.custom_css || ''), ids = new Set(variables.map(v => v.id));
    for (const [id, v] of Object.entries(value.variableEdits)) {
      if (!ids.has(id)) throw new Error('变量位置已改变，请重新读取主题变量。');
      p.variableEdits[id] = validateVariableValue(v);
    }
    for (const v of variables) {
      const saved = value.variableBindings?.[v.id];
      if (saved && saved.key !== v.bindingKey) throw new Error('变量绑定不匹配，请重新读取工程。');
    }
    p.bindingConflicts = variables.filter(v => v.ambiguous && v.id in p.variableEdits).map(v => ({ id: v.id, name: v.name, context: v.context, reason: '相同上下文含重复声明；继续源码同步前需解除歧义。' }));
  }
  if (!Array.isArray(value.breakpoints) || value.breakpoints.length > 20) throw new Error('断点配置无效。');
  const scopeIds = new Set(['base']);
  p.breakpoints = value.breakpoints.map(b => {
    if (!object(b) || !/^[a-z][\w-]{0,47}$/.test(b.id) || scopeIds.has(b.id) || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 80 || typeof b.condition !== 'string' || !/^\((?:min|max)-width: \d{1,5}px\)$/.test(b.condition)) throw new Error('断点 ID、名称或宽度条件无效。');
    if (b.id === 'mobile' && b.condition !== '(max-width: 767px)') throw new Error('保留旧 mobile 的 767px 条件；其他尺寸请新建断点。');
    scopeIds.add(b.id); return clone(b);
  });
  if (!scopeIds.has('mobile')) throw new Error('请保留旧工程的 mobile 断点。');
  p.recipe = validateRecipe(value.recipe);
  if (!Array.isArray(value.decorations) || value.decorations.length > 200) throw new Error('装饰配置无效。');
  p.decorations = value.decorations.map(d => validateLayer(d, scopeIds));
  if (new Set(p.decorations.map(d => d.id)).size !== p.decorations.length) throw new Error('图层 ID 重复。');
  if (!Array.isArray(value.assetRefs) || value.assetRefs.some(a => !object(a) || typeof a.reference !== 'string' || /^(?:[a-z]:[\\/]|file:)/i.test(a.reference))) throw new Error('可移植素材引用无效。');
  p.assetRefs = clone(value.assetRefs);
  if (!object(value.rules) || Object.keys(value.rules).some(k => !scopeIds.has(k))) throw new Error('样式范围无效。');
  for (const scope of scopeIds) {
    if (!object(value.rules[scope])) throw new Error('缺少样式范围。');
    p.rules[scope] = {};
    for (const [target, props] of Object.entries(value.rules[scope])) {
      if (!TARGETS.some(x => x.id === target) || !object(props)) throw new Error('样式部件无效。');
      p.rules[scope][target] = {};
      for (const [key, v] of Object.entries(props)) {
        if ((['left', 'top', 'max-height'].includes(key) && !isDrawer(target)) || (key === 'height' && !isDrawer(target) && !controlKind(target)) || (key === '--tts-tick-shape' && controlKind(target) !== 'tick')) throw new Error('此部件不支持该抽屉或控件属性。');
        if (['margin-left', 'margin-top', 'min-height'].includes(key) && !CANVAS_TARGETS.includes(target)) throw new Error('此部件不支持画布布局。');
        if (key !== 'min-height' && LAYOUT_FIELDS.some(f => f.key === key) && !LAYOUT_TARGETS.includes(target) && !(isDrawer(target) && key === 'max-width')) throw new Error('此部件不支持容器布局。');
        const normalized = normalizeValue(key, v);
        if (normalized !== null) p.rules[scope][target][key] = normalized;
      }
    }
  }
  return p;
}
export function applyCommand(project, command) {
  const next = validateProject(project);
  if (!object(command)) throw new Error('命令格式无效。');
  switch (command.type) {
    case 'canvas-restore': {
      if (!Array.isArray(command.changes) || !command.changes.length || command.changes.length > 2048) throw new Error('画布还原记录无效。');
      const seen = new Set();
      for (const { scope, target, property, expected, value } of command.changes) {
        const key = `${scope}/${target}/${property}`;
        if (!Object.hasOwn(next.rules, scope) || !CANVAS_TARGETS.includes(target) || !CANVAS_PROPERTIES.includes(property) || seen.has(key)) throw new Error('画布还原记录无效。');
        seen.add(key);
        if ((next.rules[scope][target]?.[property] ?? null) !== expected) throw new Error('布局已有新修改，请重新点击还原。');
        const normalized = normalizeValue(property, value);
        next.rules[scope][target] ??= {};
        if (normalized === null) delete next.rules[scope][target][property]; else next.rules[scope][target][property] = normalized;
        if (!Object.keys(next.rules[scope][target]).length) delete next.rules[scope][target];
      }
      break;
    }
    case 'canvas-set': {
      const { target, scope = 'base', props } = command;
      if (!CANVAS_TARGETS.includes(target) || !Object.hasOwn(next.rules, scope) || !object(props) || !Object.keys(props).length || Object.keys(props).some(k => !CANVAS_PROPERTIES.includes(k))) throw new Error('画布调整格式无效。');
      next.rules[scope][target] ??= {};
      for (const [key, value] of Object.entries(props)) {
        const normalized = normalizeValue(key, value);
        if (normalized === null) delete next.rules[scope][target][key];
        else next.rules[scope][target][key] = normalized;
      }
      if (!Object.keys(next.rules[scope][target]).length) delete next.rules[scope][target];
      break;
    }
    case 'set': {
      const { scope = 'base', target, property, value } = command;
      if (!Object.hasOwn(next.rules, scope) || !TARGETS.some(x => x.id === target)) throw new Error('部件或范围无效。');
      const normalized = normalizeValue(property, value);
      next.rules[scope][target] ??= {};
      if (normalized === null) delete next.rules[scope][target][property];
      else next.rules[scope][target][property] = normalized;
      if (!Object.keys(next.rules[scope][target]).length) delete next.rules[scope][target];
      break;
    }
    case 'reset-target':
      if (!Object.hasOwn(next.rules, command.scope) || !TARGETS.some(x => x.id === command.target)) throw new Error('部件或范围无效。');
      delete next.rules[command.scope][command.target];
      break;
    case 'breakpoints': {
      if (!Array.isArray(command.breakpoints)) throw new Error('断点列表无效。');
      next.breakpoints = clone(command.breakpoints);
      const scopes = new Set(['base', ...next.breakpoints.map(b => b.id)]);
      next.rules = Object.fromEntries([...scopes].map(id => [id, Object.hasOwn(next.rules, id) ? next.rules[id] : {}]));
      for (const layer of next.decorations) layer.overrides = Object.fromEntries(Object.entries(layer.overrides).filter(([id]) => scopes.has(id)));
      break;
    }
    case 'rename': next.name = command.name; break;
    case 'custom-css': next.customCss = command.css; break;
    case 'variable': {
      const variable = scanVariables(next.baseTheme.custom_css || '').find(v => v.id === command.id);
      if (!variable) throw new Error('变量不存在，请重新读取主题变量。');
      if (command.value === null || command.value === variable.value) delete next.variableEdits[command.id];
      else next.variableEdits[command.id] = validateVariableValue(command.value);
      break;
    }
    case 'base-theme': next.baseTheme = validateTheme(command.theme); next.variableEdits = {}; next.variableBindings = bindingRecords(next.baseTheme.custom_css || ''); break;
    case 'source-refresh': return validateProject(mergeRecipe(mergeSourceTheme(next, validateTheme(command.theme)), command.recipe));
    case 'recipe': next.recipe = validateRecipe(command.recipe); next.decorations = next.recipe ? layersFromRecipe(next.recipe) : []; break;
    case 'decoration-add': {
      let slot = next.recipe?.slots.find(s => s.id === command.slotId);
      if (!slot) {
        const target = TARGETS.find(t => t.id === command.target && !t.pseudo);
        if (!target || !['::before', '::after'].includes(command.pseudo)) throw new Error('请选择普通部件及前/后伪元素插槽。');
        next.recipe ??= { schemaVersion: 1, id: 'custom-' + newProjectId(), name: '自定义装饰', version: '1', slots: [], hiddenSlots: [], variables: [] };
        slot = { id: 'slot-' + newProjectId(), name: command.name || '新装饰', group: '自定义', selector: target.selector, pseudo: command.pseudo, method: command.method || 'background', sourceOwned: false, geometry: true, position: command.target === 'global' ? 'fixed' : 'absolute' };
        next.recipe.slots.push(slot);
      }
      next.recipe.hiddenSlots = next.recipe.hiddenSlots.filter(id => id !== slot.id);
      next.decorations.push({ id: 'layer-' + newProjectId(), slotId: slot.id, name: command.name || slot.name, asset: command.asset || null, visible: true, locked: false, preserveRatio: true, props: command.props || {}, overrides: {} }); break;
    }
    case 'decoration-update': {
      const layer = next.decorations.find(d => d.id === command.id);
      if (!layer || !object(command.patch)) throw new Error('图层已删除或修改格式无效。');
      if (Object.keys(command.patch).some(k => !['name', 'slotId', 'asset', 'visible', 'locked', 'preserveRatio', 'props'].includes(k))) throw new Error('不支持的图层字段。');
      if (layer.locked && (Object.keys(command.patch).length !== 1 || command.patch.locked !== false)) throw new Error('图层已锁定，请先解锁。');
      if (command.patch.slotId && command.patch.slotId !== layer.slotId) {
        if (!next.recipe?.slots.some(s => s.id === command.patch.slotId)) throw new Error('目标插槽不存在。');
        const oldSlot = next.recipe.slots.find(s => s.id === layer.slotId);
        if (oldSlot?.sourceOwned && !next.decorations.some(d => d.id !== layer.id && d.slotId === layer.slotId)) next.recipe.hiddenSlots = [...new Set([...next.recipe.hiddenSlots, layer.slotId])];
        if (command.patch.asset === undefined && layer.asset === null) layer.asset = layerAsset(next, layer);
        next.recipe.hiddenSlots = next.recipe.hiddenSlots.filter(id => id !== command.patch.slotId);
      }
      const { props, ...rest } = command.patch; Object.assign(layer, rest);
      if (props !== undefined) {
        const scope = command.scope || 'base'; if (!Object.hasOwn(next.rules, scope)) throw new Error('图层断点不存在。');
        if (scope === 'base') layer.props = validateLayerProps(props); else layer.overrides[scope] = validateLayerProps(props);
      }
      break;
    }
    case 'decoration-duplicate': {
      const layer = next.decorations.find(d => d.id === command.id); if (!layer) throw new Error('图层已删除。');
      next.decorations.push({ ...clone(layer), id: 'layer-' + newProjectId(), name: layer.name.slice(0, 110) + ' · 副本', locked: false }); break;
    }
    case 'decoration-remove': {
      const layer = next.decorations.find(d => d.id === command.id); if (!layer) throw new Error('图层已删除。'); if (layer.locked) throw new Error('请先解锁图层。');
      next.decorations = next.decorations.filter(d => d.id !== layer.id);
      if (!next.decorations.some(d => d.slotId === layer.slotId) && next.recipe?.slots.some(s => s.id === layer.slotId && s.sourceOwned)) next.recipe.hiddenSlots = [...new Set([...next.recipe.hiddenSlots, layer.slotId])];
      break;
    }
    case 'import-theme': return createProject(validateTheme(command.theme));
    case 'import-project': return validateProject(command.project);
    default: throw new Error('未知命令。');
  }
  return validateProject(next);
}

export function compileOverrides(project) {
  const compile = scope => TARGETS.flatMap(target => {
    const props = project.rules[scope][target.id];
    if (!props || !Object.keys(props).length) return [];
    if (isDrawer(target.id)) {
      const geometryKeys = ['left', 'top', 'width', 'height', 'max-height', 'max-width', 'margin-left', 'margin-top', 'min-height'];
      const geometry = Object.fromEntries(Object.entries(props).filter(([key]) => geometryKeys.includes(key)));
      const appearance = Object.fromEntries(Object.entries(props).filter(([key]) => !geometryKeys.includes(key)));
      return [[target.selector, appearance], [`${target.selector}:not(.maximized)`, geometry]].flatMap(([selector, values]) => {
        if (!Object.keys(values).length) return [];
        const declarations = Object.entries(values).map(([k,v]) => `  ${k}: ${v} !important;`);
        declarations.push(...drawerDeclarations(target, values));
        if ('border-width' in values) declarations.push('  border-style: solid !important;');
        return `/* ${target.name} */\n${selector} {\n${declarations.join('\n')}\n}`;
      });
    }
    const avatar = messagePart(target.id) === 'avatar';
    const avatarSelector = target.elementSelector || '#chat .mes .avatar';
    const geometry = avatar ? Object.entries(props).filter(([k]) => CANVAS_PROPERTIES.includes(k)) : [];
    const declarations = Object.entries(props).filter(([k]) => !geometry.some(([g]) => g === k)).map(([k, v]) => `  ${k}: ${v} !important;`);
    declarations.push(...drawerDeclarations(target, props));
    if ('border-width' in props) declarations.push('  border-style: solid !important;');
    if (target.alternateSelector) return [target.selector, target.alternateSelector].map(selector => `/* ${target.name} */\n${selector} {\n${declarations.join('\n')}\n}`);
    return [declarations.length && `/* ${target.name} */\n${target.selector} {\n${declarations.join('\n')}\n}`, geometry.length && `/* 头像几何只作用于外框，避免图片重复偏移 */\n${avatarSelector} {\n${geometry.map(([k, v]) => `  ${k}: ${v} !important;`).join('\n')}\n}`, avatar && props.width && `${avatarSelector} img { width: 100% !important; max-width: 100% !important; }`].filter(Boolean);
  }).join('\n\n');
  const base = compile('base');
  const responsive = (project.breakpoints || defaultBreakpoints()).map(b => { const css = compile(b.id); return css && `@media ${b.condition} {\n${css}\n}`; });
  return [base, ...responsive, compileDecorations(project), project.customCss].filter(Boolean).join('\n\n');
}
export function exportTheme(project) {
  const p = validateProject(project);
  return { ...clone(p.baseTheme), name: p.name, custom_css: [rewriteVariables(p.baseTheme.custom_css || '', p.variableEdits), compileOverrides(p)].filter(Boolean).join('\n\n/* Tavern Theme Studio */\n') };
}
export function ruleCount(project) {
  return Object.keys(project.variableEdits || {}).length + Object.values(project.rules).reduce((sum, scope) => sum + Object.values(scope).reduce((n, props) => n + Object.keys(props).length, 0), 0) + (project.decorations || []).filter(d => d.asset || !d.visible || Object.keys(d.props).length || Object.keys(d.overrides).length).length;
}

export class ProjectHistory {
  constructor(project = createProject()) { this.project = validateProject(project); this.past = []; this.future = []; this.revision = 0; }
  snapshot() { return { project: clone(this.project), revision: this.revision, canUndo: this.past.length > 0, canRedo: this.future.length > 0 }; }
  execute(command, expectedRevision) {
    if (expectedRevision !== this.revision) { const error = new Error('工程已被另一处更新，请刷新后重试。'); error.status = 409; throw error; }
    if (command.type === 'undo') {
      if (!this.past.length) return this.snapshot();
      this.future.push(this.project); this.project = this.past.pop();
    } else if (command.type === 'redo') {
      if (!this.future.length) return this.snapshot();
      this.past.push(this.project); this.project = this.future.pop();
    } else {
      const next = applyCommand(this.project, command);
      if (JSON.stringify(next) === JSON.stringify(this.project)) return this.snapshot();
      this.past.push(this.project); this.project = next; this.future = [];
      if (this.past.length > 100) this.past.shift();
    }
    this.revision++;
    return this.snapshot();
  }
}
