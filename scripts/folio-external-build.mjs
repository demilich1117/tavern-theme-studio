// Maintained repository entry; the 2.2.4 portable release builder stays frozen.
import { buildFolio } from './folio-build.mjs';
const index = process.argv.indexOf('--output');
console.log(JSON.stringify(await buildFolio({ outputDir: index < 0 ? process.env.STUDIO_BUILD_OUTPUT : process.argv[index + 1], mode: 'external', preview: false })));
