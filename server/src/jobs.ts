import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import path from 'node:path';
import { db, listRules, loadOverrides, type ImageRow } from './db.js';
import { ORIGINALS_DIR } from './paths.js';
import { PLATFORMS, SPEC, resolve, problems, type PlatformId, type Meta } from '../../shared/platforms.js';
import { ADAPTERS, isImplemented } from './platforms/index.js';
import { isConnected } from './accounts.js';
import { withBrowser, close as closeBrowser } from './browser.js';
import { allSettings, getSetting, setSetting } from './settings.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

type JobRow = {
  id: string;
  platform: PlatformId;
  image_ids: string;
  status: JobStatus;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  options: string;
  result: string | null;
  error: string | null;
  log: string;
  created_at: string;
};

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const now = () => new Date().toISOString();

function jobDto(j: JobRow) {
  const ids: string[] = JSON.parse(j.image_ids);
  const sel = db.prepare('SELECT id, title, ext, nsfw FROM images WHERE id = ?');
  const images = ids
    .map((id) => sel.get(id) as { id: string; title: string; ext: string; nsfw: number } | undefined)
    .filter(Boolean)
    .map((i) => ({ id: i!.id, title: i!.title, thumb: `/files/thumbs/${i!.id}.webp`, nsfw: i!.nsfw === 1 }));
  return {
    ...j,
    image_ids: ids,
    images,
    options: JSON.parse(j.options),
    result: j.result ? JSON.parse(j.result) : null,
    log: JSON.parse(j.log) as string[],
  };
}

/** Effective metadata of a post (1 or N images) for a platform. */
function buildMeta(rows: ImageRow[], platform: PlatformId): Meta & { nsfw: boolean } {
  const rules = listRules();
  const first = rows[0];
  const resolved = rows.map((r) =>
    resolve({ title: r.title, description: r.description, tags: JSON.parse(r.tags) }, loadOverrides(r.id)[platform], platform, rules),
  );
  const tags: string[] = [];
  for (const r of resolved) for (const t of r.tags) if (!tags.includes(t) && tags.length < SPEC[platform].tagsMax) tags.push(t);
  // Post title: the first image whose title isn't still just its file name (else the first one).
  const isReal = (r: ImageRow, m: Meta) => m.title.trim() && m.title !== r.original_name.replace(/\.[^.]+$/, '');
  const lead = Math.max(0, rows.findIndex((r, i) => isReal(r, resolved[i])));
  return { title: resolved[lead].title, description: resolved[lead].description, tags, nsfw: rows.some((r) => r.nsfw === 1) || first.nsfw === 1 };
}

// ---------------- worker ----------------
let running: string | null = null;

