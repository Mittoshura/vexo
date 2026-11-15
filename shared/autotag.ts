// Shared by client + server: character detection in ComfyUI/A1111 metadata and auto-tag generation.
import type { AgeInfo } from './age.js';

export type TagLang = 'en' | 'ja';

export type Character = {
  id: string;
  danbooru: string; // e.g. kohaku_(dr._stone)
  nameEn: string; // Kohaku
  nameJa: string; // コハク
  pixivTag: string; // コハク(Dr.STONE) — Pixiv-style character tag (JP)
  seriesEn: string; // Dr. Stone
  seriesJa: string; // Dr.STONE
  promptTriggers: string[]; // matched as whole words in the prompt (underscores = spaces)
  loraTriggers: string[]; // matched as substrings of LoRA file names
  extraTags: string[]; // always added (language-independent)
  enabled: boolean;
} & Partial<AgeInfo>;

export type AutotagOptions = {
  lang: TagLang;
  series: boolean; // add the series tag
  pixivStyle: boolean; // JP only: use pixivTag (コハク(Dr.STONE)) instead of nameJa
  title: boolean; // fill an empty title
};

export type Detection = { characterId: string; via: 'prompt' | 'lora'; match: string };

export type GenSource = { positive?: string; loras?: string[] } | null | undefined;

/** Prompt text → lowercase, `_` → space, `\(` → `(`, single spaces. */
export function normPrompt(s: string): string {
  return s.toLowerCase().replace(/\\([()[\]])/g, '$1').replace(/_/g, ' ').replace(/\s+/g, ' ');
}

