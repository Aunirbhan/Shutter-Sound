export interface YouTubeVideo {
    id: string;
    title: string;
    channelTitle: string;
    thumbnailUrl: string;
    videoUrl: string;
}

export async function searchYouTube(query: string): Promise<YouTubeVideo[]> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
        throw new Error('Missing YOUTUBE_API_KEY');
    }

    const endpoint = 'https://www.googleapis.com/youtube/v3/search';
    const params = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        videoCategoryId: '10', // Music
        maxResults: '50', // Fetch more to allow for aggressive filtering
        q: query,
        key: apiKey,
    });

    try {
        const response = await fetch(`${endpoint}?${params.toString()}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('YouTube API Error:', errorText);
            throw new Error(`YouTube API failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.items) {
            return [];
        }

        return data.items.map((item: any) => ({
            id: item.id.videoId,
            title: item.snippet.title,
            channelTitle: item.snippet.channelTitle,
            thumbnailUrl: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url,
            videoUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        }));

    } catch (error) {
        console.error('Failed to fetch from YouTube:', error);
        throw error;
    }
}
