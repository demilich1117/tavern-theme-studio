import { controlKind, isDrawer } from '/shared/drawer-parts.js';
import { FIELDS } from '/shared/core.js';
import { colorParts, colorValue, paddingSides, supportsField, sameValue, scopeExplanation } from '/shared/editing.js';

const node = (tag, className) => { const el = document.createElement(tag); if (className) el.className = className; return el; };
export function attachInspector({ getContext, change, select, openLayer, resetScope }) {
  const host = document.querySelector('#property-fields'), rows = new Map();
  const related = node('div', 'selection-related'); related.setAttribute('aria-label', '相关部件与装饰'); host.before(related);
  const scopeBox = node('details', 'scope-explanation'), scopeTitle = node('summary'), scopeBody = node('div'); scopeBox.id = 'scope-explanation'; scopeBox.append(scopeTitle, scopeBody); host.before(scopeBox);
  for (const group of ['文字', '形状与留白', '位置与尺寸', '色彩']) {
    const section = node('section'), heading = node('h3'); heading.textContent = group; section.append(heading); host.append(section);
    for (const field of FIELDS.filter(f => f.group === group)) {
      const row = node('div', 'field'); row.id = `field-${field.key}`;
      const labelRow = node('div', 'field-label'), label = node('label'), source = node('span', 'field-source');
      label.htmlFor = `prop-${field.key}`; label.textContent = field.label; labelRow.append(label, source);
      const controls = node('div', 'field-input'), input = node(field.type === 'select' ? 'select' : 'input'); if (field.type === 'select') { for (const [value,label] of field.options) input.add(new Option(label,value)); } else input.type = field.type; input.id = label.htmlFor; input.setAttribute('aria-label', field.label);
      const exact = node('input', 'property-exact'); exact.type = field.type === 'color' ? 'text' : 'number'; exact.hidden = field.type === 'select'; exact.setAttribute('aria-label', `${field.label}精确值`);
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
        if (field.type === 'select') return input.value;
        if (control === exact) return field.type === 'color' ? exact.value.trim() : `${exact.value}${unit?.value || field.unit}`;
        if (sides?.includes(control)) return sides.map(side => `${side.value}px`).join(' ');
        if (control === alpha) preciseAlpha = +alpha.value / 100;
        return field.type === 'color' ? colorValue(input.value, preciseAlpha) : `${input.value}${unit?.value || field.unit}`;
      };
      for (const control of [input, exact, alpha, ...(sides || [])].filter(Boolean)) {
        control.addEventListener('input', () => {
          if (field.type === 'select' || control === exact || sides?.includes(control)) return; // Text entry commits on blur/Enter; no malformed intermediate values.
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
        change(field.key, `${Math.max(unit.value === 'px' ? 1 : 20, Math.min(unit.value === 'px' ? 4096 : 100, n))}${unit.value}`, false);
      });
      controls.append(input, exact, reset); row.append(labelRow, controls, feedback); if (alpha || sides) row.append(extras); section.append(row);
      if (unit) controls.insertBefore(unit, reset);
      rows.set(field.key, { row, section, input, exact, unit, source, reset, feedback, alpha, alphaOutput, summary, sides, setAlpha: value => { preciseAlpha = value; } });
    }
  }
  function render() {
    const { project, target, scope, inspection, comparing, drafting } = getContext();
    const current = inspection?.id === target ? inspection : undefined;
    const explanation = scopeExplanation(project, target, scope, current?.width);
    scopeTitle.textContent = `尺寸覆盖 · ${explanation.name}${current?.width ? ` · 画面 ${current.width}px` : ''}`;
    scopeBody.replaceChildren();
    const describe = text => { const p = node('p', 'panel-hint'); p.textContent = text; scopeBody.append(p); };
    describe(scope === 'base' ? '基础修改适用于所有尺寸；命中的尺寸覆盖可以替换同一属性。' : `${explanation.name}：仅在 ${explanation.condition} 时生效；未填写的属性沿用基础或原主题。`);
    describe(current ? `画面命中：${explanation.matching.map(b => b.name).join('、') || '仅基础'}。${explanation.active ? '' : '当前正在编辑的尺寸未命中，修改会保存，但不会显示在此画面。'}` : '等待真实画面读取，暂时无法判断命中的尺寸。');
    const keys = [...new Set([...Object.keys(explanation.base), ...Object.keys(explanation.own), ...Object.keys(explanation.effective)])];
    if (keys.length) {
      const table = node('table'); table.setAttribute('aria-label', '尺寸覆盖值对照');
      const heading = node('tr'); for (const title of ['属性', '基础', '此尺寸', '画面']) { const th = node('th'); th.textContent = title; heading.append(th); } table.append(heading);
      for (const key of keys) { const tr = node('tr'); const actualKey = key === 'width' && (explanation.effective[key] || '').endsWith('px') ? 'width-px' : key;
        for (const text of [FIELDS.find(f => f.key === key)?.label || key, explanation.base[key] ?? '原主题', scope === 'base' ? '—' : explanation.own[key] ?? '沿用', current?.values?.[actualKey] ?? '未读取']) { const td = node('td'); td.textContent = text; tr.append(td); } table.append(tr); }
      scopeBody.append(table);
    }
    describe('画面值包含原主题、共同部件和高级 CSS 的影响。上表说明本工作台的覆盖关系，不代表能判定所有 CSS 的优先级。');
    if (current?.measurementNote) describe(current.measurementNote);
    const reset = node('button'); reset.type = 'button'; reset.textContent = `还原此部件的${explanation.name}修改`; reset.disabled = !Object.keys(explanation.own).length; reset.addEventListener('click', () => resetScope(target, scope)); scopeBody.append(reset);
    related.replaceChildren();
    for (const item of current?.related || []) { const b = node('button'); b.type = 'button'; b.textContent = item.name; b.addEventListener('click', () => select(item.id)); related.append(b); }
    for (const layer of current?.layers || []) { const b = node('button'); b.type = 'button'; b.textContent = `装饰 · ${layer.name}`; b.addEventListener('click', () => openLayer(layer.id)); related.append(b); }
    related.hidden = !related.children.length;
    for (const field of FIELDS) {
      const view = rows.get(field.key), own = project.rules[scope]?.[target]?.[field.key], base = scope !== 'base' ? project.rules.base[target]?.[field.key] : undefined;
      const pixelWidth = field.key === 'width' && ((own ?? base)?.endsWith('px') || (own ?? base) === undefined && (isDrawer(target) || controlKind(target)));
      const actual = current?.values?.[pixelWidth ? 'width-px' : field.key], value = own ?? base ?? actual;
      if (view.unit) { view.unit.value = pixelWidth ? 'px' : '%'; for (const control of [view.input, view.exact]) { control.min = pixelWidth ? 1 : 20; control.max = pixelWidth ? 4096 : 100; } }
      view.row.hidden = !supportsField(target, field.key) && own === undefined;
      view.row.classList.toggle('modified', own !== undefined); view.reset.disabled = own === undefined;
      view.source.textContent = own !== undefined ? '已修改' : base !== undefined ? '继承基础' : actual !== undefined ? '当前效果' : '未覆盖';
      const later = explanation.effective[field.key] !== undefined && explanation.effective[field.key] !== own;
      view.feedback.textContent = own !== undefined && actual !== undefined ? comparing ? '正在对比原主题' : !explanation.active ? '当前画面未进入此尺寸' : later ? `本部件当前由「${explanation.sources[field.key]}」提供 ${explanation.effective[field.key]}` : sameValue(field.key, own, actual) ? '与画面值一致' : `画面值：${actual} · 请查看尺寸覆盖或样式诊断` : '';
      if (view.row.contains(document.activeElement) && drafting) continue;
      // Preserve text edits during incoming preview/heartbeat messages.
      const assign = (control, val) => { if (document.activeElement !== control || ['range', 'color'].includes(control.type)) control.value = val; };
      if (field.type === 'select') { assign(view.input, value || field.fallback); } else if (field.type === 'color') {
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
