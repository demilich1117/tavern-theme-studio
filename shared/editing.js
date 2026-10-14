import { CANVAS_TARGETS } from './canvas.js';
// Small, DOM-free contracts shared by the inspector and the native connector.
export function matchesWidth(condition, width) {
  const match = /^\((min|max)-width: (\d+)px\)$/.exec(condition || '');
  return !!match && Number.isFinite(width) && (match[1] === 'min' ? width >= +match[2] : width <= +match[2]);
}
export function activeRules(project, target, width) {
  return Object.assign({}, project?.rules.base[target], ...(project?.breakpoints || []).filter(b => matchesWidth(b.condition, width)).map(b => project.rules[b.id]?.[target]));
}
export function colorParts(value, fallback = '#000000') {
  if (value === 'transparent') return { hex: '#000000', alpha: 0 };
  const hex = /^#([a-f\d]{6})([a-f\d]{2})?$/i.exec(value || '');
  if (hex) return { hex: '#' + hex[1].toLowerCase(), alpha: hex[2] ? parseInt(hex[2], 16) / 255 : 1 };
  const rgb = /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value || '');
  if (rgb) return { hex: '#' + rgb.slice(1, 4).map(v => Math.min(255, Math.round(+v)).toString(16).padStart(2, '0')).join(''), alpha: rgb[4] === undefined ? 1 : Math.min(1, +rgb[4]) };
  return { hex: fallback, alpha: 1 };
}
export function colorValue(hex, alpha) { return alpha >= 1 ? hex : hex + Math.round(Math.max(0, alpha) * 255).toString(16).padStart(2, '0'); }
export function paddingSides(value) {
  const parts = String(value || '').trim().split(/\s+/);
  if (!parts.length || parts.length > 4 || parts.some(v => !/^\d+(?:\.\d+)?px$/.test(v))) return null;
  const [top, right = top, bottom = top, left = right] = parts;
  return [top, right, bottom, left].map(parseFloat);
}
const textOnly = new Set(['name', 'timestamp']);
const noText = new Set(['avatar', 'assistant-before', 'assistant-after']);
export function supportsField(target, key) {
  if (['margin-left', 'margin-top', 'min-height'].includes(key)) return CANVAS_TARGETS.includes(target);
  if (textOnly.has(target)) return ['color', 'font-size', 'line-height', 'opacity', 'margin-bottom'].includes(key);
  if (noText.has(target) && ['color', 'font-size', 'line-height'].includes(key)) return false;
  return true;
}
export function sameValue(key, requested, actual) {
  if (actual === undefined || requested === undefined) return false;
  if (key.endsWith('color')) { const a = colorParts(requested), b = colorParts(actual); return a.hex === b.hex && Math.abs(a.alpha - b.alpha) < .006; }
  if (key === 'padding') { const a = paddingSides(requested), b = paddingSides(actual); return !!a && !!b && a.every((n, i) => Math.abs(n - b[i]) < .1); }
  const a = parseFloat(requested), b = parseFloat(actual);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) < (key === 'width' ? .6 : .05) : requested === actual;
}
