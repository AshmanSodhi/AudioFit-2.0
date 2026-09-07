// ponytail: single file for all ML recommendations — ReccoBeats features + your model endpoints, no fallbacks
import type { Recommendation, CandidateSong } from './recommender';
import {
  AudioFeatures,
  FavoriteSongFeatures,
  MIN_FAVORITE_SONGS,
  estimateAudioFeatures,
  hasAllAudioFeatures,
  isValidUserProfile,
} from './audioFeatures';

// Single base URL for the ML backend — all endpoints derive from this.
// (Do NOT hardcode the URL elsewhere; import API_BASE_URL.)
export const API_BASE_URL = 'https://audiofit-ml-backend.onrender.com';
const ML_BASE = API_BASE_URL;
const TIMEOUT_MS = 8000;
const PROFILE_TIMEOUT_MS = 15000;

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

// Exported so onboarding / store reuse the same feature lookup (no duplication).
export async function getSongFeatures(spotifyTrackId: string): Promise<SongFeatures | null> {
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

// ============================================================================
// V2 — personalized recommendations + user profile
// V1 above is untouched. V2 reuses getSongFeatures / fetchWithTimeout.
// ============================================================================

export class MlApiError extends Error {
  status: number | 'timeout' | 'network';
  constructor(message: string, status: number | 'timeout' | 'network') {
    super(message);
    this.name = 'MlApiError';
    this.status = status;
  }
}

function toApiError(e: unknown, what: string): MlApiError {
  if (e instanceof MlApiError) return e;
  if (e instanceof DOMException && e.name === 'AbortError') {
    return new MlApiError(`${what} timed out. Check your connection and retry.`, 'timeout');
  }
  return new MlApiError(`${what} failed (network unavailable?). ${e instanceof Error ? e.message : ''}`.trim(), 'network');
}

export interface CreateProfileResult {
  profile: number[];
  songsUsed: number;
}

interface V2Item {
  track_id: string;
  track_name: string;
  artist_name: string;
  album_name?: string;
  year?: number;
  language?: string;
  popularity?: number;
  v2_score?: number;
  content_similarity?: number;
  user_similarity?: number;
}

/** POST /create_profile — backend requires ≥10 favorite songs (9 features each). */
export async function createUserProfile(favoriteSongs: FavoriteSongFeatures[]): Promise<CreateProfileResult> {
  console.log('[ml] profile creation started, favorites:', favoriteSongs.length);
  if (!Array.isArray(favoriteSongs) || favoriteSongs.length < MIN_FAVORITE_SONGS) {
    throw new MlApiError(`Select at least ${MIN_FAVORITE_SONGS} favorite songs (got ${favoriteSongs?.length ?? 0}).`, 400);
  }
  const invalid = favoriteSongs.findIndex((s) => !hasAllAudioFeatures(s));
  if (invalid !== -1) {
    throw new MlApiError(`Favorite song #${invalid + 1} is missing audio features. Not sending incomplete data.`, 400);
  }
  try {
    const res = await fetchWithTimeout(
      `${API_BASE_URL}/create_profile`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite_songs: favoriteSongs }),
      },
      PROFILE_TIMEOUT_MS
    );
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new MlApiError(`Profile creation failed (HTTP ${res.status}). ${t.slice(0, 200)}`.trim(), res.status);
    }
    const data = await res.json().catch(() => null);
    const profile = data?.profile;
    if (!isValidUserProfile(profile)) {
      throw new MlApiError('Invalid profile response: expected exactly 9 numeric values.', res.status);
    }
    console.log('[ml] profile successfully created, dimensions:', profile.length);
    return { profile, songsUsed: typeof data?.songs_used === 'number' ? data.songs_used : favoriteSongs.length };
  } catch (e) {
    throw toApiError(e, 'Profile creation');
  }
}

function toV2Recommendation(item: V2Item): Recommendation {
  const song: CandidateSong = {
    id: item.track_id,
    title: item.track_name,
    artist: item.artist_name,
    genres: item.language ? [item.language.toLowerCase()] : [],
    popularity: typeof item.popularity === 'number' ? item.popularity / 100 : undefined,
    source: 'v2-personalized',
  };
  const v2 = typeof item.v2_score === 'number' ? item.v2_score : 0;
  const content = typeof item.content_similarity === 'number' ? item.content_similarity : 0;
  const user = typeof item.user_similarity === 'number' ? item.user_similarity : 0;
  const bits: string[] = [];
  if (item.language) bits.push(item.language);
  bits.push(`match ${(v2 * 100).toFixed(1)}%`);
  return {
    song,
    score: Math.round(v2 * 100),
    genreSim: content,
    artistSim: user,
    reasons: [bits.join(' · ')],
  };
}

/**
 * POST /recommend_v2 — personalized rerank using the stored 9D user_profile
 * plus the current song's 9 audio features. Throws MlApiError on failure
 * (callers fall back to V1).
 */
export async function getV2Recommendations(
  userProfile: number[],
  currentFeatures: AudioFeatures,
  nRecommendations = 10
): Promise<Recommendation[]> {
  if (!isValidUserProfile(userProfile)) {
    throw new MlApiError('No valid user profile (need exactly 9 values). Falling back to V1.', 400);
  }
  if (!hasAllAudioFeatures(currentFeatures)) {
    throw new MlApiError('Current song is missing audio features. Not sending incomplete data.', 400);
  }
  console.log('[ml] V2 recommendation request, profile length:', userProfile.length);
  try {
    const res = await fetchWithTimeout(`${API_BASE_URL}/recommend_v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_profile: userProfile, ...currentFeatures, n_recommendations: nRecommendations }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new MlApiError(`V2 recommendations failed (HTTP ${res.status}). ${t.slice(0, 200)}`.trim(), res.status);
    }
    const data = await res.json().catch(() => null);
    const arr = Array.isArray(data) ? data : data?.recommendations ?? [];
    if (!Array.isArray(arr)) throw new MlApiError('Invalid V2 response shape.', res.status);
    console.log('[ml] V2 recommendation success, count:', arr.length);
    return arr.map(toV2Recommendation);
  } catch (e) {
    console.log('[ml] V2 recommendation failure, falling back to V1');
    throw toApiError(e, 'V2 recommendations');
  }
}

/**
 * Resolve full 9 audio features for any seed id.
 * Real ReccoBeats values when available; otherwise the app's established
 * deterministic-estimate pattern (flagged via `estimated`).
 */
export async function resolveAudioFeatures(
  spotifyTrackId: string
): Promise<{ features: AudioFeatures; estimated: boolean }> {
  const real = await getSongFeatures(spotifyTrackId);
  if (real) {
    const { n_recommendations: _drop, ...nine } = real;
    if (hasAllAudioFeatures(nine)) return { features: nine, estimated: false };
  }
  return { features: estimateAudioFeatures(spotifyTrackId || 'unknown'), estimated: true };
}
