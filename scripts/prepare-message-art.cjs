// Production encoding only: alpha-preserving trim and proportional resize.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require(process.argv[2]);
const root = path.resolve(__dirname, '../examples/moonveil-covenant/assets/night');
(async () => {
  const report = [];
  for (const [name, width, trim] of [
    ['codex-message-frame', 640, false],
    ['lunar-wax-seal', 144, true],
    ['moon-phase-clasp', 420, true],
  ]) {
    const source = path.join(root, `${name}.original.png`);
    const meta = await sharp(source).metadata();
    const {data, info} = await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let transparent = 0, opaque = 0, centerMaxAlpha = 0;
    for (let y=0; y<info.height; y++) for (let x=0; x<info.width; x++) {
      const a = data[(y*info.width+x)*4+3];
      if (a===0) transparent++;
      if (a===255) opaque++;
      if (x>info.width*.3 && x<info.width*.7 && y>info.height*.3 && y<info.height*.7) centerMaxAlpha=Math.max(centerMaxAlpha,a);
    }
    if (!meta.hasAlpha || !transparent) throw new Error(`${name}: missing true transparency`);
    let pipeline = sharp(source);
    if (trim) pipeline = pipeline.trim({threshold:5});
    const encoded = await pipeline.resize({width}).webp({quality:84,alphaQuality:100,effort:6}).toFile(path.join(root,`${name}.webp`));
    report.push({name,original:{width:meta.width,height:meta.height,hasAlpha:meta.hasAlpha,transparentFraction:transparent/(info.width*info.height),opaqueFraction:opaque/(info.width*info.height),centerMaxAlpha},production:encoded});
  }
  await fs.writeFile(path.join(root,'message-encoding.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
