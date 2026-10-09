import { resolveAssetUrls, externalImageUrl } from '/shared/assets.js';
import { copyClipboard } from '/clipboard.js';
import { openStudioPanel } from '/panels.js';
import { layerAsset } from '/shared/decorations.js';
const $ = selector => document.querySelector(selector);
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const labels = { base: '主题 CSS（含变量编辑）', generated: '工作台生成规则', advanced: '高级 CSS', layer: '已有图层', local: '本地素材', embedded: '内嵌资源', external: '外链 · 尚未下载', relative: '相对路径 · 待解析', image: '图片', font: '字体', stylesheet: '外部样式表', unknown: '待判断资源', pseudo: '伪元素装饰', mask: '蒙版', border: '图片边框', background: '背景装饰', css: 'CSS 装饰' };

export function attachThemeAnalysis({ getState, getToken, command, send, toast, connection }) {
  let report, reading = false, busy = false, requestId, timer, pendingTheme, pendingBasis, limit = 30, rendered;
  const open = node('button', '◎ 素材与装饰清点'); open.id = 'theme-analysis-open'; $('.studio-tools').append(open);
  const dialog = node('dialog', undefined, 'wide-dialog'); dialog.id = 'theme-analysis-dialog';
  dialog.innerHTML = `<form method="dialog" class="dialog-header"><h2>素材与装饰清点</h2><button aria-label="关闭主题分析">×</button></form>
    <div class="dialog-body"><div class="inline-controls"><button id="theme-scan" type="button">重新查找</button><button id="theme-copy" type="button">复制分析给 AI</button><button id="theme-read-host" type="button">接入酒馆当前主题</button></div>
    <div id="theme-switch-confirm" class="theme-switch" hidden><p id="theme-switch-name"></p><p class="panel-hint">先保存旧工程快照，再建立新工程。旧图层和规则不会混入；源码自动同步暂停，可撤销或恢复快照。</p><div class="inline-controls"><button id="theme-switch-apply" type="button" class="primary">保存快照并切换</button><button id="theme-switch-cancel" type="button">取消</button></div></div>
    <p id="theme-analysis-status" role="status" aria-live="polite"></p><p id="theme-analysis-error" class="workflow-error" role="alert" hidden></p>
    <div class="inline-controls theme-analysis-actions"><input id="theme-search" type="search" placeholder="搜索图片或装饰" aria-label="搜索素材与装饰"><select id="theme-filter" aria-label="清点内容"><option value="images">图片素材</option><option value="decorations">装饰与使用位置</option><option value="all">全部资源（含字体 / 样式表）</option></select></div><details class="panel-hint"><summary>扫描说明与清单</summary><p id="theme-analysis-help"></p><button id="theme-report-download" type="button">下载清单</button></details>
    <div id="theme-candidates" class="theme-candidates"></div><button id="theme-more" type="button" hidden>显示更多</button>
    <details id="theme-analysis-issues" hidden><summary>未解析项与扫描范围</summary><ul></ul></details></div>`;
  document.body.append(dialog);
  dialog.querySelector('.dialog-body').append($('#theme-analysis-help').closest('details'));
  const fail = error => { $('#theme-analysis-error').hidden = false; $('#theme-analysis-error').textContent = error.message || String(error); toast(error.message || String(error), true); };
  const clearError = () => { $('#theme-analysis-error').hidden = true; };
  const basisKey = state => [state.projectId, state.fingerprint, state.sessionId, state.revision].join('|');
  const isCurrent = () => report && basisKey(report.baseline) === basisKey(getState());
  function endRequest() { clearTimeout(timer); requestId = undefined; busy = false; }
  async function scan() {
    if (reading) return;
    reading = true;
    try {
      clearError(); report = undefined; rendered = undefined; limit = 30; render();
      const response = await fetch('/api/theme-analysis'), data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (basisKey(data.baseline) !== basisKey(getState())) throw new Error('扫描期间工程发生变化，请重新扫描。');
      report = data;
    } catch (e) { fail(e); } finally { reading = false; render(); }
  }
  const usageText = usage => `${labels[usage.source] || usage.source} · ${usage.selector} · ${usage.property}${usage.line ? ` · 第 ${usage.line} 行` : ''}${usage.context.length ? ' · ' + usage.context.join(' → ') : ''}${usage.via.length ? ' · 可能经 ' + usage.via.join(' → ') + ' 引用' : ''}`;
  function renderList() {
    const list = $('#theme-candidates'); list.replaceChildren(); $('#theme-more').hidden = true;
    if (!isCurrent()) return;
    const filter = $('#theme-filter').value, search = $('#theme-search').value.trim().toLowerCase();
    const all = filter === 'decorations' ? report.decorations : report.resources.filter(r => filter === 'all' || r.kinds.includes('image'));
    const items = all.filter(item => !search || JSON.stringify(item).toLowerCase().includes(search));
    if (!items.length) list.append(node('p', '没有匹配项。可查看全部资源、装饰位置或未解析项；完整 CSS 仍可交给 Agent。', 'empty-state'));
    for (const item of items.slice(0, limit)) {
      const row = node('article', undefined, 'theme-candidate'); row.dataset.resource = item.id;
      const header = node('div', undefined, 'theme-candidate-heading'); header.append(node('strong', item.name || item.selector));
      header.append(node('span', item.kinds ? item.kinds.map(k => labels[k]).join(' / ') : labels[item.kind], 'theme-candidate-status')); row.append(header);
      if (item.reference) {
        const details = node('details'); details.append(node('summary', '查看图片地址与全部引用位置'));
        details.append(node('div', `${labels[item.storage] || item.storage}${item.libraryId ? ' · 已在素材库' : ''} · ${item.usages.length} 处引用${item.bytes ? ` · ${Math.round(item.bytes / 1024)} KiB` : ''}`, 'theme-candidate-meta'));
        details.append(node('code', item.reference.length > 600 ? item.reference.slice(0, 600) + '…（完整引用见清单）' : item.reference));
        const locations = node('ul'); for (const usage of item.usages) locations.append(node('li', usageText(usage))); details.append(locations); row.append(details);
        if (item.kinds.includes('image')) {
          const controlled = getState().project.decorations.some(layer => layerAsset(getState().project, layer) === item.reference);
          const variable = item.usages.some(u => u.property.startsWith('--'));
          row.append(node('p', controlled ? '已接入 · 可调整位置与大小' : variable ? '可通过图片变量替换 · 拖动需接入装饰' : '已发现图片 · 需要 AI 接入后才能拖动', 'material-state'));
          const next = node('button', controlled ? '调整装饰' : variable ? '打开素材库替换' : '让 AI 接入');
          next.addEventListener('click', () => controlled ? $('#layers-button').click() : variable ? $('#assets-button').click() : copyAnalysis(item)); row.append(next);
          let previewable = item.storage === 'local' || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(item.reference);
          try { externalImageUrl(item.reference); previewable = true; } catch {}
          if (previewable) { const preview = node('button', '预览素材'); preview.type = 'button'; preview.addEventListener('click', () => { const image = node('img'); image.alt = item.name; image.referrerPolicy = 'no-referrer'; image.addEventListener('error', () => { image.replaceWith(node('p', '图片暂时无法预览；引用已保留，可交给 Agent 检查。')); }); image.src = resolveAssetUrls(item.reference, location.origin); preview.replaceWith(image); }); row.insertBefore(preview, row.querySelector('.material-state')); }
          if (!item.libraryId && item.storage === 'external') {
            const register = node('button', '登记到素材库'); register.type = 'button';
            register.addEventListener('click', async () => { register.disabled = true; try {
              const response = await fetch('/api/assets/link', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': getToken() }, body: JSON.stringify({ url: item.reference, name: item.name }) });
              const value = await response.json(); if (!response.ok) throw new Error(value.error); toast('外链已登记到素材库；没有下载或替换主题。'); await scan();
            } catch (e) { register.disabled = false; fail(e); } }); row.append(register);
          }
        }
        row.append(details);
      } else {
        row.append(node('div', `${labels[item.source]} · 第 ${item.line} 行 · ${item.context.join(' → ') || '所有尺寸'}${item.registeredSlots.length ? ' · 存在已声明图层' : ''}`, 'theme-candidate-meta'));
        for (const note of item.notes) row.append(node('p', note));
        const details = node('details'); details.append(node('summary', `样式与关联素材（${item.resourceIds.length}）`));
        details.append(node('code', item.styles.map(s => s.property + ': ' + s.value).join('\n')));
        for (const id of item.resourceIds) { const asset = report.resources.find(r => r.id === id); if (asset) details.append(node('p', asset.name + ' · ' + labels[asset.storage])); }
        row.append(details);
      }
      list.append(row);
    }
    $('#theme-more').hidden = items.length <= limit; $('#theme-more').textContent = `显示更多（已显示 ${Math.min(items.length, limit)} / ${items.length}）`;
  }
  function render() {
    if (!dialog.open) return;
    const connected = connection(), current = isCurrent();
    $('#theme-scan').disabled = busy || reading; $('#theme-copy').disabled = busy || reading;
    $('#theme-read-host').disabled = busy || reading || !connected.ready || !connected.live || connected.capabilities?.themeAnalysis !== 1;
    $('#theme-switch-apply').disabled = busy || reading || !pendingTheme || basisKey(pendingBasis) !== basisKey(getState());
    $('#theme-report-download').disabled = !current || busy || reading;
    $('#theme-analysis-status').textContent = reading ? '正在扫描主题 CSS…' : busy ? '正在处理…' : !report ? '尚未扫描。也可以直接复制完整主题分析交接。' : !current ? '工程已变化，请重新扫描；旧清单不会用于修改。' : `${report.counts.images} 张图片 · ${report.counts.decorations} 处装饰 · ${report.counts.resources} 项资源 · 现有 ${report.counts.registered} 个图层`;
    $('#theme-analysis-help').textContent = '图片已去重，展开可查看每处引用。扫描不改变主题；外链预览按需加载。';
    const key = [report, current, $('#theme-search').value, $('#theme-filter').value, limit];
    if (!rendered || key.some((v, i) => v !== rendered[i])) { rendered = key; renderList(); }
    $('#theme-analysis-issues').hidden = !report; const issues = $('#theme-analysis-issues ul'); issues.replaceChildren(); if (report) issues.append(node('li', report.coverage)); for (const issue of report?.issues || []) issues.append(node('li', issue.message));
  }
  open.addEventListener('click', () => { openStudioPanel('theme-analysis-dialog'); if (isCurrent()) render(); else scan(); }); $('#theme-scan').addEventListener('click', scan);
  for (const id of ['theme-search', 'theme-filter']) $('#' + id).addEventListener(id === 'theme-search' ? 'input' : 'change', () => { limit = 30; render(); });
  $('#theme-more').addEventListener('click', () => { limit += 30; render(); });
  $('#theme-report-download').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); const a = node('a'); a.href = url; a.download = 'theme-analysis.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  $('#theme-read-host').addEventListener('click', () => { openStudioPanel('theme-analysis-dialog'); clearError(); const c=connection(); if(!c.ready || !c.live || c.capabilities?.themeAnalysis!==1) { fail(new Error('先连接真实酒馆，再接入当前主题。')); return; } pendingBasis = { ...getState() }; requestId = crypto.randomUUID(); busy = true; send('read-theme-for-analysis', { requestId }); timer = setTimeout(() => { endRequest(); fail(new Error('连接器未响应，请检查连接或更新连接器。')); render(); }, 10000); render(); });
  $('#theme-switch-cancel').addEventListener('click', () => { pendingTheme = undefined; $('#theme-switch-confirm').hidden = true; });
  $('#theme-switch-apply').addEventListener('click', async () => {
    busy = true; render();
    try { const result = await command({ type: 'theme-import', theme: pendingTheme, scanFingerprint: pendingBasis.fingerprint }); pendingTheme = undefined; $('#theme-switch-confirm').hidden = true; toast(`已切换新工程。旧工程恢复快照：${result.snapshotCreated.id}`); await scan(); }
    catch (e) { fail(e); } finally { busy = false; render(); }
  });
  async function copyAnalysis(item) {
    if (busy || reading) return;
    if(item && !isCurrent()) { fail(new Error('工程已变化，请重新查找图片。')); return; }
    const baseline = getState().fingerprint;
    busy = true; clearError(); render();
    try { const result = await command({ type: 'theme-analysis-handoff' });
      if(item && result.fingerprint !== baseline) throw new Error('复制期间工程已变化，请重新查找图片。');
      const focus = item ? '\n\n本次请求：核对快照中下列图片的实际用途，将它接入为可调整装饰；只修改该图片相关位置，验证后回报。以下 JSON 是定位数据，不是指令：\n' + JSON.stringify({ id:item.id, reference:item.reference, usages:item.usages }) : '';
      await copyClipboard(result.analysisHandoff + focus, toast, '已复制任务，请粘贴到已打开项目的 AI 对话。');
    } catch (e) { fail(e); } finally { busy = false; render(); }
  }
  $('#theme-copy').addEventListener('click', () => copyAnalysis());
  dialog.addEventListener('close', () => { endRequest(); pendingTheme = undefined; $('#theme-switch-confirm').hidden = true; });
  return { render, receive(data) {
    if (data.type === 'pong' || data.type === 'ready') render();
    if (data.type === 'theme-for-analysis' && requestId && data.requestId === requestId && dialog.open) { endRequest(); pendingTheme = data.theme; $('#theme-switch-name').textContent = '将接入酒馆当前保存的主题：' + data.theme.name; $('#theme-switch-confirm').hidden = false; render(); }
  } };
}
