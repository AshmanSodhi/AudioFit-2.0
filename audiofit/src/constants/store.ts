import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ListenRecord,
  PreferenceProfile,
  Recommendation,
  buildProfile,
} from './recommender';
import { recommendForTracks } from './mlRecommender';

export interface Workout {
  id: string;
  type: 'walk' | 'run';
  date: string;
  duration: number; // in seconds
  distance: number; // in km
  steps: number;
  avgSpeed: number; // in km/h
  avgCadence: number; // in SPM
  songsHeard: {
    title: string;
    artist: string;
    bpm: number;
    energy: number;
    speedBoost: number; // pace boost percentage
    avgSpeed: number;
    matchScore: number; // 0 - 100
    trackId?: string; // Spotify track id for ML recommendations
  }[];
  // ponytail: persisted GPS polyline + cached ML recs, embedded in same AsyncStorage key — move to hosted NoSQL when cross-device sync needed
  route?: { latitude: number; longitude: number; timestamp: number }[];
  recommendations?: Recommendation[];
}

export interface SpotifySong {
  trackId?: string;
  title: string;
  artist: string;
  artistIds?: string[];
  genres?: string[];
  bpm: number;
  energy: number;
  valence: number;
  timestamp: number;
  // When true, BPM/energy could not be fetched from Spotify's audio
  // features API (deprecated for new apps) and was estimated locally.
  bpmEstimated?: boolean;
  source?: 'recently-played' | 'top-tracks' | 'saved-tracks';
  // Populated only when the track was correlated to a real workout.
  speed?: number;
  cadence?: number;
}

export type SpotifySyncSource = 'recently-played' | 'top-tracks' | 'saved-tracks';

export interface SpotifyState {
  isConnected: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  clientId: string | null;
  customRedirectUri: string | null;
  syncSource?: SpotifySyncSource;
  user: {
    displayName: string;
    id: string;
    product: string;
    followers: number;
    avatarUrl?: string;
  } | null;
  recentlyPlayed: SpotifySong[];
}

const STORAGE_KEYS = {
  HISTORY: '@audiofit:workout_history_v2',
  SPOTIFY: '@audiofit:spotify_state_v2',
  ARTIST_GENRES: '@audiofit:artist_genres_v1',
  RECOMMENDATIONS: '@audiofit:recommendations_v1',
  RECOMMENDATION_SERVICE_URL: '@audiofit:recommendation_service_url',
};

class AppStore {
  private history: Workout[] = [];
  private spotify: SpotifyState = {
    isConnected: false,
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    clientId: null,
    customRedirectUri: null,
    user: null,
    recentlyPlayed: [],
  };

  // Cached artist -> genres map (keyed by normalized artist name). Survives
  // offline so the recommender can resolve genres without an API call.
  private artistGenres: Record<string, string[]> = {};

  private listeners = new Set<() => void>();
  private isInitialized = false;

  constructor() {
    this.init();
  }

