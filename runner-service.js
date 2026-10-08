import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { atomicJson } from './storage-migrations.js';
import { validateTicketResult } from './shared/tickets.js';

export async function createRunner({ dataDir, getProjectId, publish = () => {} }) {
  const file = path.join(dataDir, 'runner.json'), folder = path.join(dataDir, 'tasks'); await mkdir(folder, { recursive: true });
  let state = { version: 0, config: null, verified: false, tasks: [] }, active, closing = false, queue = Promise.resolve();
  try { state = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const t of state.tasks) if (['queued', 'running'].includes(t.state)) { t.state = 'interrupted'; t.error = '服务重启；保留源码修改，核对后显式重试。'; }
  const snapshot = () => structuredClone(state);
  const save = async next => { await atomicJson(file, next); state = next; publish(snapshot()); };
  const serial = work => { const task = queue.then(work); queue = task.catch(() => {}); return task; };
  await save(state);
  async function update(id, patch) { await save({ ...state, tasks: state.tasks.map(t => t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t) }); }
  async function pump() {
    if (active || closing) return;
    const task = state.tasks.find(t => t.state === 'queued'); if (!task) return;
    if (task.projectId !== getProjectId()) { await update(task.id, { state: 'interrupted', error: '当前工程已切换。' }); return pump(); }
    const config = task.config, inputPath = path.join(folder, task.id + '.input.json');
    await writeFile(inputPath, JSON.stringify(task.input, null, 2));
    await update(task.id, { state: 'running', startedAt: new Date().toISOString() });
    let child;
    try { child = spawn(config.program, config.args.map(a => a.replaceAll('{input}', inputPath)), { cwd: config.cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { await update(task.id, { state: 'failed', error: e.message }); return pump(); }
    const running = active = { id: task.id, child, lastHeartbeat: Date.now(), result: null, log: '', reason: null };
    let finish; running.finished = new Promise(resolve => { finish = resolve; });
    let buffer = '';
    const stop = reason => {
      if (running.reason) return;
      running.reason = reason;
      if (process.platform === 'win32' && child.pid) {
        const kill = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        kill.once('error', () => child.kill()); kill.once('exit', code => { if (code) child.kill(); });
      } else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } }
    }; running.stop = stop;
    const timer = setInterval(() => {
      if (Date.now() - running.started > config.timeoutMs) stop('执行超时');
      else if (Date.now() - running.lastHeartbeat > config.heartbeatMs) stop('心跳失联');
    }, 250); running.started = Date.now(); timer.unref();
    const consume = chunk => {
      buffer += chunk.toString(); if (buffer.length > 65536) { stop('协议行超过 64 KiB'); return; }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === 'heartbeat') running.lastHeartbeat = Date.now();
          else if (event.type === 'result') {
            const validated = validateTicketResult(event.result);
            if (!validated.details || validated.details.baseline.projectId !== task.projectId) throw new Error('结果缺少对应工程的结构化基线');
            running.result = validated.details;
          } else if (event.type === 'progress') { running.log = (running.log + String(event.message).slice(0, 2000) + '\n').slice(-16000); }
        } catch (e) { running.log = (running.log + line.slice(0, 2000) + '\n').slice(-16000); if (line.includes('"result"')) stop('结构化结果无效：' + e.message); }
      }
    };
    child.stdout.on('data', consume); child.stderr.on('data', c => { running.log = (running.log + c.toString()).slice(-16000); });
    child.stdin.on('error', () => {}); child.stdin.end(config.input === 'file' ? undefined : JSON.stringify(task.input) + '\n');
    let spawnError;
    child.once('error', e => { spawnError = e.message; });
    child.once('close', code => { clearInterval(timer); serial(async () => {
      const finalState = running.reason === 'cancelled' ? 'cancelled' : running.reason === 'interrupted' ? 'interrupted' : !running.reason && !spawnError && code === 0 && running.result ? 'succeeded' : 'failed';
      await update(task.id, { state: finalState, exitCode: code, result: running.result, log: running.log, error: running.reason || spawnError || (finalState === 'failed' ? '进程失败或未返回有效结构化结果' : null), completedAt: new Date().toISOString() });
      if (finalState === 'succeeded' && JSON.stringify(config) === JSON.stringify(state.config)) await save({ ...state, verified: true });
      active = null; finish(); await pump();
    }).catch(() => { active = null; finish(); }); });
  }
  return {
    status: () => ({ ...snapshot(), activeProgress: active ? { id: active.id, log: active.log, heartbeatAt: new Date(active.lastHeartbeat).toISOString() } : null }),
    projectChanged: () => serial(async () => { if (active && state.tasks.find(t => t.id === active.id)?.projectId !== getProjectId()) active.stop('interrupted'); await pump(); }),
    configure: (config, version) => serial(async () => {
      if (version !== state.version) throw Object.assign(new Error('CLI 配置已更新，请重新读取。'), { status: 409 });
      if (active || state.tasks.some(t => t.state === 'queued')) throw new Error('请先结束队列再更改 CLI 配置。');
      if (config !== null && (!path.isAbsolute(config.program || '') || !path.isAbsolute(config.cwd || '') || !Array.isArray(config.args) || config.args.length > 100 || config.args.some(a => typeof a !== 'string' || a.length > 4000) || !['stdin', 'file'].includes(config.input))) throw new Error('需要程序和工作目录绝对路径、独立参数列表及 stdin/file 输入方式。');
      if (config) { config = { program: config.program, cwd: config.cwd, args: config.args, input: config.input, timeoutMs: config.timeoutMs ?? 1800000, heartbeatMs: config.heartbeatMs ?? 120000 }; if (![config.timeoutMs, config.heartbeatMs].every(n => Number.isInteger(n) && n >= 1000 && n <= 86400000)) throw new Error('超时和心跳需为 1000–86400000 毫秒。'); }
      await save({ ...state, config, verified: false, version: state.version + 1 }); return snapshot();
    }),
    enqueue: input => serial(async () => {
      if (!state.config) throw new Error('尚未配置 CLI；复制交接仍可独立使用。');
      if (input.projectId !== getProjectId()) throw new Error('工程身份已变化。');
      const task = { id: randomUUID(), projectId: input.projectId, state: 'queued', input: structuredClone(input), config: structuredClone(state.config), createdAt: new Date().toISOString() };
      await save({ ...state, tasks: [...state.tasks, task] }); await pump(); return snapshot();
    }),
    cancel: id => serial(async () => { const task = state.tasks.find(t => t.id === id); if (!task) throw new Error('任务不存在。'); if (active?.id === id) active.stop('cancelled'); else if (task.state === 'queued') await update(id, { state: 'cancelled' }); return snapshot(); }),
    close: async () => { closing = true; if (active) { const running = active; running.stop('interrupted'); await running.finished; } await queue; },
  };
}
