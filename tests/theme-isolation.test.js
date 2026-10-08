import test from 'node:test';
import assert from 'node:assert/strict';
import { createThemeIsolation, createThemePresentation } from '../connector/theme-isolation.js';

test('fresh theme preview suspends and restores the original CSS without changing text', () => {
  const style = { sheet: { disabled: false }, textContent: 'body { color: red !important; }' };
  const isolation = createThemeIsolation(() => style);
  isolation.setEnabled(true); isolation.refresh();
  assert.equal(style.sheet.disabled, true);
  assert.equal(style.textContent, 'body { color: red !important; }');
  isolation.setEnabled(false);
  assert.equal(style.sheet.disabled, false);
  isolation.setEnabled(true); isolation.dispose();
  assert.equal(style.sheet.disabled, false);
});
test('replacement sheets and previously disabled themes restore their individual state', () => {
  const first = { sheet: { disabled: true } }, second = { sheet: { disabled: false } };
  let current = first;
  const isolation = createThemeIsolation(() => current);
  isolation.setEnabled(true); current = second; isolation.refresh();
  assert.equal(second.sheet.disabled, true);
  isolation.dispose();
  assert.equal(first.sheet.disabled, true); assert.equal(second.sheet.disabled, false);
  current = null; isolation.setEnabled(true); isolation.dispose();
});
test('native appearance preview restores only managed classes and leaves other extensions alone', () => {
  function element(names) { const set = new Set(names); return { set, classList: { contains: name => set.has(name), toggle: (name, enabled) => enabled ? set.add(name) : set.delete(name) } }; }
  const body = element(['bubblechat','big-avatars','hideChatAvatars','other-extension']);
  const composer = element(['compact']); const preview = createThemePresentation(() => body, () => composer);
  preview.apply({ chat_display: 0, avatar_style: 2, hideChatAvatars_enabled: false, compact_input_area: false });
  assert.deepEqual([...body.set].sort(), ['other-extension','square-avatars']); assert.equal(composer.set.has('compact'), false);
  body.set.add('new-extension-state'); preview.restore();
  assert.deepEqual([...body.set].sort(), ['big-avatars','bubblechat','hideChatAvatars','new-extension-state','other-extension']);
  assert.equal(composer.set.has('compact'), true);
  preview.apply({}); preview.restore(); assert.equal(body.set.has('bubblechat'), true);
});
