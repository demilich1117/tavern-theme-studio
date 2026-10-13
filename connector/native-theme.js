import { validateTheme } from '../shared/core.js';

export function canApplyNativeTheme() {
  return !!document.getElementById('ui_preset_import_file') && !!document.getElementById('themes') && typeof DataTransfer === 'function';
}
// SillyTavern 1.14–1.19: retain native import validation, warnings, persistence and
// theme list. No private theme arrays or host files are modified directly.
export async function applyNativeTheme(value) {
  const theme = validateTheme(value), input = document.getElementById('ui_preset_import_file'), select = document.getElementById('themes');
  if (!canApplyNativeTheme()) throw new Error('此酒馆版本暂不支持直接应用，请下载主题 JSON 后导入。');
  if ([...select.options].some(o => o.value === theme.name)) throw new Error('酒馆已有同名主题，请换一个名称，原主题会保留。');
  if (/tts-asset:\/\//.test(theme.custom_css || '')) throw new Error('请先完成素材内嵌后再应用。');
  const transfer = new DataTransfer(); transfer.items.add(new File([JSON.stringify(theme)], 'theme.json', { type: 'application/json' }));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  const end = Date.now() + 120000;
  while (input.files.length) {
    if (Date.now() > end) throw new Error('酒馆导入仍未结束，请先处理酒馆提示，再查看主题列表。');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (![...select.options].some(o => o.value === theme.name)) throw new Error('酒馆未完成导入，请查看酒馆提示；也可以下载主题文件。');
  select.value = theme.name; select.dispatchEvent(new Event('change', { bubbles: true }));
  if (globalThis.SillyTavern?.getContext().powerUserSettings.theme !== theme.name) throw new Error('主题已导入，请在酒馆主题列表中选择它。');
  return { name: theme.name };
}
