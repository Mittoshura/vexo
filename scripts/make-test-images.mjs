// Génère des PNG de test avec métadonnées ComfyUI / A1111 dans $TMPDIR/artpost-test
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = path.join(process.env.TMPDIR ?? '.', 'artpost-test');
fs.mkdirSync(out, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function addText(png, key, text) {
  const data = Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]);
  // insert after IHDR (8 sig + 25 IHDR)
  return Buffer.concat([png.subarray(0, 33), chunk('tEXt', data), png.subarray(33)]);
}

const graph = {
  '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'waiIllustrious_v140.safetensors' } },
  '2': { class_type: 'LoraLoader', inputs: { lora_name: 'detail_tweaker.safetensors', model: ['1', 0], clip: ['1', 1] } },
  '3': { class_type: 'CLIPTextEncode', inputs: { text: 'masterpiece, 1girl, red hair, space suit, (bear ears:1.2), looking at viewer', clip: ['2', 1] } },
  '4': { class_type: 'CLIPTextEncode', inputs: { text: 'lowres, bad anatomy', clip: ['2', 1] } },
  '5': { class_type: 'KSampler', inputs: { seed: 123456789, steps: 28, cfg: 5.5, sampler_name: 'euler_ancestral', scheduler: 'normal', positive: ['3', 0], negative: ['4', 0], model: ['2', 0] } },
};

const colors = ['#e5383b', '#3a86ff', '#8338ec', '#ffbe0b', '#06d6a0', '#ff006e'];
for (let i = 0; i < colors.length; i++) {
  const w = 768 + (i % 3) * 128, h = 1024 - (i % 2) * 256;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${colors[i]}"/><circle cx="${w/2}" cy="${h/2}" r="${Math.min(w,h)/3}" fill="#0b0b0d"/><text x="${w/2}" y="${h/2+20}" font-size="72" text-anchor="middle" fill="#fff" font-family="sans-serif">#${i+1}</text></svg>`;
  let png = await sharp(Buffer.from(svg)).png().toBuffer();
  if (i < 4) png = addText(png, 'prompt', JSON.stringify({ ...graph, '5': { ...graph['5'], inputs: { ...graph['5'].inputs, seed: 1000 + i } } }));
  else if (i === 4) png = addText(png, 'parameters', 'a cute bear in space, flat colors\nNegative prompt: ugly\nSteps: 20, Sampler: DPM++ 2M, CFG scale: 7, Seed: 42, Model: sdxl_base');
  fs.writeFileSync(path.join(out, `ComfyUI_0000${i + 1}_.png`), png);
}
fs.writeFileSync(path.join(out, 'notes.txt'), 'pas une image');
console.log(out);
