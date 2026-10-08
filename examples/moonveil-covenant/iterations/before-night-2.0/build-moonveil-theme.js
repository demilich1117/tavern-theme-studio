import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createProject, exportTheme } from '../shared/core.js';
const root = new URL('../examples/moonveil-covenant/', import.meta.url);
const bytes = await readFile(new URL('assets/dragon-keyart-moonveil.webp', root));
const source = await readFile(new URL('theme.css', root), 'utf8');
let css = source.replace('url("__DRAGON_ART__")', `url("data:image/webp;base64,${bytes.toString('base64')}")`);
for (const [marker, file] of Object.entries({ CREST: 'dragon-crest.svg', FRAME: 'illuminated-frame.svg', FLOURISH: 'manuscript-flourish.svg' })) {
  const svg = await readFile(new URL(`assets/${file}`, root), 'utf8');
  css = css.replaceAll(`__${marker}_ART__`, `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}
// Every visual default is authored here; never spread or load a user's theme.
const theme = {
  name: '月誓 · 龙廷 1.1 — 月雾阅读版',
  blur_strength: 20, font_scale: 1, shadow_width: 0,
  main_text_color: '#e2e7da', italics_text_color: '#b2c4c0', underline_text_color: '#b5acd0',
  quote_text_color: '#d4dfd3', blur_tint_color: '#162128', chat_tint_color: '#162128',
  user_mes_blur_tint_color: '#303043', bot_mes_blur_tint_color: '#d9dfdc',
  shadow_color: '#00000000', border_color: '#a6b9b66b',
  fast_ui_mode: false, waifuMode: false, avatar_style: 0, chat_display: 0,
  toastr_position: 'toast-top-right', noShadows: true, chat_width: 80,
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
const html = template.replace('__BASE_CSS__', demoCss).replace('__THEME_CSS__', compiled.custom_css);
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
console.log(JSON.stringify({ name: theme.name, cssCharacters: css.length, artworkBytes: bytes.length, standalone: true }));
