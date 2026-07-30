'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { SIZE, classifyImage, extractColorFeatures, onVisionStatus } from '@/lib/vision';
import type { VisionStatus } from '@/lib/vision';
import { lensPhrase } from '@/lib/recommend';
import type { ColorFeatures, Lens, SemanticFeatures, SpotifyTrack } from '@/lib/types';

type Result = SpotifyTrack & { lens: Lens };

interface Debug {
  queries: string[];
  genres: Lens[];
  tone: string[];
  valence: number;
  energy: number;
  era: [number, number] | null;
  semantic: Record<string, { tags: { id: string; score: number }[]; top: number; margin: number }>;
  pool: number;
}

const CHIP = 'rounded-full border border-rule px-3 py-1 text-xs text-muted';
const BUTTON = 'rounded-full px-5 py-3 text-sm font-medium transition-colors';
const NAV = 'rounded-full border border-rule px-4 py-2 text-sm transition-colors enabled:hover:bg-rule disabled:opacity-35';

// Fixed order so chips don't reshuffle between photos.
const CHIP_BANKS = ['setting', 'time', 'weather', 'subject', 'action', 'motion', 'medium', 'mood', 'region'];

const soften = (id: string) => id.replace(/_/g, ' ');

function statusLabel(s: VisionStatus): string {
  switch (s.phase) {
    case 'idle': return 'Pick a photo to start';
    case 'downloading': return `Downloading vision model ${s.pct}%`;
    case 'preparing': return 'Preparing…';
    case 'ready': return '✓ Vision model ready';
    case 'failed': return 'Vision model unavailable — using colour only';
  }
}

