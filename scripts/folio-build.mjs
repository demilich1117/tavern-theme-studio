import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createProject, exportTheme, applyCommand } from '../shared/core.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
export const folioSource = path.join(projectRoot, 'examples/moonveil-crescent-folio');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function buildFolio({ outputDir, mode = 'embedded', preview = false, legacy = false } = {}) {
  if (!['local', 'embedded', 'external'].includes(mode)) throw new Error('素材模式应为 local、embedded 或 external。');
  outputDir = path.resolve(outputDir || path.join(projectRoot, 'dist/candidates/moonveil-folio'));
  for (const name of ['moonveil-covenant-2.2.4', 'moonveil-covenant-2.2.4-external']) {
    const baseline = path.join(projectRoot, 'dist', name);
    if (outputDir === baseline || outputDir.startsWith(baseline + path.sep)) throw new Error('2.2.4 恢复基线只读；请输出到候选目录。');
  }
  const manifest = JSON.parse(await readFile(path.join(folioSource, 'assets.manifest.json'), 'utf8'));
  const fields = JSON.parse(await readFile(path.join(folioSource, 'theme-fields.json'), 'utf8'));
  let css = await readFile(path.join(folioSource, 'theme.css'), 'utf8'), nativeCss = css;
  const assets = [], assetRefs = [];
  for (const item of manifest.assets) {
    if (!/^[\w-]+\.webp$/.test(item.originalFile)) throw new Error('素材清单包含无效文件名。');
    const file = path.join(folioSource, 'assets/production', item.originalFile);
    let bytes; try { bytes = await readFile(file); } catch (e) { throw new Error(`缺少素材 ${item.originalFile}：${e.message}`); }
    const sha256 = hash(bytes), id = `${sha256}.webp`, reference = `tts-asset://${id}`;
    if (!css.includes(item.marker)) throw new Error(`未使用的素材插槽 ${item.marker}。`);
    if (mode === 'external') {
      if (sha256 !== item.sha256) throw new Error(`素材 ${item.originalFile} 已改变，固定外链对应旧哈希；请先发布新内容并更新清单。`);
      if (!item.url.startsWith(`https://raw.githubusercontent.com/${manifest.repository}/${manifest.commit}/`) || /[\s"'()<>]/.test(item.url)) throw new Error(`素材 ${item.originalFile} 缺少固定提交外链。`);
      css = css.replaceAll(item.marker, item.url); nativeCss = nativeCss.replaceAll(item.marker, item.url);
      assetRefs.push({ id: sha256, sha256, name: item.originalFile, reference: item.url, kind: 'external', repository: manifest.repository, commit: manifest.commit });
    } else {
      css = css.replaceAll(item.marker, legacy ? `data:image/webp;base64,${bytes.toString('base64')}` : reference);
      nativeCss = nativeCss.replaceAll(item.marker, `data:image/webp;base64,${bytes.toString('base64')}`);
      assets.push({ file: `assets/${id}`, id, sha256, bytes: bytes.length, name: item.originalFile, data: bytes });
      assetRefs.push({ id, sha256, name: item.originalFile, reference, kind: 'local' });
    }
  }
  if (/__\w+__/.test(css)) throw new Error('CSS 仍含未解析素材占位符。');
  const recipe = JSON.parse(await readFile(path.join(folioSource, 'studio.recipe.json'), 'utf8'));
  const theme = { ...fields, custom_css: css }, project = applyCommand(createProject(theme), { type: 'recipe', recipe });
  project.assetRefs = assetRefs;
  const native = { ...fields, custom_css: nativeCss };
  await mkdir(outputDir, { recursive: true });
  if (!legacy) {
    for (const asset of assets) { await mkdir(path.dirname(path.join(outputDir, asset.file)), { recursive: true }); await writeFile(path.join(outputDir, asset.file), asset.data); }
    await writeFile(path.join(outputDir, 'theme.json'), JSON.stringify(theme, null, 2));
    await writeFile(path.join(outputDir, 'build.json'), JSON.stringify({ schemaVersion: 1, themeFile: 'theme.json', mode, assets: assets.map(({ data, ...asset }) => asset), assetRefs, recipe }, null, 2));
  }
  await writeFile(path.join(outputDir, 'moonveil.theme.json'), JSON.stringify(native, null, 2));
  await writeFile(path.join(outputDir, 'moonveil.studio.json'), JSON.stringify(project, null, 2));
  if (preview) {
    let html = (await readFile(path.join(folioSource, 'preview.template.html'), 'utf8')).replace('__THEME_CSS__', exportTheme(createProject(native)).custom_css);
    for (const [marker, file, mime] of [['ICON_FONT', 'fa-solid-900.woff2', 'font/woff2'], ['PORTRAIT_A', 'dragon-portrait.webp', 'image/webp'], ['PORTRAIT_U', 'traveler-portrait.webp', 'image/webp']]) {
      const bytes = await readFile(path.join(folioSource, 'assets/production', file)); html = html.replaceAll(`__${marker}__`, `data:${mime};base64,${bytes.toString('base64')}`);
    }
    html = html.replace('__COMPANION_JS__', await readFile(path.join(folioSource, 'companion/index.js'), 'utf8'));
    if (/__\w+__/.test(html)) throw new Error('演示仍含未解析占位符。');
    await writeFile(path.join(outputDir, 'preview.html'), html);
  }
  if (legacy) {
    for (const [file, served] of [['moonveil.theme.json', 'moonveil-crescent.theme.json'], ['moonveil.studio.json', 'moonveil-crescent.studio.json'], ...(preview ? [['preview.html', 'moonveil-crescent.html']] : [])]) {
      let text = await readFile(path.join(outputDir, file), 'utf8'); if (file === 'preview.html') text = text.replaceAll('href="./moonveil.', 'href="./moonveil-crescent.');
      await writeFile(path.join(projectRoot, 'public', served), text);
    }
  }
  return { outputDir, mode, assets: manifest.assets.length, cssCharacters: css.length, nativeBytes: Buffer.byteLength(JSON.stringify(native)), preview };
}
