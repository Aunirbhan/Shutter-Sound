import { NextResponse } from 'next/server';
import { SpotifyError, searchTracks } from '@/lib/spotify';
import { assess, buildQueries, explain, fallbackQuery, queryOffsets, rankTracks } from '@/lib/recommend';
import { BANKS } from '@/lib/taxonomy';
import type { BankId } from '@/lib/taxonomy';
import type { BankResult, ColorFeatures, ErrorCode, Features, SemanticFeatures, TagHit } from '@/lib/types';

const NUMERIC_KEYS = [
  'brightness', 'saturation', 'warmth', 'contrast',
  'colorfulness', 'dominantHue', 'edgeDensity',
] as const;

const BANK_IDS = new Set<string>(BANKS.map((b) => b.id));

/** A real payload is under 2KB. Route handlers have no body limit of their own. */
const MAX_BODY_CHARS = 32_000;
/** topK is 2, so this is pure headroom — it just stops a 200k-tag body burning a core. */
const MAX_TAGS_PER_BANK = 8;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
const RATE_MAP_CAP = 5_000;

// Per-instance only. Good enough for a single server or local run; on serverless every
// instance counts separately, so a real deployment wants a shared store.
const hits = new Map<string, { count: number; resetAt: number }>();

/** Returns seconds to wait when over the limit, else null. */
function rateLimit(request: Request): number | null {
  const now = Date.now();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'shared';

  // The map is keyed on attacker-controlled input, so it has to be swept.
  if (hits.size > RATE_MAP_CAP) {
    for (const [key, value] of hits) if (value.resetAt <= now) hits.delete(key);
  }

  const entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }

  entry.count += 1;
  return entry.count > RATE_MAX ? Math.ceil((entry.resetAt - now) / 1000) : null;
}

const PUBLIC_MESSAGE: Record<ErrorCode, string> = {
  BAD_REQUEST: 'That request could not be read.',
  MISSING_CREDENTIALS: 'This server is not configured for Spotify.',
  SPOTIFY_AUTH_FAILED: 'Spotify could not be reached.',
  BAD_QUERY: 'Spotify could not be reached.',
  QUOTA_EXCEEDED: 'Spotify is rate limiting us. Try again shortly.',
  RATE_LIMITED: 'Too many requests. Try again in a minute.',
  NO_RESULTS: 'No tracks matched this photo.',
};

/** Detail goes to the log in production and to the developer in dev — never both. */
function fail(code: ErrorCode, detail: string, status: number, headers?: HeadersInit) {
  if (process.env.NODE_ENV === 'production') {
    console.error(`[recommend] ${code}: ${detail}`);
    return NextResponse.json({ error: PUBLIC_MESSAGE[code], code }, { status, headers });
  }
  return NextResponse.json({ error: detail, code }, { status, headers });
}

function parseColor(input: unknown): ColorFeatures | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const out = {} as ColorFeatures;

  for (const key of NUMERIC_KEYS) {
    const v = raw[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[key] = v;
  }
  return out;
}

const unit = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;

function parseBank(input: unknown): BankResult | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.tags)) return null;

  const tags: TagHit[] = raw.tags.slice(0, MAX_TAGS_PER_BANK).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { id, score } = item as Record<string, unknown>;
    if (typeof id !== 'string') return [];
    // From the browser, so clamp — an out-of-range score would dominate every average.
    return [{ id, score: unit(score) }];
  });

  if (!tags.length) return null;
  return { tags, top: unit(raw.top), margin: unit(raw.margin) };
}

function parseSemantic(input: unknown): SemanticFeatures | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;

  const out: SemanticFeatures = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!BANK_IDS.has(key)) continue;
    const bank = parseBank(value);
    if (bank) out[key as BankId] = bank;
  }

  return Object.keys(out).length ? out : null;
}

export async function POST(request: Request) {
  const retryAfter = rateLimit(request);
  if (retryAfter !== null) {
    return fail('RATE_LIMITED', `Over ${RATE_MAX} requests per minute.`, 429, {
      'Retry-After': String(retryAfter),
    });
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) {
      return fail('BAD_REQUEST', `Body over ${MAX_BODY_CHARS} bytes.`, 413);
    }
    body = JSON.parse(text);
  } catch {
    return fail('BAD_REQUEST', 'Body must be JSON.', 400);
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const color = parseColor(raw.color);
  if (!color) {
    return fail('BAD_REQUEST', `color must contain finite numbers: ${NUMERIC_KEYS.join(', ')}`, 400);
  }

  const features: Features = { color, semantic: parseSemantic(raw.semantic) };
  const verdict = assess(features);
  const queries = buildQueries(verdict);
  const offsets = queryOffsets(color, queries.length);

  // allSettled so one dead query can't sink the whole request.
  const settled = await Promise.allSettled(
    queries.map((q, i) => searchTracks(q.query, { offset: offsets[i] })),
  );

  // Kept per-query so rankTracks can take one keeper per lens.
  const perQuery = settled.map((r) => (r.status === 'fulfilled' ? r.value : []));

  // A lens that came back empty would lose its result entirely, so retry it once with
  // just the bare genre at offset 0 before giving up on it.
  const empty = perQuery.flatMap((list, i) => (list.length ? [] : [i]));
  if (empty.length) {
    const retried = await Promise.allSettled(
      empty.map((i) => {
        const q = fallbackQuery(verdict, queries[i].lens);
        // No echo filter on the retry — a `genre:` query can't echo a title.
        return q ? searchTracks(q, { echo: '' }) : Promise.resolve([]);
      }),
    );
    retried.forEach((r, k) => {
      if (r.status === 'fulfilled') perQuery[empty[k]] = r.value;
    });
  }

  const pool = perQuery.reduce((n, list) => n + list.length, 0);

  if (pool === 0) {
    const rejected = settled.find((r) => r.status === 'rejected');
    if (rejected?.status === 'rejected' && rejected.reason instanceof SpotifyError) {
      const status = rejected.reason.code === 'QUOTA_EXCEEDED' ? 429 : 502;
      return fail(rejected.reason.code, rejected.reason.message, status);
    }
    return fail('NO_RESULTS', 'No tracks matched this photo.', 404);
  }

  // Resolve each lane back to the lens that asked for it, so the UI can say why.
  const tracks = rankTracks(perQuery, features).map(({ track, lens }) => ({
    ...track,
    lens: verdict.genres[queries[lens]?.lens ?? lens] ?? verdict.genres[0],
  }));

  return NextResponse.json({
    tracks,
    why: explain(features, verdict),
    debug: {
      queries: queries.map((q) => q.query),
      genres: verdict.genres,
      tone: verdict.tone,
      valence: verdict.v,
      energy: verdict.e,
      era: verdict.era,
      semantic: features.semantic ?? {},
      pool,
    },
  });
}