  // Load persisted states on startup
  private async init() {
    try {
      const historyData = await AsyncStorage.getItem(STORAGE_KEYS.HISTORY);
      const spotifyData = await AsyncStorage.getItem(STORAGE_KEYS.SPOTIFY);
      const artistGenresData = await AsyncStorage.getItem(STORAGE_KEYS.ARTIST_GENRES);

      if (historyData) {
        this.history = JSON.parse(historyData);
      }

      if (spotifyData) {
        this.spotify = JSON.parse(spotifyData);
      }

      if (artistGenresData) {
        this.artistGenres = JSON.parse(artistGenresData);
      }
      
      this.isInitialized = true;
      this.notify();
    } catch (e) {
      console.warn('Failed to load store data:', e);
    }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    if (this.isInitialized) {
      listener(); // notify instantly if already loaded
    }
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  private async persistHistory() {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(this.history));
    } catch (e) {
      console.warn('Failed to persist history:', e);
    }
  }

  private async persistSpotify() {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SPOTIFY, JSON.stringify(this.spotify));
    } catch (e) {
      console.warn('Failed to persist Spotify state:', e);
    }
  }

  getHistory() {
    return [...this.history];
  }

  getWorkoutById(id: string): Workout | undefined {
    return this.history.find((w) => w.id === id);
  }

  // ponytail: patch recommendations into the workout so detail page never re-fetches
  setWorkoutRecommendations(id: string, recs: Recommendation[]) {
    const idx = this.history.findIndex((w) => w.id === id);
    if (idx === -1) return;
    this.history[idx] = { ...this.history[idx], recommendations: recs };
    this.persistHistory();
    this.notify();
  }

  addWorkout(workout: Workout) {
    this.history = [workout, ...this.history];
    this.persistHistory();
    
    // Add songs heard in workout to Spotify Sync page list too
    workout.songsHeard.forEach((song) => {
      // Avoid duplicates
      const exists = this.spotify.recentlyPlayed.some(
        (s) => s.title === song.title && Math.abs(s.timestamp - Date.now()) < 60000
      );
      if (!exists) {
        this.spotify.recentlyPlayed = [
          {
            title: song.title,
            artist: song.artist,
            bpm: song.bpm,
            energy: song.energy,
            valence: 0.5 + Math.random() * 0.4,
            speed: song.avgSpeed,
            cadence: workout.avgCadence,
            timestamp: Date.now(),
          },
          ...this.spotify.recentlyPlayed,
        ];
      }
    });

    this.persistSpotify();
    this.notify();
  }

  // Remove a saved activity from history (e.g. user discards it).
  removeWorkout(id: string) {
    const existed = this.history.some((w) => w.id === id);
    if (!existed) return;
    this.history = this.history.filter((w) => w.id !== id);
    this.persistHistory();
    this.notify();
  }

  getSpotifyState() {
    return { ...this.spotify };
  }

  saveSettings(clientId: string, redirectUri: string) {
    this.spotify.clientId = clientId || null;
    this.spotify.customRedirectUri = redirectUri || null;
    this.persistSpotify();
    this.notify();
  }

  // Connect Real Spotify session (Authorization Code with PKCE)
  connectSpotify(
    user: SpotifyState['user'],
    tokens: { accessToken: string; refreshToken?: string | null; expiresIn?: number }
  ) {
    this.spotify.isConnected = true;
    this.spotify.accessToken = tokens.accessToken;
    this.spotify.refreshToken = tokens.refreshToken ?? null;
    this.spotify.tokenExpiresAt = tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : null;
    this.spotify.user = user;
    this.persistSpotify();
    this.notify();
  }

  disconnectSpotify() {
    this.spotify.isConnected = false;
    this.spotify.accessToken = null;
    this.spotify.refreshToken = null;
    this.spotify.tokenExpiresAt = null;
    this.spotify.user = null;
    this.spotify.recentlyPlayed = [];
    this.spotify.syncSource = undefined;
    this.persistSpotify();
    this.notify();
  }

  // --- Token lifecycle (refresh before expiry / on 401) ---

  async refreshAccessToken(): Promise<string | null> {
    const { refreshToken, clientId } = this.spotify;
    if (!refreshToken || !clientId) return null;
    try {
      const body = new URLSearchParams();
      body.append('grant_type', 'refresh_token');
      body.append('refresh_token', refreshToken);
      body.append('client_id', clientId);
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!response.ok) throw new Error(`Token refresh failed: ${response.status}`);
      const data = await response.json();
      this.spotify.accessToken = data.access_token;
      this.spotify.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
      if (data.refresh_token) this.spotify.refreshToken = data.refresh_token;
      this.persistSpotify();
      this.notify();
      return data.access_token;
    } catch (err) {
      console.warn('refreshAccessToken error:', err);
      return null;
    }
  }

  // Returns a usable access token, refreshing it first when near/after expiry.
  async getValidAccessToken(): Promise<string | null> {
    const { accessToken, tokenExpiresAt } = this.spotify;
    if (!accessToken) return null;
    if (!tokenExpiresAt || tokenExpiresAt - Date.now() < 5 * 60 * 1000) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) return refreshed;
    }
    return accessToken;
  }

  // --- Real Spotify API Queries ---

  // 1. Fetch user profile info
  async fetchUserProfile(token: string) {
    try {
      const response = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Profile fetch failed: ${response.status}`);
      const data = await response.json();
      
      const userObj = {
        displayName: data.display_name || data.id,
        id: data.id,
        product: data.product || 'free',
        followers: data.followers?.total || 0,
        avatarUrl: data.images?.[0]?.url || undefined,
      };

      this.spotify.user = userObj;
      this.persistSpotify();
      this.notify();
      return userObj;
    } catch (err) {
      console.warn('fetchUserProfile error:', err);
      throw err;
    }
  }

  // 2. Sync the user's real listening history with a resilient fallback chain.
  //    Spotify restricted /v1/audio-features for new apps, so BPM/energy is
  //    estimated locally (deterministically per track) when the API refuses.
  async syncHistory(token: string): Promise<SpotifySong[]> {
    try {
      let songs = await this.fetchRecentlyPlayed(token);
      let usedSource: SpotifySyncSource | undefined = songs.length > 0 ? 'recently-played' : undefined;

      if (songs.length === 0) {
        songs = await this.fetchTopTracks(token);
        usedSource = songs.length > 0 ? 'top-tracks' : undefined;
      }

      if (songs.length === 0) {
        songs = await this.fetchSavedTracks(token);
        usedSource = songs.length > 0 ? 'saved-tracks' : undefined;
      }

      if (songs.length === 0) {
        this.spotify.recentlyPlayed = [];
        this.spotify.syncSource = undefined;
        this.persistSpotify();
        this.notify();
        return [];
      }

      this.spotify.recentlyPlayed = songs;
      this.spotify.syncSource = usedSource;
      this.persistSpotify();
      this.enrichArtistGenres(token);
      this.notify();
      return songs;
    } catch (err) {
      console.warn('syncHistory error:', err);
      throw err;
    }
  }

  // Fetch recently played tracks (requires user-read-recently-played)
  async fetchRecentlyPlayed(token: string): Promise<SpotifySong[]> {
    try {
      const response = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=20', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        this.disconnectSpotify();
        return [];
      }
      if (!response.ok) return [];
      const data = await response.json();
      const items = (data.items || []).filter((item: any) => item && item.track);
      if (items.length === 0) return [];
      return this.mapTracks(
        items.map((item: any) => item.track),
        token,
        'recently-played',
        items.map((item: any) => item.played_at)
      );
    } catch (err) {
      console.warn('fetchRecentlyPlayed error:', err);
      return [];
    }
  }

  // Fallback 1: user's top tracks over the last 4 weeks (requires user-top-read)
  async fetchTopTracks(token: string): Promise<SpotifySong[]> {
    try {
      const response = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=20&time_range=short_term', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return [];
      const data = await response.json();
      const items = (data.items || []).filter((item: any) => item && item.id);
      if (items.length === 0) return [];
      return this.mapTracks(items, token, 'top-tracks');
    } catch (err) {
      console.warn('fetchTopTracks error:', err);
      return [];
    }
  }

  // Fallback 2: user's saved tracks (requires user-library-read)
  async fetchSavedTracks(token: string): Promise<SpotifySong[]> {
    try {
      const response = await fetch('https://api.spotify.com/v1/me/tracks?limit=20', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return [];
      const data = await response.json();
      const items = (data.items || []).filter((item: any) => item && item.track);
      if (items.length === 0) return [];
      return this.mapTracks(
        items.map((item: any) => item.track),
        token,
        'saved-tracks'
      );
    } catch (err) {
      console.warn('fetchSavedTracks error:', err);
      return [];
    }
  }

  // Map raw track objects to SpotifySong, fetching audio features when the
  // API still allows it and falling back to deterministic local estimates.
  private async mapTracks(
    tracks: any[],
    token: string,
    source: SpotifySyncSource,
    playedAt?: (string | null)[]
  ): Promise<SpotifySong[]> {
    const trackIds: string[] = [];
    tracks.forEach((track) => {
      if (track && track.id && !trackIds.includes(track.id)) trackIds.push(track.id);
    });
    if (trackIds.length === 0) return [];

    let audioFeatures: any[] = [];
    try {
      const featuresResponse = await fetch(`https://api.spotify.com/v1/audio-features?ids=${trackIds.join(',')}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (featuresResponse.ok) {
        const featData = await featuresResponse.json();
        audioFeatures = featData.audio_features || [];
      }
    } catch (err) {
      console.warn('audio-features unavailable, using local estimates:', err);
    }

    const songs: SpotifySong[] = [];
    tracks.forEach((track, idx) => {
      if (!track || !track.id) return;
      const features = audioFeatures.find((f: any) => f && f.id === track.id);
      const hasFeatures = !!features;
      const artistNames = (track.artists || []).map((a: any) => a.name);
      const artistIds = (track.artists || []).map((a: any) => a.id).filter(Boolean);
      songs.push({
        trackId: track.id,
        title: track.name,
        artist: artistNames.join(', '),
        artistIds,
        genres: this.resolveGenres(artistIds, artistNames),
        bpm: hasFeatures ? Math.round(features.tempo) : this.estimateBpm(track.id),
        energy: hasFeatures ? features.energy : this.estimateEnergy(track.id),
        valence: hasFeatures ? features.valence : this.estimateValence(track.id),
        bpmEstimated: !hasFeatures,
        timestamp: playedAt && playedAt[idx] ? new Date(playedAt[idx] as string).getTime() : Date.now() - idx * 1000,
        source,
      });
    });
    return songs;
  }

  // Best-effort genre resolution from the local cache. If a track's artists
  // haven't been cached yet, we request them once via enrichArtistGenres.
  private resolveGenres(artistIds: string[], artistNames: string[]): string[] {
    const genres = new Set<string>();
    artistIds.forEach((id) => {
      const cached = this.artistGenres[id];
      if (cached) cached.forEach((g) => genres.add(g));
    });
    artistNames.forEach((name) => {
      const cached = this.artistGenres[this.normalizeArtist(name)];
      if (cached) cached.forEach((g) => genres.add(g));
    });
    return [...genres];
  }

  // Fetch & cache genres for artists seen in this sync batch so the recommender
  // can use real genre tags (not just artist names) going forward.
  async enrichArtistGenres(token: string): Promise<void> {
    const pendingIds = new Set<string>();
    const pendingNames = new Set<string>();
    this.spotify.recentlyPlayed.forEach((s) => {
      (s.artistIds || []).forEach((id) => {
        if (!this.artistGenres[id]) pendingIds.add(id);
      });
      const norm = this.normalizeArtist(s.artist);
      if (!this.artistGenres[norm]) pendingNames.add(norm);
    });

    const allIds = [...pendingIds, ...pendingNames].filter(Boolean);
    if (allIds.length === 0) return;

    try {
      // Query in batches of 50 (Spotify limit for the artists endpoint).
      for (let i = 0; i < allIds.length; i += 50) {
        const chunk = allIds.slice(i, i + 50).join(',');
        const res = await fetch(`https://api.spotify.com/v1/artists?ids=${chunk}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) continue;
        const data = await res.json();
        (data.artists || []).forEach((artist: any) => {
          if (!artist) return;
          const genres = artist.genres || [];
          this.artistGenres[artist.id] = genres;
          this.artistGenres[this.normalizeArtist(artist.name)] = genres;
        });
      }
      await this.persistArtistGenres();
      this.notify();
    } catch (err) {
      console.warn('enrichArtistGenres error:', err);
    }
  }

  private async persistArtistGenres() {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.ARTIST_GENRES, JSON.stringify(this.artistGenres));
    } catch (e) {
      console.warn('Failed to persist artist genres:', e);
    }
  }

  private normalizeArtist(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Deterministic per-track estimates (stable across syncs) used when
  // Spotify's audio features endpoint is unavailable for the app.
  private estimateBpm(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return 90 + (h % 91); // 90-180 BPM
  }

  private estimateEnergy(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
    return Math.round((0.4 + ((h % 100) / 100) * 0.5) * 100) / 100; // 0.4-0.9
  }

  private estimateValence(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 37 + id.charCodeAt(i)) >>> 0;
    return Math.round((0.2 + ((h % 100) / 100) * 0.7) * 100) / 100; // 0.2-0.9
  }

  // 3. Query currently playing track + features
  async fetchCurrentlyPlaying(token: string) {
    try {
      const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 204) return null; // nothing playing
      if (!response.ok) {
        if (response.status === 401) this.disconnectSpotify();
        return null;
      }
      const data = await response.json();
      if (!data || !data.item) return null;

      const track = data.item;
      const trackId = track.id;

      // Fetch features for this single song
      const featuresResponse = await fetch(`https://api.spotify.com/v1/audio-features/${trackId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      // Spotify restricted /v1/audio-features for new apps, so fall back to
      // deterministic local estimates (same as the history sync path).
      let bpm = this.estimateBpm(trackId);
      let energy = this.estimateEnergy(trackId);
      if (featuresResponse.ok) {
        const feat = await featuresResponse.json();
        bpm = feat.tempo ? Math.round(feat.tempo) : bpm;
        energy = typeof feat.energy === 'number' ? feat.energy : energy;
      }

      return {
        id: trackId,
        title: track.name,
        artist: track.artists.map((a: any) => a.name).join(', '),
        bpm,
        energy,
        progressMs: data.progress_ms || 0,
        isPlaying: data.is_playing,
      };
    } catch (err) {
      console.warn('fetchCurrentlyPlaying error:', err);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Recommendation — ML model only (ponytail: no Spotify fallback, no catalog)
  // Each heard track -> ReccoBeats features -> recommend_eng + recommend_hin -> top 3
  // ---------------------------------------------------------------------------

  // Flatten songs heard during workouts into ListenRecords (for profile). Kept for DNA UI.
  getListeningHistory(workoutId?: string): ListenRecord[] {
    const now = Date.now();
    const records: ListenRecord[] = [];
    this.history
      .filter((w) => (workoutId ? w.id === workoutId : true))
      .forEach((w) => {
        const workoutTime = new Date(w.date).getTime();
        w.songsHeard.forEach((song) => {
          records.push({
            title: song.title,
            artist: song.artist,
            genres: [],
            bpm: song.bpm,
            energy: song.energy,
            timestamp: workoutTime || now,
          });
        });
      });
    return records;
  }

  getPreferenceProfile(): PreferenceProfile {
    return buildProfile(this.getListeningHistory());
  }

  // Collect distinct Spotify track ids from workouts
  private getHeardTrackIds(workoutId?: string): string[] {
    const ids: string[] = [];
    this.history
      .filter((w) => (workoutId ? w.id === workoutId : true))
      .forEach((w) => w.songsHeard.forEach((s) => { if (s.trackId) ids.push(s.trackId); }));
    return [...new Set(ids)];
  }

  // Only ML model — no fallback. Returns [] if no trackIds or ML unreachable.
  async getRecommendations(opts?: { limit?: number; includeHeard?: boolean }): Promise<Recommendation[]> {
    const trackIds = this.getHeardTrackIds();
    const limit = opts?.limit ?? 12;
    const results = trackIds.length ? await recommendForTracks(trackIds, limit) : [];
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.RECOMMENDATIONS, JSON.stringify({ at: Date.now(), results }));
    } catch (e) {
      console.warn('Failed to persist recommendations:', e);
    }
    return results;
  }

  async getActivityRecommendations(workoutId: string, limit = 5): Promise<Recommendation[]> {
    const trackIds = this.getHeardTrackIds(workoutId);
    if (!trackIds.length) return [];
    return recommendForTracks(trackIds, limit);
  }

  // Load the last persisted recommendation run (no recomputation).
  async getCachedRecommendations(): Promise<Recommendation[] | null> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.RECOMMENDATIONS);
      return data ? JSON.parse(data).results : null;
    } catch (e) {
      console.warn('Failed to load cached recommendations:', e);
      return null;
    }
  }
}

export const store = new AppStore();
