'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';

interface VideoResult {
  id: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  videoUrl: string;
}

export default function Home() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VideoResult | null>(null);
  const [features, setFeatures] = useState<{ b: number; s: number; w: number } | null>(null);
  const [shuffleIndex, setShuffleIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenImageRef = useRef<HTMLImageElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset everything
    setResult(null);
    setFeatures(null);
    setShuffleIndex(0);
    setError(null);

    const url = URL.createObjectURL(file);
    setImageSrc(url);
  };

  // Called when the hidden <img> loads the file
  const extractFeatures = () => {
    const img = hiddenImageRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw downscaled
    ctx.drawImage(img, 0, 0, 64, 64);

    const imageData = ctx.getImageData(0, 0, 64, 64);
    const data = imageData.data;

    let rSum = 0, gSum = 0, bSum = 0;
    let satSum = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const rN = r / 255;
      const gN = g / 255;
      const bN = b / 255;


      // Accumulate raw RGB for Warmth
      rSum += r;
      gSum += g;
      bSum += b;

      // Saturation
      const max = Math.max(rN, gN, bN);
      const min = Math.min(rN, gN, bN);
      const delta = max - min;
      let s = max === 0 ? 0 : delta / max;
      satSum += s;
    }

    const pixelCount = 64 * 64;

    // Averages
    const avgR = rSum / pixelCount;
    const avgG = gSum / pixelCount;
    const avgB = bSum / pixelCount;

    const meanL = 0.2126 * avgR + 0.7152 * avgG + 0.0722 * avgB;
    const b = meanL / 255;

    // Saturation
    const s = satSum / pixelCount;

    // Warmth
    const w = (avgR - avgB) / 255;

    const newFeatures = { b, s, w };
    setFeatures(newFeatures);

  };

  const fetchRecommendation = async (retryShuffleIndex?: number) => {
    if (!features) return;
    setLoading(true);
    setError(null);

    const idx = retryShuffleIndex ?? shuffleIndex;

    try {
      const resp = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brightness: features.b,
          saturation: features.s,
          warmth: features.w,
          shuffleIndex: idx,
        }),
      });

      if (!resp.ok) {
        throw new Error('Failed to fetch recommendation');
      }

      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      setResult(data.track);
    } catch (err) {
      console.error(err);
      setError('Something went wrong. Try again?');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = () => {
    fetchRecommendation();
  };

  const handleTryAnother = () => {
    setShuffleIndex((prev) => {
      const next = prev + 1;
      fetchRecommendation(next);
      return next;
    });
  };

  const handleReset = () => {
    setImageSrc(null);
    setResult(null);
    setFeatures(null);
    setShuffleIndex(0);
    setError(null);
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-4">
      {/* Hidden processing elements */}
      <canvas ref={canvasRef} width={64} height={64} className="hidden" />
      {imageSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={hiddenImageRef}
          src={imageSrc}
          alt="Analysis source"
          className="hidden"
          onLoad={extractFeatures}
          crossOrigin="anonymous"
        />
      )}

      <div className="w-full max-w-md flex flex-col items-center gap-8">
        <h1 className="text-3xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
          ShutterSound
        </h1>

        {/* State 1: Idle (Upload) */}
        {!imageSrc && (
          <div className="w-full aspect-square border-2 border-dashed border-neutral-700 rounded-xl flex items-center justify-center bg-neutral-900/50 hover:bg-neutral-900 hover:border-neutral-500 transition-colors cursor-pointer relative group">
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="text-neutral-500 group-hover:text-neutral-300 text-center">
              <span className="text-4xl block mb-2">📷</span>
              <p>Tap to upload photo</p>
            </div>
          </div>
        )}

        {/* State 2: Image Selected / Preview */}
        {imageSrc && features && !result && !loading && (
          <div className="flex flex-col items-center gap-6 w-full animate-in fade-in zoom-in duration-300">
            <div className="relative w-64 h-64 rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10">
              <Image
                src={imageSrc}
                alt="Preview"
                fill
                className="object-cover"
              />
            </div>

            <div className="text-xs font-mono text-neutral-500 flex gap-4">
              <span>B: {features.b.toFixed(2)}</span>
              <span>S: {features.s.toFixed(2)}</span>
              <span>W: {features.w.toFixed(2)}</span>
            </div>

            <button
              onClick={handleGenerate}
              className="w-full py-4 bg-white text-black font-bold rounded-full hover:bg-neutral-200 transition-transform active:scale-95"
            >
              Generate Recommendation
            </button>

            <button
              onClick={handleReset}
              className="text-sm text-neutral-500 hover:text-white"
            >
              Cancel
            </button>
          </div>
        )}

        {/* State 3: Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-4 animate-pulse">
            <div className="w-64 h-64 bg-neutral-800 rounded-xl" />
            <div className="h-4 w-32 bg-neutral-800 rounded" />
          </div>
        )}

        {/* State 4: Result */}
        {result && !loading && (
          <div className="flex flex-col items-center gap-6 w-full bg-neutral-900/50 p-6 rounded-2xl ring-1 ring-white/10 animate-in slide-in-from-bottom-4 duration-500">

            <div className="relative w-48 h-48 rounded-lg overflow-hidden shadow-lg bg-black">
              {result.thumbnailUrl && (
                <Image
                  src={result.thumbnailUrl}
                  alt={result.title}
                  fill
                  className="object-cover"
                />
              )}
            </div>

            <div className="text-center">
              <h2 className="text-lg font-bold line-clamp-2 leading-tight mb-1">{result.title}</h2>
              <p className="text-neutral-400 text-sm">{result.channelTitle}</p>
            </div>

            <a
              href={result.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3 bg-[#FF0000] text-white font-bold rounded-full text-center hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
            >
              <span>▶</span> Listen on YouTube
            </a>

            <div className="flex gap-3 w-full">
              <button
                onClick={handleTryAnother}
                className="flex-1 py-3 bg-neutral-800 rounded-full font-medium text-sm hover:bg-neutral-700 transition-colors"
              >
                Try Another
              </button>
              <button
                onClick={handleReset}
                className="flex-1 py-3 bg-neutral-800 rounded-full font-medium text-sm hover:bg-neutral-700 transition-colors"
              >
                New Image
              </button>
            </div>

            {/* Keeping the image preview small nearby can be nice context, but specs said "Result State" showing result */}
          </div>
        )}

        {error && (
          <div className="text-red-400 text-center">
            <p className="mb-4">{error}</p>
            <button onClick={handleReset} className="underline text-sm">Start Over</button>
          </div>
        )}
      </div>
    </main>
  );
}
