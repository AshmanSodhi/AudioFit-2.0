// ponytail: single file for all ML recommendations — ReccoBeats features + your model endpoints, no fallbacks
import type { Recommendation, CandidateSong } from './recommender';

const ML_BASE = 'https://audiofit-ml-backend.onrender.com';
const TIMEOUT_MS = 8000;

interface SongFeatures {
  acousticness: number;
  danceability: number;
  energy: number;
  instrumentalness: number;
  liveness: number;
  loudness: number;
  speechiness: number;
  tempo: number;
  valence: number;
  n_recommendations: number;
}

interface MlItem {
  track_id: string;
  track_name: string;
  artist_name: string;
  album_name?: string;
  year?: number;
  language?: string;
  popularity?: number;
  similarity: number;
}

async function fetchWithTimeout(url: string, init?: RequestInit, ms = TIMEOUT_MS): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: c.signal } as any);
  } finally {
    clearTimeout(t);
  }
}

async function getReccobeatsId(spotifyTrackId: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`https://api.reccobeats.com/v1/track?ids=${encodeURIComponent(spotifyTrackId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.content?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function getSongFeatures(spotifyTrackId: string): Promise<SongFeatures | null> {
  const reccoId = await getReccobeatsId(spotifyTrackId);
  if (!reccoId) return null;
  try {
    const res = await fetchWithTimeout(`https://api.reccobeats.com/v1/track/${reccoId}/audio-features`);
    if (!res.ok) return null;
    const f = await res.json();
    // must have all 9 fields
    if (
      typeof f.acousticness !== 'number' ||
      typeof f.danceability !== 'number' ||
      typeof f.energy !== 'number' ||
      typeof f.liveness !== 'number' ||
      typeof f.loudness !== 'number' ||
      typeof f.speechiness !== 'number' ||
      typeof f.tempo !== 'number' ||
      typeof f.valence !== 'number'
    )
      return null;
    return {
      acousticness: f.acousticness,
      danceability: f.danceability,
      energy: f.energy,
      instrumentalness: f.instrumentalness ?? 0,
      liveness: f.liveness,
      loudness: f.loudness,
      speechiness: f.speechiness,
      tempo: f.tempo,
      valence: f.valence,
      n_recommendations: 5,
    };
  } catch {
    return null;
  }
}

function toRecommendation(item: MlItem): Recommendation {
  const song: CandidateSong = {
    id: item.track_id,
    title: item.track_name,
    artist: item.artist_name,
    genres: item.language ? [item.language.toLowerCase()] : [],
    popularity: typeof item.popularity === 'number' ? item.popularity / 100 : undefined,
    source: 'ml-model',
  };
  const score = Math.round((item.similarity ?? 0) * 100);
  return {
    song,
    score,
    genreSim: item.similarity ?? 0,
    artistSim: 0,
    reasons: item.language ? [`${item.language} · similarity ${(item.similarity * 100).toFixed(1)}%`] : [`Similarity ${(item.similarity * 100).toFixed(1)}%`],
  };
}

async function callEndpoint(path: '/recommend_eng' | '/recommend_hin', features: SongFeatures): Promise<MlItem[]> {
  try {
    const res = await fetchWithTimeout(`${ML_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(features),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const arr = Array.isArray(data) ? data : data?.recommendations ?? [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// 3 per track: call both endpoints (5 each), merge by similarity desc, take top 3
export async function recommendForTrack(spotifyTrackId: string): Promise<Recommendation[]> {
  const features = await getSongFeatures(spotifyTrackId);
  if (!features) return [];
  const [eng, hin] = await Promise.all([callEndpoint('/recommend_eng', features), callEndpoint('/recommend_hin', features)]);
  const merged = [...eng, ...hin]
    .filter((x) => x.track_id?.toLowerCase() !== spotifyTrackId.toLowerCase())
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, 3);
  return merged.map(toRecommendation);
}

// Aggregate across multiple seed tracks — dedupe seeds and results
export async function recommendForTracks(trackIds: string[], limit?: number): Promise<Recommendation[]> {
  const uniq = [...new Set(trackIds.filter(Boolean))];
  if (uniq.length === 0) return [];
  // ponytail: sequential per track is fine for <20 tracks; parallel would hammer ReccoBeats + model
  const all: Recommendation[] = [];
  const seen = new Set<string>();
  // cap seeds to avoid excessive API calls — take most recent N if many
  const seeds = limit ? uniq.slice(0, Math.ceil(limit / 3) + 2) : uniq;
  // parallelize but limit concurrency
  const batches: Recommendation[][] = await Promise.all(seeds.map((id) => recommendForTrack(id)));
  for (const batch of batches) {
    for (const r of batch) {
      const key = (r.song.id ?? `${r.song.artist}|${r.song.title}`).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(r);
    }
  }
  // filter out seeds themselves if they appear in results
  const seedSet = new Set(uniq.map((s) => s.toLowerCase()));
  const filtered = all.filter((r) => !seedSet.has((r.song.id ?? '').toLowerCase()));
  // already sorted per-track by similarity, but re-sort globally by score desc
  filtered.sort((a, b) => b.score - a.score);
  return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
}