/** Letters/digits only — for LoRA names (kohaku_DrStone-v2.safetensors → kohakudrstonev2). */
export function compact(s: string): string {
  return s.toLowerCase().replace(/\.(safetensors|ckpt|pt|bin)$/i, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** LoRA file names, from metadata and from A1111 `<lora:name:0.8>` prompt syntax. */
export function loraNames(gen: GenSource): string[] {
  const out = [...(gen?.loras ?? [])].map((l) => l.split(/[\\/]/).pop()!);
  for (const m of (gen?.positive ?? '').matchAll(/<lora:([^:>]+)/gi)) out.push(m[1]);
  return out;
}

export function detect(chars: Character[], gen: GenSource): Detection[] {
  if (!gen) return [];
  const prompt = ` ${normPrompt((gen.positive ?? '').replace(/<lora:[^>]*>/gi, ' '))} `;
  const loras = loraNames(gen).map((l) => ({ raw: l, c: compact(l) }));
  const active = chars.filter((c) => c.enabled);

  // Every prompt occurrence of every trigger, as [start, end) spans.
  type Span = { id: string; trigger: string; start: number; end: number };
  const spans: Span[] = [];
  for (const ch of active)
    for (const t of ch.promptTriggers) {
      const k = normPrompt(t).trim();
      if (!k) continue;
      const re = new RegExp(`(?<=^|[^\\p{L}\\p{N}])${esc(k)}(?=[^\\p{L}\\p{N}]|$)`, 'gu');
      for (const m of prompt.matchAll(re)) spans.push({ id: ch.id, trigger: t, start: m.index!, end: m.index! + m[0].length });
    }
  // "fern (sousou no frieren)" must not also count as Frieren: drop spans inside a longer span of another character.
  const kept = spans.filter((s) => !spans.some((o) => o.id !== s.id && o.start <= s.start && o.end >= s.end && o.end - o.start > s.end - s.start));

  const out: (Detection & { pos: number })[] = [];
  for (const ch of active) {
    let hit: (Detection & { pos: number }) | null = null;
    for (const t of ch.loraTriggers) {
      const k = compact(t);
      const l = k && loras.find((x) => x.c.includes(k));
      if (l) {
        hit = { characterId: ch.id, via: 'lora', match: l.raw, pos: 1e9 + loras.indexOf(l) };
        break;
      }
    }
    const first = kept.filter((s) => s.id === ch.id).sort((a, b) => a.start - b.start)[0];
    if (first) hit = { characterId: ch.id, via: hit?.via ?? 'prompt', match: hit?.match ?? first.trigger, pos: first.start };
    if (hit) out.push(hit);
  }
  // Prompt order (main character first), then LoRA-only hits.
  return out.sort((a, b) => a.pos - b.pos).map(({ pos: _pos, ...d }) => d);
}

/** Tags a character adds with the given options. */
export function characterTags(c: Character, o: AutotagOptions): string[] {
  const name = o.lang === 'ja' ? (o.pixivStyle && c.pixivTag) || c.nameJa || c.nameEn : c.nameEn || c.nameJa;
  const series = o.lang === 'ja' ? c.seriesJa || c.seriesEn : c.seriesEn || c.seriesJa;
  return [name, ...(o.series && series ? [series] : []), ...c.extraTags].filter(Boolean);
}

/** Every language variant of a character's name/series tags (to swap languages cleanly). */
export function variantTags(c: Character): string[] {
  return [c.nameEn, c.nameJa, c.pixivTag, c.seriesEn, c.seriesJa].filter(Boolean);
}

export function autoTitle(chars: Character[], o: AutotagOptions): string {
  const pick = (c: Character) => (o.lang === 'ja' ? c.nameJa || c.nameEn : c.nameEn || c.nameJa);
  const names = [...new Set(chars.map(pick).filter(Boolean))];
  const series = [...new Set(chars.map((c) => (o.lang === 'ja' ? c.seriesJa || c.seriesEn : c.seriesEn || c.seriesJa)).filter(Boolean))];
  if (!names.length) return '';
  const t = names.join(' & ');
  return series.length === 1 ? `${t} / ${series[0]}` : t;
}

/**
 * Auto-title that fits in `max` characters, shortening step by step:
 * "Kohaku & Ruri / Dr. Stone" → "Kohaku & Ruri" → "Kohaku +1" → "Kohak…".
 */
export function shortTitle(chars: Character[], o: AutotagOptions, max: number): string {
  const full = autoTitle(chars, o);
  if (full.length <= max) return full;
  const pick = (c: Character) => (o.lang === 'ja' ? c.nameJa || c.nameEn : c.nameEn || c.nameJa);
  const names = [...new Set(chars.map(pick).filter(Boolean))];
  const joined = names.join(' & ');
  if (joined.length <= max) return joined;
  const first = names[0] ?? '';
  const more = names.length > 1 ? ` +${names.length - 1}` : '';
  if ((first + more).length <= max) return first + more;
  return `${first.slice(0, Math.max(1, max - 1 - more.length))}…${more}`.slice(0, max);
}

/** Every title auto-tag could have generated for these characters (any language, any length limit). */
export function generatedTitles(chars: Character[], o: AutotagOptions, limits: number[]): Set<string> {
  const out = new Set<string>();
  for (const lang of ['en', 'ja'] as const) {
    const ol = { ...o, lang };
    out.add(autoTitle(chars, ol));
    for (const m of limits) out.add(shortTitle(chars, ol, m));
  }
  out.delete('');
  return out;
}

/**
 * Applies detections to an image's tags/title. Variant tags of detected characters are replaced by the
 * current language; other tags are kept in order.
 */
export function applyAutotag(
  img: { title: string; tags: string[]; original_name?: string },
  detected: Character[],
  o: AutotagOptions,
): { title: string; tags: string[]; added: string[] } {
  // Import sets the title to the file name: treat that as "no title yet".
  const stem = img.original_name?.replace(/\.[^.]+$/, '');
  const placeholder = !img.title.trim() || img.title === stem;
  if (!detected.length) return { title: img.title, tags: img.tags, added: [] };
  // A title we generated ourselves (in either language) may be regenerated too.
  const generated = (['en', 'ja'] as const).some((lang) => img.title === autoTitle(detected, { ...o, lang }));
  const drop = new Set(detected.flatMap(variantTags).map((t) => t.toLowerCase()));
  const kept = img.tags.filter((t) => !drop.has(t.toLowerCase()));
  const lower = new Set(kept.map((t) => t.toLowerCase()));
  const added: string[] = [];
  for (const t of detected.flatMap((c) => characterTags(c, o))) {
    if (lower.has(t.toLowerCase())) continue;
    lower.add(t.toLowerCase());
    added.push(t);
  }
  const title = o.title && (placeholder || generated) ? autoTitle(detected, o) || img.title : img.title;
  return { title, tags: [...added, ...kept], added };
}

// ---------- Danbooru helpers (pure: used by the server lookup) ----------

const JP = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

const SMALL = new Set(['no', 'na', 'ni', 'wo', 'to', 'ga', 'wa', 'de', 'of', 'the', 'and', 'a', 'an', 'in', 'on', 'x']);

/** kohaku_(dr._stone) → Kohaku ; ishigami_senkuu → Ishigami Senkuu ; sousou_no_frieren → Sousou no Frieren */
export function danbooruToName(tag: string): string {
  const base = tag.replace(/_\([^)]*\)$/, '').replace(/_/g, ' ').trim();
  return base
    .split(' ')
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/^\p{L}/u, (m) => m.toUpperCase())))
    .join(' ');
}

/** dr._stone → Dr. Stone */
export function danbooruToSeries(tag: string): string {
  return danbooruToName(tag.replace(/_\(series\)$/, ''));
}

export function pickJapanese(otherNames: string[]): { nameJa: string; pixivTag: string } {
  const jp = otherNames.filter((n) => JP.test(n));
  const plain = jp.find((n) => !/[(（]/.test(n)) ?? '';
  const withSeries = jp.find((n) => /[(（]/.test(n)) ?? '';
  return { nameJa: plain || withSeries, pixivTag: withSeries || plain };
}

/** Default prompt triggers: the Danbooru tag itself (as written in prompts). */
export function defaultTriggers(tag: string): { promptTriggers: string[]; loraTriggers: string[] } {
  const base = tag.replace(/_\([^)]*\)$/, '');
  return { promptTriggers: [tag.replace(/_/g, ' ')], loraTriggers: [base.replace(/_/g, '')] };
}
