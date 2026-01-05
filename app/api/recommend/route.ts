import { NextResponse } from 'next/server';
import { searchYouTube } from '@/lib/youtube';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { brightness, saturation, warmth, shuffleIndex = 0 } = body;

        // 1. Construct Query based on features
        const terms: string[] = [];

        // Genre selection based on Saturation and Warmth quadrants
        if (warmth > 0.1) {
            // Warm tones
            if (saturation > 0.4) {
                // High Saturation + Warm = High Energy / Tropical
                terms.push('reggaeton', 'afrobeats', 'summer hip hop');
            } else {
                // Low Saturation + Warm = Smooth / Soulful
                terms.push('neo soul', 'r&b', 'old school hip hop', 'conscious rap');
            }
        } else {
            // Cool tones
            if (saturation > 0.4) {
                // High Saturation + Cool = Sharp / Modern / Electronic influence
                terms.push('modern trap', 'melodic rap', 'rage rap');
            }
                // Low Saturation + Cool = Dark / Moody
                terms.push('dark r&b', 'drill', 'cloud rap', 'atmospheric hip hop');
        }

        // Add vibe modifiers based on Brightness
        if (brightness > 0.7) terms.push('upbeat', 'mainstream');
        else if (brightness < 0.3) terms.push('underground', 'moody', 'night');

        const baseQuery = terms.join(' ') + ' "official music video"';

        console.log(`Generated Query: "${baseQuery}" for features (b=${brightness.toFixed(2)}, s=${saturation.toFixed(2)}, w=${warmth.toFixed(2)})`);

        // 2. Call YouTube API
        let videos = await searchYouTube(baseQuery);

        // 3. Filter out non-official content
        const blacklist = [
            'type beat', 'instrumental', 'remix', 'mix', 'compilation',
            'loop kit', 'sample pack', 'free for profit', 'drum kit',
            'preset', 'tutorial', 'reaction', 'review', '1 hour', '10 hours'
        ];

        videos = videos.filter(v => {
            const t = v.title.toLowerCase();
            const isBlacklisted = blacklist.some(term => t.includes(term));

            return !isBlacklisted;
        });

        videos.sort((a, b) => {
            const aOfficial = /vevo|topic|official/i.test(a.channelTitle);
            const bOfficial = /vevo|topic|official/i.test(b.channelTitle);
            if (aOfficial && !bOfficial) return -1;
            if (!aOfficial && bOfficial) return 1;
            return 0;
        });

        // Logging result count
        console.log(`Filtered count: ${videos.length}`);

        console.log(`Filtered count: ${videos.length}`);

        if (videos.length === 0) {
            // Fallback if we filtered everything (rare with 50 results)
            console.warn('All results filtered out, falling back to raw search');
            videos = await searchYouTube(terms.join(' ') + ' music');
        }

        // 4. Select Track using shuffleIndex
        // This allows "Try Another" to maintain the same query but pick the next result
        const selectedIndex = shuffleIndex % videos.length;
        const track = videos[selectedIndex];

        return NextResponse.json({
            track,
            debug: {
                query: baseQuery,
                resultCount: videos.length,
                selectedIndex
            }
        });

    } catch (error) {
        console.error('API Error:', error);
        return NextResponse.json(
            { error: 'Internal Server Error' },
            { status: 500 }
        );
    }
}