async function runJob(j: JobRow) {
  running = j.id;
  const log: string[] = [];
  const push = (m: string) => {
    log.push(`${new Date().toLocaleTimeString('en-GB')} ${m}`);
    db.prepare('UPDATE jobs SET log = ? WHERE id = ?').run(JSON.stringify(log), j.id);
  };
  db.prepare("UPDATE jobs SET status = 'running', started_at = ?, error = NULL WHERE id = ?").run(now(), j.id);
  try {
    const adapter = ADAPTERS[j.platform];
    if (!adapter) throw new Error('Platform not implemented.');
    const ids: string[] = JSON.parse(j.image_ids);
    const sel = db.prepare('SELECT * FROM images WHERE id = ?');
    const rows = ids.map((id) => sel.get(id) as ImageRow | undefined).filter(Boolean) as ImageRow[];
    if (!rows.length) throw new Error('Images not found (deleted?).');
    const meta = buildMeta(rows, j.platform);
    const probs = problems(meta, j.platform);
    if (probs.length) throw new Error(probs.join(' · '));

    const settings = allSettings();
    const defaults: Record<string, string> =
      j.platform === 'pixiv'
        ? { aiType: settings['pixiv.aiType'], restrict: settings['pixiv.restrict'], allowTagEdit: settings['pixiv.allowTagEdit'] }
        : j.platform === 'deviantart'
          ? { aiGenerated: settings['deviantart.aiGenerated'], noai: settings['deviantart.noai'] }
          : {};
    const options: Record<string, string> = { ...defaults, ...JSON.parse(j.options) };
    const detail =
      j.platform === 'pixiv'
        ? options.restrict
        : j.platform === 'deviantart'
          ? options.scraps === '1'
            ? 'scraps'
            : (options.folderName ?? 'gallery')
          : j.platform === 'subscribestar'
            ? options.tierNames || 'public'
            : j.platform === 'x' && meta.nsfw
              ? 'sensitive'
              : '';
    push(`${rows.length} image(s) → ${SPEC[j.platform].name} · ${meta.nsfw ? (j.platform === 'deviantart' ? 'Mature' : 'R-18') : 'SFW'}${detail ? ` · ${detail}` : ''}`);

    const result = await withBrowser(getSetting('hideBrowser') === '1', (ctx) =>
      adapter.post(
        ctx,
        {
          meta,
          nsfw: meta.nsfw,
          files: rows.map((r) => ({
            path: path.join(ORIGINALS_DIR, `${r.id}.${r.ext}`),
            name: `${r.id}.${r.ext}`,
            mime: MIME[r.ext] ?? 'application/octet-stream',
            width: r.width,
            height: r.height,
            gen: r.comfy ? JSON.parse(r.comfy) : null,
          })),
          options,
        },
        push,
      ),
    );

    const insPost = db.prepare('INSERT INTO posts (id, job_id, image_id, platform, url, remote_id) VALUES (?, ?, ?, ?, ?, ?)');
    for (const r of rows) insPost.run(crypto.randomUUID(), j.id, r.id, j.platform, result.url, result.remoteId);
    db.prepare("UPDATE jobs SET status = 'done', finished_at = ?, result = ? WHERE id = ?").run(now(), JSON.stringify(result), j.id);
  } catch (e) {
    const err = e as Error & { raw?: unknown };
    push(`Failed: ${err.message}`);
    db.prepare("UPDATE jobs SET status = 'failed', finished_at = ?, error = ?, result = ? WHERE id = ?").run(
      now(),
      err.message,
      err.raw ? JSON.stringify({ raw: err.raw }) : null,
      j.id,
    );
  } finally {
    await closeBrowser();
    running = null;
  }
}

function tick() {
  if (running) return;
  const t = now();
  const queued = db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND scheduled_at <= ? ORDER BY scheduled_at, created_at").all(t) as JobRow[];
  for (const j of queued) {
    const delay = Number(getSetting(`delay.${j.platform}`)) * 1000;
    const last = db.prepare("SELECT MAX(finished_at) AS f FROM jobs WHERE platform = ? AND status = 'done'").get(j.platform) as { f: string | null };
    if (last.f && Date.now() - Date.parse(last.f) < delay) continue;
    if (!isConnected(j.platform)) continue;
    void runJob(j);
    return;
  }
}

/** Next possible send time for a platform (delay gating). */
function nextSlot(platform: PlatformId): string | null {
  const delay = Number(getSetting(`delay.${platform}`)) * 1000;
  const last = db.prepare("SELECT MAX(finished_at) AS f FROM jobs WHERE platform = ? AND status = 'done'").get(platform) as { f: string | null };
  if (!last.f) return null;
  const at = Date.parse(last.f) + delay;
  return at > Date.now() ? new Date(at).toISOString() : null;
}

export function startWorker() {
  // A "running" job at startup = previous crash → requeue it.
  db.prepare("UPDATE jobs SET status = 'queued' WHERE status = 'running'").run();
  setInterval(tick, 4000);
}

