import { TARGETS } from '../shared/core.js';

export function targetElement(target, preferred) {
  const matches = [...document.querySelectorAll(target.elementSelector || target.selector)].filter(el => !el.closest('[data-tts-ui]'));
  const visible = el => el.getClientRects().length && el.getBoundingClientRect().width && el.getBoundingClientRect().height;
  return { matches, element: preferred && matches.includes(preferred) && visible(preferred) ? preferred : matches.find(visible) };
}
function splitSelectors(text) {
  let start = 0, depth = 0, quote; const parts = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && !depth) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start)); return parts;
}
function matchesSelector(el, selector, pseudo) {
  return splitSelectors(selector).some(part => {
    const pseudos = part.match(/::?(before|after)\b/g) || [];
    if (pseudo ? !pseudos.some(p => p.replace(/^:+/, '') === pseudo.slice(2)) : pseudos.length) return false;
    try { return el.matches(part.replace(/::?(before|after)\b/g, '')); } catch { return false; }
  });
}
export function diagnose(target, property, requested, enabled = true, preferred) {
  const { element: el } = targetElement(target, preferred);
  if (!el) return { target: target.id, property, visible: false, sources: [], message: '当前没有可见匹配。请打开对应界面或切换示例场景。' };
  const computed = getComputedStyle(el, target.pseudo || null);
  const actual = computed.getPropertyValue(property);
  const sources = [], inaccessible = new Set(), limitations = new Set(); let visited = 0;
  const inherited = ['color', 'font-size', 'line-height'].includes(property);
  function collect(style, selector, source, context, ancestor = false) {
    const value = style.getPropertyValue(property);
    if (value && sources.length < 100) sources.push({ selector, source, context, value, important: style.getPropertyPriority(property) === 'important', inherited: ancestor });
  }
  function walk(sheet, context = [], chain = new Set()) {
    if (!sheet || sheet.disabled || chain.has(sheet)) return;
    if (sheet.media?.mediaText && !matchMedia(sheet.media.mediaText).matches) return;
    const nextChain = new Set(chain); nextChain.add(sheet);
    let rules; try { rules = sheet.cssRules; } catch { inaccessible.add(sheet.href || '不可读取的样式表'); return; }
    const source = sheet.href ? (() => { try { return new URL(sheet.href).pathname; } catch { return sheet.href; } })() : `内联样式${sheet.ownerNode?.id ? ` #${sheet.ownerNode.id}` : ''}`;
    function ruleset(list, contexts) {
      for (const rule of list) {
        if (++visited > 20000) { limitations.add('规则数量达到读取上限'); return; }
        if (rule.type === 3) { if (!rule.media?.mediaText || matchMedia(rule.media.mediaText).matches) walk(rule.styleSheet, [...contexts, '@import'], nextChain); continue; }
        if (rule.type === 4 && !matchMedia(rule.conditionText).matches) continue;
        if (rule.constructor.name === 'CSSSupportsRule' && !CSS.supports(rule.conditionText)) continue;
        if (rule.selectorText && rule.style) {
          if (matchesSelector(el, rule.selectorText, target.pseudo)) collect(rule.style, rule.selectorText, source, contexts.join(' → '));
          if (inherited) {
            for (let parent = target.pseudo ? el : el.parentElement; parent; parent = parent.parentElement) {
              if (matchesSelector(parent, rule.selectorText)) { collect(rule.style, rule.selectorText, source, contexts.join(' → '), true); break; }
            }
          }
        }
        if (rule.cssRules?.length) {
          const kind = rule.constructor.name;
          if (['CSSContainerRule', 'CSSScopeRule', 'CSSStyleRule'].includes(kind)) limitations.add('容器查询、作用域或嵌套规则的条件需在浏览器开发工具中核实');
          ruleset(rule.cssRules, [...contexts, rule.cssText.slice(0, rule.cssText.indexOf('{')).trim().slice(0, 180)]);
        }
      }
    }
    ruleset(rules, context);
  }
  for (const sheet of document.styleSheets) walk(sheet);
  if (!target.pseudo) collect(el.style, '元素 style 属性', '元素内联样式', '');
  if (sources.length >= 100) limitations.add('仅展示前 100 条候选规则');
  let applied = null;
  if (requested && enabled) {
    const style = document.createElement('span').style; style.setProperty(property, requested);
    const expanded = { padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'], 'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'], 'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'], 'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'] };
    if (property === 'line-height') applied = Math.abs(parseFloat(actual) / parseFloat(computed.fontSize) - parseFloat(requested)) < 0.015;
    else if (property !== 'width') applied = (expanded[property] || [property]).every(key => style.getPropertyValue(key) === computed.getPropertyValue(key));
  }
  return { target: target.id, property, visible: true, actual, requested: requested || null, applied, enabled, pseudo: target.pseudo || null,
    content: target.pseudo ? computed.content : null, sources, inaccessible: inaccessible.size, limitations: [...limitations],
    message: !enabled ? '正在查看原样，工程覆盖暂停。' : !requested ? '此属性没有部件覆盖；下方显示当前值与候选来源。' : applied === null ? '该属性需要结合布局核实，当前值已列出。' : applied ? '当前计算值与部件设置一致。' : '当前计算值与部件设置不同。请检查候选规则、继承、动画或布局约束。' };
}
export function auditScene() {
  const viewport = { width: innerWidth, height: innerHeight };
  const checks = [];
  const pageOverflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth;
  checks.push({ name: '页面横向溢出', status: pageOverflow > 2 ? 'warn' : 'pass', detail: pageOverflow > 2 ? `超出视口 ${Math.round(pageOverflow)} px` : '未发现页面横向溢出' });
  for (const id of ['chat', 'input', 'message-text', 'reasoning', 'code', 'table', 'left', 'right']) {
    const target = TARGETS.find(t => t.id === id), { matches, element } = targetElement(target);
    if (!element) { checks.push({ name: target.name, status: 'skip', detail: matches.length ? '当前隐藏' : '当前场景没有此部件' }); continue; }
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    const outside = rect.left < -2 || rect.right > innerWidth + 2;
    const clipped = element.scrollWidth > element.clientWidth + 2 && ['hidden', 'clip'].includes(style.overflowX);
    checks.push({ name: target.name, status: outside || clipped ? 'warn' : 'pass', detail: `${Math.round(rect.width)} × ${Math.round(rect.height)} px${outside ? ' · 超出横向视口' : ''}${clipped ? ' · 内容可能被裁切' : ''}` });
  }
  return { viewport, scene: document.body.dataset.scene || 'current', createdAt: new Date().toISOString(), checks };
}
