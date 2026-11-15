// Probe: share of a character's Danbooru posts tagged loli / child / flat_chest (calibrates the "looks young" threshold).
const UA = { headers: { 'user-agent': 'ArtPost/0.1 (local tool)', accept: 'application/json' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function count(tags) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://danbooru.donmai.us/counts/posts.json?tags=${encodeURIComponent(tags)}`, UA);
    if (r.ok) return (await r.json()).counts.posts;
    await sleep(2000);
  }
  return null;
}
const chars = ['anya_(spy_x_family)', 'illyasviel_von_einzbern', 'yor_briar', 'fern_(sousou_no_frieren)', 'frieren', 'kohaku_(dr._stone)', 'hatsune_miku', 'makima_(chainsaw_man)', 'kanna_kamui', 'nezuko_(kimetsu_no_yaiba)', 'power_(chainsaw_man)', 'raiden_shogun'];
for (const c of chars) {
  const total = await count(c);
  const parts = [];
  for (const g of ['loli', 'child', 'flat_chest']) {
    await sleep(700);
    const n = await count(`${c} ${g}`);
    parts.push(`${g}=${total && n !== null ? ((n / total) * 100).toFixed(1) : '?'}%`);
  }
  console.log(c.padEnd(28), `total=${total}`, parts.join(' '));
  await sleep(700);
}
