import { objectRows, targetPath, parentTarget } from '/shared/object-tree.js';

export function attachObjects({ getContext, select, send, openLayer }) {
  const inspector = document.querySelector('.inspector');
  const tabs = document.createElement('nav'); tabs.className = 'object-tabs'; tabs.setAttribute('aria-label', '编辑面板');
  const browser = document.createElement('section'); browser.id = 'object-browser'; browser.hidden = true;
  const properties = document.createElement('section'); properties.id = 'object-properties';
  while (inspector.firstChild) properties.append(inspector.firstChild);
  inspector.append(tabs, browser, properties);
  const buttons = ['部件与图层', '属性'].map((label, i) => {
    const b = document.createElement('button'); b.textContent = label; b.setAttribute('aria-controls', i ? properties.id : browser.id);
    b.addEventListener('click', () => show(i === 0)); tabs.append(b); return b;
  });
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = '搜索部件、角色、用户…'; search.setAttribute('aria-label', '搜索部件与图层');
  const hint = document.createElement('p'); hint.className = 'object-hint'; hint.textContent = '按部件类型编辑，同身份的同类部件一起变化。';
  const list = document.createElement('div'); list.className = 'object-list'; list.setAttribute('aria-label', '部件目录');
  browser.append(search, hint, list);
  const path = document.createElement('nav'); path.className = 'object-path'; path.setAttribute('aria-label', '当前选择路径');
  properties.prepend(path);
  const collapsed = new Set(); let lastKey, previousSelection, fromList = false;
  function show(objects) {
    browser.hidden = !objects; properties.hidden = objects;
    buttons.forEach((b,i) => b.setAttribute('aria-pressed', String(i === (objects ? 0 : 1))));
    if (objects) { render(true); search.focus({ preventScroll: true }); }
  }
  function render(force = false) {
    const { project, scope, selected, inspection } = getContext();
    if(previousSelection!==selected){if(previousSelection&&!fromList)search.value='';targetPath(selected).forEach(t=>collapsed.delete(t.id));previousSelection=selected;}
    hint.textContent = `${scope==='base'?'所有尺寸':project.breakpoints.find(b=>b.id===scope)?.name||scope} · 按部件类型编辑，同身份的同类部件一起变化。`;
    const key = JSON.stringify([project.rules[scope], project.decorations, project.recipe, scope, selected, inspection?.count, search.value, [...collapsed]]);
    if (!force && key === lastKey) return; lastKey = key;
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.object : undefined;
    path.replaceChildren();
    for (const target of targetPath(selected)) { const b = document.createElement('button'); b.textContent = target.name; b.disabled = target.id === selected; b.addEventListener('click', () => select(target.id)); path.append(b); }
    list.replaceChildren();
    const rows = objectRows(project, scope, search.value);
    for (const { target, depth, modified } of rows) {
      if (!search.value && targetPath(target.id).slice(0,-1).some(t => collapsed.has(t.id))) continue;
      const row = document.createElement('div'); row.className = 'object-row'; row.style.setProperty('--depth', depth); row.classList.toggle('selected', target.id === selected);
      const expand = document.createElement('button'); expand.className = 'object-expand';
      const hasChildren = rows.some(r => parentTarget(r.target.id) === target.id);
      expand.textContent = collapsed.has(target.id) ? '›' : '⌄'; expand.hidden = !hasChildren;
      expand.setAttribute('aria-label', `展开或收起${target.name}`); expand.setAttribute('aria-expanded', String(!collapsed.has(target.id)));
      expand.addEventListener('click', () => { collapsed.has(target.id) ? collapsed.delete(target.id) : collapsed.add(target.id); render(true); row.isConnected || list.querySelector(`[data-object="${target.id}"]`)?.focus(); });
      const b = document.createElement('button'); b.dataset.object = target.id; b.className = 'object-choice'; b.setAttribute('aria-current', String(target.id === selected));
      const icon = document.createElement('span'); icon.className = 'object-icon'; icon.textContent = target.icon;
      const text = document.createElement('span'); text.textContent = target.name;
      b.append(icon, text);
      if (modified) { const dot = document.createElement('small'); dot.textContent = '●'; dot.title = `当前范围有 ${modified} 项修改`; b.append(dot); }
      b.addEventListener('click', () => { fromList=true;try{select(target.id);}finally{fromList=false;} send('focus-selection');send('objects-selected'); });
      b.addEventListener('dblclick', () => show(false));
      row.append(expand,b); list.append(row);
    }
    const layers = project.decorations.filter(l => `${l.name} ${project.recipe?.slots.find(s => s.id === l.slotId)?.group || ''}`.toLowerCase().includes(search.value.trim().toLowerCase()));
    const heading = document.createElement('h3'); heading.textContent = `装饰图层 · ${layers.length}`; list.append(heading);
    for (const layer of layers) {
      const b = document.createElement('button'); b.className = 'object-layer'; b.textContent = `${layer.name} · ${layer.locked ? '已锁定' : layer.visible ? '显示' : '隐藏'}`;
      b.addEventListener('click', () => openLayer(layer.id)); list.append(b);
    }
    if (!layers.length) { const p = document.createElement('p'); p.className = 'object-hint'; p.textContent = search.value ? '没有匹配的装饰。' : '接入可调装饰后，在这里选取并管理显隐、锁定与顺序。'; list.append(p); }
    if (!rows.length) { const p = document.createElement('p'); p.className = 'object-hint'; p.textContent = '没有匹配的部件，试试“头像”或“用户”。'; list.prepend(p); }
    if (focused) list.querySelector(`[data-object="${focused}"]`)?.focus({ preventScroll:true });
  }
  search.addEventListener('input', () => render(true));
  list.addEventListener('keydown', event => {
    if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
    const items = [...list.querySelectorAll('button:not([hidden])')], index = items.indexOf(event.target);
    if (index < 0) return; event.preventDefault();
    items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1 : Math.max(0,Math.min(items.length-1,index+(event.key==='ArrowDown'?1:-1)))]?.focus();
  });
  show(false);
  return { render, open: () => show(true) };
}
