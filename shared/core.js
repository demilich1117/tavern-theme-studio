import { rewriteVariables, scanVariables, validateVariableValue } from './variables.js';
// Self-contained illustrated themes embed raster assets in their base CSS.
export const MAX_THEME_CSS_LENGTH = 1_000_000;
export const TARGETS = [
  { id: 'global', name: '全局界面', selector: 'body', icon: '◉', note: '页面底色与基础文字；局部主题样式可能覆盖继承值。' },
  { id: 'chat', name: '聊天区域', selector: '#chat', icon: '▤', note: '消息列表的背景、宽度与留白。' },
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
  { id: 'reasoning-header', name: '思考折叠栏', selector: '#chat .mes .mes_reasoning_summary', icon: '⌄', detail: true, note: '思考区域的标题与折叠栏。' },
  { id: 'quote', name: '引用块', selector: '#chat .mes .mes_text blockquote', icon: '❞', detail: true, note: 'Markdown 引用块；普通引号文字不属于此部件。' },
  { id: 'code', name: '代码块', selector: '#chat .mes .mes_text pre', icon: '{}', detail: true, note: '代码块外框；语法高亮可能单独控制文字颜色。' },
  { id: 'table', name: '表格', selector: '#chat .mes .mes_text table', icon: '▦', detail: true, note: 'Markdown 表格整体样式。' },
  { id: 'message-buttons', name: '消息操作栏', selector: '#chat .mes .mes_buttons', icon: '⋯', detail: true, note: '消息上的编辑、复制等操作区域。' },
  { id: 'assistant-before', name: '角色消息 · 前装饰', selector: '#chat .mes[is_user="false"]::before', elementSelector: '#chat .mes[is_user="false"]', pseudo: '::before', icon: '◁', detail: true, note: '已有 ::before 装饰的样式；不会自动生成 content。' },
  { id: 'assistant-after', name: '角色消息 · 后装饰', selector: '#chat .mes[is_user="false"]::after', elementSelector: '#chat .mes[is_user="false"]', pseudo: '::after', icon: '▷', detail: true, note: '已有 ::after 装饰的样式；伪元素通过列表选择。' },
];

