// Age parsing + live AniList/Danbooru check. Usage: ARTPOST_DATA=<tmp dir> npx tsx scripts/test-age.ts
import assert from 'node:assert/strict';
import { minAge, ageRisk } from '../shared/age.js';

assert.equal(minAge('16-23 (physically), 27 (chronologically)'), 16);
assert.equal(minAge('1000+'), 1000);
assert.equal(minAge('6 (self asserted)'), 6);
assert.equal(minAge('17 (Part 1), 20 (Part 2)'), 17);
assert.equal(minAge('Early 20s'), 20);
assert.equal(minAge('Teenager'), 15);
assert.equal(minAge(''), null);
assert.equal(ageRisk({ ageText: '24', youngScore: 0.3 }).level, 'ok');
assert.equal(ageRisk({ ageText: '16', youngScore: 0.3 }).level, 'minor');
assert.equal(ageRisk({ ageText: '1000+', youngScore: 21.9 }).level, 'minor'); // ancient but drawn as a child
assert.equal(ageRisk({ ageText: '1000+', youngScore: 5 }).level, 'young');
assert.equal(ageRisk({ ageText: '', youngScore: 0.1 }).level, 'unknown');
assert.equal(ageRisk({}).level, 'unknown');
console.log('age parsing: OK');

const base = process.env.ARTPOST_API ?? '';
if (!base) {
  console.log('(set ARTPOST_API=http://127.0.0.1:3299 for the live lookup)');
} else {
  for (const tag of ['kohaku_(dr._stone)', 'frieren', 'anya_(spy_x_family)', 'makima_(chainsaw_man)', 'kanna_kamui', 'yor_briar', 'raiden_shogun']) {
    const d = await (await fetch(`${base}/api/characters/lookup?tag=${encodeURIComponent(tag)}`)).json();
    const r = ageRisk(d);
    console.log(tag.padEnd(24), `age="${d.ageText}"`.padEnd(48), `loli=${d.youngScore}%`.padEnd(12), r.level.padEnd(8), d.ageUrl);
  }
}
