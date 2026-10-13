import { buildThemeSource } from '../src/theme-builder.js';
if (!process.env.STUDIO_BUILD_OUTPUT) throw new Error('请通过工作台的通用主题构建器运行。');
console.log(JSON.stringify(await buildThemeSource(process.cwd(), process.env.STUDIO_BUILD_OUTPUT)));
