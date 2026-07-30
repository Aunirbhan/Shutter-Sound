import assert from 'node:assert';
import { assess, buildQueries, explain, fallbackQuery, lensPhrase, queryOffsets, rankTracks, toneWords } from '../lib/recommend.ts';
import { MAX_SEARCH_LIMIT, echoesQuery, keepTrack } from '../lib/spotify.ts';
import { BANKS, GENRE_FILTER_SAFE } from '../lib/taxonomy.ts';
import type { BankResult, Features, SpotifyTrack } from '../lib/types.ts';

const hit = (id: string, score: number) => ({ id, score });

const bank = (...tags: { id: string; score: number }[]): BankResult => ({
  tags,
  top: tags[0].score,
  margin: tags[0].score - (tags[1]?.score ?? 0),
});

const FIXTURES: { name: string; features: Features }[] = [
  // The three water fixtures are the whole point — they used to collapse onto the same
  // ambient list. Same wet setting, but they must diverge on light, medium and motion.
  {
    name: 'lake at dusk, on film',
    features: {
      color: { brightness: 0.30, saturation: 0.22, warmth: -0.02, contrast: 0.25,
        colorfulness: 0.20, dominantHue: 210, edgeDensity: 0.15 },
      semantic: {
        setting: bank(hit('lake_river', 0.55), hit('forest', 0.21)),
        time: bank(hit('golden_glow', 0.35)),
        weather: bank(hit('cloudy_overcast', 0.30)),
        medium: bank(hit('film_35mm', 0.44)),
        motion: bank(hit('still_calm', 0.50)),
      },
    },
  },
  {
    name: 'river at midday, from a drone',
    features: {
      color: { brightness: 0.62, saturation: 0.45, warmth: 0.05, contrast: 0.40,
        colorfulness: 0.40, dominantHue: 150, edgeDensity: 0.35 },
      semantic: {
        setting: bank(hit('lake_river', 0.50), hit('mountain_alpine', 0.24)),
        time: bank(hit('midday', 0.55)),
        weather: bank(hit('sunny_clear', 0.50)),
        medium: bank(hit('drone_aerial', 0.50)),
      },
    },
  },
  {
    name: 'open ocean, overcast',
    features: {
      color: { brightness: 0.45, saturation: 0.12, warmth: -0.08, contrast: 0.20,
        colorfulness: 0.10, dominantHue: 210, edgeDensity: 0.14 },
      semantic: {
        setting: bank(hit('ocean_open_deep', 0.60)),
        weather: bank(hit('cloudy_overcast', 0.45)),
        medium: bank(hit('long_exposure', 0.35)),
        motion: bank(hit('empty_sparse', 0.40)),
      },
    },
  },
  {
    name: 'club at night, on flash',
    features: {
      color: { brightness: 0.20, saturation: 0.66, warmth: 0.10, contrast: 0.58,
        colorfulness: 0.52, dominantHue: 300, edgeDensity: 0.60 },
      semantic: {
        setting: bank(hit('interior_club_bar', 0.60)),
        time: bank(hit('night', 0.50)),
        subject: bank(hit('crowd', 0.50)),
        action: bank(hit('dancing_party', 0.55)),
        medium: bank(hit('flash_snapshot', 0.45)),
        motion: bank(hit('motion_blur', 0.40)),
      },
    },
  },
  {
    name: 'portrait in a meadow, golden hour',
    features: {
      color: { brightness: 0.66, saturation: 0.42, warmth: 0.22, contrast: 0.30,
        colorfulness: 0.38, dominantHue: 45, edgeDensity: 0.22 },
      semantic: {
        setting: bank(hit('field_meadow', 0.40)),
        time: bank(hit('golden_glow', 0.50)),
        subject: bank(hit('single_portrait', 0.55)),
        medium: bank(hit('film_35mm', 0.40)),
      },
    },
  },
  {
    name: 'snowy landscape, no model output',
    features: {
      color: { brightness: 0.78, saturation: 0.08, warmth: -0.05, contrast: 0.22,
        colorfulness: 0.08, dominantHue: 210, edgeDensity: 0.12 },
      semantic: null,
    },
  },
];

