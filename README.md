# ShutterSound

Upload a photo, get a song that matches it.

## How it works

A photo goes through two readings, and they meet in the recommender.

**The numbers.** The image is drawn to a 64×64 canvas and reduced to seven values:
brightness, saturation, warmth, contrast, colourfulness, dominant hue, and edge density.
Together they describe how the photo *feels* before you know what's in it — bright and busy,
or dim and still.

**The meaning.** A CLIP model runs in your browser and answers four questions independently:
where is this, what is the light doing, what's the weather, what's the mood. Separating them
matters — a beach at sunset and a beach at midnight are the same place and very different
songs. The model downloads once (~85MB) and is cached by your browser. If it can't load, the
app falls back to the numbers alone rather than failing.

**The match.** Both readings score against a genre table, where each genre declares the
conditions it responds to. The top few genres become search queries — several of them, since
Spotify caps results at ten per query — and the returned tracks are deduplicated, limited to
one per artist, and ranked. You get the whole pool at once, so shuffling costs nothing.

## Why not Spotify's own recommender

Spotify removed `/v1/recommendations`, `/v1/audio-features`, and `/v1/audio-analysis` in
November 2024 for newly registered apps, with no replacement. ShutterSound is built on
`/v1/search` instead, which is why the genre table above has to do the work an audio-features
API would otherwise do.

## Setup

1. Create an app at the Spotify Developer Dashboard and copy the client ID and secret.
2. `cp .env.example .env.local` and fill in `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`.
   `SPOTIFY_MARKET` defaults to `US`.
3. `npm install && npm run dev`

No user login is needed — ShutterSound uses Client Credentials, and the secret stays on the
server.

## Tuning it

The label banks in `lib/vision.ts` and the genre table in `lib/recommend.ts` are plain data.
Editing them changes the recommendations with no retraining.

One catch when adding a genre: the queries include a `genre:"…"` filter, and Spotify silently
returns nothing for a genre string it doesn't recognise. `lo-fi hip hop` returns zero results
where `chillhop` works. Check a new genre against the API before relying on it.

After changing the table, run `npm run eval` — it prints the genres and queries each of its four
test photos produces, which is the fastest way to see what your edit actually did.

## Evals

`npm run eval` runs offline with no API key. It pushes four contrasting synthetic inputs
through the recommender and checks that they produce genuinely different genres — the failure
this project started with was every photo returning the same four hip-hop variants.
