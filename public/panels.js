const groups = { 'theme-analysis-dialog': 'materials', 'assets-dialog': 'materials', 'layers-dialog': 'materials', 'tickets-dialog': 'comments', 'co-design-dialog': 'co-design' };
const $ = selector => document.querySelector(selector);
let changing = false;

function showView(view) {
  document.body.dataset.view = view;
  for (const button of $('#workbench-nav').children) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  $('.workspace').hidden = view !== 'edit';
  $('#workspace-panel-host').hidden = view === 'edit';
  $('#material-tabs').hidden = view !== 'materials';
}
export function showEditor() {
  changing = true;
  for (const panel of document.querySelectorAll('.workspace-panel[open]')) panel.close();
  changing = false; showView('edit');
}
export function openStudioPanel(id) {
  const panel = document.getElementById(id);
  changing = true;
  for (const other of document.querySelectorAll('.workspace-panel[open]')) if (other !== panel) other.close();
  changing = false;
  showView(groups[id]);
  if (!panel.open) panel.show();
  for (const button of $('#material-tabs').children) button.setAttribute('aria-pressed', String(button.dataset.panel === id));
  panel.querySelector('h2').focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}
export function attachNavigation() {
  for (const id of Object.keys(groups)) {
    const panel = document.getElementById(id); panel.classList.add('workspace-panel');
    panel.querySelector('h2').tabIndex = -1; $('#workspace-panel-host').append(panel);
    panel.addEventListener('close', () => {
      if (!changing && !document.querySelector('.workspace-panel[open]')) showView('edit');
    });
  }
  $('#edit-view').addEventListener('click', showEditor);
  $('#materials-view').addEventListener('click', () => $('#theme-analysis-open').click());
  const tickets = $('#tickets-button'); tickets.dataset.view = 'comments'; $('#workbench-nav').append(tickets);
  const coDesign = $('#co-design-view'); coDesign.hidden = false; $('#workbench-nav').append(coDesign);
  for (const [buttonId, panelId, name] of [['theme-analysis-open', 'theme-analysis-dialog', '主题图片'], ['assets-button', 'assets-dialog', '素材库'], ['layers-button', 'layers-dialog', '可调装饰']]) {
    const button = document.getElementById(buttonId); button.dataset.panel = panelId;
    if (buttonId !== 'layers-button') button.textContent = name;
    $('#material-tabs').append(button);
  }
  $('#edit-actions').append($('#target-select'), $('#variables-button'));
  $('.target-details').append($('#reset-target'));
  $('#reset-target').textContent = '重置当前部件';
  $('#files-dialog .dialog-body').prepend($('#snapshots-button'));
  $('#files-dialog .dialog-body').prepend($('#theme-read-host'));
  $('#scope-row').append($('#scope-controls'));
  $('#workbench-nav').after($('#fixture-tools'));
  $('#tools-content').append(...$('.studio-tools').children, $('#advanced-button'), $('#fixture-actions'), $('#view-css'));
  $('#tools-button').addEventListener('click', () => $('#tools-dialog').showModal());
  $('#tools-content').addEventListener('click', e => { if (e.target.closest('button')) $('#tools-dialog').close(); }, { capture: true });
  $('#files-dialog').addEventListener('click', e => { if (e.target.closest('#snapshots-button, #theme-read-host')) $('#files-dialog').close(); }, { capture: true });
  $('#opinion-mark').addEventListener('click', () => { showEditor(); $('#annotate-button').click(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.dataset.view !== 'edit' && !document.querySelector('dialog:modal')) { showEditor(); $('#edit-view').focus(); }
  });
  showView('edit');
}
