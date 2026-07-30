'use client';

import type { ProgressInfo } from '@huggingface/transformers';
import type { BankResult, ColorFeatures, SemanticFeatures, TagHit } from './types.ts';
import { BANKS } from './taxonomy.ts';

export const SIZE = 64;

// SigLIP over CLIP because there's no softmax: a lake photo can score every "action"
// low instead of being forced to pick one.
const MODEL_ID = 'Xenova/siglip-base-patch16-224';

/** SigLIP was trained on this exact phrasing; bare tag ids score badly. */
const template = (p: string) => `This is a photo of ${p}.`;

// Scores are relative to each image, not absolute. These ONNX towers put cosines in
// -0.10..0.07 (the published siglip head wants ~0.11 for even odds), and the offset
// drifts per image, so any fixed cutoff either fires everything or nothing. Rankings
// are solid though — so standardise per image, then squash.
const Z_CENTER = 1.6;
const Z_SCALE = 1.4;

const BATCH = 32;

export function extractColorFeatures(canvas: HTMLCanvasElement): ColorFeatures | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const n = SIZE * SIZE;
  const luma = new Float64Array(n);
  const hueBins = new Float64Array(12);

  let rSum = 0, bSum = 0, satSum = 0, lumaSum = 0;
  let rgSum = 0, rgSqSum = 0, ybSum = 0, ybSqSum = 0;

  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    rSum += r;
    bSum += b;

    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma[p] = l;
    lumaSum += l;

    const rN = r / 255, gN = g / 255, bN = b / 255;
    const max = Math.max(rN, gN, bN);
    const min = Math.min(rN, gN, bN);
    const delta = max - min;
    const s = max === 0 ? 0 : delta / max;
    satSum += s;

    // Opponent channels for Hasler-Susstrunk colourfulness.
    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    rgSum += rg; rgSqSum += rg * rg;
    ybSum += yb; ybSqSum += yb * yb;

    if (delta > 0) {
      let h: number;
      if (max === rN) h = ((gN - bN) / delta) % 6;
      else if (max === gN) h = (bN - rN) / delta + 2;
      else h = (rN - gN) / delta + 4;
      h *= 60;
      if (h < 0) h += 360;
      // Weight by saturation so washed-out pixels don't vote on hue.
      hueBins[Math.min(11, Math.floor(h / 30))] += s;
    }
  }

  const meanLuma = lumaSum / n;

  let varSum = 0;
  for (let p = 0; p < n; p++) {
    const d = luma[p] - meanLuma;
    varSum += d * d;
  }

  let edgeSum = 0, edgeCount = 0;
  for (let y = 0; y < SIZE - 1; y++) {
    for (let x = 0; x < SIZE - 1; x++) {
      const p = y * SIZE + x;
      edgeSum += Math.abs(luma[p] - luma[p + 1]) + Math.abs(luma[p] - luma[p + SIZE]);
      edgeCount++;
    }
  }

  const rgMean = rgSum / n, ybMean = ybSum / n;
  const rgStd = Math.sqrt(Math.max(0, rgSqSum / n - rgMean * rgMean));
  const ybStd = Math.sqrt(Math.max(0, ybSqSum / n - ybMean * ybMean));
  const colorful =
    (Math.hypot(rgStd, ybStd) + 0.3 * Math.hypot(rgMean, ybMean)) / 255;

  let top = 0;
  for (let i = 1; i < 12; i++) if (hueBins[i] > hueBins[top]) top = i;

  return {
    brightness: meanLuma / 255,
    saturation: satSum / n,
    warmth: (rSum - bSum) / n / 255,
    contrast: Math.min(1, Math.sqrt(varSum / n) / 128),
    colorfulness: Math.min(1, colorful),
    dominantHue: top * 30 + 15,
    edgeDensity: Math.min(1, edgeSum / edgeCount / 64),
  };
}

// --- inference ---------------------------------------------------------------

function l2(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Median + MAD, so a few strong hits don't drag the baseline they're measured against. */
function robustStats(values: number[]): { mu: number; sd: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (arr: number[]) => arr[Math.floor(arr.length / 2)];
  const mu = mid(sorted);
  const mad = mid(sorted.map((v) => Math.abs(v - mu)).sort((a, b) => a - b));
  return { mu, sd: Math.max(1e-4, 1.4826 * mad) };
}

/** One vector per tag, built once and reused for every photo. */
interface TagVector {
  bank: string;
  tag: string;
  vec: Float32Array;
}

interface Engine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processor: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vision: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RawImage: any;
  vectors: TagVector[];
}

export type VisionStatus =
  | { phase: 'idle' }
  | { phase: 'downloading'; pct: number }
  | { phase: 'preparing' }
  | { phase: 'ready' }
  | { phase: 'failed' };

let status: VisionStatus = { phase: 'idle' };
const listeners = new Set<(s: VisionStatus) => void>();

function setStatus(next: VisionStatus) {
  status = next;
  for (const l of listeners) l(next);
}

/** Subscribe to load progress. Subscribing must never start a download — the model is
 *  fetched when a photo is picked, not when the page opens. */
export function onVisionStatus(cb: (s: VisionStatus) => void): () => void {
  listeners.add(cb);
  cb(status);
  return () => { listeners.delete(cb); };
}

let enginePromise: Promise<Engine> | null = null;

