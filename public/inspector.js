import { FIELDS } from '/shared/core.js';
import { colorParts, colorValue, paddingSides, supportsField, sameValue, matchesWidth } from '/shared/editing.js';

const node = (tag, className) => { const el = document.createElement(tag); if (className) el.className = className; return el; };
export function attachInspector({ getContext, change, select, openLayer }) {
  const host = document.querySelector('#property-fields'), rows = new Map();
  const related = node('div', 'selection-related'); related.setAttribute('aria-label', '相关部件与装饰'); host.before(related);
  for (const group of ['文字', '形状与留白', '位置与尺寸', '色彩']) {
    const section = node('section'), heading = node('h3'); heading.textContent = group; section.append(heading); host.append(section);
    for (const field of FIELDS.filter(f => f.group === group)) {
      const row = node('div', 'field'); row.id = `field-${field.key}`;
      const labelRow = node('div', 'field-label'), label = node('label'), source = node('span', 'field-source');
      label.htmlFor = `prop-${field.key}`; label.textContent = field.label; labelRow.append(label, source);
      const controls = node('div', 'field-input'), input = node('input'); input.type = field.type; input.id = label.htmlFor; input.setAttribute('aria-label', field.label);
      const exact = node('input', 'property-exact'); exact.type = field.type === 'color' ? 'text' : 'number'; exact.setAttribute('aria-label', `${field.label}精确值`);
      if (field.type === 'range') for (const control of [input, exact]) { control.min = field.min; control.max = field.max; control.step = field.step; }
      if (field.type === 'range') exact.step = 'any';
      const unit = field.key === 'width' ? node('select', 'property-unit') : null;
      if (unit) { unit.setAttribute('aria-label', '宽度单位'); unit.add(new Option('%', '%')); unit.add(new Option('px', 'px')); }
      const reset = node('button', 'reset-property'); reset.type = 'button'; reset.textContent = '↺'; reset.setAttribute('aria-label', `还原${field.label}`);
      const feedback = node('small', 'property-feedback'); feedback.setAttribute('aria-live', 'polite');
      const extras = node('details', 'property-details'), summary = node('summary'); extras.append(summary);
      let alpha, alphaOutput, sides;
      if (field.type === 'color') {
        summary.textContent = '透明度'; alpha = node('input'); alpha.type = 'range'; alpha.min = 0; alpha.max = 100; alpha.step = 1; alpha.setAttribute('aria-label', `${field.label}不透明度`); alphaOutput = node('output'); extras.append(alpha, alphaOutput);
      } else if (field.key === 'padding') {
        summary.textContent = '分别调整四边'; const group = node('div', 'padding-sides');
        sides = ['上', '右', '下', '左'].map(side => { const wrap = node('label'), control = node('input'); wrap.textContent = side; control.type = 'number'; control.min = field.min; control.max = field.max; control.step = field.step; control.setAttribute('aria-label', `内边距${side}侧`); wrap.append(control); group.append(wrap); return control; }); extras.append(group);
      }
      let preciseAlpha = 1;
      const value = control => {
        if (control === exact) return field.type === 'color' ? exact.value.trim() : `${exact.value}${unit?.value || field.unit}`;
        if (sides?.includes(control)) return sides.map(side => `${side.value}px`).join(' ');
        if (control === alpha) preciseAlpha = +alpha.value / 100;
        return field.type === 'color' ? colorValue(input.value, preciseAlpha) : `${input.value}${unit?.value || field.unit}`;
      };
      for (const control of [input, exact, alpha, ...(sides || [])].filter(Boolean)) {
        control.addEventListener('input', () => {
          if (control === exact || sides?.includes(control)) return; // Text entry commits on blur/Enter; no malformed intermediate values.
          if (alpha) alphaOutput.textContent = `${alpha.value}%`;
          exact.value = field.type === 'color' ? value(control) : parseFloat(value(control));
          source.textContent = '预览中'; change(field.key, value(control), true);
        });
        control.addEventListener('change', () => { if (control.type !== 'number' || control.validity.valid && control.value !== '') change(field.key, value(control), false); else render(); });
        if (control === exact || sides?.includes(control)) control.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); control.blur(); } });
      }
      reset.addEventListener('click', () => change(field.key, null, false));
      unit?.addEventListener('change', () => {
        const { inspection } = getContext(), raw = unit.value === 'px' ? inspection?.values?.['width-px'] : inspection?.values?.width;
        const n = Number.parseFloat(raw); if (!Number.isFinite(n)) return render();
        change(field.key, `${Math.max(unit.value === 'px' ? 8 : 20, Math.min(unit.value === 'px' ? 512 : 100, n))}${unit.value}`, false);
      });
      controls.append(input, exact, reset); row.append(labelRow, controls, feedback); if (alpha || sides) row.append(extras); section.append(row);
      if (unit) controls.insertBefore(unit, reset);
      rows.set(field.key, { row, section, input, exact, unit, source, reset, feedback, alpha, alphaOutput, summary, sides, setAlpha: value => { preciseAlpha = value; } });
    }
  }
  function render() {
    const { project, target, scope, inspection, comparing, drafting } = getContext();
    const current = inspection?.id === target ? inspection : undefined;
    related.replaceChildren();
    for (const item of current?.related || []) { const b = node('button'); b.type = 'button'; b.textContent = item.name; b.addEventListener('click', () => select(item.id)); related.append(b); }
    for (const layer of current?.layers || []) { const b = node('button'); b.type = 'button'; b.textContent = `装饰 · ${layer.name}`; b.addEventListener('click', () => openLayer(layer.id)); related.append(b); }
    related.hidden = !related.children.length;
    for (const field of FIELDS) {
      const view = rows.get(field.key), own = project.rules[scope]?.[target]?.[field.key], base = scope !== 'base' ? project.rules.base[target]?.[field.key] : undefined;
      const pixelWidth = field.key === 'width' && (own ?? base)?.endsWith('px');
      const actual = current?.values?.[pixelWidth ? 'width-px' : field.key], value = own ?? base ?? actual;
      if (view.unit) { view.unit.value = pixelWidth ? 'px' : '%'; for (const control of [view.input, view.exact]) { control.min = pixelWidth ? 8 : 20; control.max = pixelWidth ? 512 : 100; } }
      view.row.hidden = !supportsField(target, field.key) && own === undefined;
      view.row.classList.toggle('modified', own !== undefined); view.reset.disabled = own === undefined;
      view.source.textContent = own !== undefined ? '已修改' : base !== undefined ? '继承基础' : actual !== undefined ? '当前效果' : '未覆盖';
      const active = scope === 'base' || matchesWidth(project.breakpoints.find(b => b.id === scope)?.condition, current?.width);
      view.feedback.textContent = own !== undefined && actual !== undefined ? comparing ? '正在对比原主题' : !active ? '当前画面未进入此尺寸' : sameValue(field.key, own, actual) ? '已在画面生效' : `画面值：${actual} · 可展开下方诊断查看原因` : '';
      if (view.row.contains(document.activeElement) && drafting) continue;
      // Preserve text edits during incoming preview/heartbeat messages.
      const assign = (control, val) => { if (document.activeElement !== control || ['range', 'color'].includes(control.type)) control.value = val; };
      if (field.type === 'color') {
        const color = colorParts(value, field.fallback); view.setAlpha(color.alpha);
        assign(view.input, color.hex); assign(view.exact, value === undefined ? '' : colorValue(color.hex, color.alpha));
        assign(view.alpha, Math.round(color.alpha * 100)); view.alphaOutput.textContent = `${Math.round(color.alpha * 100)}%`;
        view.summary.textContent = `透明度 · ${Math.round(color.alpha * 100)}% 不透明`;
      } else {
        const sides = field.key === 'padding' ? paddingSides(value) : null;
        const uniform = !sides || sides.every(v => v === sides[0]);
        const n = Math.round(parseFloat(value) * 1000) / 1000, editable = uniform && Number.isFinite(n);
        assign(view.input, editable ? n : field.fallback); assign(view.exact, editable ? n : '');
        view.exact.placeholder = sides && !uniform ? '四边不同' : value || '沿用';
        view.input.setAttribute('aria-valuetext', editable ? `${n}${field.unit}` : sides ? '四边不同；拖动将统一四边' : value || '沿用主题');
        if (sides && !uniform) view.feedback.textContent ||= `上 ${sides[0]} · 右 ${sides[1]} · 下 ${sides[2]} · 左 ${sides[3]} px`;
        view.sides?.forEach((control, i) => assign(control, sides?.[i] ?? field.fallback));
      }
    }
    for (const section of host.children) section.hidden = ![...section.querySelectorAll('.field')].some(row => !row.hidden);
  }
  return { render };
}
