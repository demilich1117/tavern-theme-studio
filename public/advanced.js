import { FIELDS, applyCommand } from '/shared/core.js';
import { scanVariables, variableControl } from '/shared/variables.js';

const $ = selector => document.querySelector(selector);
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function rgba(value) {
  if (variableControl(value).type !== 'color' || !CSS.supports('color', value)) return null;
  const probe = document.createElement('span').style; probe.color = value;
  const direct = probe.color.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
  if (direct) return { hex: '#' + direct.slice(1, 4).map(n => Math.round(Number(n)).toString(16).padStart(2, '0')).join(''), alpha: Math.round(Number(direct[4] ?? 1) * 100) };
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, alpha] = ctx.getImageData(0, 0, 1, 1).data;
  return { hex: '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join(''), alpha: Math.round(alpha / 255 * 100) };
}
export function attachAdvanced({ getState, command, preview, send, toast, getSelected, isLive, isReady, setDevice, getDevice }) {
  let cssCache, variables = [], selectedSnapshot, reports = [], running = false, diagnosticSequence = 0;
  const pending = new Map();
  function refreshVariables() {
    const css = getState().project.baseTheme.custom_css || '';
    if (css !== cssCache) { cssCache = css; variables = scanVariables(css); }
    $('#variable-count').textContent = variables.length;
    if (!$('#variables-panel').hidden) renderVariables();
  }
  function renderVariables() {
    if ($('#variables-list').contains(document.activeElement) && document.activeElement.matches('input, select')) return;
    const edits = getState().project.variableEdits || {}, search = $('#variable-search').value.toLowerCase().trim();
    const shown = variables.filter(v => (!$('#variables-modified').checked || v.id in edits) && `${v.name} ${v.label} ${v.context}`.toLowerCase().includes(search));
    $('#variables-total').textContent = `${shown.length} / ${variables.length}`;
    $('#variables-list').replaceChildren();
    if (!shown.length) { $('#variables-list').append(node('p', variables.length ? '没有匹配的变量。' : '基础主题中没有可识别的变量声明。可以继续使用部件编辑，或导入包含 CSS 变量的主题。', 'empty-state')); return; }
    for (const variable of shown) {
      const current = edits[variable.id] ?? variable.value, config = variableControl(variable.value);
      const row = node('section', undefined, 'variable-row'); row.dataset.variable = variable.id;
      const head = node('div', undefined, 'variable-heading'); head.append(node('code', variable.name));
      const reset = node('button', '↺', 'quiet'); reset.title = '还原原始声明'; reset.setAttribute('aria-label', `还原变量 ${variable.name} 第 ${variable.line} 行`); reset.disabled = !(variable.id in edits);
      reset.addEventListener('click', () => command({ type: 'variable', id: variable.id, value: null }).catch(() => {})); head.append(reset); row.append(head);
      if (variable.label) row.append(node('p', variable.label, 'variable-label'));
      const context = node('p', `第 ${variable.line} 行 · ${variable.context}${variable.important ? ' · !important' : ''}`, 'variable-context'); context.title = context.textContent; row.append(context);
      // Embedded artwork is preserved in the source; don't expose a multi-KB base64
      // blob in a value control that cannot accept it under the edit size limit.
      if (current.length > 4000 && /url\(["']?data:image\//i.test(current)) {
        row.append(node('p', '内嵌图片素材 · 随工程保存。外观可用尺寸与透明度变量调整。', 'variable-label'));
        $('#variables-list').append(row);
        continue;
      }
      const input = node('input'); input.type = 'text'; input.value = current; input.spellcheck = false; input.setAttribute('aria-label', `${variable.name} 第 ${variable.line} 行的值`);
      const controls = node('div', undefined, 'variable-controls');
      let visual;
      const live = value => {
        input.value = value;
        try { preview(applyCommand(getState().project, { type: 'variable', id: variable.id, value })); } catch (e) { toast(e.message, true); }
      };
      const commit = value => command({ type: 'variable', id: variable.id, value }).catch(() => { preview(); });
      if (config.type === 'range') {
        visual = node('input'); visual.type = 'range'; visual.min = config.min; visual.max = config.max; visual.step = config.step; visual.value = parseFloat(current);
        visual.setAttribute('aria-label', `${variable.name} 第 ${variable.line} 行滑块`);
        // A complex override remains editable as text; never coerce it back to a number on render.
        if (variableControl(current).type !== 'range' || variableControl(current).unit !== config.unit) visual.disabled = true;
        visual.addEventListener('input', () => live(`${visual.value}${config.unit}`)); visual.addEventListener('change', () => commit(input.value));
      } else if (config.type === 'color') {
        const color = rgba(current) || rgba(variable.value) || { hex: '#000000', alpha: 100 };
        visual = node('input'); visual.type = 'color'; visual.value = color.hex; visual.setAttribute('aria-label', `${variable.name} 第 ${variable.line} 行颜色`);
        const alpha = node('input'); alpha.type = 'range'; alpha.min = 0; alpha.max = 100; alpha.step = 1; alpha.value = color.alpha; alpha.setAttribute('aria-label', `${variable.name} 第 ${variable.line} 行不透明度`);
        const alphaLabel = node('label', `不透明度 ${color.alpha}%`, 'variable-alpha-label');
        const alphaRow = node('div', undefined, 'variable-alpha'); alphaRow.append(alphaLabel, alpha);
        const value = () => visual.value + (Number(alpha.value) < 100 ? Math.round(Number(alpha.value) / 100 * 255).toString(16).padStart(2, '0') : '');
        if (!rgba(current)) visual.disabled = alpha.disabled = true;
        visual.addEventListener('input', () => live(value())); visual.addEventListener('change', () => commit(input.value));
        alpha.addEventListener('input', () => { alphaLabel.textContent = `不透明度 ${alpha.value}%`; live(value()); }); alpha.addEventListener('change', () => commit(input.value));
        row.append(alphaRow);
      } else if (config.type === 'ratio') {
        visual = node('select'); visual.setAttribute('aria-label', `${variable.name} 比例预设`);
        for (const value of ['', '1 / 1', '3 / 4', '4 / 3', '9 / 16', '16 / 9']) { const option = node('option', value || '比例预设'); option.value = value; visual.append(option); }
        visual.value = ['1 / 1', '3 / 4', '4 / 3', '9 / 16', '16 / 9'].includes(current) ? current : '';
        visual.addEventListener('change', () => { if (visual.value) { live(visual.value); commit(visual.value); } });
      }
      if (visual) controls.append(visual);
      input.addEventListener('change', () => commit(input.value));
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); commit(input.value); } });
      const apply = node('button', '应用', 'variable-apply'); apply.setAttribute('aria-label', `应用变量 ${variable.name} 第 ${variable.line} 行`); apply.addEventListener('click', () => commit(input.value));
      controls.append(input, apply); row.append(controls);
      row.append(node('small', variable.id in edits ? `已修改 · 原值 ${variable.value}` : `原始声明 · ${config.type === 'text' ? '文本 / CSS 表达式' : '可视化调整'}`, variable.id in edits ? 'variable-original edited' : 'variable-original'));
      $('#variables-list').append(row);
    }
  }
  function request(type, payload = {}) {
    if (!isReady()) return Promise.reject(new Error('预览尚未连接。'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('读取预览超时，请检查连接。')); }, 10000);
      pending.set(requestId, { resolve, reject, timer }); send(type, { ...payload, requestId });
    });
  }
  async function diagnostics() {
    const sequence = ++diagnosticSequence;
    $('#diagnostic-result').replaceChildren(node('p', '正在读取浏览器计算值…', 'empty-state'));
    try {
      const result = await request('diagnose', { target: getSelected(), property: $('#diagnostic-property').value });
      if (sequence !== diagnosticSequence) return;
      const area = $('#diagnostic-result'); area.replaceChildren();
      area.append(node('p', result.message, result.applied === false ? 'diagnostic-warning' : 'diagnostic-summary'));
      if (!result.visible) return;
      const values = node('div', undefined, 'diagnostic-values');
      for (const [label, value] of [['部件设置', result.requested ?? '未设置'], ['浏览器计算值', result.actual || '空值']]) { const cell = node('div'); cell.append(node('small', label), node('code', value)); values.append(cell); }
      area.append(values);
      if (result.pseudo) area.append(node('p', `伪元素 ${result.pseudo} · content: ${result.content}`, 'panel-hint'));
      if (result.inaccessible) area.append(node('p', `${result.inaccessible} 个样式表无法读取，来源列表不完整。`, 'diagnostic-warning'));
      for (const text of result.limitations || []) area.append(node('p', text, 'panel-hint'));
      area.append(node('h3', `候选来源 · ${result.sources.length}`));
      for (const source of result.sources) {
        const item = node('div', undefined, 'source-row'); item.append(node('code', source.selector), node('b', `${source.value}${source.important ? ' !important' : ''}`), node('small', `${source.source}${source.inherited ? ' · 祖先继承候选' : ''}${source.context ? ` · ${source.context}` : ''}`)); area.append(item);
      }
      if (!result.sources.length) area.append(node('p', '未找到可读取的匹配声明，可能来自继承、浏览器默认值或不可访问的样式表。', 'panel-hint'));
    } catch (e) { $('#diagnostic-result').replaceChildren(node('p', e.message, 'diagnostic-warning')); }
  }
  async function listSnapshots() {
    const response = await fetch('/api/snapshots'); const list = await response.json(); if (!response.ok) throw new Error(list.error);
    $('#snapshots-list').replaceChildren();
    if (!list.length) $('#snapshots-list').append(node('p', '还没有快照。先保存一个起点，之后就能对比和恢复。', 'empty-state'));
    for (const saved of list) {
      const button = node('button', undefined, 'snapshot-item');
      button.append(node('b', saved.name), node('small', new Date(saved.createdAt).toLocaleString('zh-CN')), node('span', '对比 / 恢复 →'));
      button.addEventListener('click', () => compareSnapshot(saved.id).catch(e => toast(e.message, true))); $('#snapshots-list').append(button);
    }
  }
  async function compareSnapshot(id) {
    const response = await fetch(`/api/snapshots/${id}`), saved = await response.json(); if (!response.ok) throw new Error(saved.error);
    selectedSnapshot = { ...saved, comparedRevision: getState().revision };
    $('#snapshot-comparison').hidden = false; $('#snapshot-comparison-title').textContent = `「${saved.name}」→ 当前工程 · ${saved.changes.length} 处变化`;
    $('#snapshot-diff').replaceChildren();
    for (const change of saved.changes) {
      const row = node('div', undefined, 'diff-row'); row.append(node('code', change.label || change.path), node('del', displayValue(change.before)), node('span', '→'), node('ins', displayValue(change.after))); $('#snapshot-diff').append(row);
    }
    if (!saved.changes.length) $('#snapshot-diff').append(node('p', '与当前工程相同。', 'empty-state'));
    $('#restore-snapshot').disabled = !saved.changes.length;
  }
  function displayValue(value) { return value === null ? '无覆盖' : typeof value === 'string' ? value : JSON.stringify(value); }
  function renderReports() {
    const area = $('#checks-results'); area.replaceChildren();
    for (const report of reports) {
      const details = node('details', undefined, 'check-report'); details.open = reports.length === 1;
      const warnings = report.checks.filter(c => c.status === 'warn').length;
      details.append(node('summary', `${report.isDemo ? '示例' : '真实画面'} · ${report.scene} · ${report.viewport.width} × ${report.viewport.height} · ${warnings ? `${warnings} 项待检查` : '未发现所检布局问题'}`));
      for (const check of report.checks) { const row = node('div', undefined, 'check-row'); row.append(node('span', check.status === 'pass' ? '通过' : check.status === 'warn' ? '检查' : '跳过', `check-${check.status}`), node('b', check.name), node('small', check.detail)); details.append(row); }
      area.append(details);
    }
    $('#export-checks').disabled = !reports.length || running;
  }
  async function check(matrix) {
    if (running) return;
    if (matrix && isLive()) return toast('真实酒馆仅检查当前画面。请在独立工作台运行示例组合。', true);
    running = true; reports = []; renderReports(); $('#check-current').disabled = true; $('#check-matrix').disabled = true;
    const initialDevice = getDevice(), initialScene = $('#scene').value, compared = $('#compare').checked, revision = getState().revision;
    document.querySelectorAll('.check-progress').forEach(el => el.remove());
    const status = node('p', '正在检查…', 'check-progress'); $('#checks-results').before(status);
    try {
      if (matrix) {
        $('#compare').checked = false; preview();
        for (const device of ['desktop', 'mobile']) {
          setDevice(device);
          for (const scene of ['chat', 'long', 'rich', 'reasoning', 'sidebar', 'composer']) {
            if (getState().revision !== revision) throw new Error('检查期间工程发生变化，请重新运行以获得同一版本的报告。');
            $('#scene').value = scene; send('scene', { scene });
            await new Promise(resolve => setTimeout(resolve, 180));
            const report = await request('audit'); reports.push({ ...report, revision }); renderReports(); status.textContent = `已检查 ${reports.length} / 12`;
          }
        }
      } else reports.push({ ...await request('audit'), revision });
    } catch (e) { toast(e.message, true); status.textContent = e.message; }
    finally {
      if (matrix) { setDevice(initialDevice); $('#scene').value = initialScene; send('scene', { scene: initialScene }); $('#compare').checked = compared; preview(); }
      running = false; $('#check-current').disabled = false; $('#check-matrix').disabled = isLive(); renderReports();
      if (reports.length === (matrix ? 12 : 1)) status.remove();
    }
  }
  $('#variables-button').addEventListener('click', () => { $('#variables-panel').hidden = false; refreshVariables(); $('#variable-search').focus(); });
  $('#close-variables').addEventListener('click', () => { $('#variables-panel').hidden = true; preview(); $('#variables-button').focus(); });
  $('#variable-search').addEventListener('input', renderVariables); $('#variables-modified').addEventListener('change', renderVariables);
  $('#variables-list').addEventListener('focusout', event => { if (!$('#variables-list').contains(event.relatedTarget)) setTimeout(renderVariables, 0); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#variables-panel').hidden && !document.querySelector('dialog[open]')) $('#close-variables').click(); });
  for (const field of FIELDS) { const option = node('option', field.label); option.value = field.key; $('#diagnostic-property').append(option); } $('#diagnostic-property').value = 'padding';
  $('#diagnose-button').addEventListener('click', () => { $('#diagnostic-dialog').showModal(); diagnostics(); });
  $('#diagnostic-property').addEventListener('change', diagnostics); $('#refresh-diagnostic').addEventListener('click', diagnostics);
  $('#snapshots-button').addEventListener('click', () => { $('#snapshots-dialog').showModal(); listSnapshots().catch(e => toast(e.message, true)); });
  $('#snapshot-form').addEventListener('submit', async e => {
    e.preventDefault(); const button = e.submitter; button.disabled = true;
    try { await command({ type: 'snapshot-save', name: $('#snapshot-name').value }); $('#snapshot-name').value = ''; await listSnapshots(); toast('快照已保存到本机。'); } catch {} finally { button.disabled = false; }
  });
  $('#restore-snapshot').addEventListener('click', async () => {
    if (!selectedSnapshot) return;
    if (selectedSnapshot.comparedRevision !== getState().revision) { await compareSnapshot(selectedSnapshot.id); toast('工程已更新，已重新显示差异。请查看后再次恢复。'); return; }
    try { await command({ type: 'snapshot-restore', id: selectedSnapshot.id }); await compareSnapshot(selectedSnapshot.id); toast('已恢复快照，可撤销返回。'); } catch {}
  });
  $('#checks-button').addEventListener('click', () => { $('#check-matrix').disabled = isLive(); $('#check-help').textContent = isLive() ? '检查真实酒馆当前画面。请手动打开要检查的聊天、思考区或侧栏；完整示例组合在独立工作台中运行。' : '轮流检查桌面与手机下的聊天、长文本、代码表格、思考区、侧栏和多行输入。'; $('#checks-dialog').showModal(); });
  $('#check-current').addEventListener('click', () => check(false)); $('#check-matrix').addEventListener('click', () => check(true));
  $('#checks-dialog').addEventListener('cancel', e => { if (running) e.preventDefault(); });
  $('#export-checks').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, project: getState().project.name, reports }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = node('a'); a.href = url; a.download = 'theme-scene-report.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return {
    render: refreshVariables,
    receive(data) { const waiting = pending.get(data.requestId); if (!waiting) return; clearTimeout(waiting.timer); pending.delete(data.requestId); waiting.resolve(data.result); },
  };
}
