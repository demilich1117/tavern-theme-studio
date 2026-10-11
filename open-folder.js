import { spawn } from 'node:child_process';
import path from 'node:path';

export async function openFolder(directory) {
  const program = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe') : process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open';
  await new Promise((resolve, reject) => {
    const child = spawn(program, [directory], { shell: false, windowsHide: true, detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
