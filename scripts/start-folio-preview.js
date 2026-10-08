import {createServer} from '../server.js';
const app=await createServer({dataDir:new URL('../.local/folio-preview/',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),port:19322});
console.log(`Moonveil Crescent preview: ${app.address}/moonveil-crescent.html`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});
