import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createProject,exportTheme,validateProject} from '../shared/core.js';
const root=new URL('../examples/moonveil-crescent-folio/',import.meta.url);
const artwork={CASTLE:'castle-folio',DRAGON:'sleeping-dragon-desktop',BABY_DRAGON:'sleeping-dragon-mobile',WRITING:'writing-frame',ARC:'lunar-arc-balanced',PENDANT:'nav-pendant',SLIP:'violet-slip',QUILL:'quote-quill',JEWEL:'scroll-dragon-bookmark',AVATAR:'avatar-talons',SEAL:'lunar-wax-seal',FRAME:'silver-frame'};
let css=await readFile(new URL('theme.css',root),'utf8');
let artworkBytes=0;
for(const [marker,name] of Object.entries(artwork)){
  const bytes=await readFile(new URL(`assets/production/${name}.webp`,root));artworkBytes+=bytes.length;
  assert(css.includes(`__${marker}_ART__`),`Unused artwork ${marker}`);
  css=css.replaceAll(`__${marker}_ART__`,`data:image/webp;base64,${bytes.toString('base64')}`);
}
assert(!/__\w+__/.test(css),'Unresolved CSS asset');
assert(!/url\(["']?https?:/i.test(css),'Theme must remain self contained');
// Deliberately omit native width/font/mode/visibility preferences: an update
// should inherit the reader's saved preferences, not reset them to mock values.
const theme={name:'月誓 · 龙廷 2.2.4 — 月弧浮页',blur_strength:0,shadow_width:0,
 main_text_color:'#d2d5e3',italics_text_color:'#c4bde2',underline_text_color:'#b5acec',quote_text_color:'#c8bee9',
 blur_tint_color:'#202637',chat_tint_color:'#10162500',user_mes_blur_tint_color:'#302e4600',bot_mes_blur_tint_color:'#10162500',
 shadow_color:'#00000000',border_color:'#7783a34d',custom_css:css};
for(const key of Object.keys(theme).filter(k=>k.endsWith('_color'))){
 const hex=theme[key].slice(1),c=n=>parseInt(hex.slice(n,n+2),16);
 theme[key]=`rgba(${c(0)}, ${c(2)}, ${c(4)}, ${hex.length===8?+(c(6)/255).toFixed(4):1})`;
}
const project=createProject(theme),compiled=exportTheme(validateProject(project));
assert.equal(compiled.custom_css.trim(),css.trim());
const outputs={'moonveil.theme.json':JSON.stringify(compiled,null,2),'moonveil.studio.json':JSON.stringify(project,null,2)};
const includePreview=!process.argv.includes('--no-preview');
if(includePreview){
let html=(await readFile(new URL('preview.template.html',root),'utf8')).replace('__THEME_CSS__',compiled.custom_css);
for(const [marker,file,mime] of [['ICON_FONT','fa-solid-900.woff2','font/woff2'],['PORTRAIT_A','dragon-portrait.webp','image/webp'],['PORTRAIT_U','traveler-portrait.webp','image/webp']]){
 const data=await readFile(new URL(`assets/production/${file}`,root));
 html=html.replaceAll(`__${marker}__`,`data:${mime};base64,${data.toString('base64')}`);
}
html=html.replace('__COMPANION_JS__',await readFile(new URL('companion/index.js',root),'utf8'));
assert(!/__\w+__/.test(html),'Unresolved preview asset');
outputs['preview.html']=html;
}
await mkdir(root,{recursive:true});
for(const [name,content] of Object.entries(outputs)){
 await writeFile(new URL(name,root),content);
 const served=name==='preview.html'?'moonveil-crescent.html':name.replace('moonveil.','moonveil-crescent.');
 await writeFile(new URL(`../public/${served}`,import.meta.url),name==='preview.html'?content.replaceAll('href="./moonveil.','href="./moonveil-crescent.'):content);
}
console.log(JSON.stringify({version:'2.2.4',name:theme.name,cssCharacters:css.length,artworkBytes,assets:Object.keys(artwork).length,preserves:['chat_width','font_scale','chat_display','avatar_style','hideChatAvatars_enabled','mesIDDisplay_enabled'],standalone:includePreview}));
