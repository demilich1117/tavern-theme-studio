// A deterministic local builder exercising the same file protocol as real builders.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import path from 'node:path';
const input = JSON.parse(await readFile('source.json', 'utf8'));
await setTimeout(input.delayMs || 0);
if (input.fail) throw new Error('Fixture build failure');
const output = process.env.STUDIO_BUILD_OUTPUT; await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'theme.json'), JSON.stringify({ name: 'Builder fixture', custom_css: input.css }));
await writeFile(path.join(output, 'build.json'), JSON.stringify({ schemaVersion: 1, themeFile: 'theme.json', assets: input.missing ? [{ file: 'assets/missing.png', sha256: '0'.repeat(64), id: '0'.repeat(64) + '.png' }] : [] }));
