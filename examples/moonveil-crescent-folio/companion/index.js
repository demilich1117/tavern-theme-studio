// SillyTavern 1.19.0 sets reasoning-edit selection to the end of its text.
// Scope this presentation-only correction to a user click in Moonveil's theme.
const MODULE_KEY = Symbol.for('moonveil.reasoning-edit-start');
let controller;

export function activate() {
  globalThis[MODULE_KEY]?.abort();
  controller = new AbortController();
  globalThis[MODULE_KEY] = controller;
  document.addEventListener('click', onEdit, {capture: true, signal: controller.signal});
}

export function disable() {
  controller?.abort();
  if (globalThis[MODULE_KEY] === controller) delete globalThis[MODULE_KEY];
}

function onEdit(event) {
  const button = event.target instanceof Element ? event.target.closest('.mes_reasoning_edit') : null;
  if (!button || getComputedStyle(document.documentElement).getPropertyValue('--cc-theme-id').trim() !== 'moonveil-crescent') return;
  const details = button.closest('.mes_reasoning_details');
  const chat = button.closest('#chat');
  if (!details || !chat || details.querySelector('.reasoning_edit_textarea')) return;
  const signal = controller.signal;
  // The host creates and focuses its editor synchronously in the bubbling handler.
  // One animation frame lets that handler finish without patching host functions.
  requestAnimationFrame(() => {
    if (signal.aborted || !details.isConnected) return;
    const editor = details.querySelector('.reasoning_edit_textarea');
    // Never steal focus if a different editor/control gained focus meanwhile.
    if (!editor || document.activeElement !== editor) return;
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
    const anchor = details.querySelector('.mes_reasoning_summary') || editor;
    const top = anchor.getBoundingClientRect().top;
    const viewport = chat.getBoundingClientRect();
    if (top < viewport.top + 8 || editor.getBoundingClientRect().top > viewport.bottom - 80) {
      chat.scrollTop += top - viewport.top - 8;
    }
  });
}