export const FIELDS = [
  { key: 'background-color', label: '背景颜色', type: 'color', group: '色彩', fallback: '#353941' },
  { key: 'color', label: '文字颜色', type: 'color', group: '色彩', fallback: '#e8e6e0' },
  { key: 'border-color', label: '边框颜色', type: 'color', group: '色彩', fallback: '#656970' },
  { key: 'opacity', label: '整体不透明度', type: 'range', group: '色彩', min: 0.1, max: 1, step: 0.05, unit: '', fallback: 1 },
  { key: 'font-size', label: '字号', type: 'range', group: '文字', min: 10, max: 36, step: 1, unit: 'px', fallback: 16 },
  { key: 'line-height', label: '行高', type: 'range', group: '文字', min: 1, max: 2.8, step: 0.05, unit: '', fallback: 1.7 },
  { key: 'border-radius', label: '圆角', type: 'range', group: '形状与留白', min: 0, max: 48, step: 1, unit: 'px', fallback: 12 },
  { key: 'padding', label: '内边距', type: 'range', group: '形状与留白', min: 0, max: 64, step: 1, unit: 'px', fallback: 16 },
  { key: 'margin-bottom', label: '下方间距', type: 'range', group: '形状与留白', min: 0, max: 48, step: 1, unit: 'px', fallback: 8 },
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
export function createProject(theme = { name: '新主题', custom_css: '' }) {
  return { schemaVersion: 2, name: theme.name, baseTheme: validateTheme(theme), rules: { base: {}, mobile: {} }, variableEdits: {}, customCss: '' };
}
export function normalizeValue(key, value) {
  const field = FIELDS.find(x => x.key === key);
  if (!field) throw new Error('不支持的样式属性。');
  if (value === null) return null;
  if (field.type === 'color') {
    if (typeof value !== 'string' || !/^#[a-f\d]{6}([a-f\d]{2})?$/i.test(value)) throw new Error('颜色需使用 #RRGGBB 或 #RRGGBBAA。');
    return value.toLowerCase();
  }
  const pattern = new RegExp(`^-?\\d+(?:\\.\\d+)?${field.unit}$`);
  const raw = typeof value === 'number' ? String(value) + field.unit : value;
  if (typeof raw !== 'string' || !pattern.test(raw)) throw new Error(`属性 ${key} 的单位应为 ${field.unit || '无单位'}。`);
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < field.min || n > field.max) throw new Error(`${field.label}超出范围。`);
  return `${Number(n.toFixed(3))}${field.unit}`;
}
export function validateProject(value) {
  if (!object(value) || ![1, 2].includes(value.schemaVersion)) throw new Error('不支持的工程格式或版本。');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120) throw new Error('工程名称无效。');
  const p = createProject(validateTheme(value.baseTheme));
  p.name = value.name;
  if (typeof value.customCss !== 'string' || value.customCss.length > 250000) throw new Error('高级 CSS 格式错误或过大。');
  p.customCss = value.customCss;
  if (value.schemaVersion === 2) {
    if (!object(value.variableEdits)) throw new Error('主题变量格式错误。');
    const ids = new Set(scanVariables(p.baseTheme.custom_css || '').map(v => v.id));
    for (const [id, v] of Object.entries(value.variableEdits)) {
      if (!ids.has(id)) throw new Error('变量位置已改变，请重新读取主题变量。');
      p.variableEdits[id] = validateVariableValue(v);
    }
  }
  if (!object(value.rules) || Object.keys(value.rules).some(k => !['base', 'mobile'].includes(k))) throw new Error('样式范围无效。');
  for (const scope of ['base', 'mobile']) {
    if (!object(value.rules[scope])) throw new Error('缺少样式范围。');
    for (const [target, props] of Object.entries(value.rules[scope])) {
      if (!TARGETS.some(x => x.id === target) || !object(props)) throw new Error('样式部件无效。');
      p.rules[scope][target] = {};
      for (const [key, v] of Object.entries(props)) {
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
    case 'set': {
      const { scope = 'base', target, property, value } = command;
      if (!['base', 'mobile'].includes(scope) || !TARGETS.some(x => x.id === target)) throw new Error('部件或范围无效。');
      const normalized = normalizeValue(property, value);
      next.rules[scope][target] ??= {};
      if (normalized === null) delete next.rules[scope][target][property];
      else next.rules[scope][target][property] = normalized;
      if (!Object.keys(next.rules[scope][target]).length) delete next.rules[scope][target];
      break;
    }
    case 'reset-target':
      if (!['base', 'mobile'].includes(command.scope) || !TARGETS.some(x => x.id === command.target)) throw new Error('部件或范围无效。');
      delete next.rules[command.scope][command.target];
      break;
    case 'rename': next.name = command.name; break;
    case 'custom-css': next.customCss = command.css; break;
    case 'variable': {
      const variable = scanVariables(next.baseTheme.custom_css || '').find(v => v.id === command.id);
      if (!variable) throw new Error('变量不存在，请重新读取主题变量。');
      if (command.value === null || command.value === variable.value) delete next.variableEdits[command.id];
      else next.variableEdits[command.id] = validateVariableValue(command.value);
      break;
    }
    case 'base-theme': next.baseTheme = validateTheme(command.theme); next.variableEdits = {}; break;
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
    const declarations = Object.entries(props).map(([k, v]) => `  ${k}: ${v} !important;`);
    if ('border-width' in props) declarations.push('  border-style: solid !important;');
    return [`/* ${target.name} */\n${target.selector} {\n${declarations.join('\n')}\n}`];
  }).join('\n\n');
  const base = compile('base');
  const mobile = compile('mobile');
  return [base, mobile && `@media (max-width: 767px) {\n${mobile}\n}`, project.customCss].filter(Boolean).join('\n\n');
}
export function exportTheme(project) {
  const p = validateProject(project);
  return { ...clone(p.baseTheme), name: p.name, custom_css: [rewriteVariables(p.baseTheme.custom_css || '', p.variableEdits), compileOverrides(p)].filter(Boolean).join('\n\n/* Tavern Theme Studio */\n') };
}
export function ruleCount(project) {
  return Object.keys(project.variableEdits || {}).length + Object.values(project.rules).reduce((sum, scope) => sum + Object.values(scope).reduce((n, props) => n + Object.keys(props).length, 0), 0);
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
