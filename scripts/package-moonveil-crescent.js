import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
const src=path.join(repo,'examples/moonveil-crescent-folio');
const out=path.join(repo,'dist/moonveil-covenant-2.2.4');
const activeArt=['castle-folio','sleeping-dragon-desktop','sleeping-dragon-mobile','writing-frame','lunar-arc-balanced','nav-pendant','violet-slip','quote-quill','scroll-dragon-bookmark','avatar-talons','lunar-wax-seal','silver-frame'];
await mkdir(out,{recursive:true});
const copy=async(from,to)=>{const dest=path.join(out,to);await mkdir(path.dirname(dest),{recursive:true});await copyFile(from,dest)};
for(const f of ['README.md','BRIEF.md','ARTWORK.md','WORKFLOW.md','moonveil.theme.json','moonveil.studio.json','preview.html'])await copy(path.join(src,f),f);
await copy(path.join(src,'theme.css'),'source/theme.template.css');
await copy(path.join(src,'preview.template.html'),'source/preview.template.html');
await copy(path.join(repo,'scripts/folio-standalone-build.mjs'),'source/build.mjs');
const theme=JSON.parse(await readFile(path.join(src,'moonveil.theme.json'),'utf8'));
assert(!theme.custom_css.includes('127.0.0.1')&&!theme.custom_css.includes('#tts-dock'),'Private preview rules leaked');
const fields={...theme};delete fields.custom_css;
await writeFile(path.join(out,'source/theme-fields.json'),JSON.stringify(fields,null,2));
await writeFile(path.join(out,'theme.css'),theme.custom_css);
const encoding=JSON.parse(await readFile(path.join(src,'assets/encoding.json'),'utf8')).filter(r=>activeArt.includes(r.name));
await mkdir(path.join(out,'assets'),{recursive:true});
await writeFile(path.join(out,'assets/encoding.json'),JSON.stringify(encoding,null,2));
for(const f of ['manifest.json','index.js','README.md'])await copy(path.join(src,'companion',f),'companion/'+f);
for(const f of [...activeArt.map(name=>name+'.webp'),'dragon-portrait.webp','traveler-portrait.webp','fa-solid-900.woff2','Font-Awesome-LICENSE.txt'])await copy(path.join(src,'assets/production',f),'assets/production/'+f);
await mkdir(path.join(out,'assets/prompts'),{recursive:true});
for(const f of await readdir(path.join(src,'assets/originals')))if(activeArt.some(name=>f===name+'.prompt.txt'||f===name+'.revision.prompt.txt')){
 const original=await readFile(path.join(src,'assets/originals',f),'utf8');
 // Preserve the prompt prose; remove machine-specific metadata from the package.
 const portable=original.replace(/^([^\r\n:]+:\s*)([A-Z]:[\\/][^\r\n]+)$/gm,(_,label,file)=>label+(file.endsWith('moonveil-reading-concept-02.png')?'../../validation/reference-concept.png':`[source-project generation record: ${path.basename(file.replaceAll('\\','/'))}]`));
 await writeFile(path.join(out,'assets/prompts',f),portable);
}
// Private host screenshots contain real chats and remain outside the release.
for(const f of ['design-qa.md','demo-desktop-1780.jpg','demo-desktop-wide-95.jpg','demo-desktop-narrow-45.jpg','demo-mobile-393.jpg','demo-long-1780.jpg','demo-desktop-short-600.jpg','host-width-checks.json'])await copy(path.join(src,'validation/2.2.4',f),'validation/'+f);
await copy(path.join(repo,'dist/moonveil-covenant-2.2.3/validation/demo-desktop-1780.jpg'),'validation/reference-2.2.3.jpg');
await copy(path.join(repo,'dist/moonveil-covenant-2.2.3/validation/host-width-checks.json'),'validation/previous-2.2.3-width-checks.json');
await copy(path.join(src,'concepts/quiet-dragon-2026-10-08/desktop-rock-sleep-concept-01.png'),'validation/reference-concept.png');
const manifest=[];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const absolute=path.join(dir,entry.name);if(entry.isDirectory())await walk(absolute);else if(entry.name!=='SHA256SUMS.txt'){const b=await readFile(absolute);manifest.push(`${createHash('sha256').update(b).digest('hex')}  ${path.relative(out,absolute).replaceAll('\\','/')}`)}}}
await walk(out);manifest.sort();await writeFile(path.join(out,'SHA256SUMS.txt'),manifest.join('\n')+'\n');
console.log(JSON.stringify({release:out,files:manifest.length,selfContained:true,cssCharacters:theme.custom_css.length}));
