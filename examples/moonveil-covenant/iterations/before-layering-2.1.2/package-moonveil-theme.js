// Explicit release manifest: excludes private screenshots, originals and historical candidates.
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../examples/moonveil-covenant/', import.meta.url);
const dist = new URL('../dist/moonveil-covenant-2.1.1/', import.meta.url);
const art = ['dragon-user-final-v3','silver-frame','avatar-talons','castle-night','codex-message-frame','lunar-wax-seal','moon-phase-clasp'];
const files = [
  'README.md','BRIEF.md','WORKFLOW.md','theme.css','moonveil.theme.json','moonveil.studio.json','preview.html','preview.template.html',
  ...art.map(n=>`assets/night/${n}.webp`),
  ...['codex-message-frame','lunar-wax-seal','moon-phase-clasp'].map(n=>`assets/night/${n}.prompt.txt`),
  'assets/night/MESSAGE-ARTWORK.md','assets/night/GENERATION.md','assets/night/message-encoding.json',
  'assets/night/Font-Awesome-LICENSE.txt','assets/night/fa-solid-900.woff2','assets/night/dragon-portrait.webp','assets/night/traveler-portrait.webp',
  'validation/messages-2.1/qa.md','validation/messages-2.1/layout.json',
  'validation/messages-2.1/desktop-reading.png','validation/messages-2.1/mobile-expanded.png','validation/messages-2.1/mobile-collapsed.png',
  'validation/reading-2.1.1/qa.md','validation/reading-2.1.1/comparison.json',
  'validation/reading-2.1.1/after-1685x785.png','validation/reading-2.1.1/after-1366x768.png','validation/reading-2.1.1/desktop-reading.png',
  'validation/reading-2.1.1/laptop-reading.png','validation/reading-2.1.1/preview-switch.json','validation/reading-2.1.1/width-74.json',
];
const manifest = [];
for (const file of files) {
  const target = new URL(file,dist);
  await mkdir(new URL('.',target),{recursive:true});
  await copyFile(new URL(file,root),target);
  const bytes = await readFile(target);
  manifest.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(new URL('release.json',dist),JSON.stringify({version:'2.1.1',target:'SillyTavern 1.19.0 / 06bde939f',files:manifest},null,2));
console.log(JSON.stringify({directory:dist.pathname,files:manifest.length,bytes:manifest.reduce((n,f)=>n+f.bytes,0)}));
