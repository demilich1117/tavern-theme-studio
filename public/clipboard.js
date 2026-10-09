export async function copyClipboard(text, toast, message = '交接内容已复制，可粘贴到已打开项目的 Agent 对话。') {
  try { await navigator.clipboard.writeText(text); toast(message); return true; }
  catch {
    let dialog = document.querySelector('#clipboard-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.id = 'clipboard-dialog'; dialog.className = 'wide-dialog';
      dialog.innerHTML = '<form method="dialog" class="dialog-header"><h2>手动复制交接内容</h2><button aria-label="关闭手动复制">×</button></form><div class="dialog-body"><p>浏览器未允许直接复制。请选中文本后按 Ctrl+C 或使用系统复制。</p><textarea id="clipboard-text" readonly rows="18" aria-label="可手动复制的完整内容"></textarea><button type="button">全选文本</button></div>';
      dialog.querySelector('.dialog-body button').addEventListener('click', () => { const area = dialog.querySelector('textarea'); area.focus(); area.select(); });
      document.body.append(dialog);
    }
    const area = dialog.querySelector('textarea'); area.value = text; if (!dialog.open) dialog.showModal(); area.focus(); area.select();
    toast('完整文本已准备，请在弹出的文本框中手动复制。'); return false;
  }
}
