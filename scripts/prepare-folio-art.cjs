// Encode generated originals without changing their illustration or aspect ratio.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');
const root = path.resolve(__dirname, '../examples/moonveil-crescent-folio/assets');
const jobs = [
  ['castle-folio', 1774, 88],
  ['folio-dragon', 1050, 91],
  ['writing-frame', 1600, 90, {left:41,top:239,width:2067,height:242}],
  ['lunar-arc-balanced', 1710, 92, {left:32,top:298,width:1710,height:342}],
  ['nav-pendant', 160, 92, {left:145,top:106,width:813,height:1220}],
  ['violet-slip', 1400, 88, {left:60,top:197,width:2075,height:312}],
  ['quote-quill', 144, 90, {left:459,top:55,width:403,height:1208}],
  ['scroll-jewel', 80, 92, {left:454,top:232,width:345,height:749}],
];
(async()=>{
  await fs.mkdir(path.join(root,'production'),{recursive:true});
  const report=[];
  for(const [name,width,quality,crop] of jobs){
    const source=path.join(root,'originals',name+'.png');
    const original=await sharp(source).metadata();
    let pipeline=sharp(source);if(crop)pipeline=pipeline.extract(crop);
    const target=path.join(root,'production',name+'.webp');
    await pipeline.resize({width,withoutEnlargement:true}).webp({quality,alphaQuality:100,effort:6}).toFile(target);
    const metadata=await sharp(target).metadata();
    report.push({name,original:{width:original.width,height:original.height},crop:crop||null,width:metadata.width,height:metadata.height,hasAlpha:metadata.hasAlpha,bytes:(await fs.stat(target)).size});
  }
  for(const name of ['avatar-talons.webp','lunar-wax-seal.webp','silver-frame.webp','dragon-portrait.webp','traveler-portrait.webp','fa-solid-900.woff2','Font-Awesome-LICENSE.txt']){
    await fs.copyFile(path.resolve(__dirname,'../examples/moonveil-covenant/assets/night',name),path.join(root,'production',name));
  }
  await fs.writeFile(path.join(root,'encoding.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({assets:report,bytes:report.reduce((n,a)=>n+a.bytes,0)},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
