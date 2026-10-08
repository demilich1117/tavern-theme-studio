export const LAYOUT_TARGETS = ['stage', 'chat', 'composer', 'left', 'right', 'message-text'];
export const LAYOUT_FIELDS = [
  { key: 'display', label: '容器排版', values: ['block', 'flex', 'grid'] },
  { key: 'flex-direction', label: 'Flex 方向', values: ['row', 'column'] },
  { key: 'flex-wrap', label: 'Flex 换行', values: ['nowrap', 'wrap'] },
  { key: 'align-items', label: '交叉轴对齐', values: ['stretch', 'start', 'center', 'end'] },
  { key: 'justify-content', label: '主轴对齐', values: ['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'] },
  { key: 'gap', label: '元素间距 px' },
  { key: 'max-width', label: '最大宽度 px/%/vw' },
  { key: 'min-height', label: '最小高度 px/vh' },
  { key: 'padding-inline', label: '左右留白 px' },
  { key: 'padding-block', label: '上下留白 px' },
  { key: 'grid-template-columns', label: 'Grid 列（如 1fr 2fr）' },
  { key: 'flex-grow', label: 'Flex 剩余空间份额' },
];
export function normalizeLayoutValue(key, value) {
  const field = LAYOUT_FIELDS.find(f => f.key === key);
  if (!field) throw new Error('不支持的布局属性。');
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 160) throw new Error('布局参数需为短文本。');
  value = value.trim();
  if (field.values) { if (!field.values.includes(value)) throw new Error('布局选项无效；不支持反向排列或 DOM 重排。'); }
  else if (key === 'grid-template-columns') {
    const tokens = value.split(/\s+/);
    if (!tokens.length || tokens.length > 12 || tokens.some(t => !/^(?:\d+(?:\.\d+)?)(?:fr|px|%)$/.test(t) || parseFloat(t) <= 0 || parseFloat(t) > 10000)) throw new Error('Grid 列使用 1–12 个正数 fr/px/%。');
  } else if (key === 'flex-grow') {
    if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) > 10) throw new Error('Flex 份额范围为 0–10。');
  } else {
    const units = key === 'max-width' ? '(?:px|%|vw)' : key === 'min-height' ? '(?:px|vh)' : 'px';
    if (!new RegExp('^\\d+(?:\\.\\d+)?' + units + '$').test(value) || parseFloat(value) > (['gap', 'padding-inline', 'padding-block'].includes(key) ? 128 : 10000)) throw new Error('布局尺寸或单位无效。');
  }
  return value;
}

// Screen displacement is inverted through the measured containing-block basis.
// Translation remains CSS coordinates even under scroll, CSS zoom or rotation.
export function localDelta(basis, dx, dy) {
  const det = basis.a * basis.d - basis.b * basis.c;
  if (![basis.a, basis.b, basis.c, basis.d, dx, dy].every(Number.isFinite) || Math.abs(det) < 0.000001) throw new Error('容器变换不可逆，无法定位。');
  return { x: (basis.d * dx - basis.c * dy) / det, y: (-basis.b * dx + basis.a * dy) / det };
}
export function scaleRatio(basis, origin, initial, current) {
  const from = localDelta(basis, initial.x - origin.x, initial.y - origin.y), to = localDelta(basis, current.x - origin.x, current.y - origin.y);
  const length = from.x * from.x + from.y * from.y;
  if (length < 1) throw new Error('装饰尺寸太小，无法缩放。');
  return Math.max(0.05, (from.x * to.x + from.y * to.y) / length);
}
