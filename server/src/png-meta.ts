import zlib from 'node:zlib';
import type { ComfyMeta } from './db.js';

/** Read all text chunks (tEXt / zTXt / iTXt) from a PNG buffer. */
export function readPngText(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  if (buf.length < 8 || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return out;
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    try {
      if (type === 'tEXt') {
        const i = data.indexOf(0);
        out[data.toString('latin1', 0, i)] = data.toString('latin1', i + 1);
      } else if (type === 'zTXt') {
        const i = data.indexOf(0);
        out[data.toString('latin1', 0, i)] = zlib.inflateSync(data.subarray(i + 2)).toString('utf8');
      } else if (type === 'iTXt') {
        const i = data.indexOf(0);
        const key = data.toString('latin1', 0, i);
        const compressed = data[i + 1] === 1;
        let p = i + 3;
        p = data.indexOf(0, p) + 1; // language tag
        p = data.indexOf(0, p) + 1; // translated keyword
        const body = data.subarray(p);
        out[key] = compressed ? zlib.inflateSync(body).toString('utf8') : body.toString('utf8');
      }
    } catch {
      /* ignore malformed chunk */
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  return out;
}

type Node = { class_type: string; inputs: Record<string, unknown> };
type Graph = Record<string, Node>;

function isLink(v: unknown): v is [string, number] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';
}

/** Follow links until we find a string text value. */
function resolveText(graph: Graph, v: unknown, depth = 0): string | undefined {
  if (depth > 8) return undefined;
  if (typeof v === 'string') return v;
  if (!isLink(v)) return undefined;
  const node = graph[v[0]];
  if (!node) return undefined;
  const candidates = ['text', 'string', 'value', 'text_g', 'text_positive', 'prompt'];
  for (const k of candidates) {
    if (k in node.inputs) {
      const r = resolveText(graph, node.inputs[k], depth + 1);
      if (r) return r;
    }
  }
  // generic: follow any linked input
  for (const val of Object.values(node.inputs)) {
    if (isLink(val)) {
      const r = resolveText(graph, val, depth + 1);
      if (r) return r;
    }
  }
  return undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

export function extractComfy(graphJson: string): ComfyMeta | null {
  let graph: Graph;
  try {
    graph = JSON.parse(graphJson);
  } catch {
    return null;
  }
  if (!graph || typeof graph !== 'object') return null;
  const meta: ComfyMeta = { source: 'comfyui', loras: [] };
  const nodes = Object.values(graph).filter((n) => n && typeof n.class_type === 'string');

  for (const n of nodes) {
    const ct = n.class_type.toLowerCase();
    if (ct.includes('checkpointloader') || ct.includes('unetloader')) {
      const name = n.inputs.ckpt_name ?? n.inputs.unet_name;
      if (typeof name === 'string' && !meta.model) meta.model = name;
    }
    if (ct.includes('loraloader')) {
      const name = n.inputs.lora_name;
      if (typeof name === 'string') meta.loras!.push(name);
    }
  }

  const sampler = nodes.find((n) => /ksampler|samplercustom/i.test(n.class_type));
  if (sampler) {
    meta.seed = num(sampler.inputs.seed) ?? num(sampler.inputs.noise_seed);
    meta.steps = num(sampler.inputs.steps);
    meta.cfg = num(sampler.inputs.cfg);
    if (typeof sampler.inputs.sampler_name === 'string') meta.sampler = sampler.inputs.sampler_name;
    if (typeof sampler.inputs.scheduler === 'string') meta.scheduler = sampler.inputs.scheduler;
    meta.positive = resolveText(graph, sampler.inputs.positive);
    meta.negative = resolveText(graph, sampler.inputs.negative);
  }
  if (!meta.positive) {
    const enc = nodes.filter((n) => /cliptextencode/i.test(n.class_type));
    if (enc[0]) meta.positive = resolveText(graph, enc[0].inputs.text);
    if (enc[1]) meta.negative = resolveText(graph, enc[1].inputs.text);
  }
  if (!meta.loras!.length) delete meta.loras;
  const hasAny = meta.positive || meta.model || meta.seed !== undefined;
  return hasAny ? meta : null;
}

/** A1111 / Forge "parameters" chunk. */
export function extractA1111(params: string): ComfyMeta | null {
  const negIdx = params.indexOf('\nNegative prompt:');
  const stepsIdx = params.lastIndexOf('\nSteps:');
  const meta: ComfyMeta = { source: 'a1111' };
  meta.positive = params.slice(0, negIdx >= 0 ? negIdx : stepsIdx >= 0 ? stepsIdx : undefined).trim();
  if (negIdx >= 0) meta.negative = params.slice(negIdx + 17, stepsIdx >= 0 ? stepsIdx : undefined).trim();
  const tail = stepsIdx >= 0 ? params.slice(stepsIdx + 1) : '';
  const get = (k: string) => tail.match(new RegExp(`${k}: ([^,]+)`))?.[1]?.trim();
  meta.steps = Number(get('Steps')) || undefined;
  meta.cfg = Number(get('CFG scale')) || undefined;
  meta.seed = Number(get('Seed')) || undefined;
  meta.sampler = get('Sampler');
  meta.model = get('Model');
  return meta.positive ? meta : null;
}

export function extractGenerationMeta(buf: Buffer): ComfyMeta | null {
  const chunks = readPngText(buf);
  if (chunks.prompt) {
    const m = extractComfy(chunks.prompt);
    if (m) return m;
  }
  if (chunks.parameters) return extractA1111(chunks.parameters);
  return null;
}
