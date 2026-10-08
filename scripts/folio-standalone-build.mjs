// Portable source builder; distributed as source/build.mjs.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const art={CASTLE:'castle-folio',DRAGON:'sleeping-dragon-desktop',BABY_DRAGON:'sleeping-dragon-mobile',WRITING:'writing-frame',ARC:'lunar-arc-balanced',PENDANT:'nav-pendant',SLIP:'violet-slip',QUILL:'quote-quill',JEWEL:'scroll-dragon-bookmark',AVATAR:'avatar-talons',SEAL:'lunar-wax-seal',FRAME:'silver-frame'};
let css=await readFile(new URL('source/theme.template.css',root),'utf8');
for(const [marker,name] of Object.entries(art))css=css.replaceAll(`__${marker}_ART__`,`data:image/webp;base64,${(await readFile(new URL(`assets/production/${name}.webp`,root))).toString('base64')}`);
assert(!/__\w+__/.test(css),'Unresolved CSS asset');
assert(!/url\(["']?https?:/i.test(css),'External artwork is not allowed in the release');
const theme={...JSON.parse(await readFile(new URL('source/theme-fields.json',root),'utf8')),custom_css:css};
const project={schemaVersion:2,name:theme.name,baseTheme:theme,rules:{base:{},mobile:{}},variableEdits:{},customCss:''};
let html=(await readFile(new URL('source/preview.template.html',root),'utf8')).replace('__THEME_CSS__',css);
for(const [marker,file,mime] of [['ICON_FONT','fa-solid-900.woff2','font/woff2'],['PORTRAIT_A','dragon-portrait.webp','image/webp'],['PORTRAIT_U','traveler-portrait.webp','image/webp']])html=html.replaceAll(`__${marker}__`,`data:${mime};base64,${(await readFile(new URL(`assets/production/${file}`,root))).toString('base64')}`);
html=html.replace('__COMPANION_JS__',await readFile(new URL('companion/index.js',root),'utf8'));
assert(!/__\w+__/.test(html),'Unresolved preview asset');
for(const [file,data] of Object.entries({'moonveil.theme.json':JSON.stringify(theme,null,2),'moonveil.studio.json':JSON.stringify(project,null,2),'theme.css':css,'preview.html':html}))await writeFile(new URL(file,root),data);
console.log('Rebuilt native theme, Studio project, CSS and offline preview.');
