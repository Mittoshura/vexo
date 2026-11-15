// Generates SFW demo illustrations (procedural SVG → PNG, 832×1216) with ComfyUI metadata, for screenshots.
// Usage: node scripts/make-demo.mjs <outDir>
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? 'demo';
fs.mkdirSync(out, { recursive: true });
const W = 832, H = 1216;

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
const addText = (png, key, text) => Buffer.concat([png.subarray(0, 33), chunk('tEXt', Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(text, 'utf8')])), png.subarray(33)]);
const graph = (prompt, lora, s) => JSON.stringify({
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'waiIllustrious_v140.safetensors' } },
  2: { class_type: 'LoraLoader', inputs: { lora_name: lora, model: ['1', 0], clip: ['1', 1] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 1] } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: 'lowres, bad anatomy, watermark', clip: ['2', 1] } },
  5: { class_type: 'KSampler', inputs: { seed: s, steps: 28, cfg: 5.5, sampler_name: 'euler_ancestral', scheduler: 'karras', positive: ['3', 0], negative: ['4', 0], model: ['2', 0] } },
});

const stars = (n, maxY, op = 0.9) => Array.from({ length: n }, () => `<circle cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * maxY).toFixed(0)}" r="${(rnd() * 1.8 + 0.3).toFixed(1)}" fill="#fff" opacity="${(rnd() * op).toFixed(2)}"/>`).join('');
function ridge(baseY, amp, color, steps = 14) {
  let d = `M0 ${H} L0 ${baseY}`;
  for (let i = 0; i <= steps; i++) d += ` L${((i / steps) * W).toFixed(0)} ${(baseY - rnd() * amp).toFixed(0)}`;
  return `<path d="${d} L${W} ${H} Z" fill="${color}"/>`;
}
const svg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${defs}<filter id="blur" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="40"/></filter><filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter></defs>${body}</svg>`;
const sky = (id, stops) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;

const scenes = [
  ['sunset_sea', 'frieren, 1girl, elf, white hair, standing on a cliff, sunset over the sea, wind, scenery', 'chars/frieren_sousou_v2.safetensors',
    () => svg(sky('s', [[0, '#2b1055'], [0.45, '#d75b5b'], [0.62, '#ffb46b'], [1, '#1b1f3b']]),
      `<rect width="${W}" height="${H}" fill="url(#s)"/>${stars(60, 400, 0.6)}<circle cx="416" cy="700" r="150" fill="#ffd38a" filter="url(#blur)"/><circle cx="416" cy="700" r="110" fill="#ffe3a8"/>
       <rect y="740" width="${W}" height="${H - 740}" fill="#232a52"/>${Array.from({ length: 22 }, (_, i) => `<rect x="${280 + rnd() * 120}" y="${760 + i * 18}" width="${60 + rnd() * 140}" height="3" fill="#ffd38a" opacity="${0.7 - i * 0.03}"/>`).join('')}
       ${ridge(1000, 120, '#151933')}`)],
  ['neon_city', 'hatsune miku, 1girl, twintails, neon city at night, rain, reflections, cyberpunk, scenery', 'detail_tweaker.safetensors',
    () => svg(sky('s', [[0, '#05010f'], [0.6, '#2a0b4a'], [1, '#0b0620']]),
      `<rect width="${W}" height="${H}" fill="url(#s)"/>${stars(40, 300, 0.4)}<circle cx="600" cy="260" r="90" fill="#ff4fd8" opacity="0.35" filter="url(#blur)"/>
       ${Array.from({ length: 16 }, (_, i) => { const x = i * 56 - 20, h = 300 + rnd() * 520, c = ['#1a1035', '#22124a', '#160d2e'][i % 3]; const wins = Array.from({ length: 30 }, () => `<rect x="${x + 6 + Math.floor(rnd() * 4) * 11}" y="${H - 240 - rnd() * h}" width="6" height="9" fill="${rnd() > 0.5 ? '#38e8ff' : '#ff4fd8'}" opacity="${(0.4 + rnd() * 0.6).toFixed(2)}"/>`).join(''); return `<rect x="${x}" y="${H - 240 - h}" width="52" height="${h}" fill="${c}"/>${wins}`; }).join('')}
       <rect y="${H - 240}" width="${W}" height="240" fill="#0b0620"/>${Array.from({ length: 40 }, () => `<rect x="${rnd() * W}" y="${H - 230 + rnd() * 220}" width="${2 + rnd() * 3}" height="${20 + rnd() * 60}" fill="${rnd() > 0.5 ? '#38e8ff' : '#ff4fd8'}" opacity="0.25" filter="url(#soft)"/>`).join('')}`)],
  ['aurora', 'fern (sousou no frieren), 1girl, purple hair, snowy mountains, aurora borealis, night sky, scenery', 'chars/fern_sousou_v1.safetensors',
    () => svg(sky('s', [[0, '#020615'], [0.55, '#0b2a3d'], [1, '#d9ecff']]) + `<linearGradient id="a" x1="0" x2="1"><stop offset="0" stop-color="#36ffb0" stop-opacity="0"/><stop offset="0.5" stop-color="#36ffb0"/><stop offset="1" stop-color="#7b5cff" stop-opacity="0"/></linearGradient>`,
      `<rect width="${W}" height="${H}" fill="url(#s)"/>${stars(140, 700)}
       <path d="M-50 380 C 200 200, 450 520, 900 300 L 900 420 C 450 640, 200 330, -50 520 Z" fill="url(#a)" opacity="0.55" filter="url(#blur)"/>
       <path d="M-50 300 C 300 160, 520 420, 900 220 L 900 280 C 520 470, 300 230, -50 360 Z" fill="url(#a)" opacity="0.45" filter="url(#soft)"/>
       ${ridge(820, 260, '#2c4a66')}${ridge(960, 200, '#9fc2e0')}${ridge(1080, 120, '#eaf4ff')}`)],
  ['sakura', '1girl, kimono, cherry blossoms, japanese shrine, spring, petals, scenery', 'detail_tweaker.safetensors',
    () => svg(sky('s', [[0, '#ffe1ec'], [0.6, '#ffc2d6'], [1, '#f6a5c0']]),
      `<rect width="${W}" height="${H}" fill="url(#s)"/><circle cx="620" cy="300" r="120" fill="#fff6f0" opacity="0.9" filter="url(#soft)"/>
       ${ridge(900, 160, '#e68aa8')}<rect x="300" y="700" width="232" height="26" fill="#c8323c"/><rect x="280" y="680" width="272" height="22" rx="6" fill="#d9414a"/><rect x="330" y="726" width="22" height="380" fill="#c8323c"/><rect x="480" y="726" width="22" height="380" fill="#c8323c"/>
       ${Array.from({ length: 160 }, () => `<ellipse cx="${rnd() * W}" cy="${rnd() * H}" rx="${4 + rnd() * 7}" ry="${3 + rnd() * 4}" fill="${rnd() > 0.5 ? '#ffffff' : '#ff8fb5'}" opacity="${(0.5 + rnd() * 0.5).toFixed(2)}" transform="rotate(${rnd() * 180})"/>`).join('').replace(/rotate\(([\d.]+)\)"\/>/g, (m, a) => m)}
       <rect y="1100" width="${W}" height="116" fill="#b85b7c"/>`)],
  ['space_planet', 'space, ringed planet, nebula, stars, astronaut, scenery, wide shot', 'detail_tweaker.safetensors',
    () => svg(`<radialGradient id="n" cx="0.3" cy="0.35" r="0.7"><stop offset="0" stop-color="#7a2cff"/><stop offset="0.5" stop-color="#1b0b45"/><stop offset="1" stop-color="#03020a"/></radialGradient><radialGradient id="p" cx="0.35" cy="0.3"><stop offset="0" stop-color="#ffb36b"/><stop offset="1" stop-color="#7a2d22"/></radialGradient>`,
      `<rect width="${W}" height="${H}" fill="url(#n)"/><circle cx="650" cy="900" r="260" fill="#ff3f8e" opacity="0.25" filter="url(#blur)"/>${stars(260, H)}
       <circle cx="430" cy="620" r="210" fill="url(#p)"/><ellipse cx="430" cy="630" rx="360" ry="70" fill="none" stroke="#ffd9a8" stroke-width="16" opacity="0.7" transform="rotate(-18 430 630)"/><ellipse cx="430" cy="630" rx="330" ry="60" fill="none" stroke="#fff1dc" stroke-width="5" opacity="0.6" transform="rotate(-18 430 630)"/>`)],
  ['forest_lake', '1girl, sitting by a forest lake, morning fog, sunbeams, scenery', 'detail_tweaker.safetensors',
    () => svg(sky('s', [[0, '#cfe8d6'], [0.5, '#8fbf9a'], [1, '#203b2e']]),
      `<rect width="${W}" height="${H}" fill="url(#s)"/>${Array.from({ length: 6 }, (_, i) => `<polygon points="${120 + i * 120},0 ${200 + i * 120},0 ${420 + i * 60},${H} ${300 + i * 60},${H}" fill="#fffbe0" opacity="0.08"/>`).join('')}
       ${Array.from({ length: 3 }, (_, k) => Array.from({ length: 14 }, (_, i) => { const x = i * 64 + (k * 31) % 64 - 20, h = 260 + rnd() * 200, y = 720 + k * 60; return `<polygon points="${x},${y} ${x + 34},${y - h} ${x + 68},${y}" fill="${['#5f8f6e', '#3f6b50', '#26493a'][k]}"/>`; }).join('')).join('')}
       <rect y="860" width="${W}" height="${H - 860}" fill="#6f9fb0"/><rect y="860" width="${W}" height="60" fill="#e8f3ec" opacity="0.6" filter="url(#soft)"/>${ridge(1120, 60, '#1c3226')}`)],
];

for (const [i, [name, prompt, lora, draw]] of scenes.entries()) {
  let png = await sharp(Buffer.from(draw())).png().toBuffer();
  png = addText(png, 'prompt', graph(`masterpiece, best quality, ${prompt}`, lora, 1000 + i * 7919));
  fs.writeFileSync(path.join(out, `ComfyUI_${String(310 + i).padStart(5, '0')}_${name}.png`), png);
}
console.log(`${scenes.length} demo images → ${out}`);
