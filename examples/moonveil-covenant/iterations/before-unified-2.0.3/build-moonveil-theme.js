import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createProject, exportTheme } from '../shared/core.js';
const root = new URL('../examples/moonveil-covenant/', import.meta.url);
const source = await readFile(new URL('theme.css', root), 'utf8');
let css = source, artworkBytes = 0;
for (const [marker, file] of Object.entries({ DRAGON:'dragon-corner-v2', WING:'dragon-right-wing', FRAME:'silver-frame', AVATAR:'avatar-talons', CASTLE:'castle-night' })) {
  const bytes = await readFile(new URL(`assets/night/${file}.webp`, root));
  artworkBytes += bytes.length;
  css = css.replaceAll(`__${marker}_ART__`, `data:image/webp;base64,${bytes.toString('base64')}`);
}
// Every visual default is authored here; never spread or load a user's theme.
const theme = {
  name: '月誓 · 龙廷 2.0 — 夜幕浮雕',
  blur_strength: 0, font_scale: 1, shadow_width: 0,
  main_text_color: '#d2d5e3', italics_text_color: '#b6bbd8', underline_text_color: '#b5acec',
  quote_text_color: '#bcb2e8', blur_tint_color: '#202637', chat_tint_color: '#202637',
  user_mes_blur_tint_color: '#302e46', bot_mes_blur_tint_color: '#2c334a',
  shadow_color: '#00000000', border_color: '#707b9c66',
  fast_ui_mode: false, waifuMode: false, avatar_style: 0, chat_display: 0,
  toastr_position: 'toast-top-right', noShadows: true, chat_width: 92,
  timer_enabled: false, timestamps_enabled: true, timestamp_model_icon: false,
  mesIDDisplay_enabled: false, hideChatAvatars_enabled: false, message_token_count_enabled: false,
  expand_message_actions: false, enableZenSliders: false, enableLabMode: false,
  hotswap_enabled: false, bogus_folders: false, zoomed_avatar_magnification: false,
  reduced_motion: true, compact_input_area: false, show_swipe_num_all_messages: false,
  click_to_edit: false, media_display: 'list', custom_css: css,
};
// SillyTavern 1.19's applyThemeColor splits the main color as rgba(...).
// Use its native export format for every color, even though browsers accept hex.
for (const key of Object.keys(theme).filter(key => key.endsWith('_color'))) {
  const hex = theme[key].slice(1), channel = start => parseInt(hex.slice(start, start + 2), 16);
  theme[key] = `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${hex.length === 8 ? +(channel(6) / 255).toFixed(4) : 1})`;
}
const project = createProject(theme);
const compiled = exportTheme(project);
const template = await readFile(new URL('preview.template.html', root), 'utf8');
const demoCss = await readFile(new URL('../public/demo.css', import.meta.url), 'utf8');
let html = template.replace('__BASE_CSS__', demoCss).replace('__THEME_CSS__', compiled.custom_css);
for (const [marker,file,mime] of [
  ['ICON_FONT','fa-solid-900.woff2','font/woff2'],
  ['DRAGON_AVATAR','dragon-portrait.webp','image/webp'],
  ['TRAVELER','traveler-portrait.webp','image/webp'],
]) {
  const bytes = await readFile(new URL(`assets/night/${file}`,root));
  html=html.replaceAll(`__${marker}__`, `data:${mime};base64,${bytes.toString('base64')}`);
}
await mkdir(new URL('../public/', import.meta.url), { recursive: true });
for (const [filename, content] of Object.entries({
  'moonveil.theme.json': JSON.stringify(compiled, null, 2),
  'moonveil.studio.json': JSON.stringify(project, null, 2),
  'preview.html': html,
})) {
  await writeFile(new URL(filename, root), content);
  const served = filename === 'preview.html' ? 'moonveil.html' : filename;
  await writeFile(new URL(`../public/${served}`, import.meta.url), content);
}
console.log(JSON.stringify({ name: theme.name, cssCharacters: css.length, artworkBytes, standalone: true }));
