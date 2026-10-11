// Neutral native starting point, independent of the previously previewed theme.
export function starterTheme(name) {
  return { name, custom_css: '/* 在这里编写主题样式；保存后工作台会保留用户微调并更新预览。 */\n',
    main_text_color: '#e7e8ea', italics_text_color: '#a0a4ad', underline_text_color: '#e7e8ea', quote_text_color: '#e6aa64',
    blur_tint_color: '#17191dee', chat_tint_color: '#17191dcc', user_mes_blur_tint_color: '#25282e80', bot_mes_blur_tint_color: '#1d1f2480',
    shadow_color: '#00000080', border_color: '#ffffff20', blur_strength: 10, shadow_width: 1, font_scale: 1,
    fast_ui_mode: false, waifuMode: false, avatar_style: 0, chat_display: 0, noShadows: false, chat_width: 70,
    hideChatAvatars_enabled: false, compact_input_area: false };
}