// ---------------- routes ----------------
export async function jobRoutes(app: FastifyInstance) {
  app.get('/api/jobs', async () => {
    const rows = db.prepare("SELECT * FROM jobs ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, scheduled_at DESC, created_at DESC").all() as JobRow[];
    return { jobs: rows.map(jobDto), running, nextSlot: Object.fromEntries(PLATFORMS.map((p) => [p, nextSlot(p)])) };
  });

  const Create = z.object({
    platform: z.enum(PLATFORMS as [string, ...string[]]),
    imageIds: z.array(z.string()).min(1),
    mode: z.enum(['single', 'grouped']).default('single'),
    scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
    options: z.record(z.string()).default({}),
  });

  app.post('/api/jobs', async (req, reply) => {
    const p = Create.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const platform = p.data.platform as PlatformId;
    if (!isImplemented(platform)) return reply.code(400).send({ error: `${SPEC[platform].name} is not implemented yet.` });
    if (!isConnected(platform)) return reply.code(400).send({ error: `Not logged in to ${SPEC[platform].name}.` });

    const sel = db.prepare('SELECT * FROM images WHERE id = ?');
    const rows = p.data.imageIds.map((id) => sel.get(id) as ImageRow | undefined).filter(Boolean) as ImageRow[];
    if (!rows.length) return reply.code(400).send({ error: 'No valid images.' });

    const groups: ImageRow[][] = [];
    if (p.data.mode === 'grouped') {
      const per = SPEC[platform].imagesPerPost;
      for (let i = 0; i < rows.length; i += per) groups.push(rows.slice(i, i + per));
    } else for (const r of rows) groups.push([r]);

    // Validate before queueing: reject if any post has a blocking problem.
    const errors: string[] = [];
    groups.forEach((g, i) => {
      const m = buildMeta(g, platform);
      for (const pr of problems(m, platform)) errors.push(`Post ${i + 1} (${g[0].title || g[0].original_name}): ${pr}`);
    });
    if (errors.length) return reply.code(422).send({ error: 'Fix these before sending', details: errors });

    const base = p.data.scheduledAt ? Date.parse(p.data.scheduledAt) : Date.now();
    const ins = db.prepare('INSERT INTO jobs (id, platform, image_ids, scheduled_at, options) VALUES (?, ?, ?, ?, ?)');
    const created: string[] = [];
    groups.forEach((g, i) => {
      const id = crypto.randomUUID();
      // Nominal spacing only: the worker enforces the real delay anyway.
      ins.run(id, platform, JSON.stringify(g.map((r) => r.id)), new Date(base + i * 1000).toISOString(), JSON.stringify(p.data.options));
      created.push(id);
    });
    const get = db.prepare('SELECT * FROM jobs WHERE id = ?');
    return reply.code(201).send(created.map((id) => jobDto(get.get(id) as JobRow)));
  });

  app.post('/api/jobs/:id/cancel', async (req, reply) => {
    const id = (req.params as any).id;
    const r = db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'queued'").run(now(), id);
    if (!r.changes) return reply.code(409).send({ error: 'Job cannot be cancelled.' });
    return { ok: true };
  });

  app.post('/api/jobs/:id/retry', async (req, reply) => {
    const id = (req.params as any).id;
    const r = db
      .prepare("UPDATE jobs SET status = 'queued', scheduled_at = ?, started_at = NULL, finished_at = NULL, error = NULL, result = NULL, log = '[]' WHERE id = ? AND status IN ('failed','cancelled')")
      .run(now(), id);
    if (!r.changes) return reply.code(409).send({ error: 'Job cannot be retried.' });
    return { ok: true };
  });

  app.delete('/api/jobs/:id', async (req, reply) => {
    const id = (req.params as any).id;
    const r = db.prepare("DELETE FROM jobs WHERE id = ? AND status != 'running'").run(id);
    if (!r.changes) return reply.code(409).send({ error: 'Job is running.' });
    return { ok: true };
  });

  // ---- settings ----
  app.get('/api/settings', async () => allSettings());
  app.patch('/api/settings', async (req, reply) => {
    const p = z.record(z.string()).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    for (const [k, v] of Object.entries(p.data)) if (!k.startsWith('acct.')) setSetting(k, v);
    return allSettings();
  });
}

