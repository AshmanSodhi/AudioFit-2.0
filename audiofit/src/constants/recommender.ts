// =============================================================================
// AudioFit — Recommendation Engine (preference profile + similarity)
//
// Pure, side-effect-free functions that:
//   1. Build a user preference profile from listening history (genres/artists).
//   2. Score candidate songs by similarity to that profile.
//   3. Rank & return the top recommendations with an explainable breakdown.
//
// No AsyncStorage / network here — pass data in, get results out. The store
// layer (store.ts) wires this to real history and persists results.
// See docs/RECOMMENDATION_ENGINE.md for the full math behind every step.
// =============================================================================

// A single tuple of "The user heard this song at this time".
export interface ListenRecord {
  title: string;
  artist: string;
  artistId?: string;
  genres?: string[];
  bpm?: number;
  energy?: number;
  timestamp: number; // epoch ms
  playWeight?: number; // optional engagement weight (e.g. completion 0..1)
}

// A candidate song the recommender may propose.
export interface CandidateSong {
  id?: string;
  title: string;
  artist: string;
  artistId?: string;
  genres?: string[];
  bpm?: number;
  energy?: number;
  /** optional prior popularity 0..1 used to break cold-start ties */
  popularity?: number;
  /** does the user already have this exact track in history */
  alreadyHeard?: boolean;
  /** where the candidate came from (e.g. 'catalog', 'synced', 'workout') */
  source?: string;
}

export interface Recommendation {
  song: CandidateSong;
  score: number; // 0..100
  genreSim: number; // 0..1
  artistSim: number; // 0..1
  reasons: string[]; // human readable explanation for UI
}

// Aggregated taste summary, ready to render.
export interface PreferenceProfile {
  topGenres: { label: string; score: number }[];
  topArtists: { label: string; score: number }[];
  totalListens: number;
  dominantBpm: number | null;
}

// ---------------------------------------------------------------------------
// Tunable knobs
// ---------------------------------------------------------------------------

// Exponential time-decay half-life (days). A listen 30 days ago is worth 50%.
export const HALF_LIFE_DAYS = 30;

// Relative weight given to genre overlap vs. artist identity.
export const GENRE_WEIGHT = 0.65;
export const ARTIST_WEIGHT = 0.35;

// Reject songs the user already heard within this many days (novelty guard).
export const RECENTLY_HEARD_DAYS = 14;

// ---------------------------------------------------------------------------
// Profile building
// ---------------------------------------------------------------------------

/**
 * Exponential recency weight. A song heard `ageDays` ago gets
 *   w = exp( -(ln 2 / HALF_LIFE_DAYS) * ageDays )
 * so old listens fade instead of counting equally with fresh ones.
 */
export function recencyWeight(timestamp: number, now: number): number {
  const ageDays = Math.max(0, (now - timestamp) / 86_400_000);
  return Math.exp(-(Math.LN2 / HALF_LIFE_DAYS) * ageDays);
}

/** Genre affinity: sum of recency-weighted listens spread across a song's genres. */
export function buildGenreScores(records: ListenRecord[]): Map<string, number> {
  const now = Date.now();
  const map = new Map<string, number>();
  for (const rec of records) {
    const w = (rec.playWeight ?? 1) * recencyWeight(rec.timestamp, now);
    const genres = rec.genres?.length ? [...new Set(rec.genres)] : [];
    if (genres.length === 0) continue;
    for (const g of genres) map.set(g, (map.get(g) ?? 0) + w / genres.length);
  }
  return map;
}

/** Artist affinity from the same recency-weighted listens. */
export function buildArtistScores(
  records: ListenRecord[]
): Map<string, { label: string; score: number }> {
  const now = Date.now();
  const map = new Map<string, { label: string; score: number }>();
  for (const rec of records) {
    const key = (rec.artistId || rec.artist || '').toLowerCase();
    if (!key) continue;
    const w = (rec.playWeight ?? 1) * recencyWeight(rec.timestamp, now);
    const cur = map.get(key);
    map.set(key, { label: rec.artist, score: (cur?.score ?? 0) + w });
  }
  return map;
}

/** Normalize scores to fractions of the max value (0..1). */
function toFractions(scores: Map<string, number>): Map<string, number> {
  let max = 0;
  scores.forEach((v) => (max = Math.max(max, v)));
  const out = new Map<string, number>();
  if (max <= 0) return out;
  for (const [k, v] of scores) out.set(k, v / max);
  return out;
}

