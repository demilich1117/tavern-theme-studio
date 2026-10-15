import { edgePlacement, edgeDistances, sliceSides } from '/shared/decoration-tools.js';
import { layerAsset } from '/shared/decorations.js';
import { resolveAssetUrls } from '/shared/assets.js';

const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
const hint = (parent, text) => parent.append(el('p', text, 'panel-hint'));
const button = (parent, text, action, disabled = false) => { const b = el('button', text); b.type = 'button'; b.disabled = disabled; b.addEventListener('click', action); parent.append(b); return b; };
function input(parent, label, value, type = 'text') { const wrap = el('label', null, 'layer-field'), n = el('input'); n.type = type; n.value = value ?? ''; n.setAttribute('aria-label', label); wrap.append(el('span', label), n); parent.append(wrap); return n; }

export function renderDecorationTools(parent, { project, layer, slot, props, scope, inspection, save, review, canReview }) {
  if (!slot) return;
  const locked = layer.locked, own = scope === 'base' ? layer.props : layer.overrides[scope] || {};
  if (slot.geometry) {
    const section = el('section', null, 'decoration-tool'), heading = el('h4', '装饰贴边'); section.append(heading); parent.append(section);
    const current = edgeDistances(props), fitting = props.frame === 'container', grid = el('div', null, 'anchor-grid'); grid.setAttribute('aria-label', '装饰九宫格贴边');
    const labels = ['左上', '上中', '右上', '左中', '居中', '右中', '左下', '下中', '右下'];
    for (const [i, label] of labels.entries()) {
      const x = i % 3 / 2, y = Math.floor(i / 3) / 2;
      const b = button(grid, label, () => save(edgePlacement(x, y, current?.horizontal || 0, current?.vertical || 0)), locked || fitting);
      b.setAttribute('aria-pressed', String(current?.x === x && current?.y === y)); b.setAttribute('aria-label', `贴${label}`);
    }
    section.append(grid);
    hint(section, fitting ? '当前边框随整个容器伸展，贴边与固定尺寸暂不参与；原参数保留。' : current ? '正数向容器内留白，负数向外悬挂；居中时正数向右／向下。' : '当前沿用源码或自定义锚点。选一个位置，将图片同侧角与容器对齐。');
    if (current && !fitting) {
      const fields = el('div', null, 'layer-fields'); section.append(fields);
      const h = input(fields, current.x === 0 ? '距左边 px' : current.x === 1 ? '距右边 px' : '水平中心偏移 px', current.horizontal, 'number');
      const v = input(fields, current.y === 0 ? '距上边 px' : current.y === 1 ? '距下边 px' : '垂直中心偏移 px', current.vertical, 'number');
      for (const n of [h, v]) { n.min = -10000; n.max = 10000; n.step = 1; n.disabled = locked; n.addEventListener('change', () => { if (h.value !== '' && v.value !== '' && h.validity.valid && v.validity.valid) save(edgePlacement(current.x, current.y, +h.value, +v.value)); }); }
    }
    button(section, '还原此尺寸的贴边', () => save({ anchor: undefined, x: undefined, y: undefined }), locked || !['anchor', 'x', 'y'].some(k => own[k] !== undefined));
  }
  if (slot.method !== 'nine-slice') return;
  const section = el('section', null, 'decoration-tool'); section.append(el('h4', '长文适配')); parent.append(section);
  hint(section, '四角保持形状，边缘随容器拉伸或重复。适用于消息边框；独立花饰和头像挂件使用贴边。');
  const frameRow = el('div', null, 'inline-controls'); section.append(frameRow);
  const fitting = props.frame === 'container';
  button(frameRow, fitting ? '已随容器伸展' : '让边框随容器伸展', () => save({ frame: 'container' }), locked || fitting || !inspection?.canFrame);
  button(frameRow, '还原此尺寸的伸展', () => save({ frame: undefined }), locked || own.frame === undefined);
  if (fitting) hint(section, `边框跟随目标容器的宽高，不设置消息高度。${scope !== 'base' && !own.frame ? '此项继承基础；需切换基础尺寸才能取消。' : '还原后恢复此前的位置与尺寸。'}`);
  else if (!inspection?.canFrame) hint(section, inspection?.error || inspection?.frameReason || '等待真实画面的定位检查。连接新版连接器并进入测试对话后可启用。');

  const repeatWrap = el('label', null, 'layer-field'), repeat = el('select'); repeat.setAttribute('aria-label', '边缘延展方式');
  for (const [value, name] of [['', '沿用基础／源码'], ['stretch', '拉伸边缘'], ['repeat', '重复边缘'], ['round', '整段铺满'], ['space', '间隔平铺']]) repeat.add(new Option(name, value));
  repeat.value = own.repeat || ''; repeat.disabled = locked; repeat.addEventListener('change', () => save({ repeat: repeat.value || undefined })); repeatWrap.append(el('span', '边缘延展方式'), repeat); section.append(repeatWrap);
  hint(section, `当前读取：${inspection?.repeat || props.repeat || '待连接'}。有规律的花纹可试“整段铺满”；接缝仍需在真实消息上检查。`);

  const detail = el('details', null, 'slice-editor'); detail.append(el('summary', '切片边界与绘制边宽')); section.append(detail);
  const source = props.slice || inspection?.slice || (!slot.sourceOwned ? '25%' : ''), parsed = sliceSides(source);
  const art = layerAsset(project, layer), imageBox = el('div', null, 'slice-image'), image = el('img');
  image.alt = '原图切片边界示意'; image.referrerPolicy = 'no-referrer'; if (art) { image.src = resolveAssetUrls(art, location.origin); imageBox.append(image); detail.append(imageBox); }
  const fields = el('div', null, 'slice-fields'); detail.append(fields);
  const sides = ['上', '右', '下', '左'].map((label, i) => input(fields, `切片${label}边`, parsed?.sides[i]));
  const fillWrap = el('label', null, 'layer-field'), fill = el('input'); fill.type = 'checkbox'; fill.checked = parsed?.fill || false; fill.setAttribute('aria-label', '填充边框中心'); fillWrap.append(el('span', '填充中心'), fill); detail.append(fillWrap);
  const width = input(detail, '绘制边宽', props.edgeWidth || inspection?.edgeWidth || (!slot.sourceOwned ? '12px' : ''));
  width.placeholder = '例如 16px 或 16px 24px 16px 24px';
  for (const n of [...sides, fill, width]) n.disabled = locked;
  const guide = () => {
    imageBox.querySelectorAll('i').forEach(n => n.remove());
    sides.forEach((n, i) => {
      if (!/^\d+(?:\.\d+)?%?$/.test(n.value.trim())) return;
      const raw = n.value.trim(), dimension = i % 2 ? image.naturalWidth : image.naturalHeight;
      const percent = raw.endsWith('%') ? parseFloat(raw) : dimension ? parseFloat(raw) / dimension * 100 : NaN;
      if (!Number.isFinite(percent)) return;
      const line = el('i'); line.style[['top', 'right', 'bottom', 'left'][i]] = `${Math.min(100, percent)}%`; line.className = i % 2 ? 'vertical' : 'horizontal'; imageBox.append(line);
    });
  };
  image.addEventListener('load', guide); sides.forEach(n => n.addEventListener('input', guide)); guide();
  hint(detail, '边界支持原图数值或百分比（如 24 或 25%），顺序为上、右、下、左。蓝线是原图分区，边宽是画面中的绘制厚度；不会自动修补素材接缝。');
  button(detail, '应用切片与边宽', () => {
    const value = sides.map(n => n.value.trim()).join(' ') + (fill.checked ? ' fill' : '');
    save({ slice: value, edgeWidth: width.value.trim() || undefined });
  }, locked);
  button(detail, '还原此尺寸的切片', () => save({ slice: undefined, edgeWidth: undefined, repeat: undefined }), locked || !['slice', 'edgeWidth', 'repeat'].some(k => own[k] !== undefined));

  const check = el('div', null, 'long-check'); check.append(el('h4', '在真实消息中检查')); section.append(check);
  const role = el('select'); role.setAttribute('aria-label', '长文检查角色'); role.add(new Option('角色消息', 'assistant')); role.add(new Option('用户消息', 'user')); role.value = /is_user\s*=\s*["']?true/.test(slot.selector) ? 'user' : 'assistant'; check.append(role);
  const buttons = el('div', null, 'long-check-actions'); check.append(buttons);
  for (const [caption, position, long] of [['短消息', 'start', false], ['长文顶部', 'start', true], ['长文中段', 'center', true], ['长文底部', 'end', true]]) button(buttons, caption, () => review(role.value === 'user' ? long ? 'long-user' : 'chat' : long ? 'long' : 'short-assistant', position), !canReview);
  hint(check, '只滚动虚构测试对话，不改消息。旧测试副本缺少用户长文时，在“更多工具”中选择“新建测试副本”；原副本保留。');
}
