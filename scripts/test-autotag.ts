// Unit checks for shared/autotag.ts + live Danbooru lookup logic. Usage: npx tsx scripts/test-autotag.ts
import assert from 'node:assert/strict';
import { detect, applyAutotag, danbooruToName, danbooruToSeries, pickJapanese, defaultTriggers, type Character } from '../shared/autotag.js';

const kohaku: Character = {
  id: 'k', danbooru: 'kohaku_(dr._stone)', nameEn: 'Kohaku', nameJa: 'コハク', pixivTag: 'コハク(Dr.STONE)',
  seriesEn: 'Dr. Stone', seriesJa: 'Dr.STONE', ...defaultTriggers('kohaku_(dr._stone)'), extraTags: [], enabled: true,
};
const miku: Character = {
  id: 'm', danbooru: 'hatsune_miku', nameEn: 'Hatsune Miku', nameJa: '初音ミク', pixivTag: '初音ミク',
  seriesEn: 'Vocaloid', seriesJa: 'VOCALOID', ...defaultTriggers('hatsune_miku'), extraTags: ['twintails'], enabled: true,
};
const chars = [kohaku, miku];

// prompt, escaped parentheses + weights
assert.deepEqual(detect(chars, { positive: 'masterpiece, 1girl, (kohaku \\(dr. stone\\):1.2), bikini' }).map((d) => d.characterId), ['k']);
// underscores
assert.deepEqual(detect(chars, { positive: 'hatsune_miku, smile' }).map((d) => d.characterId), ['m']);
// no false positive on substrings
assert.deepEqual(detect(chars, { positive: 'hatsune_mikurin, smile' }), []);
// LoRA from ComfyUI metadata
assert.deepEqual(detect(chars, { positive: '1girl', loras: ['chars\\Kohaku_DrStone-v2.safetensors'] })[0], { characterId: 'k', via: 'lora', match: 'Kohaku_DrStone-v2.safetensors' });
// LoRA from A1111 syntax
assert.equal(detect(chars, { positive: '<lora:hatsunemiku_v3:0.8>, 1girl' })[0].characterId, 'm');
// disabled
assert.deepEqual(detect([{ ...miku, enabled: false }], { positive: 'hatsune miku' }), []);

const o = { lang: 'en' as const, series: true, pixivStyle: true, title: true };
let r = applyAutotag({ title: 'ComfyUI_00042_', tags: ['bikini'], original_name: 'ComfyUI_00042_.png' }, [kohaku], o);
assert.deepEqual(r.tags, ['Kohaku', 'Dr. Stone', 'bikini']);
assert.equal(r.title, 'Kohaku / Dr. Stone');
// switching to Japanese swaps variants, keeps others, keeps a real title
let r2 = applyAutotag({ title: r.title, tags: r.tags, original_name: 'ComfyUI_00042_.png' }, [kohaku], { ...o, lang: 'ja' });
assert.equal(r2.title, 'コハク / Dr.STONE'); // generated title follows the language
r = applyAutotag({ title: 'Summer', tags: r.tags, original_name: 'x.png' }, [kohaku], { ...o, lang: 'ja' });
assert.deepEqual(r.tags, ['コハク(Dr.STONE)', 'Dr.STONE', 'bikini']);
assert.equal(r.title, 'Summer'); // a real title is kept
r = applyAutotag({ title: '', tags: [] }, [kohaku, miku], { ...o, lang: 'ja', pixivStyle: false });
assert.deepEqual(r.tags, ['コハク', 'Dr.STONE', '初音ミク', 'VOCALOID', 'twintails']);
assert.equal(r.title, 'コハク & 初音ミク');

assert.equal(danbooruToName('kohaku_(dr._stone)'), 'Kohaku');
assert.equal(danbooruToSeries('dr._stone'), 'Dr. Stone');
assert.deepEqual(pickJapanese(['コハク', 'コハク(Dr.STONE)', 'kohaku']), { nameJa: 'コハク', pixivTag: 'コハク(Dr.STONE)' });
console.log('autotag unit checks: OK');

// live Danbooru (same calls as server/src/characters.ts lookup)
const UA = { headers: { 'user-agent': 'ArtPost/0.1 (local tool)' } };
for (const tag of ['kohaku_(dr._stone)', 'hatsune_miku', 'frieren']) {
  const names = ((await (await fetch(`https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(tag)}.json?only=other_names`, UA)).json()) as any).other_names ?? [];
  const rel = (await (await fetch(`https://danbooru.donmai.us/related_tag.json?query=${encodeURIComponent(tag)}&category=copyright&limit=3`, UA)).json()) as any;
  const series = rel.related_tags?.find((x: any) => x.tag.category === 3)?.tag.name ?? '';
  const sNames = series ? (((await (await fetch(`https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(series)}.json?only=other_names`, UA)).json()) as any).other_names ?? []) : [];
  console.log(tag, '→', danbooruToName(tag), pickJapanese(names), '| series:', danbooruToSeries(series), '/', sNames[0]);
}

// ---- short titles per platform limit ----
{
  const { shortTitle, autoTitle } = await import('../shared/autotag.js');
  const long1: Character = { ...kohaku, id: 'a', nameEn: 'Ishigami Senkuu', seriesEn: 'Dr. Stone' };
  const long2: Character = { ...kohaku, id: 'b', nameEn: 'Kohaku', seriesEn: 'Dr. Stone' };
  const long3: Character = { ...kohaku, id: 'c', nameEn: 'Chrome', seriesEn: 'Dr. Stone' };
  const en = { lang: 'en' as const, series: true, pixivStyle: true, title: true };
  const full = autoTitle([long1, long2, long3], en);
  assert.equal(full, 'Ishigami Senkuu & Kohaku & Chrome / Dr. Stone'); // 45 chars
  assert.equal(shortTitle([long1, long2, long3], en, 50), full);
  assert.equal(shortTitle([long1, long2, long3], en, 32), 'Ishigami Senkuu & Kohaku & Chrome'.length <= 32 ? 'Ishigami Senkuu & Kohaku & Chrome' : 'Ishigami Senkuu +2');
  assert.equal(shortTitle([long1, long2, long3], en, 10), 'Ishiga… +2');
  for (const m of [5, 10, 32]) assert.ok(shortTitle([long1, long2, long3], en, m).length <= m, `≤ ${m}`);
  console.log('short titles:', [50, 32, 10].map((m) => `${m} → "${shortTitle([long1, long2, long3], en, m)}"`).join(' | '));
}

// ---- a character name inside another character's qualifier is not a match ----
{
  const frieren: Character = { ...kohaku, id: 'fr', danbooru: 'frieren', nameEn: 'Frieren', promptTriggers: ['frieren'], loraTriggers: ['frieren'] };
  const fern: Character = { ...kohaku, id: 'fe', danbooru: 'fern_(sousou_no_frieren)', nameEn: 'Fern', promptTriggers: ['fern (sousou no frieren)'], loraTriggers: ['fern'] };
  const ids = (p: string) => detect([frieren, fern], { positive: p }).map((d) => d.characterId);
  assert.deepEqual(ids('1girl, fern \(sousou no frieren\), purple hair'), ['fe']);
  assert.deepEqual(ids('frieren, fern (sousou no frieren), 2girls'), ['fr', 'fe']);
  assert.deepEqual(ids('fern_(sousou_no_frieren), frieren'), ['fe', 'fr']); // prompt order
  console.log('nested names: OK');
}
