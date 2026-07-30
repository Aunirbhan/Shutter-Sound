// Type-only module so the eval runner can import feature shapes without pulling in browser code.

import type { BankId } from './taxonomy.ts';

export interface ColorFeatures {
  brightness: number;    // 0..1, mean per-pixel luma
  saturation: number;    // 0..1
  warmth: number;        // -1..1, red minus blue
  contrast: number;      // 0..1, stddev of luma
  colorfulness: number;  // 0..1, Hasler-Susstrunk
  dominantHue: number;   // 0..360 degrees
  edgeDensity: number;   // 0..1, mean gradient magnitude
}

export interface TagHit {
  /** Tag id from lib/taxonomy.ts, not a display string. */
  id: string;
  /** SigLIP sigmoid probability. Independent per label, so comparable within a bank. */
  score: number;
}

export interface BankResult {
  tags: TagHit[];
  /** Top-1 score and its lead over top-2 — the gates, since raw scores lie across banks. */
  top: number;
  margin: number;
}

/** Sparse by design: a bank that fired nothing is simply absent. */
export type SemanticFeatures = Partial<Record<BankId, BankResult>>;

export interface Features {
  color: ColorFeatures;
  semantic: SemanticFeatures | null;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: string[];
  album: string;
  albumArt: string;
  spotifyUrl: string;
  uri: string;
  /** Absent from search results on this app's quota tier — null means unknown, which is
   *  not the same as unpopular. */
  popularity: number | null;
  durationMs: number;
}

/** One reading of the photo, as seen through a single descriptor. Boosting one bank and
 *  re-running the genre union is what makes five results differ from each other. */
export interface Lens {
  genre: string;
  score: number;
  /** Which bank this reading came from. */
  from: BankId;
  /** The tag anchoring it, e.g. 'film_35mm'. What the UI names. */
  tag: string;
}

/** What the recommender decided, carried to the UI so it can explain itself. */
export interface Verdict {
  v: number;
  e: number;
  genres: Lens[];
  tone: string[];
  era: [number, number] | null;
}

/** A query plus which lens asked for it, so results stay attributable. */
export interface LensQuery {
  query: string;
  lens: number;
}

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'MISSING_CREDENTIALS'
  | 'SPOTIFY_AUTH_FAILED'
  | 'BAD_QUERY'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'NO_RESULTS';