const byName = (n: string) => FIXTURES.find((f) => f.name === n)!.features;
const WATER = FIXTURES.slice(0, 3);

let failures = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  pass  ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${(err as Error).message}`);
  }
}

const genresFor = (f: Features) => assess(f).genres.map((g) => g.genre);

console.log('\nVerdict per fixture\n');
for (const { name, features } of FIXTURES) {
  const v = assess(features);
  console.log(`  ${name}`);
  console.log(`    v=${v.v.toFixed(2)} e=${v.e.toFixed(2)} tone=${v.tone.join('/')}${v.era ? ` era=${v.era[0]}-${v.era[1]}` : ''}`);
  console.log(`    genres: ${v.genres.map((g) => `${g.genre} (${g.score.toFixed(2)}, ${g.from})`).join(', ')}`);
  console.log(`    queries: ${buildQueries(v).map((q) => `[${q.lens}] ${q.query}`).join(' | ')}`);
  console.log(`    lenses:  ${v.genres.map((g) => `${g.from}/${g.tag} -> ${g.genre}`).join(' | ')}`);
  console.log(`    why: ${explain(features, v)}\n`);
}

console.log('Assertions\n');

// The regression guard for `400 Invalid limit`. This app's quota tier caps search at 10
// despite the docs saying 50, and raising it broke every single search.
check('search limit never exceeds the measured ceiling', () => {
  assert.strictEqual(MAX_SEARCH_LIMIT, 10, `MAX_SEARCH_LIMIT is ${MAX_SEARCH_LIMIT}, Spotify 400s above 10`);
});

check('every fixture yields 5 lenses with distinct genres', () => {
  for (const { name, features } of FIXTURES) {
    const genres = assess(features).genres;
    assert.ok(genres.length >= 4 && genres.length <= 5, `${name} produced ${genres.length}`);
    assert.strictEqual(
      new Set(genres.map((g) => g.genre)).size, genres.length, `${name} has duplicate genres`,
    );
  }
});

check('each lens is anchored to a tag that actually fired in its bank', () => {
  for (const { name, features } of FIXTURES) {
    const semantic = features.semantic;
    if (!semantic) continue;
    for (const lens of assess(features).genres) {
      const fired = semantic[lens.from]?.tags.map((t) => t.id) ?? [];
      assert.ok(
        fired.includes(lens.tag),
        `${name}: lens ${lens.from} claims tag "${lens.tag}" but ${lens.from} fired [${fired.join(', ')}]`,
      );
    }
  }
});

check('the strongest bank picks first', () => {
  const club = assess(byName('club at night, on flash'));
  assert.strictEqual(club.genres[0].from, 'setting', `first lens came from ${club.genres[0].from}`);
});

check('lenses spread across banks', () => {
  for (const { name, features } of FIXTURES) {
    if (!features.semantic) continue;
    const banksFired = Object.keys(features.semantic).length;
    if (banksFired < 3) continue;
    const origins = new Set(assess(features).genres.map((g) => g.from));
    assert.ok(origins.size >= 3, `${name} drew lenses from only ${[...origins].join(', ')}`);
  }
});

check('a boosted bank actually changes its lens genre', () => {
  // The point of lenses: the medium lens should not just echo the setting lens.
  const f = byName('lake at dusk, on film');
  const lenses = assess(f).genres;
  const setting = lenses.find((l) => l.from === 'setting');
  const medium = lenses.find((l) => l.from === 'medium');
  assert.ok(setting && medium, 'expected both a setting and a medium lens');
  assert.notStrictEqual(setting!.genre, medium!.genre, 'setting and medium lenses agreed');
});

check('lensPhrase never leaks a raw tag id', () => {
  for (const bank of BANKS) {
    for (const tag of bank.tags) {
      const phrase = lensPhrase(tag.id);
      assert.ok(phrase.length > 0, `${tag.id} produced nothing`);
      assert.ok(!phrase.includes('_'), `${tag.id} produced "${phrase}"`);
    }
  }
});

check('bulk input stays bounded', () => {
  // Mirrors what the route caps, but proves the scorer itself doesn't fall over.
  const base = byName('open ocean, overcast');
  const flood = Array.from({ length: 4000 }, () => hit('ocean_open_deep', 0.6));
  const started = Date.now();
  const v = assess({
    color: base.color,
    semantic: { ...base.semantic, setting: { tags: flood, top: 0.6, margin: 0 } },
  });
  assert.ok(v.genres.length >= 4, `produced ${v.genres.length} lenses`);
  assert.ok(Date.now() - started < 3000, 'took over 3s');
});

// The original bug was every body of water reading as the same scene. With lenses the
// meaningful test is per-descriptor, not a percentage: two photos are allowed to agree
// where they genuinely share a descriptor (both overcast -> both post-punk), but a
// different setting must never produce the same setting genre.
check('water fixtures read their settings differently', () => {
  for (let i = 0; i < WATER.length; i++) {
    for (let j = i + 1; j < WATER.length; j++) {
      const a = assess(WATER[i].features).genres;
      const b = assess(WATER[j].features).genres;
      const sa = a.find((l) => l.from === 'setting');
      const sb = b.find((l) => l.from === 'setting');
      if (!sa || !sb || sa.tag === sb.tag) continue;
      assert.notStrictEqual(
        sa.genre, sb.genre,
        `${WATER[i].name} (${sa.tag}) and ${WATER[j].name} (${sb.tag}) both read as ${sa.genre}`,
      );
    }
  }
});

check('water fixtures differ on a majority of lenses', () => {
  for (let i = 0; i < WATER.length; i++) {
    for (let j = i + 1; j < WATER.length; j++) {
      const a = genresFor(WATER[i].features);
      const b = new Set(genresFor(WATER[j].features));
      const shared = a.filter((g) => b.has(g));
      assert.ok(
        shared.length * 2 < a.length,
        `${WATER[i].name} vs ${WATER[j].name}: ${shared.length}/${a.length} shared (${shared.join(', ')})`,
      );
    }
  }
});

// Weaker than the water rule on purpose. Two photos sharing a medium and a light
// should share some genres — that's the system working. What's not allowed is two
// photos collapsing onto the same list, or overlap being the norm.
check('no two fixtures produce the same genre set, and overlap is the exception', () => {
  const overlaps: number[] = [];

  for (let i = 0; i < FIXTURES.length; i++) {
    for (let j = i + 1; j < FIXTURES.length; j++) {
      const a = genresFor(FIXTURES[i].features);
      const b = new Set(genresFor(FIXTURES[j].features));
      const shared = a.filter((g) => b.has(g));
      const overlap = shared.length / a.length;
      overlaps.push(overlap);

      assert.ok(
        overlap < 1,
        `${FIXTURES[i].name} and ${FIXTURES[j].name} are identical: ${shared.join(', ')}`,
      );
    }
  }

  const mean = overlaps.reduce((x, y) => x + y, 0) / overlaps.length;
  assert.ok(mean < 0.35, `mean pairwise overlap is ${(mean * 100).toFixed(0)}%`);
});

check('no bank supplies more than 2 lenses', () => {
  for (const { name, features } of FIXTURES) {
    if (!features.semantic || Object.keys(features.semantic).length < 3) continue;
    const counts = new Map<string, number>();
    for (const g of assess(features).genres) counts.set(g.from, (counts.get(g.from) ?? 0) + 1);
    for (const [origin, n] of counts) {
      assert.ok(n <= 2, `${name}: ${origin} supplied ${n} lenses`);
    }
  }
});

check('action bank is ignored when no person was seen', () => {
  // Same photo, but one payload smuggles in an action with no subject to back it.
  const base = byName('open ocean, overcast');
  const spoofed: Features = {
    color: base.color,
    semantic: { ...base.semantic, action: bank(hit('sports_exercise', 0.9)) },
  };
  assert.deepStrictEqual(
    assess(spoofed).genres,
    assess(base).genres,
    'an unsubstantiated action tag changed the outcome',
  );
  assert.strictEqual(assess(spoofed).e, assess(base).e, 'energy moved without a person present');
});

check('action bank does count when a person was seen', () => {
  const club = assess(byName('club at night, on flash'));
  assert.ok(club.e > 0.6, `expected high energy from dancing crowd, got ${club.e.toFixed(2)}`);
});

check('deep night only applies over a near-black frame', () => {
  const club = byName('club at night, on flash');
  const dark: Features = { ...club, color: { ...club.color, brightness: 0.05 } };
  assert.ok(
    assess(dark).v < assess(club).v,
    'near-black frame should pull valence down via deep night',
  );
});

check('fallback fires when the model returned nothing', () => {
  const v = assess(byName('snowy landscape, no model output'));
  assert.ok(v.genres.length >= 4, 'fallback produced no genres');
  assert.ok(v.genres.some((g) => g.genre === 'ambient'), 'fallback should include ambient');
});

check('scoring is deterministic across runs', () => {
  for (const { name, features } of FIXTURES) {
    assert.deepStrictEqual(assess(features), assess(features), name);
    assert.deepStrictEqual(buildQueries(assess(features)), buildQueries(assess(features)), name);
  }
});

check('every fixture produces at least 4 unique queries', () => {
  for (const { name, features } of FIXTURES) {
    const queries = buildQueries(assess(features));
    assert.ok(queries.length >= 4, `${name} produced ${queries.length}`);
    assert.strictEqual(
      new Set(queries.map((q) => q.query)).size, queries.length, `${name} has duplicate queries`,
    );
  }
});

check('no query uses genre:, which Spotify ignores for tracks', () => {
  for (const { name, features } of FIXTURES) {
    for (const q of buildQueries(assess(features))) {
      assert.ok(!q.query.includes('genre:'), `${name}: "${q.query}" uses a genre: filter`);
    }
  }
});

check('one query per lens, each carrying its own genre', () => {
  for (const { name, features } of FIXTURES) {
    const v = assess(features);
    const queries = buildQueries(v);
    assert.strictEqual(queries.length, v.genres.length, `${name}: ${queries.length} queries for ${v.genres.length} lenses`);
    queries.forEach((q) => {
      assert.ok(
        q.query.includes(v.genres[q.lens].genre),
        `${name}: query "${q.query}" is tagged lens ${q.lens} (${v.genres[q.lens].genre})`,
      );
    });
    assert.deepStrictEqual(queries.map((q) => q.lens), queries.map((_, i) => i), `${name}: lens indices not sequential`);
  }
});

// Measured against the live API: "dream pop" returns 10 results, "moody dream pop
// year:1975-2005" returns 0. With one query per lens, a dead query costs a whole result.
check('queries carry no year: filter', () => {
  const v = assess(byName('lake at dusk, on film'));
  assert.ok(v.era, 'film_35mm should still supply an era for display');
  for (const q of buildQueries(v)) {
    assert.ok(!q.query.includes('year:'), `"${q.query}" carries a year filter`);
  }
});

check('every lens has a fallback, using genre: only where Spotify knows the string', () => {
  for (const { name, features } of FIXTURES) {
    const v = assess(features);
    v.genres.forEach((g, i) => {
      const q = fallbackQuery(v, i);
      assert.ok(q, `${name}: lens ${i} has no fallback`);
      if (GENRE_FILTER_SAFE.has(g.genre.toLowerCase())) {
        assert.strictEqual(q, `genre:"${g.genre}"`, `${name}: "${g.genre}" is allowlisted but fell back to "${q}"`);
      } else {
        assert.ok(!q!.includes('genre:'), `${name}: "${g.genre}" is not allowlisted but fell back to "${q}"`);
        assert.ok(g.genre.endsWith(q!), `${name}: fallback "${q}" is not derived from "${g.genre}"`);
      }
    });
  }
});

// Search is lexical, so every genre query drags in tracks that merely contain the word.
check('echo filter drops the word-match, keeps the real thing', () => {
  const t = (name: string) =>
    ({ name, album: '' } as SpotifyTrack);

  // Multi-word genres are distinctive — only an exact title match is filler.
  assert.ok(echoesQuery(t('Indie Folk'), 'indie folk'));
  assert.ok(echoesQuery(t('Post-Punk'), 'post-punk'));
  assert.ok(!echoesQuery(t('Ophelia'), 'indie folk'));
  assert.ok(!echoesQuery(t('Evil'), 'post-punk'));

  // Single common nouns match hundreds of unrelated titles, so leading with one is enough.
  assert.ok(echoesQuery(t('House Of The Rising Sun'), 'house'));
  assert.ok(echoesQuery(t('Ambiente'), 'ambient'));
  assert.ok(!echoesQuery(t('Ambien Slide'), 'ambient'));
  assert.ok(!echoesQuery(t('No Broke Boys'), 'disco'));

  // Short genres would match far too much.
  assert.ok(!echoesQuery(t('Popcorn'), 'pop'));
});

check('tone words bucket the axes', () => {
  assert.deepStrictEqual(toneWords(-0.8, 0.1), ['dark', 'slow']);
  assert.deepStrictEqual(toneWords(0.0, 0.4), ['moody', 'mellow']);
  assert.deepStrictEqual(toneWords(0.4, 0.6), ['warm', 'driving']);
  assert.deepStrictEqual(toneWords(0.9, 0.9), ['euphoric', 'high energy']);
});

check('explain writes a complete sentence for every fixture', () => {
  for (const { name, features } of FIXTURES) {
    const text = explain(features, assess(features));
    assert.ok(text.length > 20, `${name}: "${text}" is too short`);
    assert.ok(text.endsWith('.'), `${name}: "${text}" does not end in a full stop`);
    assert.ok(!text.includes('_'), `${name}: "${text}" leaked a raw tag id`);
    assert.ok(!/undefined|NaN/.test(text), `${name}: "${text}" leaked a bad value`);
  }
});

// --- track filtering and ranking ---------------------------------------------

const track = (
  id: string,
  name: string,
  artist: string,
  extra: Partial<SpotifyTrack> = {},
): SpotifyTrack => ({
  id,
  name,
  artists: [artist],
  album: name,
  albumArt: '',
  spotifyUrl: '',
  uri: `spotify:track:${id}`,
  popularity: 55,
  durationMs: 210_000,
  ...extra,
});

check('functional audio is rejected, real music is not', () => {
  const slop = [
    track('a', 'Gentle Rain Sounds for Deep Sleep (8 Hours)', 'Sleep Machine'),
    track('b', 'White Noise for Studying', 'Focus Labs'),
    track('c', 'Ocean Waves ASMR', 'Calm Nature'),
    track('d', 'Binaural Delta Waves', 'Deep Rest'),
    track('e', 'Relaxing Calm Ambience', 'Zen Tones'),
  ];
  for (const t of slop) assert.ok(!keepTrack(t), `kept slop: ${t.name}`);

  const music = [
    track('f', 'Purple Rain', 'Prince', { popularity: 82 }),
    track('g', 'Set the Controls for the Heart of the Sun', 'Pink Floyd', { popularity: 60, durationMs: 320_000 }),
    track('h', 'An Ending (Ascent)', 'Brian Eno', { popularity: 58, durationMs: 264_000 }),
    track('i', 'Thunder Road', 'Bruce Springsteen', { popularity: 71, durationMs: 289_000 }),
  ];
  for (const t of music) assert.ok(keepTrack(t), `dropped real music: ${t.name}`);
});

check('duration and popularity bounds hold', () => {
  assert.ok(!keepTrack(track('x', 'Interlude', 'Someone', { durationMs: 40_000 })));
  assert.ok(!keepTrack(track('y', 'Long Drone', 'Someone', { durationMs: 45 * 60_000 })));
  assert.ok(!keepTrack(track('z', 'Obscure', 'Someone', { popularity: 3 })));
});

check('rankTracks dedupes reissues and caps one track per artist', () => {
  const lanes = [[
    track('1', 'Midnight', 'Aurora'),
    track('2', 'Midnight', 'Aurora'),
    track('3', 'Daylight', 'Aurora'),
    track('4', 'Other', 'Beacon'),
    track('4', 'Other', 'Beacon'),
  ]];
  const ranked = rankTracks(lanes, FIXTURES[0].features);
  assert.strictEqual(ranked.length, 2, `expected 2 tracks, got ${ranked.length}`);
  assert.strictEqual(new Set(ranked.map((r) => r.track.artists[0])).size, 2);
});

check('every lens gets at most one result, and results span the lenses', () => {
  // One fat lane, four thin — the old pool-and-shuffle let the fat one win.
  const fat = Array.from({ length: 20 }, (_, i) => track(`fat${i}`, `Fat ${i}`, `FatArtist ${i}`));
  const thin = (p: string) => Array.from({ length: 3 }, (_, i) => track(`${p}${i}`, `${p} ${i}`, `${p}Artist ${i}`));
  const ranked = rankTracks([fat, thin('a'), thin('b'), thin('c'), thin('d')], FIXTURES[1].features);

  assert.ok(ranked.length <= 5, `expected at most 5, got ${ranked.length}`);
  const perLens = new Map<number, number>();
  for (const r of ranked) perLens.set(r.lens, (perLens.get(r.lens) ?? 0) + 1);
  for (const [lens, n] of perLens) assert.ok(n <= 1, `lens ${lens} supplied ${n} results`);
  assert.ok(perLens.size >= 3, `results spanned only ${perLens.size} lenses`);
});

check('an empty lane is covered by the others', () => {
  const full = (p: string) => Array.from({ length: 4 }, (_, i) => track(`${p}${i}`, `${p} ${i}`, `${p}Artist ${i}`));
  const ranked = rankTracks([full('a'), [], full('c'), [], full('e')], FIXTURES[0].features);
  assert.strictEqual(ranked.length, 5, `two dead lanes left only ${ranked.length} results`);
});

check('rankTracks ordering is stable for the same photo', () => {
  const lanes = [Array.from({ length: 12 }, (_, i) => track(`id${i}`, `Song ${i}`, `Artist ${i}`))];
  const a = rankTracks(lanes, FIXTURES[1].features).map((r) => r.track.id);
  const b = rankTracks(lanes, FIXTURES[1].features).map((r) => r.track.id);
  assert.deepStrictEqual(a, b);
});

check('rankTracks ordering differs between different photos', () => {
  const lanes = [Array.from({ length: 12 }, (_, i) => track(`id${i}`, `Song ${i}`, `Artist ${i}`))];
  const a = rankTracks(lanes, FIXTURES[0].features).map((r) => r.track.id);
  const b = rankTracks(lanes, FIXTURES[2].features).map((r) => r.track.id);
  assert.notDeepStrictEqual(a, b);
});

check('query offsets are seeded per photo, not constant', () => {
  const a = queryOffsets(FIXTURES[0].features.color, 6);
  const b = queryOffsets(FIXTURES[0].features.color, 6);
  const c = queryOffsets(FIXTURES[3].features.color, 6);
  assert.deepStrictEqual(a, b, 'same photo gave different offsets');
  assert.notDeepStrictEqual(a, c, 'different photos gave identical offsets');
  assert.ok(a.every((n) => n >= 0 && n < 20), `offset out of range: ${a.join(', ')}`);
});

console.log(failures ? `\n${failures} check(s) failed.\n` : '\nAll checks passed.\n');
process.exit(failures ? 1 : 0);
