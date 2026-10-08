// Source-preserving CSS custom-property reader. It never flattens selectors or media queries.
const unComment = text => text.replace(/\/\*[\s\S]*?\*\//g, '').trim();
function quotedEnd(css, start) {
  const quote = css[start]; let i = start + 1;
  for (; i < css.length; i++) { if (css[i] === '\\') i++; else if (css[i] === quote) return i + 1; }
  return css.length + 1;
}
function commentEnd(css, start) { const end = css.indexOf('*/', start + 2); return end < 0 ? css.length : end + 2; }
function triviaEnd(css, start) {
  let i = start;
  while (i < css.length) { if (/\s/.test(css[i])) i++; else if (css.startsWith('/*', i)) i = commentEnd(css, i); else break; }
  return i;
}
function boundary(css, start, value = false) {
  const stack = []; let i = start;
  for (; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") { i = quotedEnd(css, i) - 1; continue; }
    if (css.startsWith('/*', i)) { i = commentEnd(css, i) - 1; continue; }
    if (c === '\\') { i++; continue; }
    if (!stack.length && (c === ';' || c === '}' || (!value && c === '{'))) break;
    if (c === '(' || c === '[' || (value && c === '{')) stack.push(c);
    else if (c === ')' || c === ']' || c === '}') stack.pop();
  }
  return i;
}
export function scanVariables(css = '') {
  const result = [];
  function block(start, contexts) {
    let i = start;
    while (i < css.length) {
      const statementStart = i; i = triviaEnd(css, i);
      if (css[i] === '}') return i + 1;
      const declaration = css.slice(i).match(/^(--[\w\u0080-\uFFFF-]+)\s*:/);
      if (declaration && contexts.length) {
        const name = declaration[1], rawStart = i + declaration[0].length;
        const end = boundary(css, rawStart, true), raw = css.slice(rawStart, end);
        // Keep trailing comments and !important exactly where the author placed them.
        const tokens = [];
        for (let j = 0; j < raw.length;) {
          if (/\s/.test(raw[j])) { j++; continue; }
          if (raw.startsWith('/*', j)) { j = commentEnd(raw, j); continue; }
          const start = j;
          if (raw[j] === '"' || raw[j] === "'") j = quotedEnd(raw, j);
          else if (raw[j] === '\\') j += 2;
          else j++;
          tokens.push({ start, end: j, text: raw.slice(start, j) });
        }
        const important = tokens.slice(-10).map(t => t.text).join('').toLowerCase() === '!important';
        const valueTokens = important ? tokens.slice(0, -10) : tokens;
        const valueStart = rawStart + (valueTokens[0]?.start ?? raw.length), valueEnd = rawStart + (valueTokens.at(-1)?.end ?? raw.length);
        const after = css.slice(end + (css[end] === ';' ? 1 : 0)).match(/^[ \t]*\/\*([\s\S]*?)\*\//)?.[1];
        const before = [...css.slice(statementStart, i).matchAll(/\/\*([\s\S]*?)\*\//g)].at(-1)?.[1];
        const inner = [...raw.matchAll(/\/\*([\s\S]*?)\*\//g)].at(-1)?.[1];
        const label = (after || inner || before || '').replace(/\s+/g, ' ').trim().slice(0, 220);
        result.push({ id: `var-${i}`, name, value: css.slice(valueStart, valueEnd), start: valueStart, end: valueEnd,
          line: css.slice(0, i).split('\n').length, context: contexts.join(' → '), label, important: !!important });
        i = end + (css[end] === ';' ? 1 : 0); continue;
      }
      const end = boundary(css, i);
      if (end >= css.length) return end;
      if (css[end] === '{') i = block(end + 1, [...contexts, unComment(css.slice(i, end))]);
      else if (css[end] === '}') return end + 1;
      else i = end + 1;
    }
    return i;
  }
  block(0, []); return result;
}
export function validateVariableValue(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new Error('变量值需为 1–4000 字的 CSS 值。');
  // Accept functions, strings and data URLs, but never allow a value to escape its declaration.
  const stack = [];
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '"' || c === "'") {
      const end = quotedEnd(value, i);
      if (end > value.length || value[end - 1] !== c || end === i + 1) throw new Error('变量值的引号未闭合。');
      i = end - 1; continue;
    }
    if (c === '\\') { if (++i >= value.length) throw new Error('变量值不能以转义符结尾。'); continue; }
    if (value.startsWith('/*', i)) { const end = value.indexOf('*/', i + 2); if (end < 0) throw new Error('变量值的注释未闭合。'); i = end + 1; continue; }
    if (c === '{' || c === '}' || (c === ';' && !stack.length) || (c === '!' && !stack.length)) throw new Error('请只填写变量值，不包含声明或 !important。');
    if (c === '(' || c === '[') stack.push(c);
    else if (c === ')' || c === ']') { if (stack.pop() !== (c === ')' ? '(' : '[')) throw new Error('变量值的括号不匹配。'); }
  }
  if (stack.length) throw new Error('变量值的括号未闭合。');
  return value.trim();
}
export function rewriteVariables(css, edits = {}) {
  const vars = scanVariables(css);
  const byId = new Map(vars.map(v => [v.id, v]));
  const replacements = Object.entries(edits).map(([id, value]) => {
    const variable = byId.get(id); if (!variable) throw new Error('变量位置已改变，请重新读取主题变量。');
    return { ...variable, next: validateVariableValue(value) };
  }).sort((a, b) => b.start - a.start);
  for (const v of replacements) css = css.slice(0, v.start) + v.next + css.slice(v.end);
  return css;
}
export function variableControl(value) {
  const number = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(px|%|rem|em|vh|vw|s|ms|deg)?$/);
  if (number) {
    const n = Number(number[1]), unit = number[2] || '';
    const extent = unit === '%' ? 100 : ['rem', 'em', 's', ''].includes(unit) ? 4 : unit === 'deg' ? 360 : 100;
    return { type: 'range', number: n, unit, min: Math.min(0, Math.floor(n * 2)), max: Math.max(extent, Math.ceil(n * 2)), step: ['rem', 'em', 's', ''].includes(unit) ? 0.05 : 1 };
  }
  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value.trim()) || /^(?:rgba?|hsla?|oklch|oklab|lch|lab|color)\(/i.test(value.trim())) return { type: 'color' };
  if (/^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/.test(value.trim())) return { type: 'ratio' };
  return { type: 'text' };
}
