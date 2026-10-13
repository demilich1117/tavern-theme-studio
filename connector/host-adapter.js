// Host internals stay here. Contracts checked against official 1.14.0–1.19.0
// tags; see docs/compatibility.md. Prefer capabilities over version strings.
// 1.14–1.16 keep getThemeObject private. Copy only its theme fields, never the
// entire power_user object (which also contains unrelated personal settings).
export const LEGACY_THEME_FIELDS = Object.freeze([
  'blur_strength', 'main_text_color', 'italics_text_color', 'underline_text_color',
  'quote_text_color', 'blur_tint_color', 'chat_tint_color',
  'user_mes_blur_tint_color', 'bot_mes_blur_tint_color', 'shadow_color',
  'shadow_width', 'border_color', 'font_scale', 'fast_ui_mode', 'waifuMode',
  'avatar_style', 'chat_display', 'toastr_position', 'noShadows', 'chat_width',
  'timer_enabled', 'timestamps_enabled', 'timestamp_model_icon',
  'mesIDDisplay_enabled', 'hideChatAvatars_enabled', 'message_token_count_enabled',
  'expand_message_actions', 'enableZenSliders', 'enableLabMode', 'hotswap_enabled',
  'custom_css', 'bogus_folders', 'zoomed_avatar_magnification', 'reduced_motion',
  'compact_input_area', 'show_swipe_num_all_messages', 'click_to_edit', 'media_display',
]);

export function createHostAdapter({ getContext, loadModule = path => import(path) }) {
  return {
    getContext,
    async readTheme() {
      const host = await loadModule('/scripts/power-user.js');
      const settings = getContext().powerUserSettings;
      if (!settings || typeof settings.custom_css !== 'string') throw new Error('酒馆主题设置尚未就绪，请等待载入完成后重新连接。');
      const name = settings.theme || '酒馆当前主题';
      if (typeof host.getThemeObject === 'function') return structuredClone(host.getThemeObject(name));
      return structuredClone({ name, ...Object.fromEntries(LEGACY_THEME_FIELDS
        .filter(key => Object.hasOwn(settings, key)).map(key => [key, settings[key]])) });
    },
    async isGenerating() {
      const core = await loadModule('/script.js');
      if (typeof core.isGenerating === 'function') return core.isGenerating();
      // 1.14 exports live flags in two modules. Read both after imports settle;
      // a generation may start while a module is loading, even in another group.
      const groups = await loadModule('/scripts/group-chats.js');
      if (typeof core.is_send_press !== 'boolean' || typeof groups.is_group_generating !== 'boolean') {
        throw new Error('无法确认当前酒馆的生成状态，已停止切换测试对话。');
      }
      return core.is_send_press || groups.is_group_generating;
    },
  };
}

export const nativeHost = createHostAdapter({ getContext: () => {
  if (typeof globalThis.SillyTavern?.getContext !== 'function') throw new Error('当前页面未提供酒馆扩展接口，请使用 SillyTavern 1.14 或更新版本。');
  return globalThis.SillyTavern.getContext();
} });