export default function Home() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [color, setColor] = useState<ColorFeatures | null>(null);
  const [tracks, setTracks] = useState<Result[]>([]);
  const [why, setWhy] = useState('');
  const [debug, setDebug] = useState<Debug | null>(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vision, setVision] = useState<VisionStatus>({ phase: 'idle' });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const semanticRef = useRef<Promise<SemanticFeatures | null> | null>(null);

  // Subscribe only. This must not kick off the ~110MB download — that waits for a photo.
  useEffect(() => onVisionStatus(setVision), []);

  const reset = () => {
    setImageSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setColor(null);
    setTracks([]);
    setWhy('');
    setDebug(null);
    setIndex(0);
    setError(null);
    semanticRef.current = null;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    setImageSrc(URL.createObjectURL(file));
  };

  const handleImageLoad = () => {
    const img = imageRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    canvas.getContext('2d')?.drawImage(img, 0, 0, SIZE, SIZE);
    setColor(extractColorFeatures(canvas));
    // This is what starts the model download, a beat after the photo is picked.
    semanticRef.current = classifyImage(img.src);
  };

  const handleGenerate = async () => {
    if (!color) return;
    setLoading(true);
    setError(null);

    try {
      const semantic = await (semanticRef.current ?? Promise.resolve(null));
      const resp = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color, semantic }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        setError(`${data.error} (${data.code})`);
        return;
      }

      setTracks(data.tracks);
      setWhy(data.why ?? '');
      setDebug(data.debug);
      setIndex(0);
    } catch {
      setError('Could not reach the recommender.');
    } finally {
      setLoading(false);
    }
  };

  const total = tracks.length;
  const track = tracks[index];

  const step = useCallback(
    (delta: number) => setIndex((i) => Math.min(total - 1, Math.max(0, i + delta))),
    [total],
  );

  // Keyed on tracks, not index — otherwise paging through yanks the viewport every click.
  useEffect(() => {
    if (!total) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    resultsRef.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  }, [tracks, total]);

  useEffect(() => {
    if (!total) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total, step]);

  const bankChips = debug
    ? CHIP_BANKS
        .map((bank) => debug.semantic[bank]?.tags[0]?.id)
        .filter((id): id is string => Boolean(id))
    : [];

  const canGenerate = vision.phase === 'ready' || vision.phase === 'failed';

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-16">
      <canvas ref={canvasRef} width={SIZE} height={SIZE} className="hidden" />
      {imageSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={imageRef} src={imageSrc} alt="" className="hidden" onLoad={handleImageLoad} />
      )}

      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">ShutterSound</h1>
        <p className="text-base text-muted">Upload a photo, get a song that matches it.</p>
      </header>

      {/* Frame is permanent — dashed when empty, filled once there's a photo, and it
          stays put when results land so the photo never vanishes. */}
      <div className="mx-auto w-full max-w-xl">
        <div
          className={`relative aspect-square overflow-hidden rounded-2xl border-2 transition-colors ${
            imageSrc ? 'border-solid border-rule' : 'border-dashed border-rule hover:border-muted'
          }`}
        >
          {imageSrc ? (
            <Image src={imageSrc} alt="Uploaded photo" fill className="object-cover" unoptimized />
          ) : (
            <>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
                <p className="text-sm text-muted">Upload a photo</p>
                <p className="text-xs text-muted/70">Nothing downloads until you do</p>
              </div>
            </>
          )}
        </div>
      </div>

      {imageSrc && color && !total && !loading && (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-4 gap-y-3 font-mono text-xs text-muted">
            <Stat label="bright" value={color.brightness} />
            <Stat label="sat" value={color.saturation} />
            <Stat label="warm" value={color.warmth} />
            <Stat label="contrast" value={color.contrast} />
            <Stat label="colorful" value={color.colorfulness} />
            <Stat label="hue" value={color.dominantHue} digits={0} />
            <Stat label="edges" value={color.edgeDensity} />
          </dl>

          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className={`${BUTTON} bg-fg text-bg enabled:hover:opacity-85 disabled:opacity-40`}
          >
            {canGenerate ? 'Find a song' : statusLabel(vision)}
          </button>

          <div className="flex items-center justify-between text-xs text-muted">
            <button onClick={reset} className="underline underline-offset-4">
              Choose another photo
            </button>
            <span>{statusLabel(vision)}</span>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex animate-pulse flex-col gap-4">
          <div className="h-[152px] w-full rounded-xl bg-rule" />
          <div className="flex gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="size-14 rounded-lg bg-rule" />
            ))}
          </div>
          <div className="h-4 w-2/3 rounded bg-rule" />
          <div className="h-4 w-1/2 rounded bg-rule" />
        </div>
      )}

      {track && !loading && (
        <div ref={resultsRef} className="flex scroll-mt-6 flex-col gap-6">
          {/* 152 = Spotify's card layout, which already shows art, title and artist —
              so there's no separate header. The album-colour background is inside a
              cross-origin iframe, so overflow-hidden here is the only way to round it. */}
          <div className="overflow-hidden rounded-xl border border-rule">
            <iframe
              key={track.id}
              src={`https://open.spotify.com/embed/track/${track.id}?utm_source=generator`}
              title={track.name}
              width="100%"
              height="152"
              loading="lazy"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              className="block"
            />
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => step(-1)} disabled={index === 0} className={NAV}>
              ‹ Prev
            </button>
            <button onClick={() => step(1)} disabled={index >= total - 1} className={NAV}>
              Next ›
            </button>
            <span className="ml-auto font-mono text-xs text-muted">
              {index + 1} / {total}
            </span>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {tracks.map((t, i) => (
              <button
                key={t.id}
                onClick={() => setIndex(i)}
                title={`${t.name} — ${t.artists.join(', ')}`}
                className={`relative size-14 shrink-0 overflow-hidden rounded-lg border transition-opacity ${
                  i === index ? 'border-fg opacity-100' : 'border-rule opacity-55 hover:opacity-85'
                }`}
              >
                {t.albumArt ? (
                  <Image src={t.albumArt} alt="" fill sizes="56px" className="object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-xs text-muted">
                    {i + 1}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-4">
            <p className="text-xs uppercase tracking-wide text-muted">Why this song</p>
            {why && <p className="text-base leading-relaxed">{why}</p>}
            {track.lens && (
              <p className="text-sm text-muted">
                → This one through {lensPhrase(track.lens.tag)}:{' '}
                <span className="text-fg">{track.lens.genre}</span>
              </p>
            )}
            {debug && (
              <div className="flex flex-wrap gap-2">
                {bankChips.map((id) => (
                  <span key={id} className={CHIP}>{soften(id)}</span>
                ))}
                {debug.genres.map((g) => (
                  <span key={g.genre} className={`${CHIP} border-fg/25 text-fg`}>{g.genre}</span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-rule pt-6">
            <button onClick={reset} className={`${BUTTON} border border-rule hover:bg-rule`}>
              New photo
            </button>
            <a
              href={track.spotifyUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-xs text-muted underline underline-offset-4"
            >
              Open in Spotify
            </a>
          </div>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-rule p-4">
          <p className="text-sm">{error}</p>
          <button onClick={reset} className="text-xs underline underline-offset-4 text-muted">
            Start over
          </button>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, digits = 2 }: { label: string; value: number; digits?: number }) {
  return (
    <div className="flex flex-col gap-1">
      <dt>{label}</dt>
      <dd className="text-fg">{value.toFixed(digits)}</dd>
    </div>
  );
}
