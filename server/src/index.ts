import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { imageRoutes } from './images.js';
import { accountRoutes } from './accounts.js';
import { jobRoutes, startWorker } from './jobs.js';
import { close as closeBrowser } from './browser.js';
import { CLIENT_DIST, ORIGINALS_DIR, THUMBS_DIR } from './paths.js';
import { characterRoutes } from './characters.js';

const PROD = process.argv.includes('--prod');
const PORT = Number(process.env.PORT ?? 3210);

const app = Fastify({ logger: { level: PROD ? 'warn' : 'info' }, bodyLimit: 10 * 1024 * 1024 });

// Only the app itself (dev server on 5173 or the prod port) may call the API from a browser.
await app.register(cors, { origin: [/^http:\/\/(127\.0\.0\.1|localhost):\d+$/] });
await app.register(multipart);

// Serve only images — never the whole data dir (it holds the DB and the logged-in browser profile).
fs.mkdirSync(ORIGINALS_DIR, { recursive: true });
fs.mkdirSync(THUMBS_DIR, { recursive: true });
for (const [root, prefix] of [
  [ORIGINALS_DIR, '/files/originals/'],
  [THUMBS_DIR, '/files/thumbs/'],
] as const)
  await app.register(fastifyStatic, { root, prefix, decorateReply: false, cacheControl: true, maxAge: '1d' });

await app.register(imageRoutes);
await app.register(accountRoutes);
await app.register(jobRoutes);
await app.register(characterRoutes);
startWorker();

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    await closeBrowser();
    process.exit(0);
  });

if (PROD) {
  if (!fs.existsSync(CLIENT_DIST)) {
    console.error('client/dist not found: run `npm run build` first.');
    process.exit(1);
  }
  await app.register(fastifyStatic, { root: CLIENT_DIST, prefix: '/', decorateReply: true });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`VEXO → http://127.0.0.1:${PORT}${PROD ? '  (UI served here)' : ''}`);