/** Build a compact, ordered taste profile for UI + downstream similarity. */
export function buildProfile(records: ListenRecord[]): PreferenceProfile {
  const genre = toFractions(buildGenreScores(records));
  const artist = buildArtistScores(records);

  const topArtists = [...artist.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 8)
    .map(([, v]) => ({ label: v.label, score: v.score }));

  const topGenres = [...genre.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, score]) => ({ label, score }));

  return {
    topArtists,
    topGenres,
    totalListens: records.length,
    dominantBpm: dominantBpm(records),
  };
}

function dominantBpm(records: ListenRecord[]): number | null {
  const withBpm = records.filter((r) => r.bpm && r.bpm > 0);
  if (!withBpm.length) return null;
  const avg = withBpm.reduce((s, r) => s + (r.bpm ?? 0), 0) / withBpm.length;
  return Math.round(avg / 5) * 5; // snap to nearest 5 BPM for stable labeling
}

// ---------------------------------------------------------------------------
// Similarity scoring
// ---------------------------------------------------------------------------

/**
 * Genre overlap in [0,1]: the fraction of a candidate's distinct genres that
 * appear in the user's normalized genre profile (weighted). A candidate whose
 * genres are all "liked" hits ~1.0; an off-taste candidate falls toward 0.
 */
function genreSimilarity(candidateGenres: string[] | undefined, genres: Map<string, number>): number {
  if (!candidateGenres?.length || genres.size === 0) return 0;
  const seen = new Set<string>();
  let sum = 0;
  let maxSum = 0;
  for (const g of candidateGenres) {
    const gKey = g.toLowerCase();
    if (seen.has(gKey)) continue;
    seen.add(gKey);
    maxSum += 1;
    sum += Math.min(genres.get(gKey) ?? 0, 1);
  }
  if (maxSum === 0) return 0;
  return Math.min(1, sum / maxSum);
}

/** Artist similarity: how strongly this artist ranks in the user's profile. */
function artistSimilarity(
  candidate: Pick<CandidateSong, 'artist' | 'artistId'>,
  artists: Map<string, { label: string; score: number }>
): number {
  if (!candidate.artist) return 0;
  const hit = artists.get((candidate.artistId ?? candidate.artist).toLowerCase());
  if (!hit) return 0;
  return Math.min(1, hit.score);
}

// ---------------------------------------------------------------------------
// Recommendation entry point
// ---------------------------------------------------------------------------

export interface RecommendOptions {
  limit?: number;
  /** Keep returning songs the user already owns (default discards them). */
  includeHeard?: boolean;
  /** Candidate songs heard within this many days are excluded. */
  recentHeardDays?: number;
}

/**
 * Rank `candidates` against the user profile and return the best `limit`.
 *
 * Score formula:
 *   score(c) = GENRE_WEIGHT * simGenre(c) + ARTIST_WEIGHT * simArtist(c)
 * scaled to 0..100, plus a tiny popularity tie-breaker.
 * Songs heard within `recentHeardDays` are zeroed out (novelty guard).
 */
