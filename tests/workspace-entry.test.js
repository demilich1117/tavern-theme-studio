import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceUrl } from '../shared/workspace.js';

test('launcher and legacy entries share the workspace without forwarding host fragments', () => {
  const url = new URL(workspaceUrl('http://localhost:8000/#tts-lab=&old=1', 'http://127.0.0.1:19323/'));
  assert.equal(url.pathname, '/scripts/extensions/third-party/tavern-theme-studio-connector/connector/responsive.html');
  const params = new URLSearchParams(url.hash.slice(1));
  assert.equal(params.get('host'), '/');
  assert.equal(params.get('studio'), 'http://127.0.0.1:19323');
  assert.equal(params.size, 2);
  const custom = new URL(workspaceUrl('https://tavern.example/base/', 'http://localhost:19346', 'https://tavern.example/base/extensions/custom/connector/responsive.html'));
  assert.equal(new URLSearchParams(custom.hash.slice(1)).get('host'), '/base/');
  assert.equal(custom.origin, 'https://tavern.example');
});

test('workspace entry rejects remote studio, credentials and foreign host pages', () => {
  for (const studio of ['https://localhost:19323', 'http://example.com', 'http://user:secret@localhost:19323']) assert.throws(() => workspaceUrl('http://localhost:8000', studio));
  assert.throws(() => workspaceUrl('file:///private', 'http://localhost:19323'));
  assert.throws(() => workspaceUrl('http://localhost:8000', 'http://localhost:19323', 'http://evil.example/connector/responsive.html'));
});
