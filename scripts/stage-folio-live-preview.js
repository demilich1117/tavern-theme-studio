// Older installed preview bridges cap CSS at 250 KB. Serve identical production
// pixels locally for host QA, while the release remains completely self-contained.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createProject} from '../shared/core.js';
const root=new URL('../examples/moonveil-crescent-folio/',import.meta.url);
const theme=JSON.parse(await readFile(new URL('moonveil.theme.json',root),'utf8'));
const artwork={CASTLE:'castle-folio',DRAGON:'sleeping-dragon-desktop',BABY_DRAGON:'sleeping-dragon-mobile',WRITING:'writing-frame',ARC:'lunar-arc-balanced',PENDANT:'nav-pendant',SLIP:'violet-slip',QUILL:'quote-quill',JEWEL:'scroll-dragon-bookmark',AVATAR:'avatar-talons',SEAL:'lunar-wax-seal',FRAME:'silver-frame'};
theme.custom_css=await readFile(new URL('theme.css',root),'utf8');
await mkdir(new URL('../public/folio-art/',import.meta.url),{recursive:true});
for(const [marker,name] of Object.entries(artwork)){
 await copyFile(new URL(`assets/production/${name}.webp`,root),new URL(`../public/folio-art/${name}.webp`,import.meta.url));
 theme.custom_css=theme.custom_css.replaceAll(`__${marker}_ART__`,`http://127.0.0.1:19322/folio-art/${name}.webp?v=2.2.4`);
}
theme.custom_css+='\n/* QA only: keep the connected studio out of the screenshot and hit testing. */\n#tts-dock{visibility:hidden!important}\n';
await mkdir(new URL('../.local/folio-preview/',import.meta.url),{recursive:true});
await writeFile(new URL('../.local/folio-preview/live-preview.studio.json',import.meta.url),JSON.stringify(createProject(theme),null,2));
console.log('Live host QA project staged; production release unchanged.');
