// Structural check before a build can replace the last successful preview.
// Property support remains a host diagnostic, not an invented CSS parser.
export function validateBuiltCss(css) {
  const stack = []; let line = 1;
  for (let i = 0; i < css.length; i++) {
    const c = css[i]; if (c === '\n') line++;
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2); if (end < 0) throw new Error(`CSS 第 ${line} 行：注释未闭合。`);
      line += css.slice(i, end + 2).split('\n').length - 1; i = end + 1; continue;
    }
    if (c === '"' || c === "'") {
      const quote = c; let closed = false;
      for (i++; i < css.length; i++) { if (css[i] === '\\') i++; else if (css[i] === quote) { closed = true; break; } else if (css[i] === '\n') line++; }
      if (!closed) throw new Error(`CSS 第 ${line} 行：引号未闭合。`); continue;
    }
    if (c === '\\') { i++; continue; }
    if ('{(['.includes(c)) stack.push({ c, line });
    else if ('})]'.includes(c)) { const open = stack.pop(); if (open?.c !== ({ '}': '{', ')': '(', ']': '[' })[c]) throw new Error(`CSS 第 ${line} 行：括号不匹配。`); }
  }
  if (stack.length) throw new Error(`CSS 第 ${stack.at(-1).line} 行：括号未闭合。`);
  if (/__\w+_ART__/.test(css)) throw new Error('CSS 包含未解析素材占位符。');
  return css;
}