async function build(device: 'webgpu' | 'wasm'): Promise<Engine> {
  const { AutoTokenizer, AutoProcessor, SiglipTextModel, SiglipVisionModel, RawImage } =
    await import('@huggingface/transformers');

  // Progress arrives per file across four loads, so track each file's own bytes and
  // report the sum. Reporting the latest event instead makes the bar walk backwards.
  const bytes = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (e: ProgressInfo) => {
    if (e.status !== 'progress' || !e.total) return;
    bytes.set(e.file, { loaded: e.loaded ?? 0, total: e.total });
    let loaded = 0, total = 0;
    for (const b of bytes.values()) { loaded += b.loaded; total += b.total; }
    if (total > 0) setStatus({ phase: 'downloading', pct: Math.min(99, Math.round((loaded / total) * 100)) });
  };

  // q8 both ways — fp32 triples the download and barely moves the scores.
  const opts = { device, dtype: 'q8', progress_callback } as const;

  const [tokenizer, processor, text, vision] = await Promise.all([
    AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback }),
    AutoProcessor.from_pretrained(MODEL_ID, { progress_callback }),
    SiglipTextModel.from_pretrained(MODEL_ID, opts),
    SiglipVisionModel.from_pretrained(MODEL_ID, opts),
  ]);

  // Embedding 270 prompts takes a few seconds — without its own phase that reads as a
  // hang at 99%.
  setStatus({ phase: 'preparing' });

  // Flatten every prompt across every bank, embed once, then average per tag.
  const flat: { bank: string; tag: string; prompt: string }[] = [];
  for (const bank of BANKS) {
    for (const t of bank.tags) {
      for (const p of t.prompts) flat.push({ bank: bank.id, tag: t.id, prompt: template(p) });
    }
  }

  const embeddings: Float32Array[] = [];
  for (let i = 0; i < flat.length; i += BATCH) {
    const slice = flat.slice(i, i + BATCH);
    // SigLIP needs fixed-length padding.
    const inputs = tokenizer(slice.map((s) => s.prompt), {
      padding: 'max_length',
      truncation: true,
    });
    const { pooler_output } = await text(inputs);
    const dim = pooler_output.dims[1];
    const data = pooler_output.data as Float32Array;
    for (let r = 0; r < slice.length; r++) {
      embeddings.push(l2(data.slice(r * dim, (r + 1) * dim)));
    }
  }

  // Average each tag's prompts, then renormalise.
  const grouped = new Map<string, { bank: string; tag: string; acc: Float32Array; n: number }>();
  for (let i = 0; i < flat.length; i++) {
    const { bank, tag } = flat[i];
    const key = `${bank}/${tag}`;
    const vec = embeddings[i];
    const entry = grouped.get(key) ?? { bank, tag, acc: new Float32Array(vec.length), n: 0 };
    for (let d = 0; d < vec.length; d++) entry.acc[d] += vec[d];
    entry.n++;
    grouped.set(key, entry);
  }

  const vectors: TagVector[] = [...grouped.values()].map(({ bank, tag, acc }) => ({
    bank,
    tag,
    vec: l2(acc),
  }));

  // Text tower is dead weight now.
  await text.dispose?.();

  return { processor, vision, RawImage, vectors };
}

function loadEngine(): Promise<Engine> {
  if (enginePromise) return enginePromise;
  setStatus({ phase: 'downloading', pct: 0 });
  // WASM is the fallback because WebGPU is still absent in Safari and older Firefox.
  enginePromise = build('webgpu')
    .catch(() => build('wasm'))
    .then(
      (engine) => { setStatus({ phase: 'ready' }); return engine; },
      (err) => { setStatus({ phase: 'failed' }); throw err; },
    );
  return enginePromise;
}

/** Starts the download. Call on photo pick, not on mount. */
export function warmupVision(): Promise<boolean> {
  return loadEngine().then(() => true, () => false);
}

/** Scores every bank off a single image encode, so extra tags are basically free. */
export async function classifyImage(src: string): Promise<SemanticFeatures | null> {
  try {
    const { processor, vision, RawImage, vectors } = await loadEngine();

    const image = await RawImage.read(src);
    const inputs = await processor(image);
    const { pooler_output } = await vision(inputs);
    const imageVec = l2(pooler_output.data as Float32Array);

    // Standardise across all tags at once, so a whole bank can stay silent.
    const cosines = vectors.map(({ vec }) => dot(imageVec, vec));
    const { mu, sd } = robustStats(cosines);

    const scores = new Map<string, number>();
    vectors.forEach(({ bank, tag }, i) => {
      const z = (cosines[i] - mu) / sd;
      scores.set(`${bank}/${tag}`, sigmoid(Z_SCALE * (z - Z_CENTER)));
    });

    const out: SemanticFeatures = {};

    // Subject first — it decides whether the action bank gets to speak.
    const ordered = [
      ...BANKS.filter((b) => b.id === 'subject'),
      ...BANKS.filter((b) => b.id !== 'subject'),
    ];
    let peoplePresent = false;

    for (const bank of ordered) {
      if (bank.requiresPeople && !peoplePresent) continue;

      const hits: TagHit[] = bank.tags
        .map((t) => ({ id: t.id, score: scores.get(`${bank.id}/${t.id}`) ?? 0, floor: t.threshold ?? bank.threshold }))
        .filter((h) => h.score >= h.floor)
        .sort((a, b) => b.score - a.score)
        .map(({ id, score }) => ({ id, score }));

      if (!hits.length) continue;

      const top = hits[0].score;
      const margin = top - (hits[1]?.score ?? 0);

      // Mood is the flakiest axis, so it only counts when it's decisive.
      if (bank.minMargin !== undefined && margin < bank.minMargin) continue;

      const result: BankResult = { tags: hits.slice(0, bank.topK), top, margin };
      out[bank.id] = result;

      if (bank.id === 'subject') {
        peoplePresent = result.tags.some(
          (h) => bank.tags.find((t) => t.id === h.id)?.people === true,
        );
      }
    }

    return out;
  } catch {
    // Never block a recommendation — the recommender falls back to colour alone.
    return null;
  }
}
