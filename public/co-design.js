import { normalizeBrief, formatBrief, buildCoDesignPrompt } from '/shared/co-design.js';
import { copyClipboard } from '/clipboard.js';
import { openStudioPanel } from '/panels.js';

export function attachCoDesign({ getState, connection, selectTarget, stopPicking, toast }) {
  const $ = selector => document.querySelector(selector);
  const form = $('#co-design-form');
  const fields = [...form.elements].filter(element => element.name);
  const drafts = new Map();
  let projectId, storageFailed = false;
  const handoffStatus = $('#co-design-handoff-status');
  function clearHandoff() { handoffStatus.hidden = true; handoffStatus.textContent = ''; }
  const storageKey = id => `tts:co-design:v1:${id}`;
  // Keep legacy decision notes even though the normal flow no longer asks users to fill them in.
  const currentBrief = () => normalizeBrief({ ...drafts.get(projectId), ...Object.fromEntries(fields.map(element => [element.name, element.value])) });

  function context() {
    const state = getState(), host = connection();
    const preview = host.live && host.ready
      ? host.fixtureActive ? '真实酒馆 · 当前为虚构测试对话' : '已连接酒馆 · 尚未确认虚构测试对话'
      : '尚未连接真实酒馆；示例预览不代表宿主验证';
    return { name: state.project.name, address: location.origin, projectId: state.projectId, revision: state.revision, preview };
  }
  function updateDraftStatus() {
    $('#co-design-draft-status').textContent = storageFailed
      ? '此浏览器无法保存想法；离开前请复制给 Agent，或展开「想法怎么保存？」下载。'
      : '想法会自动保存在此浏览器，稍后回来可以继续。';
  }
  function remember() {
    const brief = currentBrief(); drafts.set(projectId, brief);
    try { localStorage.setItem(storageKey(projectId), JSON.stringify(brief)); storageFailed = false; }
    catch { storageFailed = true; }
    updateDraftStatus();
  }
  function render() {
    const state = getState();
    if (projectId !== state.projectId) {
      clearHandoff();
      // Persist edits under the previous identity before loading another theme.
      if (projectId) remember();
      projectId = state.projectId;
      let saved = drafts.get(projectId);
      storageFailed = false;
      if (!saved) {
        try { saved = JSON.parse(localStorage.getItem(storageKey(projectId)) || '{}'); }
        catch { storageFailed = true; }
      }
      const brief = normalizeBrief(saved);
      drafts.set(projectId, brief);
      for (const element of fields) element.value = brief[element.name];
    }
    const current = context();
    $('#co-design-context').textContent = `${current.name} · ${current.preview}`;
    updateDraftStatus();
  }
  form.addEventListener('submit', event => event.preventDefault());
  function edited() { clearHandoff(); remember(); }
  form.addEventListener('input', edited);
  form.addEventListener('change', edited);
  $('#co-design-view').addEventListener('click', () => { stopPicking(); render(); openStudioPanel('co-design-dialog'); });
  $('#co-design-start').addEventListener('click', async () => {
    try {
      remember();
      const sourceProjectId = projectId;
      const copied = await copyClipboard(buildCoDesignPrompt(currentBrief(), context()), toast, '已复制。现在粘贴到 Agent 对话，接着在那里看图、选方向即可。');
      if (projectId === sourceProjectId) {
        handoffStatus.textContent = copied
          ? '已复制。下一步：粘贴到 Agent 对话，有参考图时另附。直接聊想法、看图选方向；Agent 做出样板后，会带你回工作台微调和标注。'
          : '还差一步：在弹出的文本框里手动复制，再粘贴到 Agent 对话；后续在那里看图、选方向即可。';
        handoffStatus.hidden = false;
      }
    } catch (error) { toast(error.message, true); }
  });
  $('#co-design-download').addEventListener('click', () => {
    remember();
    const blob = new Blob([formatBrief(currentBrief(), context()) + '\n'], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'theme-design-brief.md'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('这页想法已下载。Agent 整理的最新设计记录和参考图请另行保留。');
  });
  for (const button of document.querySelectorAll('[data-co-design-target]')) button.addEventListener('click', () => selectTarget(button.dataset.coDesignTarget));
  render();
  return { render };
}
