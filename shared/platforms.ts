// Shared by client + server: platforms, limits, metadata resolution.

export type PlatformId = 'pixiv' | 'deviantart' | 'civitai' | 'x' | 'subscribestar';
export const PLATFORMS: PlatformId[] = ['pixiv', 'deviantart', 'civitai', 'x', 'subscribestar'];

export type PlatformSpec = {
  id: PlatformId;
  name: string;
  /** Short label for tight spots (inspector tabs). */
  short: string;
  color: string;
  titleMax: number | null; // null = no title
  descMax: number;
  tagsMax: number;
  tagMaxLen: number;
  imagesPerPost: number;
  /** Normalizes a tag for this platform (returns '' if invalid). */
  tag: (t: string) => string;
  hint: string;
};

const stripSpaces = (t: string) => t.replace(/\s+/g, '');
const hashtagSafe = (t: string) => t.replace(/[^\p{L}\p{N}_]/gu, '');

export const SPEC: Record<PlatformId, PlatformSpec> = {
  pixiv: {
    id: 'pixiv',
    name: 'Pixiv',
    short: 'Pixiv',
    color: '#0096fa',
    titleMax: 32,
    descMax: 3000,
    tagsMax: 10,
    tagMaxLen: 30,
    imagesPerPost: 200,
    tag: stripSpaces,
    hint: 'Title ≤ 32 chars, max 10 tags, no spaces. Japanese tags recommended.',
  },
  deviantart: {
    id: 'deviantart',
    name: 'DeviantArt',
    short: 'DA',
    color: '#00e59b',
    titleMax: 50,
    descMax: 10000,
    tagsMax: 30,
    tagMaxLen: 50,
    imagesPerPost: 10,
    tag: (t) => t.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').toLowerCase(),
    hint: 'Title ≤ 50 chars, max 30 tags (letters/digits/_). Up to 10 images per deviation. R-18 is posted as Mature: explicit sexual content is not allowed on DeviantArt.',
  },
  civitai: {
    id: 'civitai',
    name: 'Civitai',
    short: 'Civitai',
    color: '#1971c2',
    titleMax: 200,
    descMax: 10000,
    tagsMax: 20,
    tagMaxLen: 50,
    imagesPerPost: 20,
    tag: (t) => t.trim().toLowerCase(),
    hint: 'Posted on civitai.red (SFW shows on civitai.com too, R-18 only on .red). ComfyUI metadata (prompt, model, seed) is sent automatically — required for R-18. Up to 20 images per post.',
  },
  x: {
    id: 'x',
    name: 'X',
    short: 'X',
    color: '#e7e9ea',
    titleMax: null,
    descMax: 280,
    tagsMax: 5,
    tagMaxLen: 30,
    imagesPerPost: 4,
    tag: hashtagSafe,
    hint: 'Single text, max 280 chars: title + description + #hashtags. 4 images per post. R-18 images are marked as sensitive.',
  },
  subscribestar: {
    id: 'subscribestar',
    name: 'SubscribeStar',
    short: 'SubStar',
    color: '#ff9c00',
    titleMax: 200,
    descMax: 20000,
    tagsMax: 30,
    tagMaxLen: 50,
    imagesPerPost: 20,
    tag: (t) => t.trim().toLowerCase(),
    hint: 'subscribestar.adult. No title field: the title is shown in bold on the first line. Choose Public or tiers when publishing. Up to 20 images per post.',
  },
};

export type Meta = { title: string; description: string; tags: string[] };
export type Override = Partial<Meta>;
export type TagRule = { platform: PlatformId; src: string; dst: string };

export function applyRules(tags: string[], platform: PlatformId, rules: TagRule[]): string[] {
  const map = new Map(rules.filter((r) => r.platform === platform).map((r) => [r.src.toLowerCase(), r.dst]));
  return tags.map((t) => map.get(t.toLowerCase()) ?? t);
}

/** Effective metadata for a platform (override > common), tags normalized and capped. */
export function resolve(common: Meta, override: Override | undefined, platform: PlatformId, rules: TagRule[]): Meta & { tagsDropped: string[] } {
  const spec = SPEC[platform];
  const raw = override?.tags ?? common.tags;
  const seen = new Set<string>();
  const tags: string[] = [];
  const tagsDropped: string[] = [];
  for (const t of applyRules(raw, platform, rules)) {
    const n = spec.tag(t).slice(0, spec.tagMaxLen);
    if (!n || seen.has(n)) continue;
    if (tags.length >= spec.tagsMax) {
      tagsDropped.push(n);
      continue;
    }
    seen.add(n);
    tags.push(n);
  }
  return {
    title: override?.title ?? common.title,
    description: override?.description ?? common.description,
    tags,
    tagsDropped,
  };
}

/** Final text of the X post. */
export function xText(m: Meta): string {
  const parts = [m.title, m.description].map((s) => s.trim()).filter(Boolean);
  const tags = m.tags.map((t) => `#${t}`).join(' ');
  return [parts.join('\n\n'), tags].filter(Boolean).join('\n\n');
}

/** Blocking problems for a platform. */
export function problems(m: Meta, platform: PlatformId): string[] {
  const spec = SPEC[platform];
  const out: string[] = [];
  if (platform === 'x') {
    const len = xText(m).length;
    if (len > spec.descMax) out.push(`X text: ${len}/${spec.descMax} characters`);
    return out;
  }
  if (spec.titleMax !== null) {
    if (!m.title.trim()) out.push('Empty title');
    else if (m.title.length > spec.titleMax) out.push(`Title: ${m.title.length}/${spec.titleMax} characters`);
  }
  if (m.description.length > spec.descMax) out.push(`Description: ${m.description.length}/${spec.descMax}`);
  return out;
}
