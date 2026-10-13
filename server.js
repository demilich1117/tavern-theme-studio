// Stable entry point for existing launch commands and Agent integrations.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from './src/server.js';
import { resolveDataDirectory } from './src/work-location.js';

export { createServer };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = await createServer({ port: Number(process.env.STUDIO_PORT || 19321), dataDir: await resolveDataDirectory('.local') });
  console.log(`Tavern Theme Studio: ${app.address}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
