import { normalizeBrief, formatBrief, buildCoDesignPrompt } from '/shared/co-design.js';
import { copyClipboard } from '/clipboard.js';
import { openStudioPanel } from '/panels.js';

export function attachCoDesign({ getState, connection, selectTarget, stopPicking, toast }) {
  const $ = selector => document.querySelector(selector);
  const form = $('#co-design-form');
  const fields = [...form.elements].filter(element => element.name);
  const drafts = new Map();
  let projectId, storageFailed = false;
  const storageKey = id => `tts:co-design:v1:${id}`;
  const currentBrief = () => normalizeBrief(Object.fromEntries(fields.map(element => [element.name, element.value])));

  function context() {
    const state = getState(), host = connection();
    const preview = host.live && host.ready
      ? host.fixtureActive ? '真实酒馆 · 当前为虚构测试对话' : '已连接酒馆 · 尚未确认虚构测试对话'
      : '尚未连接真实酒馆；示例预览不代表宿主验证';
    return { name: state.project.name, address: location.origin, projectId: state.projectId, revision: state.revision, preview };
  }
  function updateDraftStatus() {
    $('#co-design-draft-status').textContent = storageFailed
      ? '浏览器无法保存简报；离开前请下载或复制。'
      : '简报按工程保存在此浏览器，换设备前请下载；不随工程备份导出。';
    $('#co-design-build').disabled = !currentBrief().decision.trim();
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
      for (const element of fields) element.value = brief[element.name];
    }
    const current = context();
    $('#co-design-context').textContent = `${current.name} · ${current.preview}`;
    updateDraftStatus();
  }
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', remember);
  form.addEventListener('change', remember);
  $('#co-design-view').addEventListener('click', () => { stopPicking(); render(); openStudioPanel('co-design-dialog'); });
  for (const button of document.querySelectorAll('[data-co-design-phase]')) button.addEventListener('click', async () => {
    try {
      remember();
      await copyClipboard(buildCoDesignPrompt(currentBrief(), context(), button.dataset.coDesignPhase), toast, '共创说明已复制。粘贴给 Agent，并在同一对话附上参考图片。');
    } catch (error) { toast(error.message, true); }
  });
  $('#co-design-download').addEventListener('click', () => {
    remember();
    const blob = new Blob([formatBrief(currentBrief(), context()) + '\n'], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'theme-design-brief.md'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('简报已下载，请和主题工程、选定参考图一起保留。');
  });
  for (const button of document.querySelectorAll('[data-co-design-target]')) button.addEventListener('click', () => selectTarget(button.dataset.coDesignTarget));
  render();
  return { render };
}
