import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { db, toDto, type ImageRow } from './db.js';
import { DEFAULTS, getSetting } from './settings.js';
import { PLATFORMS, SPEC } from '../../shared/platforms.js';
import {
  applyAutotag,
  danbooruToName,
  danbooruToSeries,
  defaultTriggers,
  detect,
  generatedTitles,
  pickJapanese,
  shortTitle,
  type AutotagOptions,
  type Character,
} from '../../shared/autotag.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS characters (
    id              TEXT PRIMARY KEY,
    danbooru        TEXT NOT NULL UNIQUE,
    name_en         TEXT NOT NULL DEFAULT '',
    name_ja         TEXT NOT NULL DEFAULT '',
    pixiv_tag       TEXT NOT NULL DEFAULT '',
    series_en       TEXT NOT NULL DEFAULT '',
    series_ja       TEXT NOT NULL DEFAULT '',
    prompt_triggers TEXT NOT NULL DEFAULT '[]',
    lora_triggers   TEXT NOT NULL DEFAULT '[]',
    extra_tags      TEXT NOT NULL DEFAULT '[]',
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);

// Age columns (added later: migrate existing DBs).
{
  const have = new Set((db.prepare('PRAGMA table_info(characters)').all() as { name: string }[]).map((c) => c.name));
  const add: [string, string][] = [
    ['age_text', "TEXT NOT NULL DEFAULT ''"],
    ['age_source', "TEXT NOT NULL DEFAULT ''"],
    ['age_url', "TEXT NOT NULL DEFAULT ''"],
    ['young_score', 'REAL'],
    ['age_checked_at', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [c, def] of add) if (!have.has(c)) db.exec(`ALTER TABLE characters ADD COLUMN ${c} ${def}`);
}

Object.assign(DEFAULTS, {
  'autotag.lang': 'en', // en | ja
  'autotag.series': '1',
  'autotag.pixivStyle': '1',
  'autotag.title': '1',
  'autotag.onImport': '1',
});

type Row = {
  id: string;
  danbooru: string;
  name_en: string;
  name_ja: string;
  pixiv_tag: string;
  series_en: string;
  series_ja: string;
  prompt_triggers: string;
  lora_triggers: string;
  extra_tags: string;
  enabled: number;
  age_text: string;
  age_source: string;
  age_url: string;
  young_score: number | null;
  age_checked_at: string;
};

const fromRow = (r: Row): Character => ({
  id: r.id,
  danbooru: r.danbooru,
  nameEn: r.name_en,
  nameJa: r.name_ja,
  pixivTag: r.pixiv_tag,
  seriesEn: r.series_en,
  seriesJa: r.series_ja,
  promptTriggers: JSON.parse(r.prompt_triggers),
  loraTriggers: JSON.parse(r.lora_triggers),
  extraTags: JSON.parse(r.extra_tags),
  enabled: r.enabled === 1,
  ageText: r.age_text,
  ageSource: (r.age_source as Character['ageSource']) || '',
  ageUrl: r.age_url,
  youngScore: r.young_score,
  ageCheckedAt: r.age_checked_at,
});

export function listCharacters(): Character[] {
  return (db.prepare('SELECT * FROM characters ORDER BY series_en, name_en').all() as Row[]).map(fromRow);
}

export function autotagOptions(): AutotagOptions {
  return {
    lang: getSetting('autotag.lang') === 'ja' ? 'ja' : 'en',
    series: getSetting('autotag.series') === '1',
    pixivStyle: getSetting('autotag.pixivStyle') === '1',
    title: getSetting('autotag.title') === '1',
  };
}

/** Detects characters in an image and writes the tags/title. Returns true if the image changed. */
export function autotagImage(id: string, chars = listCharacters(), opts = autotagOptions()): boolean {
  const r = db.prepare('SELECT * FROM images WHERE id = ?').get(id) as ImageRow | undefined;
  if (!r?.comfy) return false;
  const hits = detect(chars, JSON.parse(r.comfy));
  const found = hits.map((h) => chars.find((c) => c.id === h.characterId)!);
  const tags: string[] = JSON.parse(r.tags);
  const res = applyAutotag({ title: r.title, tags, original_name: r.original_name }, found, opts);
  const shortChanged = syncShortTitles(id, res.title, found, opts);
  if (res.title === r.title && JSON.stringify(res.tags) === JSON.stringify(tags)) return shortChanged;
  db.prepare('UPDATE images SET title = ?, tags = ? WHERE id = ?').run(res.title, JSON.stringify(res.tags), id);
  return true;
}

const LIMITS = PLATFORMS.map((p) => SPEC[p].titleMax).filter((m): m is number => m !== null);

/**
 * Per-platform short auto-title: when the generated title is too long for a platform (Pixiv: 32),
 * that platform's override gets a shortened one. Titles typed by the user are never touched.
 */
function syncShortTitles(id: string, title: string, found: Character[], opts: AutotagOptions): boolean {
  if (!found.length) return false;
  const generated = generatedTitles(found, opts, LIMITS);
  const isGen = generated.has(title);
  const getO = db.prepare('SELECT title, description, tags FROM overrides WHERE image_id = ? AND platform = ?');
  let changed = false;
  for (const p of PLATFORMS) {
    const max = SPEC[p].titleMax;
    if (max === null) continue;
    const cur = getO.get(id, p) as { title: string | null; description: string | null; tags: string | null } | undefined;
    if (cur?.title != null && !generated.has(cur.title)) continue; // user's own override title
    const want = isGen && title.length > max ? shortTitle(found, opts, max) : null;
    if ((cur?.title ?? null) === want) continue;
    changed = true;
    if (want === null && cur && cur.description === null && cur.tags === null) db.prepare('DELETE FROM overrides WHERE image_id = ? AND platform = ?').run(id, p);
    else
      db.prepare(
        `INSERT INTO overrides (image_id, platform, title) VALUES (?, ?, ?)
         ON CONFLICT(image_id, platform) DO UPDATE SET title = excluded.title`,
      ).run(id, p, want);
  }
  return changed;
}

// ---------------- Danbooru ----------------
const DANBOORU = 'https://danbooru.donmai.us';

async function dget<T>(p: string): Promise<T | null> {
  const res = await fetch(DANBOORU + p, { headers: { 'user-agent': 'VEXO/0.1 (local tool)', accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Danbooru: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function otherNames(tag: string): Promise<string[]> {
  const w = await dget<{ other_names?: string[] }>(`/wiki_pages/${encodeURIComponent(tag)}.json?only=other_names`);
  return w?.other_names ?? [];
}

/** Builds a character draft (not saved) from a Danbooru character tag. */
async function lookup(tag: string): Promise<Omit<Character, 'id'>> {
  const t = tag.trim().toLowerCase().replace(/\s+/g, '_');
  const [names, related] = await Promise.all([
    otherNames(t),
    dget<{ related_tags?: { tag: { name: string; category: number } }[] }>(`/related_tag.json?query=${encodeURIComponent(t)}&category=copyright&limit=3`),
  ]);
  const series = related?.related_tags?.find((x) => x.tag.category === 3)?.tag.name ?? '';
  const seriesNames = series ? await otherNames(series) : [];
  const { nameJa, pixivTag } = pickJapanese(names);
  const nameEn = danbooruToName(t);
  const seriesEn = series ? danbooruToSeries(series) : '';
  const seriesJa = seriesNames[0] ?? '';
  return {
    danbooru: t,
    nameEn,
    nameJa,
    pixivTag,
    seriesEn,
    seriesJa,
    ...defaultTriggers(t),
    extraTags: [],
    enabled: true,
    ...(await checkAge({ danbooru: t, nameEn, nameJa, seriesEn, seriesJa })),
  };
}

// ---------------- age (AniList + Danbooru) ----------------
const compactS = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

type AniChar = { name: { full: string; native: string | null }; age: string | null; siteUrl: string; media: { nodes: { title: { romaji: string | null; english: string | null; native: string | null } }[] } };

/** Finds the character on AniList: same series first, then an exact name match. */
async function anilistAge(c: { nameEn: string; nameJa: string; seriesEn: string; seriesJa: string }): Promise<{ age: string; url: string } | null> {
  const query = `query($s:String){Page(perPage:10){characters(search:$s){name{full native} age siteUrl media(perPage:8){nodes{title{romaji english native}}}}}}`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, variables: { s: c.nameEn || c.nameJa } }),
  });
  if (!res.ok) throw new Error(`AniList: HTTP ${res.status}`);
  const list: AniChar[] = (await res.json())?.data?.Page?.characters ?? [];
  const series = [c.seriesEn, c.seriesJa].map(compactS).filter((s) => s.length >= 3);
  const sameSeries = (a: AniChar) =>
    a.media.nodes.some((m) => [m.title.romaji, m.title.english, m.title.native].some((t) => t && series.some((s) => compactS(t).includes(s) || s.includes(compactS(t)))));
  const names = [c.nameEn, c.nameJa].map(compactS).filter(Boolean);
  const sameName = (a: AniChar) => {
    const full = compactS(a.name.full);
    const rev = compactS(a.name.full.split(' ').reverse().join(' '));
    return names.some((n) => n === full || n === rev || n === compactS(a.name.native ?? ''));
  };
  const hit = (series.length ? list.find((a) => sameSeries(a) && sameName(a)) ?? list.find(sameSeries) : undefined) ?? list.find(sameName);
  return hit ? { age: hit.age ?? '', url: hit.siteUrl } : null;
}

/** % of the character's Danbooru posts tagged `loli` (null if unknown). */
async function youngScore(tag: string): Promise<number | null> {
  const count = async (q: string) => (await dget<{ counts: { posts: number } }>(`/counts/posts.json?tags=${encodeURIComponent(q)}`))?.counts?.posts ?? null;
  const total = await count(tag);
  if (!total) return null;
  await new Promise((r) => setTimeout(r, 400));
  const n = await count(`${tag} loli`);
  return n === null ? null : Math.round((n / total) * 1000) / 10;
}

async function checkAge(c: { danbooru: string; nameEn: string; nameJa: string; seriesEn: string; seriesJa: string }) {
  const [ani, young] = await Promise.all([anilistAge(c).catch(() => null), youngScore(c.danbooru).catch(() => null)]);
  return {
    ageText: ani?.age ?? '',
    ageSource: (ani?.age ? 'anilist' : '') as Character['ageSource'],
    ageUrl: ani?.url ?? '',
    youngScore: young,
    ageCheckedAt: new Date().toISOString(),
  };
}

/** Re-checks a saved character; a manually typed age is kept. */
async function recheck(id: string): Promise<Character | null> {
  const c = listCharacters().find((x) => x.id === id);
  if (!c) return null;
  const a = await checkAge(c);
  const manual = c.ageSource === 'manual';
  db.prepare('UPDATE characters SET age_text = ?, age_source = ?, age_url = ?, young_score = ?, age_checked_at = ? WHERE id = ?').run(
    manual ? c.ageText ?? '' : a.ageText,
    manual ? 'manual' : (a.ageSource ?? ''),
    a.ageUrl || (c.ageUrl ?? ''),
    a.youngScore,
    a.ageCheckedAt,
    id,
  );
  return listCharacters().find((x) => x.id === id) ?? null;
}

// ---------------- routes ----------------
const Body = z.object({
  danbooru: z.string().trim().min(1),
  nameEn: z.string().default(''),
  nameJa: z.string().default(''),
  pixivTag: z.string().default(''),
  seriesEn: z.string().default(''),
  seriesJa: z.string().default(''),
  promptTriggers: z.array(z.string()).default([]),
  loraTriggers: z.array(z.string()).default([]),
  extraTags: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  ageText: z.string().default(''),
  ageSource: z.enum(['anilist', 'manual', '']).default(''),
  ageUrl: z.string().default(''),
  youngScore: z.number().nullable().default(null),
  ageCheckedAt: z.string().default(''),
});

const cols = (c: z.infer<typeof Body>) => [
  c.danbooru,
  c.nameEn,
  c.nameJa,
  c.pixivTag,
  c.seriesEn,
  c.seriesJa,
  JSON.stringify(c.promptTriggers),
  JSON.stringify(c.loraTriggers),
  JSON.stringify(c.extraTags),
  c.enabled ? 1 : 0,
  c.ageText,
  c.ageSource,
  c.ageUrl,
  c.youngScore,
  c.ageCheckedAt,
];

export async function characterRoutes(app: FastifyInstance) {
  app.get('/api/characters', async () => listCharacters());

  app.get('/api/characters/search', async (req) => {
    const q = String((req.query as any).q ?? '').trim().replace(/\s+/g, '_');
    if (q.length < 2) return [];
    const r = await dget<{ value: string; label: string; category: number; post_count: number }[]>(
      `/autocomplete.json?search%5Bquery%5D=${encodeURIComponent(q)}&search%5Btype%5D=tag_query&limit=12`,
    );
    return (r ?? []).filter((x) => x.category === 4).map((x) => ({ tag: x.value, label: x.label, count: x.post_count }));
  });

  app.get('/api/characters/lookup', async (req, reply) => {
    const tag = String((req.query as any).tag ?? '');
    if (!tag) return reply.code(400).send({ error: 'Missing tag.' });
    return lookup(tag);
  });

  app.post('/api/characters', async (req, reply) => {
    const p = Body.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    if (db.prepare('SELECT 1 FROM characters WHERE danbooru = ?').get(p.data.danbooru)) return reply.code(409).send({ error: 'Character already in the list.' });
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO characters (danbooru, name_en, name_ja, pixiv_tag, series_en, series_ja, prompt_triggers, lora_triggers, extra_tags, enabled,
         age_text, age_source, age_url, young_score, age_checked_at, id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(...cols(p.data), id);
    return reply.code(201).send(fromRow(db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as Row));
  });

  app.put('/api/characters/:id', async (req, reply) => {
    const id = (req.params as any).id;
    const p = Body.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const r = db
      .prepare(
        `UPDATE characters SET danbooru = ?, name_en = ?, name_ja = ?, pixiv_tag = ?, series_en = ?, series_ja = ?,
           prompt_triggers = ?, lora_triggers = ?, extra_tags = ?, enabled = ?,
           age_text = ?, age_source = ?, age_url = ?, young_score = ?, age_checked_at = ? WHERE id = ?`,
      )
      .run(...cols(p.data), id);
    if (!r.changes) return reply.code(404).send({ error: 'Not found.' });
    return fromRow(db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as Row);
  });

  /** Re-check the age of one character (`:id`) or all of them (`all`). */
  app.post('/api/characters/:id/age', async (req, reply) => {
    const id = (req.params as any).id as string;
    const ids = id === 'all' ? listCharacters().map((c) => c.id) : [id];
    for (const [i, x] of ids.entries()) {
      if (i) await new Promise((r) => setTimeout(r, 800)); // AniList: 90 req/min
      if (!(await recheck(x))) return reply.code(404).send({ error: 'Not found.' });
    }
    return listCharacters();
  });

  app.delete('/api/characters/:id', async (req) => {
    db.prepare('DELETE FROM characters WHERE id = ?').run((req.params as any).id);
    return { ok: true };
  });

  /** Auto-tag the given images (the "Auto-tag" button). */
  app.post('/api/images/autotag', async (req, reply) => {
    const p = z.object({ ids: z.array(z.string()).min(1) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const chars = listCharacters();
    const opts = autotagOptions();
    let changed = 0;
    for (const id of p.data.ids) if (autotagImage(id, chars, opts)) changed++;
    const sel = db.prepare('SELECT * FROM images WHERE id = ?');
    const images = p.data.ids.map((id) => sel.get(id) as ImageRow | undefined).filter(Boolean).map((r) => toDto(r!));
    return { changed, images };
  });
}
