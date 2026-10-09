import { parse, walk, tokenize, tokenTypes, ident, string } from 'css-tree';

// css-tree preserves escaped function names. Normalize these tokens before
// parsing so escaped url()/@import receive the same grammar as literal forms.
// Tokens inside comments and strings are never treated as function names.
export function scanCssDependencies(input, context = 'stylesheet') {
  const names = [];
  tokenize(input, (type, start, end) => {
    if (type === tokenTypes.Function) {
      const name = ident.decode(input.slice(start, end - 1)).toLowerCase();
      if (['url', 'image', 'image-set', '-webkit-image-set', 'src'].includes(name)) names.push({ start, end, text: name + '(' });
    } else if (type === tokenTypes.AtKeyword && ident.decode(input.slice(start + 1, end)).toLowerCase() === 'import') names.push({ start, end, text: '@import' });
  });
  let css = input;
  for (const n of names.reverse()) css = css.slice(0, n.start) + n.text + css.slice(n.end);
  const references = [], errors = [], stack = [];
  let ast;
  try { ast = parse(css, { context, positions: true, parseCustomProperty: true, onParseError: e => errors.push(`第 ${e.line} 行：${e.message}`) }); }
  catch (e) { return { css, references, errors: [e.message] }; }
  walk(ast, {
    enter(node) {
      const parent = stack.at(-1), functionName = parent?.type === 'Function' ? ident.decode(parent.name).toLowerCase() : '';
      const importString = node.type === 'String' && parent?.type === 'AtrulePrelude' && this.atrule?.name.toLowerCase() === 'import' && parent.children.first === node;
      if (node.type === 'Url' || (node.type === 'String' && (importString || ['image', 'image-set', '-webkit-image-set', 'src'].includes(functionName)))) {
        if (node.value && !node.value.startsWith('#')) references.push({ reference: node.value, start: node.loc.start.offset, end: node.loc.end.offset, kind: node.type === 'Url' ? 'url' : 'string' });
      }
      if (node.type === 'Raw' && node.value.trim()) errors.push(`第 ${node.loc.start.line} 行包含无法解析的 CSS，不能确认依赖完整。`);
      if (['image', 'image-set', '-webkit-image-set'].includes(functionName) && node.type === 'Function' && ['var', 'attr', 'env'].includes(ident.decode(node.name).toLowerCase())) errors.push(`${functionName}() 使用动态资源参数，无法确认完整离线依赖。`);
      // src() can use dynamic strings (e.g. attr()). It is unsafe to promise an
      // offline file when the resource address depends on runtime attributes.
      if (functionName === 'src' && node.type !== 'String') errors.push('动态 src() 地址无法作为完整离线依赖验证。');
      stack.push(node);
    },
    leave() { stack.pop(); },
  });
  return { css, references, errors: [...new Set(errors)] };
}

export function dependencies(text) {
  const context = text.includes('{') || /^\s*@/.test(text) ? 'stylesheet' : 'value';
  return [...new Set(scanCssDependencies(text, context).references.map(r => r.reference))];
}

// Replace parsed spans, including CSS-escaped addresses; never global-replace
// text that could also occur inside a comment, content string or another URL.
export function rewriteDependencies(css, replacements, context = 'stylesheet') {
  const scan = scanCssDependencies(css, context);
  if (scan.errors.length) throw new Error(scan.errors.join('\n'));
  let output = scan.css;
  for (const ref of scan.references.toReversed()) {
    if (!replacements.has(ref.reference)) continue;
    const value = string.encode(replacements.get(ref.reference));
    output = output.slice(0, ref.start) + (ref.kind === 'url' ? `url(${value})` : value) + output.slice(ref.end);
  }
  return output;
}
