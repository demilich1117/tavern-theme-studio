import { buildFolio, folioSource } from './folio-build.mjs';
const args = process.argv.slice(2);
const option = flag => { const i = args.indexOf(flag); if (i < 0) return undefined; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${flag} 缺少参数。`); return args[i + 1]; };
const outputDir = option('--output') || process.env.STUDIO_BUILD_OUTPUT;
const mode = option('--asset-mode') || process.env.STUDIO_ASSET_MODE || 'embedded';
console.log(JSON.stringify(await buildFolio({ outputDir: outputDir || folioSource, mode, legacy: !outputDir, preview: !args.includes('--no-preview') && !outputDir })));
