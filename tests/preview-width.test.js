import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../shared/core.js';
import { themeVariablesCss } from '../connector/bridge.js';

test('native preview leaves page width to the host while demo keeps theme width', () => {
  const project = createProject({ name: 'width fixture', chat_width: 92, font_scale: 1.2 });
  const native = themeVariablesCss(project, { followHostPageWidth: true });
  assert.ok(!native.includes('--sheldWidth'));
  assert.ok(native.includes('--fontScale: 1.2'));
  assert.ok(themeVariablesCss(project).includes('--sheldWidth: 92vw'));
});
