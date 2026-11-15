import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { DATA_DIR } from './paths.js';
import type { Override, PlatformId, TagRule } from '../../shared/platforms.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(path.join(DATA_DIR, 'artpost.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS images (
    id            TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    ext           TEXT NOT NULL,
    hash          TEXT NOT NULL UNIQUE,
    width         INTEGER NOT NULL,
    height        INTEGER NOT NULL,
    size          INTEGER NOT NULL,
    title         TEXT NOT NULL DEFAULT '',
    description   TEXT NOT NULL DEFAULT '',
    tags          TEXT NOT NULL DEFAULT '[]',
    nsfw          INTEGER NOT NULL DEFAULT 0,
    comfy         TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS presets (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    tags       TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS overrides (
    image_id    TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    platform    TEXT NOT NULL,
    title       TEXT,
    description TEXT,
    tags        TEXT,
    PRIMARY KEY (image_id, platform)
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id           TEXT PRIMARY KEY,
    platform     TEXT NOT NULL,
    image_ids    TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'queued',
    scheduled_at TEXT NOT NULL,
    started_at   TEXT,
    finished_at  TEXT,
    options      TEXT NOT NULL DEFAULT '{}',
    result       TEXT,
    error        TEXT,
    log          TEXT NOT NULL DEFAULT '[]',
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id        TEXT PRIMARY KEY,
    job_id    TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    image_id  TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    platform  TEXT NOT NULL,
    url       TEXT,
    remote_id TEXT,
    posted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS posts_image ON posts(image_id);

  CREATE TABLE IF NOT EXISTS tag_rules (
    id       TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    src      TEXT NOT NULL,
    dst      TEXT NOT NULL
  );
`);

// Default tag rules (first run only)
if ((db.prepare('SELECT COUNT(*) AS c FROM tag_rules').get() as { c: number }).c === 0) {
  const ins = db.prepare('INSERT INTO tag_rules (id, platform, src, dst) VALUES (?, ?, ?, ?)');
  const defaults: [string, string, string][] = [
    ['pixiv', '1girl', '女の子'],
    ['pixiv', '1boy', '男の子'],
    ['pixiv', 'original', 'オリジナル'],
    ['pixiv', 'ai art', 'AIイラスト'],
    ['pixiv', 'ai generated', 'AI生成'],
    ['pixiv', 'landscape', '風景'],
    ['deviantart', 'ai art', 'aiart'],
    ['x', 'ai art', 'AIart'],
  ];
  for (const [p, s, d] of defaults) ins.run(crypto.randomUUID(), p, s, d);
}

export function loadOverrides(imageId: string): Partial<Record<PlatformId, Override>> {
  const rows = db.prepare('SELECT platform, title, description, tags FROM overrides WHERE image_id = ?').all(imageId) as {
    platform: PlatformId; title: string | null; description: string | null; tags: string | null;
  }[];
  const out: Partial<Record<PlatformId, Override>> = {};
  for (const r of rows) {
    const o: Override = {};
    if (r.title !== null) o.title = r.title;
    if (r.description !== null) o.description = r.description;
    if (r.tags !== null) o.tags = JSON.parse(r.tags);
    out[r.platform] = o;
  }
  return out;
}

export function listRules(): (TagRule & { id: string })[] {
  return db.prepare('SELECT id, platform, src, dst FROM tag_rules ORDER BY platform, src').all() as any;
}

export type ImageRow = {
  id: string;
  original_name: string;
  ext: string;
  hash: string;
  width: number;
  height: number;
  size: number;
  title: string;
  description: string;
  tags: string;
  nsfw: number;
  comfy: string | null;
  created_at: string;
};

export type ImageDto = Omit<ImageRow, 'tags' | 'nsfw' | 'comfy'> & {
  tags: string[];
  nsfw: boolean;
  comfy: ComfyMeta | null;
  overrides: Partial<Record<PlatformId, Override>>;
  posts: PostRef[];
  url: string;
  thumb: string;
};

export type ComfyMeta = {
  positive?: string;
  negative?: string;
  model?: string;
  loras?: string[];
  seed?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  source: 'comfyui' | 'a1111';
};

export type PostRef = { platform: PlatformId; url: string | null; posted_at: string };

export function loadPosts(imageId: string): PostRef[] {
  return db.prepare('SELECT platform, url, posted_at FROM posts WHERE image_id = ? ORDER BY posted_at DESC').all(imageId) as PostRef[];
}

export function toDto(r: ImageRow): ImageDto {
  return {
    ...r,
    tags: JSON.parse(r.tags),
    nsfw: r.nsfw === 1,
    comfy: r.comfy ? JSON.parse(r.comfy) : null,
    overrides: loadOverrides(r.id),
    posts: loadPosts(r.id),
    url: `/files/originals/${r.id}.${r.ext}`,
    thumb: `/files/thumbs/${r.id}.webp`,
  };
}
