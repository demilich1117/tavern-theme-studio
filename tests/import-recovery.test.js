import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';
import { createProject } from '../shared/core.js';

test('every replacement import persists recovery across restart; launcher reuses the same live data', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'tts-recovery-')); let app;
  try {
    app=await createServer({dataDir:dir,port:0});
    // A restarted server may receive the same ephemeral port on Windows. Do not
    // reuse undici's old keep-alive socket across these deliberate restarts.
    const get=async route=>(await fetch(app.address+route,{headers:{Connection:'close'}})).json();
    const post=async command=>{const s=await get('/api/session');return fetch(app.address+'/api/commands',{method:'POST',headers:{Connection:'close','Content-Type':'application/json','X-Studio-Token':s.token},body:JSON.stringify({...s,command})});};
    await post({type:'set',target:'assistant',property:'border-radius',value:'12px'});
    const saved=await (await post({type:'snapshot-save',name:'起点'})).json();
    const commands=[
      {type:'import-theme',theme:{name:'文件主题',custom_css:'body{color:red}'}},
      {type:'import-project',project:createProject({name:'文件工程',custom_css:''})},
      {type:'theme-import',theme:{name:'宿主主题',custom_css:''}},
      {type:'base-theme',theme:{name:'新底层',custom_css:':root{--size:12px}'}},
      {type:'restore-files',project:createProject({name:'分文件恢复',custom_css:''})},
      {type:'snapshot-restore',id:saved.snapshotCreated.id}
    ];
    for(const command of commands){
      const before=await get('/api/project'); if(command.type==='theme-import')command.scanFingerprint=before.fingerprint;
      const response=await post(command); assert.equal(response.status,200); const next=await response.json(); assert(next.snapshotCreated,command.type);
      assert.equal((await get('/api/snapshots/'+next.snapshotCreated.id)).fingerprint,before.fingerprint);
      await app.close(); app=await createServer({dataDir:dir,port:0});
      assert.equal((await get('/api/project')).canUndo,false);
      assert.equal((await post({type:'snapshot-restore',id:next.snapshotCreated.id})).status,200);
      assert.equal((await get('/api/project')).fingerprint,before.fingerprint);
    }
    const result=await promisify(execFile)(process.execPath,['scripts/start-native-lab.js'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,STUDIO_DATA_DIR:dir},windowsHide:true,timeout:10000});
    assert(result.stdout.includes('已有工作台')); assert(result.stdout.includes(app.address));
  } finally {await app?.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('tts-recovery-'));await rm(dir,{recursive:true,force:true});}
});

test('failed recovery snapshot aborts ordinary import without replacing the saved project',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'tts-recovery-fail-'));let app;
  try{
    app=await createServer({dataDir:dir,port:0});const s=await(await fetch(app.address+'/api/session')).json();
    const before=await readFile(path.join(dir,'project.json'),'utf8'); await writeFile(path.join(dir,'snapshots'),'block directory creation');
    const response=await fetch(app.address+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':s.token},body:JSON.stringify({...s,command:{type:'import-theme',theme:{name:'不可覆盖',custom_css:''}}})});
    assert.equal(response.status,400);assert.equal(await readFile(path.join(dir,'project.json'),'utf8'),before);
    assert.equal((await(await fetch(app.address+'/api/project')).json()).fingerprint,s.fingerprint);
  }finally{await app?.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('tts-recovery-fail-'));await rm(dir,{recursive:true,force:true});}
});
