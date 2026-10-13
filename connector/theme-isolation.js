// Suspend only the host's custom theme sheet. Never copy or change its CSS text.
// Multiple sheet objects can appear when the host replaces its style element.
export function createThemeIsolation(getStyle) {
  const original = new Map();
  let active = false;
  function refresh() {
    if (!active) return;
    const sheet = getStyle()?.sheet;
    if (!sheet) return;
    if (!original.has(sheet)) original.set(sheet, sheet.disabled);
    sheet.disabled = true;
  }
  function restore() {
    for (const [sheet, disabled] of original) sheet.disabled = disabled;
    original.clear();
  }
  return {
    refresh,
    setEnabled(enabled) { active = !!enabled; if (active) refresh(); else restore(); },
    dispose() { active = false; restore(); },
  };
}

// Native appearance classes checked against SillyTavern 1.14–1.19 power-user.js.
// Preview changes DOM presentation only, not power_user or settings controls.
export function createThemePresentation(getBody, getComposer) {
  const originals = new Map();
  function toggle(element, name, enabled) {
    if (!element) return;
    if (!originals.has(element)) originals.set(element, new Map());
    const classes = originals.get(element);
    if (!classes.has(name)) classes.set(name, element.classList.contains(name));
    element.classList.toggle(name, enabled);
  }
  function restore() {
    for (const [element, classes] of originals) for (const [name, enabled] of classes) element.classList.toggle(name, enabled);
    originals.clear();
  }
  return {
    restore,
    apply(theme) {
      restore(); const body = getBody();
      const booleans = [
        ['fast_ui_mode','no-blur'],['waifuMode','waifuMode'],['noShadows','noShadows'],
        ['hideChatAvatars_enabled','hideChatAvatars'],['expand_message_actions','expandMessageActions'],
        ['reduced_motion','reduced-motion'],['hotswap_enabled','no-hotswap',true],
        ['timer_enabled','no-timer',true],['timestamps_enabled','no-timestamps',true],
        ['timestamp_model_icon','no-modelIcons',true],['message_token_count_enabled','no-tokenCount',true],
        ['mesIDDisplay_enabled','no-mesIDDisplay',true],
      ];
      for (const [key, name, inverted] of booleans) if (typeof theme[key] === 'boolean') toggle(body, name, inverted ? !theme[key] : theme[key]);
      if ([0,1,2,3].includes(theme.avatar_style)) for (const [name, value] of [['big-avatars',1],['square-avatars',2],['rounded-avatars',3]]) toggle(body, name, theme.avatar_style === value);
      if ([0,1,2].includes(theme.chat_display)) { toggle(body, 'bubblechat', theme.chat_display === 1); toggle(body, 'documentstyle', theme.chat_display === 2); }
      if (typeof theme.compact_input_area === 'boolean') toggle(getComposer(), 'compact', theme.compact_input_area);
    },
  };
}
