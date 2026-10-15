// Geometry helpers shared with tests; positive edge distances point inward.
export function edgePlacement(x, y, horizontal = 0, vertical = 0) {
  if (![0, .5, 1].includes(x) || ![0, .5, 1].includes(y) || ![horizontal, vertical].every(n => Number.isFinite(n) && Math.abs(n) <= 10000)) throw new Error('贴边距离需为 -10000 到 10000 的数字。');
  return { anchor: { containerX: x, containerY: y, imageX: x, imageY: y }, x: horizontal * (x === 1 ? -1 : 1), y: vertical * (y === 1 ? -1 : 1) };
}
export function edgeDistances(props) {
  const a = props.anchor;
  if (!a || a.containerX !== a.imageX || a.containerY !== a.imageY || ![0, .5, 1].includes(a.containerX) || ![0, .5, 1].includes(a.containerY)) return null;
  return { x: a.containerX, y: a.containerY, horizontal: (props.x || 0) * (a.containerX === 1 ? -1 : 1), vertical: (props.y || 0) * (a.containerY === 1 ? -1 : 1) };
}
export function sliceSides(value) {
  const tokens = String(value || '').trim().split(/\s+/), fill = tokens.at(-1) === 'fill';
  if (fill) tokens.pop();
  if (tokens.length < 1 || tokens.length > 4 || tokens.some(v => !/^\d+(?:\.\d+)?%?$/.test(v))) return null;
  const [top, right = top, bottom = top, left = right] = tokens;
  return { sides: [top, right, bottom, left], fill };
}
export function mergeLayerProps(layer, scope, patch) {
  const props = { ...(scope === 'base' ? layer.props : layer.overrides[scope]) };
  for (const [key, value] of Object.entries(patch)) { if (value === undefined) delete props[key]; else props[key] = value; }
  return props;
}
