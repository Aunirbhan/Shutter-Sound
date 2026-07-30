import type { SpotifyTrack, ErrorCode } from './types.ts';

export class SpotifyError extends Error {
  code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'SpotifyError';
    this.code = code;
  }
}

interface RawTrack {
  id: string | null;
  name: string;
  uri: string;
  popularity?: number;
  duration_ms?: number;
  external_urls: { spotify?: string };
  artists: { name: string }[];
  album: { name?: string; images: { url: string }[] };
}

let cached: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new SpotifyError(
      'MISSING_CREDENTIALS',
      'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.local',
    );
  }

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    throw new SpotifyError('SPOTIFY_AUTH_FAILED', `Token request failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  // Expire 60s early so a search can't 401 mid-flight.
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cached.token;
}

// --- functional-audio filter -------------------------------------------------
// Spotify search is lexical, so "calm ambient" returns tracks with those words in the
// title — i.e. the sleep-aid catalogue. Two tiers, since banning "rain" outright would
// also kill Purple Rain.

/** Dead giveaways. One hit is enough. */
const HARD_SLOP =
  /(white|brown|pink) noise|\basmr\b|binaural|isochronic|nature sounds?|rain ?sounds?|ocean sounds?|sleep sounds?|for (sleep|sleeping|studying|relaxation|meditation|video)|guided meditation|sleep aid|delta waves?|loopable|background music|ambient background|royalty[ -]free|no copyright|type beat|\b\d{3}\s*hz\b|\b\d+\s*hours?\b/i;

/** Strip to letters and digits so "Post-Punk" and "postpunk" compare equal. */
const flatten = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * True when a track is matching the genre *word* rather than being of the genre.
 *
 * Two rules, because the two cases differ. A multi-word genre is a distinctive string,
 * so only an exact title match is filler ("Indie Folk" by OlexandrMusic) — The Lumineers
 * stay. A single common noun matches hundreds of unrelated titles, so anything leading
 * with it is almost certainly not the genre: searching "house" returns House Of The
 * Rising Sun and House Of Memories, no house music at all. Emptying that lane is the
 * point — the caller then retries with a `genre:` filter, which does find house music.
 */
export function echoesQuery(track: SpotifyTrack, genre: string): boolean {
  const g = flatten(genre);
  if (g.length < 4) return false;
  const name = flatten(track.name);
  const singleWord = !/[\s-]/.test(genre.trim());
  return singleWord ? name.startsWith(g) : name === g;
}

/** Only damning in pairs, or singly on an unknown track. */
const SOFT_SLOP =
  /\b(rain|rainfall|thunder|sleep|sleeping|meditat\w*|study|studying|focus|calm|calming|relax\w*|ambience|soothing|tranquil|serene|lullab\w*)\b/gi;

const MIN_POPULARITY = 15;
const MIN_DURATION_MS = 90_000;
const MAX_DURATION_MS = 8 * 60_000;

export function isFunctionalAudio(track: SpotifyTrack): boolean {
  const text = `${track.name} ${track.album}`;

  if (HARD_SLOP.test(text)) return true;

  const soft = new Set((text.match(SOFT_SLOP) ?? []).map((m) => m.toLowerCase()));
  if (soft.size >= 2) return true;
  // One soft word only convicts a track we know is obscure. Unknown popularity is not
  // evidence of anything.
  if (soft.size === 1 && track.popularity !== null && track.popularity < MIN_POPULARITY) return true;

  return false;
}

/** Aggressive on purpose — loop filler and 40-minute drones both go. */
export function keepTrack(track: SpotifyTrack): boolean {
  // Only judge popularity when Spotify actually sent it. It omits the field entirely on
  // this quota tier, and treating that as 0 silently dropped every single result.
  if (track.popularity !== null && track.popularity < MIN_POPULARITY) return false;
  if (track.durationMs < MIN_DURATION_MS || track.durationMs > MAX_DURATION_MS) return false;
  return !isFunctionalAudio(track);
}

function toTrack(raw: RawTrack): SpotifyTrack | null {
  if (!raw?.id) return null;
  return {
    id: raw.id,
    name: raw.name,
    artists: raw.artists.map((a) => a.name),
    album: raw.album.name ?? '',
    albumArt: raw.album.images[1]?.url ?? raw.album.images[0]?.url ?? '',
    spotifyUrl: raw.external_urls.spotify ?? `https://open.spotify.com/track/${raw.id}`,
    uri: raw.uri,
    popularity: typeof raw.popularity === 'number' ? raw.popularity : null,
    durationMs: raw.duration_ms ?? 0,
  };
}

// Measured, not documented. The docs say 50, but this app's quota tier rejects anything
// over 10 with `400 Invalid limit` — same restricted regime that killed audio-features.
// Offsets are unaffected. Don't raise this without probing the API first.
export const MAX_SEARCH_LIMIT = 10;

export async function searchTracks(
  query: string,
  { limit = MAX_SEARCH_LIMIT, offset = 0, echo = query }:
    { limit?: number; offset?: number; echo?: string } = {},
): Promise<SpotifyTrack[]> {
  const params = new URLSearchParams({
    q: query,
    type: 'track',
    market: process.env.SPOTIFY_MARKET || 'US',
    limit: String(Math.min(MAX_SEARCH_LIMIT, Math.max(1, limit))),
    offset: String(offset),
  });

  const send = async () => {
    const token = await getAccessToken();
    return fetch(`https://api.spotify.com/v1/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  };

  let res = await send();

  if (res.status === 401) {
    cached = null;
    res = await send();
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') ?? 'unknown';
    throw new SpotifyError('QUOTA_EXCEEDED', `Spotify rate limit hit, retry after ${retryAfter}s`);
  }

  // A 400 is a malformed query, not an auth problem. Reporting it as SPOTIFY_AUTH_FAILED
  // sent us hunting through credentials for a bad `limit`.
  if (res.status === 400) {
    const body = await res.text().catch(() => '');
    throw new SpotifyError('BAD_QUERY', `Spotify rejected the query: ${body.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new SpotifyError('SPOTIFY_AUTH_FAILED', `Search failed: ${res.status}`);
  }

  const data = (await res.json()) as { tracks?: { items?: (RawTrack | null)[] } };
  const items = data.tracks?.items ?? [];

  return items
    .filter((i): i is RawTrack => i !== null)
    .map(toTrack)
    .filter((t): t is SpotifyTrack => t !== null)
    .filter((t) => keepTrack(t) && !echoesQuery(t, echo));
}
