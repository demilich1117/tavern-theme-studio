import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TARGETS, FIELDS } from '../shared/core.js';
import { formatAgentHandoff } from '../shared/handoff.js';
const args = process.argv.slice(2), commandName = args.shift();
try {
  if (!commandName || commandName === 'help') {
    console.log(`Tavern Theme Studio CLI\n\n  status\n  targets\n  variables\n  variable <id> <value>\n  variable-reset <id>\n  snapshots\n  snapshot-save <name>\n  snapshot-diff <id>\n  snapshot-restore <id>\n  set <target> <property> <value> [base|mobile]\n  unset <target> <property> [base|mobile]\n  undo | redo\n  rename <name>\n  export <output.json>\n  backup <output.studio.json>\n  import <input.json>\n  command <command.json>\n\nUses STUDIO_URL or the running local server. The UI observes the same project.`);
    console.log('\n  tickets\n  ticket <id>\n  ticket-claim <id> <owner>\n  ticket-review <id> <owner> <result.txt>\n  assets\n  asset-upload <image-file>\n  asset-link <url> [name]\n  optimize-assets');
    console.log('\n  ticket-copy <id>\n  ticket-review <id> <owner> <result.json>\n  build-status\n  build-presets\n  build-preset <index|name>\n  build-bind <local-config.json>\n  build-now\n  build-auto on|off\n  build-cancel');
    process.exit(0);
  }
  if (commandName === 'targets') { console.log(JSON.stringify({ targets: TARGETS, fields: FIELDS }, null, 2)); process.exit(0); }
  let address = process.env.STUDIO_URL;
  if (!address) { try { address = JSON.parse(await readFile(new URL('../.local/runtime.json', import.meta.url))).address; } catch { address = 'http://127.0.0.1:19321'; } }
  const sessionRes = await fetch(`${address}/api/session`); if (!sessionRes.ok) throw new Error('Cannot connect to local workbench');
  const session = await sessionRes.json();
  const expected = { sessionId: session.sessionId, projectId: session.projectId, fingerprint: session.fingerprint, revision: session.revision };
  const json = file => readFile(file, 'utf8').then(text => JSON.parse(text.replace(/^\uFEFF/, '')));
  const request = async (endpoint, body, raw = false) => {
    const response = await fetch(address + endpoint, body === undefined ? {} : { method: 'POST', headers: { 'X-Studio-Token': session.token, ...(!raw && { 'Content-Type': 'application/json' }) }, body: raw ? body : JSON.stringify({ ...expected, ...body }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  };
  if (commandName === 'ticket-copy') {
    const ticket = await request(`/api/tickets/${encodeURIComponent(args[0] || '')}`), context = await request('/api/handoff-context');
    console.log(formatAgentHandoff([ticket], context)); process.exit(0);
  }
  if (commandName.startsWith('build-')) {
    const info = await request('/api/build'); let result;
    if (commandName === 'build-status') result = info;
    else if (commandName === 'build-presets') result = await request('/api/build/presets');
    else if (['build-bind', 'build-preset'].includes(commandName)) {
      const presets = commandName === 'build-preset' ? await request('/api/build/presets') : null;
      const input = presets ? presets.find(p => p.name === args[0]) || presets[Number(args[0])] : await json(args[0]);
      if (!input) throw new Error('源码配方不存在。');
      const config = { ...(input.config || input) };
      config.root = path.resolve(config.root); if (config.program === '$NODE') config.program = process.execPath;
      result = await request('/api/build/configure', { bindingVersion: info.version, config, autoSync: input.autoSync === true });
    } else {
      if (!['build-now', 'build-auto', 'build-cancel'].includes(commandName)) throw new Error('Unknown build command');
      if (commandName === 'build-auto' && !['on', 'off'].includes(args[0])) throw new Error('build-auto on|off');
      result = await request('/api/build/control', { bindingVersion: info.version, action: commandName === 'build-now' ? 'build' : commandName === 'build-auto' ? 'auto' : 'cancel', enabled: args[0] === 'on' });
    }
    console.log(JSON.stringify(result, null, 2)); process.exit(0);
  }
  if (['tickets', 'ticket', 'ticket-claim', 'ticket-review', 'assets', 'asset-upload', 'asset-link'].includes(commandName)) {
    let result;
    if (commandName === 'tickets' || commandName === 'assets') result = await request(`/api/${commandName}`);
    else if (commandName === 'asset-upload') result = await request(`/api/assets?name=${encodeURIComponent(args[0]?.split(/[\\/]/).at(-1) || '')}`, await readFile(args[0]), true);
    else if (commandName === 'asset-link') result = await request('/api/assets/link', { url: args[0], name: args[1] });
    else {
      const endpoint = `/api/tickets/${encodeURIComponent(args[0] || '')}`, ticket = await request(endpoint);
      if (commandName === 'ticket') result = ticket;
      else result = await request(endpoint, { action: commandName === 'ticket-claim' ? 'claim' : 'review', version: ticket.version, owner: args[1], ...(commandName === 'ticket-review' && { result: args[2]?.endsWith('.json') ? await json(args[2]) : await readFile(args[2], 'utf8') }) });
    }
    console.log(JSON.stringify(result, null, 2)); process.exit(0);
  }
  if (['variables', 'snapshots', 'snapshot-diff'].includes(commandName)) {
    const endpoint = commandName === 'variables' ? '/api/variables' : commandName === 'snapshots' ? '/api/snapshots' : `/api/snapshots/${encodeURIComponent(args[0] || '')}`;
    const response = await fetch(address + endpoint), data = await response.json(); if (!response.ok) throw new Error(data.error);
    console.log(JSON.stringify(commandName === 'snapshot-diff' ? { id: data.id, name: data.name, changes: data.changes } : data, null, 2)); process.exit(0);
  }
  const command = (() => {
    switch (commandName) {
      case 'status': return null;
      case 'variable': return { type: 'variable', id: args[0], value: args[1] };
      case 'variable-reset': return { type: 'variable', id: args[0], value: null };
      case 'snapshot-save': return { type: 'snapshot-save', name: args[0] };
      case 'snapshot-restore': return { type: 'snapshot-restore', id: args[0] };
      case 'set': return { type: 'set', target: args[0], property: args[1], value: args[2], scope: args[3] || 'base' };
      case 'unset': return { type: 'set', target: args[0], property: args[1], value: null, scope: args[2] || 'base' };
      case 'undo': case 'redo': return { type: commandName };
      case 'optimize-assets': return { type: commandName };
      case 'rename': return { type: 'rename', name: args[0] };
      case 'export': case 'backup': case 'import': case 'command': return null;
      default: throw new Error('Unknown command; use help');
    }
  })();
  if (commandName === 'status') { const { token, ...status } = session; console.log(JSON.stringify(status, null, 2)); process.exit(0); }
  if (['export', 'backup'].includes(commandName)) {
    if (!args[0]) throw new Error('Output filename required');
    const data = await request(commandName === 'export' ? '/api/theme' : '/api/backup');
    await writeFile(args[0], JSON.stringify(data, null, 2)); console.log(`Saved ${args[0]}`); process.exit(0);
  }
  let resolved = command;
  if (commandName === 'import') { const data = await json(args[0]); resolved = data.schemaVersion !== undefined ? { type: 'import-project', project: data } : { type: 'import-theme', theme: data }; }
  if (commandName === 'command') resolved = await json(args[0]);
  const response = await fetch(`${address}/api/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': session.token }, body: JSON.stringify({ ...expected, command: resolved }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error);
  console.log(JSON.stringify({ revision: data.revision, name: data.project.name, canUndo: data.canUndo, snapshotCreated: data.snapshotCreated }));
} catch (e) { console.error(e.message); process.exitCode = 1; }
