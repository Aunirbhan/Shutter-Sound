import type { BankId, Tag } from './taxonomy.ts';
import {
  BANKS, BANK_BY_ID, DEEP_NIGHT, GENRE_FILTER_SAFE, MOOD_BIAS, NEUTRAL_FALLBACK,
} from './taxonomy.ts';
import type { ColorFeatures, Features, Lens, LensQuery, SpotifyTrack, Verdict } from './types.ts';

/** One result per descriptor, so five results means five lenses and five queries. */
const LENS_COUNT = 5;
/** How hard a lens leans on its own bank when re-running the genre union. */
const LENS_BOOST = 3;
/** Only applies to backfill — the lenses themselves are already one-per-bank. */
const PER_BANK_CAP = 2;

interface Fired {
  bank: BankId;
  tag: Tag;
  score: number;
  /** Score x bank weight (x MOOD_BIAS for mood). */
  w: number;
}

/** Every tag that cleared threshold, flattened with weights applied. */
function collect(f: Features): Fired[] {
  const s = f.semantic;
  if (!s) return [];

  const out: Fired[] = [];

  // Re-check the people gate here too. vision.ts does it, but this payload comes from
  // the browser and a stray action tag gets 2x weight on energy.
  const subjectBank = BANK_BY_ID.get('subject');
  const peoplePresent = Boolean(
    s.subject?.tags.some((h) => subjectBank?.tags.find((t) => t.id === h.id)?.people),
  );

  for (const bank of BANKS) {
    const result = s[bank.id];
    if (!result) continue;
    if (bank.requiresPeople && !peoplePresent) continue;

    for (const hit of result.tags) {
      const tag = bank.tags.find((t) => t.id === hit.id);
      if (!tag) continue;
      // Gate tags only answer "anyone in frame?" — they don't get a vote.
      if (tag.gateOnly) continue;
      const bias = bank.id === 'mood' ? MOOD_BIAS : 1;
      out.push({ bank: bank.id, tag, score: hit.score, w: hit.score * bank.weight * bias });
    }
  }

  // A prompt can't see "3am" but luma can, so fold it in over a near-black frame.
  const night = out.find((x) => x.bank === 'time' && x.tag.id === 'night');
  if (night && f.color.brightness < DEEP_NIGHT.maxBrightness) {
    out.push({
      bank: 'time',
      tag: { id: 'deep_night', prompts: [], v: DEEP_NIGHT.v, e: DEEP_NIGHT.e, g: DEEP_NIGHT.g },
      score: night.score,
      w: night.w,
    });
  }

  return out;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Colour nudges the axes, it doesn't drive them. Bounded so it can't outvote a tag. */
function colorNudge(c: ColorFeatures): { dv: number; de: number } {
  let dv = 0;
  let de = 0;

  if (c.brightness > 0.65 && c.warmth > 0.05) dv += 0.12;
  if (c.brightness < 0.25) dv -= 0.12;
  if (c.saturation > 0.5) dv += 0.05;
  if (c.saturation < 0.15) dv -= 0.05;

  if (c.edgeDensity > 0.5 && c.contrast > 0.4) de += 0.12;
  if (c.edgeDensity < 0.2) de -= 0.12;
  if (c.colorfulness > 0.45) de += 0.05;

  return { dv: clamp(dv, -0.15, 0.15), de: clamp(de, -0.15, 0.15) };
}

export function toneWords(v: number, e: number): string[] {
  const valence =
    v < -0.4 ? 'dark' : v < 0.2 ? 'moody' : v < 0.6 ? 'warm' : 'euphoric';
  const energy =
    e < 0.25 ? 'slow' : e < 0.5 ? 'mellow' : e < 0.75 ? 'driving' : 'high energy';
  return [valence, energy];
}

/** Fired tags -> averaged v/e, ranked genres, tone words, era. Replaces GENRE_MAP. */
export function assess(f: Features): Verdict {
  const fired = collect(f);
  const { dv, de } = colorNudge(f.color);

  if (!fired.length) {
    const v = clamp(NEUTRAL_FALLBACK.v + dv, -1, 1);
    const e = clamp(NEUTRAL_FALLBACK.e + de, 0, 1);
    return {
      v,
      e,
      genres: NEUTRAL_FALLBACK.g.slice(0, LENS_COUNT).map((genre, i) => ({
        genre,
        score: 1 / (1 + i),
        from: 'setting' as BankId,
        tag: 'fallback',
      })),
      tone: toneWords(v, e),
      era: null,
    };
  }

  // Weighted means — weather leans on valence, action/motion on energy.
  let vNum = 0, vDen = 0, eNum = 0, eDen = 0;
  for (const hit of fired) {
    const bank = BANK_BY_ID.get(hit.bank);
    if (!bank) continue;
    vNum += hit.w * bank.vWeight * hit.tag.v;
    vDen += hit.w * bank.vWeight;
    eNum += hit.w * bank.eWeight * hit.tag.e;
    eDen += hit.w * bank.eWeight;
  }

  const v = clamp((vDen ? vNum / vDen : 0) + dv, -1, 1);
  const e = clamp((eDen ? eNum / eDen : 0.3) + de, 0, 1);

  // Era comes from the strongest medium tag that has one.
  const era =
    fired
      .filter((x) => x.bank === 'medium' && x.tag.era)
      .sort((a, b) => b.w - a.w)[0]?.tag.era ?? null;

  return { v, e, genres: buildLenses(fired), tone: toneWords(v, e), era };
}

/** Union the genre lists, decaying by position. `boost` triples one bank's say. */
function genrePool(fired: Fired[], boost?: BankId) {
  const pool = new Map<string, { score: number; from: BankId; tag: string; best: number }>();

  for (const hit of fired) {
    const w = hit.bank === boost ? hit.w * LENS_BOOST : hit.w;
    hit.tag.g.forEach((genre, i) => {
      const add = w / (1 + i);
      const cur = pool.get(genre);
      if (!cur) {
        pool.set(genre, { score: add, from: hit.bank, tag: hit.tag.id, best: add });
      } else {
        cur.score += add;
        if (add > cur.best) {
          cur.best = add;
          cur.from = hit.bank;
          cur.tag = hit.tag.id;
        }
      }
    });
  }

  return [...pool.entries()]
    .map(([genre, x]) => ({ genre, score: x.score, from: x.from, tag: x.tag }))
    .sort((a, b) => b.score - a.score || a.genre.localeCompare(b.genre));
}

/**
 * One genre per descriptor. Each lens re-runs the union with a different bank boosted,
 * so "what if the medium dominates" and "what if the mood dominates" give different
 * answers. That difference is the whole reason five results aren't five near-duplicates.
 */
export function buildLenses(fired: Fired[]): Lens[] {
  // Strongest descriptor picks first.
  const weightByBank = new Map<BankId, number>();
  for (const hit of fired) {
    weightByBank.set(hit.bank, (weightByBank.get(hit.bank) ?? 0) + hit.w);
  }
  const banks = [...weightByBank.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([bank]) => bank);

  const out: Lens[] = [];
  const claimed = new Set<string>();

  for (const bank of banks) {
    if (out.length >= LENS_COUNT) break;
    const top = genrePool(fired, bank).find((c) => !claimed.has(c.genre));
    if (!top) continue;
    claimed.add(top.genre);
    // Anchor to the bank we boosted, not whoever happened to contribute most.
    const anchor = fired.filter((x) => x.bank === bank).sort((a, b) => b.w - a.w)[0];
    out.push({ genre: top.genre, score: top.score, from: bank, tag: anchor?.tag.id ?? top.tag });
  }

  // Too few banks fired to fill five, so top up from the unboosted ranking.
  if (out.length < LENS_COUNT) {
    const perBank = new Map<BankId, number>();
    for (const l of out) perBank.set(l.from, (perBank.get(l.from) ?? 0) + 1);

    for (const cand of genrePool(fired)) {
      if (out.length >= LENS_COUNT) break;
      if (claimed.has(cand.genre)) continue;
      const used = perBank.get(cand.from) ?? 0;
      if (used >= PER_BANK_CAP) continue;
      claimed.add(cand.genre);
      perBank.set(cand.from, used + 1);
      out.push(cand);
    }
  }

  return out;
}

/**
 * One query per lens, tagged with which lens asked so results stay attributable.
 * Search returns 10 rows and we need one keeper per lens, so a single well-formed query
 * beats fanning out — every extra query is another call against a shared quota.
 */
export function buildQueries(verdict: Verdict): LensQuery[] {
  const seen = new Set<string>();

  return verdict.genres.slice(0, LENS_COUNT).flatMap((g, lens) => {
    // Bare genre, nothing else. All three embellishments measured worse on the live API:
    //   `genre:` matches artist tags, returns nothing for most subgenres.
    //   `year:`  zeroes out niche ones — "dream pop" 10 results, with a year range 0.
    //   tone words get matched literally in titles — "indie folk" gives The Lumineers,
    //            "slow indie folk" gives John Mayer and MC Frontalot.
    // Search is lexical, so every extra word is another thing it can match wrongly.
    const query = g.genre;

    if (seen.has(query)) return [];
    seen.add(query);
    return [{ query, lens }];
  });
}

/**
 * Retry for a lens whose lane came back empty. `genre:` goes here rather than in the
 * primary query on purpose: it returns genre-correct but obscure tracks, where a plain
 * lexical search returns recognisable ones. Try for recognisable first, fall back to
 * merely correct. Genres outside the allowlist just drop their qualifier instead.
 */
export function fallbackQuery(verdict: Verdict, lens: number): string | null {
  const genre = verdict.genres[lens]?.genre;
  if (!genre) return null;
  if (GENRE_FILTER_SAFE.has(genre.toLowerCase())) return `genre:"${genre}"`;
  const words = genre.split(' ');
  return words.length > 1 ? words[words.length - 1] : genre;
}

function seedFrom(c: ColorFeatures): number {
  let h = 2166136261;
  for (const v of [c.brightness, c.saturation, c.warmth, c.contrast, c.colorfulness, c.edgeDensity]) {
    h = Math.imul(h ^ Math.round(v * 10000), 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A nudge off the top of Spotify's ranking, seeded from colour so the same photo is
 *  stable. Kept small: search returns 10 rows and relevance falls off a cliff after the
 *  first few — result 2 for "dream pop" is Cigarettes After Sex, result 18 is noise.
 *  Variety comes from the five lens queries, not from paging deep. */
export function queryOffsets(c: ColorFeatures, count: number, spread = 3): number[] {
  const rnd = mulberry32(seedFrom(c) ^ 0x9e3779b9);
  return Array.from({ length: count }, () => Math.floor(rnd() * spread));
}

/** A track plus the lens whose query surfaced it. */
export interface RankedTrack {
  track: SpotifyTrack;
  lens: number;
}

/**
 * One keeper per lens, so all five results answer the photo from a different descriptor.
 * The old pool-and-shuffle let a single query fill the whole list, which is most of why
 * you got fifteen ambient tracks.
 */
export function rankTracks(
  perQuery: SpotifyTrack[][],
  f: Features,
  limit = LENS_COUNT,
): RankedTrack[] {
  const rnd = mulberry32(seedFrom(f.color));

  // Shuffle each lane so we don't always take Spotify's top hit.
  const lanes = perQuery.map((list) =>
    list.map((track) => ({ track, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.track),
  );

  const ids = new Set<string>();
  const titles = new Set<string>();
  const artists = new Set<string>();
  const out: RankedTrack[] = [];

  const accept = (track: SpotifyTrack, lens: number): boolean => {
    const artist = (track.artists[0] ?? '').toLowerCase();
    // Same song shows up across many releases, so id alone isn't enough.
    const title = `${artist}|${track.name.toLowerCase()}`;
    if (ids.has(track.id) || titles.has(title) || artists.has(artist)) return false;
    ids.add(track.id);
    titles.add(title);
    artists.add(artist);
    out.push({ track, lens });
    return true;
  };

  const cursor = lanes.map(() => 0);

  // One per lane per round. A lens whose lane came back empty gets covered by the others
  // on later rounds rather than one lane being drained to fill the list.
  let progressed = true;
  while (out.length < limit && progressed) {
    progressed = false;
    for (let i = 0; i < lanes.length && out.length < limit; i++) {
      while (cursor[i] < lanes[i].length) {
        if (accept(lanes[i][cursor[i]++], i)) {
          progressed = true;
          break;
        }
      }
    }
  }

  return out;
}

// --- explanation -------------------------------------------------------------
// Deterministic prose, no model call. Tag ids are snake_case, so anything that can show
// up in a sentence gets a written fragment; unmapped ids just lose their underscores.

const SETTING_PHRASE: Record<string, string> = {
  city_day: 'A city street', city_night: 'A city street', city_aerial_skyline: 'A skyline from above',
  suburb_residential: 'A suburban street', rural_farmland: 'Open farmland', desert: 'A desert',
  ocean_beach: 'A beach', ocean_open_deep: 'The open ocean', lake_river: 'Still water',
  forest: 'A forest', jungle_tropical: 'Tropical jungle', field_meadow: 'An open meadow',
  garden_park: 'A garden', mountain_alpine: 'Mountains', snow_arctic: 'Snow and ice',
  space_sky_stars: 'A sky full of stars', interior_cozy_home: 'A room at home',
  interior_industrial_warehouse: 'An industrial interior', interior_club_bar: 'A club interior',
  interior_office_lab: 'A workspace', church_temple_sacred: 'A sacred interior',
  ruins_abandoned: 'Abandoned ruins', battlefield_war: 'A war-torn scene', road_highway: 'An open road',
};

const TIME_PHRASE: Record<string, string> = {
  midday: 'in full daylight',
  golden_glow: 'in golden light',
  night: 'after dark',
  deep_night: 'in the small hours',
};

const MEDIUM_PHRASE: Record<string, string> = {
  film_35mm: 'shot on film', black_and_white: 'in black and white', polaroid: 'on instant film',
  long_exposure: 'on a long exposure', drone_aerial: 'from the air', macro_closeup: 'in macro',
  flash_snapshot: 'caught on flash', vintage_70s: 'with a faded retro cast',
  studio_lit: 'under studio lights', phone_snapshot: 'on a phone',
};

const MOTION_PHRASE: Record<string, string> = {
  motion_blur: 'Everything is in motion',
  frozen_action: 'Movement frozen mid-air',
  still_calm: 'Nothing moves',
  crowded_busy: 'The frame is packed',
  empty_sparse: 'Mostly empty space',
};

const MOOD_PHRASE: Record<string, string> = {
  horror_dread: 'It reads as dread', suspense_tension: 'It feels held in tension',
  triumph_victory: 'It reads as triumph', nostalgia_memory: 'It reads like a memory',
  whimsy_playful: 'It reads as playful', surreal_dreamlike: 'It reads as dreamlike',
  isolation_loneliness: 'It reads as solitude', hope_uplift: 'It reads as hopeful',
  mystery_wonder: 'It reads as wonder',
};

const soften = (id: string) => id.replace(/_/g, ' ');

function topTag(f: Features, bank: BankId): string | null {
  return f.semantic?.[bank]?.tags[0]?.id ?? null;
}

/** The "Why this song" line. Same input, same sentence. */
export function explain(f: Features, verdict: Verdict): string {
  const [valence, energy] = verdict.tone;
  const [g1, g2] = verdict.genres;
  const lands = g2 ? `${g1.genre} and ${g2.genre}` : g1?.genre ?? 'something quiet';

  const setting = topTag(f, 'setting');
  const time = topTag(f, 'time');
  const medium = topTag(f, 'medium');
  const motion = topTag(f, 'motion');
  const mood = topTag(f, 'mood');

  if (!setting && !medium && !motion && !mood) {
    return `Going on colour alone — that reads ${valence} and ${energy}, which lands on ${lands}.`;
  }

  const opening = [
    setting ? (SETTING_PHRASE[setting] ?? soften(setting)) : 'This one',
    time ? (TIME_PHRASE[time] ?? soften(time)) : '',
  ].filter(Boolean).join(' ');

  const first = medium
    ? `${opening}, ${MEDIUM_PHRASE[medium] ?? soften(medium)}.`
    : `${opening}.`;

  const clause = mood
    ? (MOOD_PHRASE[mood] ?? soften(mood))
    : motion
      ? (MOTION_PHRASE[motion] ?? soften(motion))
      : null;

  const second = clause
    ? `${clause} — that reads ${valence} and ${energy}, which lands on ${lands}.`
    : `That reads ${valence} and ${energy}, which lands on ${lands}.`;

  return `${first} ${second}`;
}

// Short noun phrases for the per-result line: "this one through the film grain".
// The maps above are sentence fragments and don't read right after "through".
const LENS_PHRASE: Record<string, string> = {
  film_35mm: 'the film grain', black_and_white: 'the monochrome', polaroid: 'the instant film',
  long_exposure: 'the long exposure', drone_aerial: 'the height', macro_closeup: 'the close focus',
  flash_snapshot: 'the flash', vintage_70s: 'the faded colour', studio_lit: 'the studio light',
  phone_snapshot: 'the phone camera',
  motion_blur: 'the blur', frozen_action: 'the frozen motion', still_calm: 'the stillness',
  crowded_busy: 'the clutter', empty_sparse: 'the empty space',
  single_portrait: 'the face', group_of_people: 'the group', crowd: 'the crowd',
  animal: 'the animal', architecture_no_people: 'the architecture',
  object_closeup: 'the object', food: 'the food', vehicle: 'the vehicle',
  midday: 'the daylight', golden_glow: 'the golden light', night: 'the dark',
  deep_night: 'the small hours',
  fallback: 'colour alone',
};

/** Names the descriptor a result came from, for "this one through ___". */
export function lensPhrase(tag: string): string {
  return LENS_PHRASE[tag]
    ?? SETTING_PHRASE[tag]?.toLowerCase().replace(/^(a|an|the) /, 'the ')
    ?? MOOD_PHRASE[tag]?.replace(/^It reads as /, 'the ').replace(/^It feels held in /, 'the ')
    ?? soften(tag);
}