export function recommend(
  records: ListenRecord[],
  candidates: CandidateSong[],
  opts: RecommendOptions = {}
): Recommendation[] {
  const { limit = 10, includeHeard = false, recentHeardDays = RECENTLY_HEARD_DAYS } = opts;
  const genres = toFractions(buildGenreScores(records));
  const artists = buildArtistScores(records);
  const heardAt = new Map<string, number>();

  for (const r of records) {
    const key = ((r.artistId ?? r.artist) + '|' + r.title).toLowerCase();
    const prev = heardAt.get(key) ?? 0;
    heardAt.set(key, Math.max(prev, r.timestamp));
  }

  const cutoff = Date.now() - recentHeardDays * 86_400_000;
  const rated = candidates.map((c) => {
    const g = genreSimilarity(c.genres, genres);
    const a = artistSimilarity(c, artists);
    let score = GENRE_WEIGHT * g + ARTIST_WEIGHT * a;
    if (!includeHeard && c.alreadyHeard) score = 0;
    score += (c.popularity ?? 0) * 0.01;

    const key = ((c.artistId ?? c.artist) + '|' + c.title).toLowerCase();
    const lastHeard = heardAt.get(key);
    if (lastHeard && lastHeard >= cutoff) score = 0;

    return {
      song: c,
      score: Math.round(Math.max(0, score) * 100),
      genreSim: Math.round(g * 100) / 100,
      artistSim: Math.round(a * 100) / 100,
      reasons: buildReasons(c, g, a, score),
    };
  });

  return rated
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

/** Human readable "why this song" reasons, straight from the score terms. */
function buildReasons(c: CandidateSong, genreSim: number, artistSim: number, score: number): string[] {
  if (score <= 0) return [];
  const reasons: string[] = [];
  if (genreSim >= 0.5) {
    const top = (c.genres ?? []).slice(0, 2).join(', ');
    reasons.push(`Matches your taste in ${top || 'familiar genres'}`);
  } else if (genreSim > 0) {
    reasons.push('Shares some genres with songs you love');
  }
  if (artistSim >= 0.5) reasons.push(`You've enjoyed this artist`);
  else if (c.popularity && c.popularity >= 0.7) reasons.push('A crowd favorite worth trying');
  if (reasons.length === 0) reasons.push('Explores a fresh sound close to your vibe');
  return reasons;
}

// ---------------------------------------------------------------------------
// Curated discovery catalog
// ---------------------------------------------------------------------------

/**
 * A small built-in catalog so the recommender has fresh candidates even before
 * the user has rich synced history. Genre tags are coarse but stable.
 */
export const DISCOVERY_CATALOG: CandidateSong[] = [
  { id: 'c1', title: 'Blinding Lights', artist: 'The Weeknd', genres: ['synthwave', 'pop'], bpm: 171, energy: 0.82, popularity: 0.95 },
  { id: 'c2', title: 'Titanium', artist: 'David Guetta', genres: ['electronic', 'dance'], bpm: 126, energy: 0.79, popularity: 0.88 },
  { id: 'c3', title: 'Level Up', artist: 'Ciara', genres: ['hip hop', 'pop'], bpm: 153, energy: 0.85, popularity: 0.8 },
  { id: 'c4', title: 'Lose Yourself', artist: 'Eminem', genres: ['hip hop', 'rap'], bpm: 86, energy: 0.74, popularity: 0.9 },
  { id: 'c5', title: 'Flowers', artist: 'Miley Cyrus', genres: ['pop'], bpm: 118, energy: 0.68, popularity: 0.9 },
  { id: 'c6', title: 'As It Was', artist: 'Harry Styles', genres: ['pop', 'synthwave'], bpm: 174, energy: 0.73, popularity: 0.92 },
  { id: 'c7', title: 'Levitating', artist: 'Dua Lipa', genres: ['dance', 'pop'], bpm: 103, energy: 0.82, popularity: 0.91 },
  { id: 'c8', title: 'Golden', artist: 'Harry Styles', genres: ['pop'], bpm: 140, energy: 0.61, popularity: 0.78 },
  { id: 'c9', title: 'Mood', artist: '24kGoldn', genres: ['hip hop', 'pop'], bpm: 91, energy: 0.72, popularity: 0.82 },
  { id: 'c10', title: 'Remember', artist: 'Becky Hill & David Guetta', genres: ['dance', 'house'], bpm: 124, energy: 0.88, popularity: 0.8 },
  { id: 'c11', title: 'Uptown Funk', artist: 'Mark Ronson', genres: ['funk', 'pop'], bpm: 115, energy: 0.84, popularity: 0.89 },
  { id: 'c12', title: 'Can\'t Stop the Feeling!', artist: 'Justin Timberlake', genres: ['pop', 'disco'], bpm: 113, energy: 0.79, popularity: 0.87 },
  { id: 'c13', title: 'Run the World', artist: 'Beyoncé', genres: ['pop', 'afrobeats'], bpm: 127, energy: 0.84, popularity: 0.76 },
  { id: 'c14', title: 'I\'m Not Alright', artist: 'Loud Luxury', genres: ['dance', 'house'], bpm: 124, energy: 0.9, popularity: 0.7 },
  { id: 'c15', title: 'Shake It Off', artist: 'Taylor Swift', genres: ['pop'], bpm: 160, energy: 0.74, popularity: 0.86 },
  { id: 'c16', title: 'Wake Me Up', artist: 'Avicii', genres: ['electronic', 'folk'], bpm: 124, energy: 0.76, popularity: 0.88 },
  { id: 'c17', title: 'Stronger', artist: 'Kanye West', genres: ['hip hop', 'electronic'], bpm: 104, energy: 0.82, popularity: 0.84 },
  { id: 'c18', title: 'Shape of You', artist: 'Ed Sheeran', genres: ['pop', 'dancehall'], bpm: 96, energy: 0.74, popularity: 0.93 },
  { id: 'c19', title: 'Rolling in the Deep', artist: 'Adele', genres: ['soul', 'pop'], bpm: 105, energy: 0.72, popularity: 0.86 },
  { id: 'c20', title: 'Don\'t Start Now', artist: 'Dua Lipa', genres: ['dance', 'disco'], bpm: 124, energy: 0.8, popularity: 0.88 },
];
