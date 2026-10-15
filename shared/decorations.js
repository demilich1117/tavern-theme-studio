import { scanVariables } from './variables.js';
import { ASSET_ID, cssImage, externalImageUrl } from './assets.js';

const object = v => v && typeof v === 'object' && !Array.isArray(v);
const text = (v, label, max = 120) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`${label}无效。`); return v.trim(); };
const key = v => /^[a-z][\w-]{0,95}$/.test(v);
const number = (v, min, max) => { if (!Number.isFinite(v) || v < min || v > max) throw new Error('图层参数超出范围。'); return Math.round(v * 1000) / 1000; };
const selector = v => { text(v, '装饰选择器', 1000); if (/[{};<@\\]/.test(v)) throw new Error('装饰选择器含不支持字符。'); return v; };
export function imageReference(value) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('请选择有效图片引用。');
  if (value.startsWith('tts-asset://') && ASSET_ID.test(value.slice(12))) return value;
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z\d+/]+=*$/i.test(value) && value.length < 45 * 1048576) return value;
  return externalImageUrl(value);
}
export function validateRecipe(value) {
  if (value == null) return null;
  if (!object(value) || value.schemaVersion !== 1 || !key(value.id) || !Array.isArray(value.slots) || value.slots.length > 200) throw new Error('主题配方格式无效。');
  const ids = new Set();
  const recipe = { schemaVersion: 1, id: value.id, name: text(value.name, '配方名称'), version: text(value.version, '配方版本'), slots: [] };
  recipe.slots = value.slots.map(s => {
    if (!object(s) || !key(s.id) || ids.has(s.id) || !['background', 'nine-slice'].includes(s.method) || !['', '::before', '::after', '::-webkit-scrollbar-thumb'].includes(s.pseudo || '')) throw new Error('装饰插槽无效或重复。');
    ids.add(s.id);
    const slot = { id: s.id, name: text(s.name, '插槽名称'), group: text(s.group || '装饰', '分组'), selector: selector(s.selector), pseudo: s.pseudo || '', method: s.method, sourceOwned: s.sourceOwned === true, geometry: s.geometry !== false, position: s.position === 'fixed' ? 'fixed' : 'absolute' };
    if (slot.selector.includes('::') || (!slot.pseudo && (!slot.sourceOwned || slot.geometry)) || (slot.pseudo === '::-webkit-scrollbar-thumb' && (slot.geometry || slot.method !== 'background'))) throw new Error('请使用独立装饰伪元素；原生控件仅支持声明的背景/边框换图。');
    if (s.assetVariable !== undefined) { if (!/^--[\w-]+$/.test(s.assetVariable)) throw new Error('配方素材变量无效。'); slot.assetVariable = s.assetVariable; }
    if (s.assetContext) slot.assetContext = text(s.assetContext, '素材变量上下文', 1000);
    if (slot.sourceOwned && !slot.assetVariable) throw new Error('已有插槽需声明素材变量所有权。');
    if (s.condition) { if (!/^\((?:min|max)-width: \d{1,5}px\)$/.test(s.condition)) throw new Error('配方条件暂支持单一宽度条件。'); slot.condition = s.condition; }
    if (s.aspectRatio !== undefined) slot.aspectRatio = number(s.aspectRatio, 0.001, 1000);
    if (s.exclude) { if (!Array.isArray(s.exclude) || s.exclude.length > 20) throw new Error('插槽排除列表无效。'); slot.exclude = s.exclude.map(selector); }
    if (s.note) slot.note = text(s.note, '用途说明', 1000);
    return slot;
  });
  if (value.hiddenSlots !== undefined && !Array.isArray(value.hiddenSlots)) throw new Error('已移除插槽列表无效。');
  recipe.hiddenSlots = (value.hiddenSlots || []).map(id => { if (!ids.has(id)) throw new Error('已移除插槽不存在。'); return id; });
  if (recipe.hiddenSlots.length > 200 || new Set(recipe.hiddenSlots).size !== recipe.hiddenSlots.length) throw new Error('已移除插槽过多或重复。');
  const variables = value.variables || [];
  if (!Array.isArray(variables) || variables.length > 500) throw new Error('配方变量无效。');
  recipe.variables = variables.map(v => { if (!object(v) || !/^--[\w-]+$/.test(v.name)) throw new Error('配方变量无效。'); const item = { name: v.name, label: text(v.label, '变量标签'), group: text(v.group || '主题', '变量分组') }; if (v.context) item.context = text(v.context, '变量上下文', 1000); if (v.min !== undefined) item.min = number(v.min, -100000, 100000); if (v.max !== undefined) item.max = number(v.max, -100000, 100000); return item; });
  return recipe;
}
export function validateLayer(value, scopes) {
  if (!object(value) || !key(value.id) || !key(value.slotId)) throw new Error('图层身份或插槽无效。');
  for (const flag of ['visible', 'locked', 'preserveRatio']) if (value[flag] !== undefined && typeof value[flag] !== 'boolean') throw new Error('图层开关需为布尔值。');
  const layer = { id: value.id, slotId: value.slotId, name: text(value.name, '图层名称'), asset: imageReference(value.asset ?? null), visible: value.visible !== false, locked: value.locked === true, preserveRatio: value.preserveRatio !== false, props: validateLayerProps(value.props || {}), overrides: {} };
  if (!object(value.overrides || {})) throw new Error('图层尺寸覆盖无效。');
  for (const [scope, props] of Object.entries(value.overrides || {})) { if (!scopes.has(scope) || scope === 'base') throw new Error('图层断点不存在。'); layer.overrides[scope] = validateLayerProps(props); }
  return layer;
}
export function validateLayerProps(value) {
  if (!object(value)) throw new Error('图层参数格式无效。');
  const result = {}, ranges = { x: [-10000, 10000], y: [-10000, 10000], scale: [0.05, 10], rotation: [-360, 360], opacity: [0, 1], order: [-9999, 9999] };
  for (const [k, v] of Object.entries(value)) {
    if (ranges[k]) result[k] = number(v, ...ranges[k]);
    else if (['width', 'height'].includes(k)) { if (typeof v !== 'string' || !/^(?:\d+(?:\.\d+)?)(?:px|%|vw|vh)$/.test(v) || parseFloat(v) <= 0 || parseFloat(v) > 10000) throw new Error('尺寸需为正数 px/%/vw/vh。'); result[k] = v; }
    else if (k === 'anchor') { if (!object(v)) throw new Error('锚点无效。'); result.anchor = Object.fromEntries(['containerX', 'containerY', 'imageX', 'imageY'].map(a => [a, number(v[a], 0, 1)])); }
    else if (['slice', 'edgeWidth'].includes(k)) {
      if (typeof v !== 'string' || v.length > 100) throw new Error('九切片参数无效。');
      const parts = v.trim().split(/\s+/), fill = parts.at(-1) === 'fill'; if (fill) parts.pop();
      const pattern = k === 'slice' ? /^\d+(?:\.\d+)?%?$/ : /^\d+(?:\.\d+)?(?:%|px)?$/;
      if (!parts.length || parts.length > 4 || parts.some(n => !pattern.test(n) || parseFloat(n) > 10000) || (fill && k !== 'slice')) throw new Error('九切片需为 1–4 个数字/百分比，边宽可使用 px。');
      result[k] = [...parts, ...(fill ? ['fill'] : [])].join(' ');
    }
    else if (k === 'fit' && ['contain', 'cover'].includes(v)) result.fit = v;
    else if (k === 'repeat' && ['stretch', 'repeat', 'round', 'space'].includes(v)) result.repeat = v;
    else if (k === 'frame' && v === 'container') result.frame = v;
    else throw new Error(`不支持的图层参数：${k}`);
  }
  if (result.order !== undefined && !Number.isInteger(result.order)) throw new Error('图层顺序需为整数。');
  return result;
}
export function layersFromRecipe(recipe) {
  return recipe.slots.filter(s => !recipe.hiddenSlots.includes(s.id)).map(s => ({ id: `layer-${s.id}`, slotId: s.id, name: s.name, asset: null, visible: true, locked: false, preserveRatio: true, props: {}, overrides: {} }));
}
export function mergeRecipe(project, fresh) {
  fresh = validateRecipe(fresh);
  if (!fresh) return project;
  if (!project.recipe) { project.recipe = fresh; project.decorations = layersFromRecipe(fresh); return project; }
  if (project.recipe.id !== fresh.id) throw Object.assign(new Error('源码配方身份改变，已有图层保持；请明确导入新工程。'), { status: 409 });
  const previousIds = new Set(project.recipe.slots.map(s => s.id));
  fresh.slots.push(...project.recipe.slots.filter(s => !s.sourceOwned && !fresh.slots.some(n => n.id === s.id)));
  fresh.hiddenSlots = project.recipe.hiddenSlots.filter(id => fresh.slots.some(s => s.id === id));
  project.decorations.push(...layersFromRecipe(fresh).filter(l => !previousIds.has(l.slotId)));
  project.recipe = fresh; return project;
}
export function splitSelectors(value) {
  const parts = []; let start = 0, depth = 0, quote = '';
  for (let i = 0; i < value.length; i++) { const c = value[i]; if (quote) { if (c === quote && value[i - 1] !== '\\') quote = ''; } else if (c === '"' || c === "'") quote = c; else if ('(['.includes(c)) depth++; else if (')]'.includes(c)) depth--; else if (c === ',' && !depth) { parts.push(value.slice(start, i).trim()); start = i + 1; } }
  parts.push(value.slice(start).trim()); return parts;
}
const canonical = s => s.replace(/\s+/g, ' ').replace(/\s*([>+~])\s*/g, '$1').replace(/\[([\w-]+)=["']?([^\]"']+)["']?\]/g, '[$1=$2]').trim();
export const slotSelector = s => splitSelectors(s.selector).map(v => v + s.pseudo).join(', ');
export function effectiveLayer(project, layer, scope = 'base') { return { ...layer, props: { ...layer.props, ...(scope === 'base' ? {} : layer.overrides[scope]) } }; }
export function layerAsset(project, layer) {
  if (layer.asset) return layer.asset;
  const slot = project.recipe?.slots.find(s => s.id === layer.slotId);
  const found = scanVariables(project.baseTheme.custom_css || '').filter(v => v.name === slot?.assetVariable && (!slot.assetContext || v.context === slot.assetContext));
  if (found.length !== 1) return null;
  const value = project.variableEdits[found[0].id] ?? found[0].value;
  const match = value.match(/^url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)$/); return match ? match[1] ?? match[2] ?? match[3].trim() : null;
}
function sourceRules(css) {
  const result = [], stack = []; let boundary = 0, quote = '', comment = false;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (comment) { if (c === '*' && css[i + 1] === '/') { comment = false; i++; } continue; }
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '/' && css[i + 1] === '*') { comment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') { stack.push({ header: css.slice(boundary, i).replace(/\/\*[\s\S]*?\*\//g, ' ').trim(), start: i + 1 }); boundary = i + 1; }
    else if (c === '}') { const block = stack.pop(); if (block && block.header && !block.header.startsWith('@')) result.push(...splitSelectors(block.header).map(s => ({ selector: canonical(s), declarations: css.slice(block.start, i) }))); boundary = i + 1; }
    else if (c === ';') boundary = i + 1;
  }
  return result;
}
export function decorationDiagnostics(project) {
  const result = [], rules = sourceRules(project.baseTheme.custom_css || ''), advanced = sourceRules(project.customCss || ''), used = new Map(), variables = scanVariables(project.baseTheme.custom_css || '');
  const hidden = (project.recipe?.hiddenSlots || []).map(slotId => ({ id: `hidden-${slotId}`, slotId, props: {}, overrides: {} }));
  for (const layer of [...(project.decorations || []), ...hidden]) {
    const slot = project.recipe?.slots.find(s => s.id === layer.slotId);
    const error = message => result.push({ layerId: layer.id, slotId: layer.slotId, level: 'error', message });
    if (!slot) { error('目标插槽已删除，请对照快照重新定位。'); continue; }
    const names = splitSelectors(slotSelector(slot)).map(canonical);
    const physical = names.join(',') + '|' + (slot.condition || '');
    if (used.has(physical)) { error('同一插槽已有图层；请选择另一空闲插槽。'); result.push({ layerId: used.get(physical), slotId: slot.id, level: 'error', message: '同一插槽被多个图层占用；未应用覆盖。' }); } else used.set(physical, layer.id);
    const matches = rules.filter(r => names.includes(r.selector));
    const bindings = variables.filter(v => v.name === slot.assetVariable && (!slot.assetContext || v.context === slot.assetContext));
    const ownedVariable = new RegExp('var\\(\\s*' + (slot.assetVariable || '--unused') + '\\s*(?:,|\\))');
    if (slot.sourceOwned && (bindings.length !== 1 || bindings[0].ambiguous || !matches.some(r => ownedVariable.test(r.declarations)))) error('源码已改变插槽素材声明或绑定不唯一；未应用覆盖，请修复配方。');
    const occupied = r => [...r.declarations.matchAll(/(?:^|;)\s*(content|background(?:-image)?|border-image(?:-source)?)\s*:\s*([^;]*)/g)].some(m => !/^(?:none|normal)\s*(?:!important)?\s*$/.test(m[2].trim()));
    if (!slot.sourceOwned && matches.some(occupied)) error('原主题已占用此伪元素；保留原效果，请选择空闲插槽。');
    if (!slot.geometry && [layer.props, ...Object.values(layer.overrides || {})].some(p => Object.keys(p).some(k => !['slice', 'edgeWidth', 'fit', 'repeat'].includes(k)))) error('此插槽附着原生控件，仅支持换图/九切片参数，不能变换整个控件。');
    if ([layer.props, ...Object.values(layer.overrides || {})].some(p => slot.method === 'nine-slice' ? p.fit !== undefined : p.slice !== undefined || p.edgeWidth !== undefined || p.repeat !== undefined || p.frame !== undefined)) error('绘制参数与插槽方式不匹配，请使用背景适配或九切片参数。');
    if ([layer.props, ...Object.values(layer.overrides || {})].some(p => p.frame) && (!slot.geometry || slot.position !== 'absolute' || !['::before', '::after'].includes(slot.pseudo))) error('随容器伸展需要绝对定位的独立九切片装饰，不能用于固定挂件或原生控件。');
    if (advanced.some(r => names.includes(r.selector))) result.push({ layerId: layer.id, slotId: slot.id, level: 'warning', message: '高级 CSS 也写入该插槽，最终效果可能覆盖图层参数。' });
  }
  return result;
}
function declarations(slot, layer) {
  const values = [], p = layer.props, imageProperty = slot.method === 'nine-slice' ? 'border-image-source' : 'background-image';
  if (!layer.visible) return [`${imageProperty}: none !important;`];
  if (!slot.sourceOwned) {
    values.push('content: "" !important;', `position: ${slot.position} !important;`, 'width: 120px !important;', 'height: 120px !important;', 'background-size: contain !important;', 'background-repeat: no-repeat !important;');
    if (slot.method === 'nine-slice') values.push('border: 12px solid transparent !important;', 'border-image-slice: 25% !important;', 'box-sizing: border-box !important;');
  }
  // The border shorthand resets border-image-source, even with !important.
  // Apply the selected art after default border setup so new frames are visible.
  if (layer.asset) values.push(`${imageProperty}: ${cssImage(layer.asset)} !important;`);
  if (slot.geometry) {
    const anchor = p.anchor;
    if (anchor) values.push(`left: ${anchor.containerX * 100}% !important;`, `top: ${anchor.containerY * 100}% !important;`, 'right: auto !important;', 'bottom: auto !important;', `translate: calc(${-anchor.imageX * 100}% + ${p.x || 0}px) calc(${-anchor.imageY * 100}% + ${p.y || 0}px) !important;`);
    else if (p.x !== undefined || p.y !== undefined) values.push(`translate: ${p.x || 0}px ${p.y || 0}px !important;`);
    for (const [k, property, unit] of [['scale', 'scale', ''], ['rotation', 'rotate', 'deg'], ['opacity', 'opacity', ''], ['order', 'z-index', ''], ['width', 'width', ''], ['height', 'height', '']]) if (p[k] !== undefined) values.push(`${property}: ${p[k]}${unit} !important;`);
    if (p.anchor) values.push(`transform-origin: ${p.anchor.imageX * 100}% ${p.anchor.imageY * 100}% !important;`);
    if (layer.preserveRatio && p.width && !p.height && slot.aspectRatio) {
      values.push(`aspect-ratio: ${slot.aspectRatio} !important;`, 'height: auto !important;');
      if (slot.method === 'background' && !p.fit) values.push('background-size: contain !important;');
    }
  }
  if (p.fit) values.push(`background-size: ${p.fit} !important;`);
  if (p.slice) values.push(`border-image-slice: ${p.slice} !important;`);
  if (p.edgeWidth) values.push(`border-image-width: ${p.edgeWidth} !important;`);
  if (p.repeat) values.push(`border-image-repeat: ${p.repeat} !important;`);
  if (p.frame === 'container') values.push('position: absolute !important;', 'inset: 0 !important;', 'width: auto !important;', 'height: auto !important;', 'min-width: 0 !important;', 'min-height: 0 !important;', 'max-width: none !important;', 'max-height: none !important;', 'margin: 0 !important;', 'padding: 0 !important;', 'translate: none !important;', 'transform: none !important;', 'scale: none !important;', 'rotate: none !important;', 'aspect-ratio: auto !important;', 'box-sizing: border-box !important;');
  if (values.length && slot.pseudo !== '::-webkit-scrollbar-thumb' && slot.pseudo) values.push('pointer-events: none !important;');
  return values;
}
export function compileDecorations(project) {
  if (!project.recipe) return '';
  const blocked = new Set(decorationDiagnostics(project).filter(d => d.level === 'error').map(d => d.layerId));
  const render = (slot, layer) => { const props = declarations(slot, layer); if (!props.length) return ''; let css = `${slotSelector(slot)} {\n  ${props.join('\n  ')}\n}`; if (slot.exclude && layer.asset) css += '\n' + slot.exclude.map(s => `${s}${slot.pseudo} { ${slot.method === 'nine-slice' ? 'border-image-source' : 'background-image'}: none !important; }`).join('\n'); return slot.condition ? `@media ${slot.condition} {\n${css}\n}` : css; };
  const compiled = [];
  for (const slot of project.recipe.slots.filter(s => project.recipe.hiddenSlots.includes(s.id) && !blocked.has(`hidden-${s.id}`))) compiled.push(render(slot, { asset: null, props: {}, visible: false }));
  for (const layer of project.decorations) {
    if (blocked.has(layer.id)) continue;
    const slot = project.recipe.slots.find(s => s.id === layer.slotId); if (!slot) continue;
    compiled.push(render(slot, layer));
    for (const breakpoint of project.breakpoints) if (layer.overrides[breakpoint.id]) compiled.push(`@media ${breakpoint.condition} {\n${render(slot, effectiveLayer(project, layer, breakpoint.id))}\n}`);
  }
  return compiled.filter(Boolean).join('\n\n');
}
