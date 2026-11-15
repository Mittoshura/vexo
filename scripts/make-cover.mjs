// Builds the Civitai cover (1920×1080) from docs/screenshots/1-library.png.
import sharp from 'sharp';

const W = 1920, H = 1080;
const shot = await sharp('docs/screenshots/1-library.png').resize(1240).png().toBuffer();
const { height: sh } = await sharp(shot).metadata();
const sites = ['Pixiv', 'DeviantArt', 'Civitai', 'X', 'SubscribeStar'];
const colors = ['#0096fa', '#00e59b', '#1971c2', '#e7e9ea', '#ff9c00'];

const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="g1" cx="0.85" cy="0.2" r="0.7"><stop offset="0" stop-color="#e5383b" stop-opacity="0.35"/><stop offset="1" stop-color="#0b0b0d" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2" cx="0.05" cy="0.95" r="0.6"><stop offset="0" stop-color="#7b5cff" stop-opacity="0.25"/><stop offset="1" stop-color="#0b0b0d" stop-opacity="0"/></radialGradient>
    <filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="24" stdDeviation="30" flood-color="#000" flood-opacity="0.6"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="#0b0b0d"/><rect width="${W}" height="${H}" fill="url(#g1)"/><rect width="${W}" height="${H}" fill="url(#g2)"/>
  <rect x="96" y="132" width="78" height="78" rx="18" fill="#e5383b"/>
  <text x="135" y="191" font-family="Segoe UI, Arial" font-weight="900" font-size="54" fill="#0b0b0d" text-anchor="middle">V</text>
  <text x="196" y="196" font-family="Segoe UI, Arial" font-weight="900" font-size="78" letter-spacing="6" fill="#f2f2f3">VEXO</text>
  <text x="96" y="318" font-family="Segoe UI, Arial" font-weight="800" font-size="56" fill="#f2f2f3">One batch.</text>
  <text x="96" y="386" font-family="Segoe UI, Arial" font-weight="800" font-size="56" fill="#e5383b">Five sites.</text>
  <text x="96" y="462" font-family="Segoe UI, Arial" font-size="25" fill="#a1a1aa">Post your ComfyUI images everywhere</text>
  <text x="96" y="498" font-family="Segoe UI, Arial" font-size="25" fill="#a1a1aa">from one app on your PC.</text>
  ${sites.map((s, i) => `<g transform="translate(96 ${566 + i * 52})"><circle cx="8" cy="-8" r="7" fill="${colors[i]}"/><text x="28" y="0" font-family="Segoe UI, Arial" font-weight="700" font-size="26" fill="#e4e4e7">${s}</text></g>`).join('')}
  <text x="96" y="${H - 84}" font-family="Consolas, monospace" font-size="21" fill="#71717a">auto-tag · ComfyUI metadata · queue &amp; schedule · age check</text>
  <rect x="${W - 1240 - 70}" y="${(H - sh) / 2}" width="1240" height="${sh}" rx="14" fill="#141417" filter="url(#sh)"/>
</svg>`;

const rounded = await sharp(shot)
  .composite([{ input: Buffer.from(`<svg width="1240" height="${sh}"><rect width="1240" height="${sh}" rx="14" fill="#fff"/></svg>`), blend: 'dest-in' }])
  .png()
  .toBuffer();
await sharp(Buffer.from(bg))
  .composite([{ input: rounded, left: W - 1240 - 70, top: Math.round((H - sh) / 2) }])
  .png()
  .toFile('docs/screenshots/0-cover.png');
console.log('cover → docs/screenshots/0-cover.png');
