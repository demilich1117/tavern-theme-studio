const sharp=require(process.argv[2]||'sharp');
const path=require('node:path');
const root=path.resolve(__dirname,'../examples/moonveil-crescent-folio/validation');
const source=path.resolve(__dirname,'../examples/moonveil-covenant/concepts/reading-layout-2026-10-07/moonveil-reading-concept-02.png');
const rendered=path.join(root,'demo-desktop-1780.jpg');
(async()=>{
 const meta=await sharp(rendered).metadata();
 if(meta.width!==1780||meta.height!==883)throw Error('Expected 1780 × 883 viewport evidence.');
 await sharp({create:{width:3568,height:883,channels:3,background:'#101625'}}).composite([{input:source,left:0,top:0},{input:rendered,left:1788,top:0}]).png().toFile(path.join(root,'comparison-full.png'));
 const crop={left:300,top:106,width:1240,height:418};
 await sharp({create:{width:2488,height:418,channels:3,background:'#101625'}}).composite([{input:await sharp(source).extract(crop).toBuffer(),left:0,top:0},{input:await sharp(rendered).extract(crop).toBuffer(),left:1248,top:0}]).png().toFile(path.join(root,'comparison-reading.png'));
 const lower={left:1250,top:603,width:530,height:280};
 await sharp({create:{width:1068,height:280,channels:3,background:'#101625'}}).composite([{input:await sharp(source).extract(lower).toBuffer(),left:0,top:0},{input:await sharp(rendered).extract(lower).toBuffer(),left:538,top:0}]).png().toFile(path.join(root,'comparison-dragon.png'));
 console.log('Three same-scale comparison images written; source left, browser capture right.');
})().catch(e=>{console.error(e);process.exitCode=1});
