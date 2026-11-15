import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { db, toDto, listRules, type ImageRow } from './db.js';
import { PLATFORMS } from '../../shared/platforms.js';
import { ORIGINALS_DIR, THUMBS_DIR } from './paths.js';
import { extractGenerationMeta } from './png-meta.js';
import { autotagImage, autotagOptions, listCharacters } from './characters.js';
import { getSetting } from './settings.js';

const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const normTags = (tags: string[]) =>
  Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));

export async function imageRoutes(app: FastifyInstance) {
  await fs.mkdir(ORIGINALS_DIR, { recursive: true });
  await fs.mkdir(THUMBS_DIR, { recursive: true });

  app.get('/api/images', async () => {
    const rows = db.prepare('SELECT * FROM images ORDER BY created_at DESC').all() as ImageRow[];
    return rows.map(toDto);
  });

  app.post('/api/images', async (req, reply) => {
    const added = [];
    const skipped: { name: string; reason: string }[] = [];
    const autotag = getSetting('autotag.onImport') === '1';
    const chars = autotag ? listCharacters() : [];
    const opts = autotagOptions();
    const insert = db.prepare(
      `INSERT INTO images (id, original_name, ext, hash, width, height, size, title, comfy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for await (const part of req.files({ limits: { fileSize: 200 * 1024 * 1024, files: 1000 } })) {
      const ext = ALLOWED[part.mimetype];
      if (!ext) {
        skipped.push({ name: part.filename, reason: 'unsupported format' });
        await part.toBuffer();
        continue;
      }
      const buf = await part.toBuffer();
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      const dup = db.prepare('SELECT id FROM images WHERE hash = ?').get(hash);
      if (dup) {
        skipped.push({ name: part.filename, reason: 'duplicate' });
        continue;
      }
      let meta;
      try {
        meta = await sharp(buf).metadata();
      } catch {
        skipped.push({ name: part.filename, reason: 'unreadable image' });
        continue;
      }
      const id = crypto.randomUUID();
      await fs.writeFile(path.join(ORIGINALS_DIR, `${id}.${ext}`), buf);
      await sharp(buf)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(path.join(THUMBS_DIR, `${id}.webp`));

      const gen = ext === 'png' ? extractGenerationMeta(buf) : null;
      const title = path.parse(part.filename).name;
      insert.run(id, part.filename, ext, hash, meta.width ?? 0, meta.height ?? 0, buf.length, title, gen ? JSON.stringify(gen) : null);
      if (chars.length) autotagImage(id, chars, opts);
      added.push(toDto(db.prepare('SELECT * FROM images WHERE id = ?').get(id) as ImageRow));
    }
    return reply.code(201).send({ added, skipped });
  });

  const BulkPatch = z.object({
    ids: z.array(z.string()).min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    tagsMode: z.enum(['replace', 'add', 'remove']).default('add'),
    nsfw: z.boolean().optional(),
    /** If set: write this platform's override instead of the common values. */
    platform: z.enum(PLATFORMS as [string, ...string[]]).optional(),
    /** With platform: delete the override (back to the common values). */
    clearOverride: z.boolean().optional(),
  });

  app.patch('/api/images', async (req, reply) => {
    const p = BulkPatch.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const { ids, title, description, tags, tagsMode, nsfw, platform, clearOverride } = p.data;
    const sel = db.prepare('SELECT * FROM images WHERE id = ?');

    if (platform) {
      const getO = db.prepare('SELECT title, description, tags FROM overrides WHERE image_id = ? AND platform = ?');
      const putO = db.prepare(
        `INSERT INTO overrides (image_id, platform, title, description, tags) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(image_id, platform) DO UPDATE SET title = excluded.title, description = excluded.description, tags = excluded.tags`,
      );
      const delO = db.prepare('DELETE FROM overrides WHERE image_id = ? AND platform = ?');
      db.exec('BEGIN');
      try {
        for (const id of ids) {
          const row = sel.get(id) as ImageRow | undefined;
          if (!row) continue;
          if (clearOverride) {
            delO.run(id, platform);
            continue;
          }
          const cur = (getO.get(id, platform) as { title: string | null; description: string | null; tags: string | null } | undefined) ?? {
            title: null, description: null, tags: null,
          };
          let newTags: string[] | null = cur.tags !== null ? JSON.parse(cur.tags) : null;
          if (tags) {
            const t = normTags(tags);
            const base = newTags ?? (JSON.parse(row.tags) as string[]);
            if (tagsMode === 'replace') newTags = t;
            else if (tagsMode === 'add') newTags = normTags([...base, ...t]);
            else newTags = base.filter((x) => !t.includes(x));
          }
          putO.run(id, platform, title ?? cur.title, description ?? cur.description, newTags === null ? null : JSON.stringify(newTags));
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return ids.map((id) => sel.get(id) as ImageRow | undefined).filter(Boolean).map((r) => toDto(r as ImageRow));
    }

    const upd = db.prepare(
      'UPDATE images SET title = ?, description = ?, tags = ?, nsfw = ? WHERE id = ?',
    );
    const tx = () => {
      for (const id of ids) {
        const row = sel.get(id) as ImageRow | undefined;
        if (!row) continue;
        let newTags: string[] = JSON.parse(row.tags);
        if (tags) {
          const t = normTags(tags);
          if (tagsMode === 'replace') newTags = t;
          else if (tagsMode === 'add') newTags = normTags([...newTags, ...t]);
          else newTags = newTags.filter((x) => !t.includes(x));
        }
        upd.run(
          title ?? row.title,
          description ?? row.description,
          JSON.stringify(newTags),
          nsfw === undefined ? row.nsfw : nsfw ? 1 : 0,
          id,
        );
      }
    };
    db.exec('BEGIN');
    try {
      tx();
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    const rows = ids.map((id) => sel.get(id) as ImageRow | undefined).filter(Boolean) as ImageRow[];
    return rows.map(toDto);
  });

  app.delete('/api/images', async (req, reply) => {
    const p = z.object({ ids: z.array(z.string()).min(1) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const sel = db.prepare('SELECT id, ext FROM images WHERE id = ?');
    const del = db.prepare('DELETE FROM images WHERE id = ?');
    for (const id of p.data.ids) {
      const row = sel.get(id) as { id: string; ext: string } | undefined;
      if (!row) continue;
      del.run(id);
      await fs.rm(path.join(ORIGINALS_DIR, `${id}.${row.ext}`), { force: true });
      await fs.rm(path.join(THUMBS_DIR, `${id}.webp`), { force: true });
    }
    return { ok: true };
  });

  // ---- tag rules ----
  app.get('/api/tag-rules', async () => listRules());

  app.post('/api/tag-rules', async (req, reply) => {
    const p = z
      .object({ platform: z.enum(PLATFORMS as [string, ...string[]]), src: z.string().trim().min(1), dst: z.string().trim().min(1) })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO tag_rules (id, platform, src, dst) VALUES (?, ?, ?, ?)').run(id, p.data.platform, p.data.src, p.data.dst);
    return reply.code(201).send({ id, ...p.data });
  });

  app.delete('/api/tag-rules/:id', async (req) => {
    db.prepare('DELETE FROM tag_rules WHERE id = ?').run((req.params as any).id);
    return { ok: true };
  });

  // ---- presets ----
  app.get('/api/presets', async () => {
    const rows = db.prepare('SELECT * FROM presets ORDER BY name').all() as any[];
    return rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) }));
  });

  const Preset = z.object({
    name: z.string().min(1),
    title: z.string().default(''),
    description: z.string().default(''),
    tags: z.array(z.string()).default([]),
  });

  app.post('/api/presets', async (req, reply) => {
    const p = Preset.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO presets (id, name, title, description, tags) VALUES (?, ?, ?, ?, ?)').run(
      id, p.data.name, p.data.title, p.data.description, JSON.stringify(normTags(p.data.tags)),
    );
    return reply.code(201).send({ id, ...p.data });
  });

  app.put('/api/presets/:id', async (req, reply) => {
    const id = (req.params as any).id;
    const p = Preset.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const tags = normTags(p.data.tags);
    const res = db.prepare('UPDATE presets SET name = ?, title = ?, description = ?, tags = ? WHERE id = ?').run(p.data.name, p.data.title, p.data.description, JSON.stringify(tags), id);
    if (!res.changes) return reply.code(404).send({ error: 'Not found.' });
    return { id, ...p.data, tags };
  });

  app.delete('/api/presets/:id', async (req) => {
    db.prepare('DELETE FROM presets WHERE id = ?').run((req.params as any).id);
    return { ok: true };
  });
}
