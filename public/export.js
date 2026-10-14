export function attachExport({ download, toast, settled, getName, connection, send, onApplied }) {
  const dialog = document.createElement('dialog'); dialog.className = 'wide-dialog'; dialog.id = 'export-dialog';
  dialog.innerHTML = `<form method="dialog" class="dialog-header"><h2>导出主题</h2><button aria-label="关闭导出">×</button></form><div class="dialog-body">
    <div class="export-choice"><label for="export-name">导出名称</label><input id="export-name" required maxlength="120"><p>使用新名称，保留酒馆里的原主题。</p><button id="export-standard" class="primary">下载酒馆主题 JSON</button><p>本地图片随文件保存，原有图片和字体外链保留。</p><p id="export-summary" role="status"></p></div>
    <p id="export-result" role="status"></p><div id="export-next" class="export-next" hidden>下一步：在酒馆的「用户设置 → 主题」导入下载的 JSON，再选择新主题。</div>
    <details class="export-details"><summary>离线导出与固定外链</summary><p>离线模式要求所有依赖可内嵌；固定外链模式要求公开地址与版本已验证。</p><button id="export-offline">导出完整离线主题</button><button id="export-external">验证并导出外链主题</button></details>
    <details class="export-details"><summary>依赖详情</summary><pre id="export-audit"></pre></details>
    <details class="export-details"><summary>工程备份</summary><button id="export-portable">单文件工程备份</button><p>大工程可用 CLI 分文件备份，目标目录必须尚不存在：</p><pre>node scripts/cli.js backup-files output/my-backup
node scripts/cli.js restore-files output/my-backup</pre><p>先设置 STUDIO_URL。工程备份含素材，不含小票和本机执行配置；完整历史请保留数据目录。</p></details></div>`;
  document.body.append(dialog);
  const css = document.createElement('button'); css.id = 'canvas-download-css'; css.textContent = '仅下载 CSS';
  dialog.querySelector('.export-choice').append(css);
  const $ = s => dialog.querySelector(s);
  const apply = document.createElement('button'); apply.id = 'export-apply'; apply.className = 'primary'; apply.textContent = '应用到酒馆';
  $('#export-standard').before(apply); $('#export-standard').classList.remove('primary');
  const read = async route => { await settled(); const r = await fetch(route), data = await r.json(); if (!r.ok) throw new Error(data.error); return data; };
  let operation = 0, pending, timer;
  document.querySelector('#export-theme').addEventListener('click', async () => {
    const current=++operation; dialog.showModal(); $('#export-summary').textContent='正在检查素材…'; $('#export-result').textContent=''; $('#export-next').hidden=true;
    apply.hidden = !connection().ready || !connection().live || !connection().capabilities?.nativeThemeApply;
    const now=new Date(), pad=n=>String(n).padStart(2,'0'), suffix=` · ${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    $('#export-name').value=getName().slice(0,120-suffix.length)+suffix;
    try { const a=await read('/api/export/audit'); if (current!==operation) return;
      $('#export-summary').textContent=a.remote.length ? `包含 ${a.remote.length} 项外部依赖，显示时需要联网。` : '未发现外部网络依赖。';
      if(a.unresolved.length) $('#export-summary').textContent+=` ${a.unresolved.length} 项引用需核对，详见依赖详情。`;
      $('#export-audit').textContent=`CSS ${(a.cssBytes/1024).toFixed(1)} KiB · 本地素材 ${a.local.length}\n${a.remote.map(r=>r.reference).join('\n')}\n${a.unresolved.join('\n')}`;
    } catch(e){ $('#export-summary').textContent=e.message; }
  });
  const lock = value => { dialog.querySelectorAll('button[id^=export-], #export-name').forEach(b => b.disabled = value); };
  apply.addEventListener('click', async () => {
    if (pending || !$('#export-name').reportValidity()) return;
    const name = $('#export-name').value.trim(); if (!name) return;
    lock(true); $('#export-result').textContent = '正在内嵌素材并交给酒馆…'; $('#export-next').hidden = true;
    try {
      const result = await read('/api/export?mode=standard'); result.theme.name = name;
      if (!connection().ready) throw new Error('连接已断开，请重新连接或下载主题文件。');
      pending = crypto.randomUUID(); send('apply-native-theme', { requestId: pending, theme: result.theme });
      $('#export-result').textContent = '正在导入；如果酒馆显示提示，请在酒馆中完成。';
      timer = setTimeout(() => finish({ ok: false, error: '尚未收到酒馆完成回执，请检查酒馆主题列表。' }), 130000);
    } catch (e) { finish({ ok: false, error: e.message }); }
  });
  function finish(result) {
    clearTimeout(timer); pending = undefined; lock(false);
    $('#export-result').textContent = result.ok ? `已保存并应用“${result.name}”。关闭工作台后仍会保留，原主题也在。` : result.error;
    if (result.ok) onApplied(); else toast(result.error, true);
  }
  for(const mode of ['standard','offline','external']) $('#export-'+mode).addEventListener('click',async()=>{
    if(!$('#export-name').reportValidity())return;
    const name=$('#export-name').value.trim();if(!name){toast('请填写导出名称。',true);return;}
    const buttons=[...dialog.querySelectorAll('button[id^=export-]')]; buttons.forEach(b=>b.disabled=true); $('#export-result').textContent='正在准备文件…'; $('#export-next').hidden=true;
    try {const result=await read('/api/export?mode='+mode); result.theme.name=name; download(result.theme,mode==='standard'?'':'.'+mode); $('#export-result').textContent=`已下载主题 · ${(result.report.actualBytes/1024).toFixed(1)} KiB`; $('#export-next').hidden=false;}
    catch(e){$('#export-result').textContent=e.message;toast(e.message,true);}
    finally{buttons.forEach(b=>b.disabled=false);}
  });
  $('#export-portable').addEventListener('click',async()=>{try{download(await read('/api/backup'),'.studio');$('#export-result').textContent='工程备份已下载。';}catch(e){$('#export-result').textContent=e.message;}});
  return { receive(data) {
    if (pending && data.type === 'native-theme-result' && data.requestId === pending) finish(data);
    if (pending && data.type === 'disconnected') finish({ ok: false, error: '连接已断开，请检查酒馆主题列表后再继续。' });
  } };
}
