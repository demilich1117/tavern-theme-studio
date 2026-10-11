import { readFile, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as csstree from 'css-tree';
import { validateTheme } from './shared/core.js';
import { validateBuiltCss } from './shared/css-validation.js';
import { MAX_ASSET_BYTES } from './asset-store.js';
import { validateRecipe } from './shared/decorations.js';

// The work owns declarative input; the installed tool owns build dependencies.
export async function buildThemeSource(directory, output) {
  const root = await realpath(directory);
  async function read(relative, limit = 32 * 1048576) {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || /[\\:\0]/.test(relative) || relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('主题源码路径无效。');
    const file = await realpath(path.join(root, relative));
    if (!file.startsWith(root + path.sep) || (await stat(file)).size > limit) throw new Error('主题源码越界或过大。');
    return readFile(file);
  }
  const fields = JSON.parse(await read('theme-fields.json'));
  let studioRecipe = null;
  try { studioRecipe = validateRecipe(JSON.parse(await read('studio.recipe.json', 1048576))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const recipe = JSON.parse(await read('assets.manifest.json', 1048576));
  if (recipe.version !== 1 || !Array.isArray(recipe.assets) || recipe.assets.length > 1000) throw new Error('素材清单格式无效。');
  let css = (await read('theme.css')).toString('utf8');
  const assets = [], seen = new Set(), bytesById = new Map();
  for (const item of recipe.assets) {
    if (!/^__[A-Z0-9_]+__$/.test(item.placeholder || '') || seen.has(item.placeholder) || !css.includes(item.placeholder)) throw new Error('素材占位符缺失或重复。');
    seen.add(item.placeholder);
    const bytes = await read(item.file, MAX_ASSET_BYTES), ext = path.extname(item.file).slice(1).toLowerCase();
    if (!['png', 'jpg', 'webp', 'gif'].includes(ext)) throw new Error('素材格式不受支持。');
    const sha256 = createHash('sha256').update(bytes).digest('hex'), id = `${sha256}.${ext}`;
    css = css.replaceAll(item.placeholder, `tts-asset://${id}`);
    if (!bytesById.has(id)) assets.push({ file: `assets/${id}`, id, sha256, bytes: bytes.length });
    bytesById.set(id, bytes);
  }
  if (/__[A-Z0-9_]+__/.test(css)) throw new Error('主题中仍有未解析的素材占位符。');
  validateBuiltCss(css); csstree.parse(css);
  const theme = validateTheme({ ...fields, custom_css: css });
  await mkdir(path.join(output, 'assets'), { recursive: true });
  for (const [id, bytes] of bytesById) await writeFile(path.join(output, 'assets', id), bytes);
  await writeFile(path.join(output, 'theme.json'), JSON.stringify(theme));
  await writeFile(path.join(output, 'build.json'), JSON.stringify({ schemaVersion: 1, themeFile: 'theme.json', assets, assetRefs: [], ...(studioRecipe && { recipe: studioRecipe }) }));
  return { output, assets: assets.length };
}
