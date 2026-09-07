// ============================================================================
// AudioFit — Audio feature DTO (single source of truth for the 9 ML features)
//
// The backend (V1 + V2) requires exactly these 9 fields with these exact names:
//   acousticness, danceability, energy, instrumentalness, liveness, loudness,
//   speechiness, tempo, valence
//
// Reuse this module everywhere instead of duplicating feature logic.
// ============================================================================

export const AUDIO_FEATURE_KEYS = [
  'acousticness',
  'danceability',
  'energy',
  'instrumentalness',
  'liveness',
  'loudness',
  'speechiness',
  'tempo',
  'valence',
] as const;

export type AudioFeatureKey = (typeof AUDIO_FEATURE_KEYS)[number];

export interface AudioFeatures {
  acousticness: number;
  danceability: number;
  energy: number;
  instrumentalness: number;
  liveness: number;
  loudness: number;
  speechiness: number;
  tempo: number;
  valence: number;
}

/** A favorites entry sent to POST /create_profile (9 features, nothing else). */
export type FavoriteSongFeatures = AudioFeatures;

export const MIN_FAVORITE_SONGS = 10;
export const PROFILE_DIMENSIONS = 9;

export function hasAllAudioFeatures(obj: unknown): obj is AudioFeatures {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return AUDIO_FEATURE_KEYS.every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]));
}

/** Extract exactly the 9 backend fields from any richer object (drops extras). */
export function toAudioFeatures(obj: Record<string, unknown>): AudioFeatures | null {
  if (!hasAllAudioFeatures(obj)) return null;
  return {
    acousticness: obj.acousticness as number,
    danceability: obj.danceability as number,
    energy: obj.energy as number,
    instrumentalness: obj.instrumentalness as number,
    liveness: obj.liveness as number,
    loudness: obj.loudness as number,
    speechiness: obj.speechiness as number,
    tempo: obj.tempo as number,
    valence: obj.valence as number,
  };
}

export function isValidUserProfile(p: unknown): p is number[] {
  return Array.isArray(p) && p.length === PROFILE_DIMENSIONS && p.every((v) => typeof v === 'number' && Number.isFinite(v));
}

// ---------------------------------------------------------------------------
// Deterministic local estimates (fallback only).
//
// The app already estimates bpm/energy/valence per track-id hash when Spotify's
// audio-features API is unavailable (store.ts: estimateBpm/Energy/Valence).
// This extends that *established* pattern to all 9 ML fields so catalog/demo
// tracks (which have no ReccoBeats entry) can still participate in V2.
// Tracks resolved via ReccoBeats always use real values; estimates are flagged
// via the `estimated` return flag so callers can log them.
// ---------------------------------------------------------------------------

function hashStr(id: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function frac(hash: number, mod: number): number {
  return (hash % mod) / mod;
}

export function estimateAudioFeatures(seedId: string): AudioFeatures {
  return {
    acousticness: Math.round(frac(hashStr(seedId, 11), 100) * 0.8 * 100) / 100,
    danceability: Math.round((0.3 + frac(hashStr(seedId, 13), 100) * 0.6) * 100) / 100,
    energy: Math.round((0.4 + frac(hashStr(seedId, 17), 100) * 0.5) * 100) / 100,
    instrumentalness: Math.round(frac(hashStr(seedId, 19), 100) * 0.3 * 100) / 100,
    liveness: Math.round((0.05 + frac(hashStr(seedId, 23), 100) * 0.3) * 100) / 100,
    loudness: Math.round((-15 + frac(hashStr(seedId, 29), 100) * 10) * 100) / 100,
    speechiness: Math.round((0.02 + frac(hashStr(seedId, 31), 100) * 0.2) * 100) / 100,
    tempo: 90 + (hashStr(seedId, 37) % 91),
    valence: Math.round((0.2 + frac(hashStr(seedId, 41), 100) * 0.7) * 100) / 100,
  };
}

/** Mean features across a set (used as the "current song" proxy for list-level V2 calls). */
export function meanAudioFeatures(list: AudioFeatures[]): AudioFeatures | null {
  if (list.length === 0) return null;
  const sum: AudioFeatures = {
    acousticness: 0, danceability: 0, energy: 0, instrumentalness: 0,
    liveness: 0, loudness: 0, speechiness: 0, tempo: 0, valence: 0,
  };
  for (const f of list) {
    (AUDIO_FEATURE_KEYS as readonly string[]).forEach((k) => {
      (sum as unknown as Record<string, number>)[k] += (f as unknown as Record<string, number>)[k];
    });
  }
  const out = { ...sum };
  (AUDIO_FEATURE_KEYS as readonly string[]).forEach((k) => {
    (out as unknown as Record<string, number>)[k] =
      Math.round(((sum as unknown as Record<string, number>)[k] / list.length) * 1000) / 1000;
  });
  return out;
}
