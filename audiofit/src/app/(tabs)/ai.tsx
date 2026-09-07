import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Linking, Alert, Platform, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Sparkles, Music, ListPlus, ListMusic, Search, ExternalLink, Pencil } from 'lucide-react-native';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/Button';
import { store } from '@/constants/store';
import { ProfileManager } from '@/constants/profileManager';
import { resolveAudioFeatures } from '@/constants/mlRecommender';
import { isValidUserProfile, type AudioFeatures } from '@/constants/audioFeatures';
import { resolveTracks, addToQueue, createPlaylist, ResolvedTrack } from '@/services/spotifyWrite';

const AI_BASE = 'https://audiofit-ml-backend.onrender.com';
const REQUEST_TIMEOUT_MS = 90000;
const TASTE_CARD_KEY = '@audiofit/taste_card';
const V2_PROFILE_FALLBACK_KEY = '@audiofit/v2_profile';
const PROVIDER_KEY = '@audiofit/provider';
const AI_LANG_KEY = '@audiofit/ai_language';
const PRESETS = [
  '30 min easy run 6:30-7/km mix English Hindi',
  'Hindi workout push 140+ BPM',
  'English chill warmup',
  'Cooldown Hindi romantic',
  'PR tempo run high energy',
];

type Lang = 'mix' | 'english' | 'hindi';
type Provider = 'gemini' | 'mistral';
type Mode = 'hybrid' | 'hybrid-fallback' | 'open-world';

const MODE_BADGE: Record<Mode, string> = {
  hybrid: 'For you',
  'hybrid-fallback': 'Taste match (offline ranking)',
  'open-world': 'General',
};

// Backend may return either shape: hybrid (track_id/track_name/...) or legacy (title/artist).
interface HybridSong {
  track_id?: string;
  track_name?: string;
  title?: string;
  artist_name?: string;
  artist?: string;
  album_name?: string;
  year?: number;
  language?: string;
  popularity?: number;
  reason?: string;
  v2_score?: number;
}

interface DisplayTrack extends ResolvedTrack {
  v2Score?: number | null;
  language?: string | null;
  albumName?: string | null;
  year?: number | null;
}

// ponytail: ~3.5 min/song avg — no cap, min 3 as requested
function countForDuration(prompt: string, fallbackMin = 20): number {
  const t = prompt.toLowerCase();
  let mins: number | null = null;
  const hour = t.match(/(\d+(?:\.\d+)?)\s*(hour|hr|hrs)\b/);
  const min = t.match(/(\d+(?:\.\d+)?)\s*(m\b|min|mins|minute|minutes)\b/);
  if (hour) mins = Math.round(parseFloat(hour[1]) * 60);
  else if (min) mins = Math.round(parseFloat(min[1]));
  if (mins === null) {
    const bare = t.match(/\b(\d{1,3})\s*(?=(min|run|walk|easy|tempo|chill|cooldown|workout|playlist|song))/);
    if (bare) {
      const n = parseInt(bare[1], 10);
      if (n >= 5 && n <= 300) mins = n;
    }
  }
  if (mins === null) mins = fallbackMin;
  const count = Math.ceil(mins / 3.5);
  return Math.max(3, count);
}

async function postAiRecommend(body: Record<string, unknown>): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${AI_BASE}/ai-recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: c.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

// Resolve the seed "current song" for hybrid: freshest now-playing id available
// (recently-played head → live currently-playing → last workout song), then its
// 9 audio feats via ReccoBeats with deterministic local fallback. Null = legacy.
async function resolveSeedSong(): Promise<{ id: string; title: string; artist: string; features: AudioFeatures } | null> {
  const candidates: { id?: string; title: string; artist: string }[] = [];
  const sp = store.getSpotifyState();
  const rp0 = sp.recentlyPlayed?.[0];
  if (rp0) candidates.push({ id: rp0.trackId, title: rp0.title, artist: rp0.artist });
  if (sp.isConnected && sp.accessToken) {
    try {
      const token = await store.getValidAccessToken();
      if (token) {
        const now = await store.fetchCurrentlyPlaying(token);
        if (now?.id) candidates.unshift({ id: now.id, title: now.title, artist: now.artist });
      }
    } catch {
      // ignore — fall through to cached candidates
    }
  }
  if (candidates.length === 0) {
    for (const w of store.getHistory()) {
      const s = w.songsHeard?.find((x) => x.trackId);
      if (s) {
        candidates.push({ id: s.trackId, title: s.title, artist: s.artist });
        break;
      }
    }
  }
  for (const c of candidates) {
    if (!c.id) continue;
    try {
      const { features } = await resolveAudioFeatures(c.id);
      return { id: c.id, title: c.title, artist: c.artist, features };
    } catch {
      // try next candidate
    }
  }
  return null;
}

export default function AIRecommenderScreen() {
  const colors = useTheme();
  const router = useRouter();

  const [storeState, setStoreState] = useState(store.getSpotifyState());
  useEffect(() => {
    const unsub = store.subscribe(() => setStoreState(store.getSpotifyState()));
    return () => { unsub(); };
  }, []);

  const [prompt, setPrompt] = useState('');
  const [lang, setLang] = useState<Lang>('mix');
  const [provider, setProvider] = useState<Provider>('gemini');
  const [tasteCard, setTasteCard] = useState<Record<string, unknown> | string | null>(null);
  const [userProfile, setUserProfile] = useState<number[] | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [seedInfo, setSeedInfo] = useState<{ title: string; artist: string } | null>(null);
  const [seedNote, setSeedNote] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<DisplayTrack[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [isQueuing, setIsQueuing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Load taste context on mount/focus — read-only, never refetches onboarding.
  const loadTasteContext = useCallback(async () => {
    try {
      const [cardRaw, provRaw, langRaw] = await Promise.all([
        AsyncStorage.getItem(TASTE_CARD_KEY),
        AsyncStorage.getItem(PROVIDER_KEY),
        AsyncStorage.getItem(AI_LANG_KEY),
      ]);
      if (provRaw === 'gemini' || provRaw === 'mistral') setProvider(provRaw);
      if (langRaw === 'mix' || langRaw === 'english' || langRaw === 'hindi') setLang(langRaw);
      if (cardRaw) {
        try {
          setTasteCard(JSON.parse(cardRaw) as Record<string, unknown> | string);
        } catch {
          setTasteCard(cardRaw);
        }
      } else {
        setTasteCard(null);
      }
    } catch {
      // keep defaults on storage failure
    }
    // Canonical profile via ProfileManager; fall back to legacy key read-only.
    let profile: unknown = await ProfileManager.load().catch(() => null);
    if (!isValidUserProfile(profile)) {
      try {
        const raw = await AsyncStorage.getItem(V2_PROFILE_FALLBACK_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        const cand = Array.isArray(parsed) ? parsed : (parsed as { profile?: unknown } | null)?.profile;
        profile = isValidUserProfile(cand) ? cand : null;
      } catch {
        profile = null;
      }
    }
    setUserProfile(isValidUserProfile(profile) ? profile : null);
  }, []);

  // (mount is covered by useFocusEffect below)
  useFocusEffect(
    useCallback(() => {
      loadTasteContext();
    }, [loadTasteContext])
  );

  const changeProvider = async (p: Provider) => {
    setProvider(p);
    try {
      await AsyncStorage.setItem(PROVIDER_KEY, p);
    } catch {
      // ignore persistence failure
    }
  };

  const changeLang = async (l: Lang) => {
    setLang(l);
    try {
      await AsyncStorage.setItem(AI_LANG_KEY, l);
    } catch {
      // ignore persistence failure
    }
  };

  // ponytail: no VibeInput route exists yet — point at the existing taste editor
  // (onboarding-favorites); switch to '/vibe-input' once that screen lands.
  const goEditVibe = () => {
    router.push('/onboarding-favorites' as never);
  };

  const showAlert = (title: string, msg: string) => {
    if (Platform.OS === 'web') setActionMsg(`${title}: ${msg}`);
    else Alert.alert(title, msg);
  };

  const handleAsk = async () => {
    const q = prompt.trim().slice(0, 500);
    if (!q) {
      setError('Type something — e.g. "30 min easy run mix English Hindi"');
      return;
    }
    setError(null);
    setActionMsg(null);
    setIsLoading(true);
    setTracks([]);
    setSelected(new Set());
    setMode(null);
    setSeedNote(null);
    try {
      const count = countForDuration(q);
      const seed = await resolveSeedSong();
      setSeedInfo(seed ? { title: seed.title, artist: seed.artist } : null);

      const useHybrid = tasteCard != null && isValidUserProfile(userProfile) && seed != null;
      const baseBody: Record<string, unknown> = { prompt: q, language: lang, count, provider };
      const body: Record<string, unknown> = useHybrid
        ? { ...baseBody, taste_card: tasteCard, user_profile: userProfile, current_song: seed!.features }
        : baseBody;
      if (!useHybrid) {
        setMode('open-world');
        setSeedNote(
          tasteCard == null
            ? 'General suggestions — no taste card saved yet.'
            : seed == null
              ? 'General suggestions — play a song for personalized picks.'
              : 'General suggestions — finish your taste profile for personalized picks.'
        );
      }

      let activeProvider = provider;
      let res = await postAiRecommend(body);
      if ((res.status === 500 || res.status === 502)) {
        // LLM down — auto-retry once with flipped provider, then surface error.
        const flipped: Provider = activeProvider === 'gemini' ? 'mistral' : 'gemini';
        setProvider(flipped);
        try {
          await AsyncStorage.setItem(PROVIDER_KEY, flipped);
        } catch {
          // ignore persistence failure
        }
        setActionMsg(`Retrying with ${flipped}…`);
        activeProvider = flipped;
        res = await postAiRecommend({ ...body, provider: flipped });
      }
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        if (res.status === 400) {
          throw new Error(t.slice(0, 300) || 'Invalid request — check your prompt (a seed song is needed for personalized picks).');
        }
        throw new Error(t.slice(0, 300) || `AI ${res.status}`);
      }
      const data = await res.json();
      const rawSongs: HybridSong[] = data.songs || data.recommendations || [];
      if (!rawSongs.length) throw new Error('No songs returned. Try a different prompt.');

      const looksHybrid = rawSongs.some((s) => s.track_id != null || s.track_name != null);
      const respMode: Mode =
        data.mode === 'hybrid' || data.mode === 'hybrid-fallback'
          ? data.mode
          : looksHybrid
            ? 'hybrid'
            : 'open-world';
      setMode(respMode);

      if (looksHybrid) {
        // Hybrid: track_ids are catalog-real — use directly, no Spotify search.
        const mapped: DisplayTrack[] = rawSongs.map((s) => {
          const id = s.track_id ?? null;
          return {
            id,
            title: s.track_name ?? s.title ?? 'Unknown title',
            artist: s.artist_name ?? s.artist ?? 'Unknown artist',
            reason: s.reason ?? '',
            image: null,
            previewUrl: null,
            uri: id ? `spotify:track:${id}` : null,
            v2Score: typeof s.v2_score === 'number' ? s.v2_score : null,
            language: s.language ?? null,
            albumName: s.album_name ?? null,
            year: typeof s.year === 'number' ? s.year : null,
          };
        });
        setTracks(mapped);
        setSelected(new Set(mapped.filter((t) => t.id).map((t) => t.id!)));
        return;
      }

      // Legacy open-world — resolve titles to real Spotify IDs as before.
      const songs = rawSongs.map((s) => ({
        title: s.title ?? s.track_name ?? 'Unknown title',
        artist: s.artist ?? s.artist_name ?? 'Unknown artist',
        reason: s.reason ?? '',
      }));
      if (!storeState.isConnected || !storeState.accessToken) {
        const unresolved: DisplayTrack[] = songs.map((s) => ({ ...s, id: null, image: null, previewUrl: null, uri: null }));
        setTracks(unresolved);
        setError(null);
        setActionMsg('Connect Spotify to play / add to queue / create playlist. Showing titles only.');
        return;
      }
      const token = (await store.getValidAccessToken()) || storeState.accessToken;
      if (!token) {
        setTracks(songs.map((s) => ({ ...s, id: null, image: null, previewUrl: null, uri: null })));
        setError('Spotify session expired. Please reconnect.');
        return;
      }
      const resolved = await resolveTracks(token, songs);
      setTracks(resolved);
      // auto-select all resolved
      setSelected(new Set(resolved.filter((t) => t.id).map((t) => t.id!) ));
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setError('Request timed out (~90s). Check your connection and tap Retry.');
      } else {
        const msg = e instanceof Error ? e.message : 'Failed to get recommendations';
        setError(`${msg} — tap Retry to try again.`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedIds = tracks.filter((t) => t.id && selected.has(t.id)).map((t) => t.id!);

  const handlePlay = (t: DisplayTrack) => {
    if (!t.id) {
      showAlert('Not playable', 'No Spotify ID found for this title. Try another.');
      return;
    }
    Linking.openURL(`https://open.spotify.com/track/${t.id}`).catch(() => showAlert('Error', 'Could not open Spotify'));
  };

  const handleAddQueue = async () => {
    if (selectedIds.length === 0) {
      showAlert('Select songs', 'Tap songs to select before adding to queue.');
      return;
    }
    if (!storeState.isConnected) {
      showAlert('Connect Spotify', 'Please connect Spotify first (Spotify & DNA tab).');
      return;
    }
    setIsQueuing(true);
    setActionMsg(null);
    try {
      const token = (await store.getValidAccessToken()) || storeState.accessToken!;
      for (const id of selectedIds) {
        await addToQueue(token, id);
      }
      showAlert('Added to Queue', `${selectedIds.length} song(s) added to your Spotify queue. Open Spotify to hear them.`);
      setActionMsg(`Added ${selectedIds.length} to queue`);
    } catch (e: unknown) {
      const msg = String(e instanceof Error ? e.message : e || '');
      if (msg.includes('403') || msg.includes('404') || msg.includes('NO_ACTIVE_DEVICE')) {
        showAlert('Spotify Premium / Active device needed', 'Queue needs Premium and an active Spotify device. Open Spotify and play something first, or use Create Playlist instead.');
      } else if (msg.includes('401')) {
        showAlert('Session expired', 'Please reconnect Spotify in the Spotify & DNA tab.');
      } else {
        showAlert('Queue failed', msg.slice(0, 300) || 'Unknown error');
      }
      setActionMsg(`Queue failed: ${msg.slice(0, 120)}`);
    } finally {
      setIsQueuing(false);
    }
  };

  const handleCreatePlaylist = async () => {
    if (selectedIds.length === 0) {
      showAlert('Select songs', 'Tap songs to select before creating a playlist.');
      return;
    }
    if (!storeState.isConnected || !storeState.user?.id) {
      showAlert('Connect Spotify', 'Please connect Spotify first. Playlist creation needs your account.');
      return;
    }
    setIsCreating(true);
    setActionMsg(null);
    try {
      const token = (await store.getValidAccessToken()) || storeState.accessToken!;
      const name = `AudioFit AI — ${prompt.slice(0, 36)}`.trim() || 'AudioFit AI Mix';
      const pid = await createPlaylist(token, storeState.user.id, name, selectedIds, `Prompt: ${prompt}`);
      showAlert('Playlist created', `"${name}" with ${selectedIds.length} songs saved to your Spotify.`);
      setActionMsg(`Playlist "${name}" created (${pid.slice(0, 8)}…)`);
    } catch (e: unknown) {
      const msg = String(e instanceof Error ? e.message : e || '');
      showAlert('Playlist failed', msg.slice(0, 300));
      setActionMsg(`Playlist failed: ${msg.slice(0, 120)}`);
    } finally {
      setIsCreating(false);
    }
  };

  const isConnected = storeState.isConnected;
  const tasteEntries: [string, unknown][] =
    tasteCard != null && typeof tasteCard === 'object' ? Object.entries(tasteCard).slice(0, 10) : [];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>Hybrid AI · Taste Card aware</Text>
          <Text style={[styles.headerTitle, { color: colors.text }]}>AI Recommender</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: isConnected ? '#1DB95415' : colors.backgroundElement, borderColor: isConnected ? '#1DB954' : colors.cardBorder }]}>
          <Music size={14} color={isConnected ? '#1DB954' : colors.textSecondary} />
          <Text style={[styles.badgeText, { color: isConnected ? '#1DB954' : colors.textSecondary }]}>{isConnected ? 'Spotify OK' : 'Not connected'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Prompt input */}
        <View style={[styles.card, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <Sparkles size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>What do you want to hear?</Text>
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Type anything — “easy run 30 min 6:30/km English Hindi”, “chill Hindi romantic”, etc.</Text>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder='e.g. 30 min easy run 6:30-7/km mix English Hindi'
            placeholderTextColor={colors.textSecondary}
            multiline
            style={[styles.input, { color: colors.text, borderColor: colors.cardBorder, backgroundColor: colors.background }]}
          />
          <View style={styles.langRow}>
            {(['mix', 'english', 'hindi'] as Lang[]).map((l) => (
              <Pressable key={l} onPress={() => changeLang(l)} style={[styles.langChip, { borderColor: colors.cardBorder, backgroundColor: lang === l ? colors.primary + '18' : colors.background }, lang === l ? { borderColor: colors.primary } : {}]}>
                <Text style={[styles.langText, { color: lang === l ? colors.primary : colors.textSecondary }]}>{l === 'mix' ? 'Mix' : l === 'english' ? 'English' : 'Hindi'}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.providerRow}>
            <Text style={[styles.providerLabel, { color: colors.textSecondary }]}>Model:</Text>
            {(['gemini', 'mistral'] as Provider[]).map((p) => (
              <Pressable key={p} onPress={() => changeProvider(p)} style={[styles.langChip, { borderColor: colors.cardBorder, backgroundColor: provider === p ? colors.accent + '18' : colors.background }, provider === p ? { borderColor: colors.accent } : {}]}>
                <Text style={[styles.langText, { color: provider === p ? colors.accent : colors.textSecondary }]}>{p}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.presetWrap}>
            {PRESETS.map((p) => (
              <Pressable key={p} onPress={() => setPrompt(p)} style={[styles.presetChip, { borderColor: colors.cardBorder, backgroundColor: colors.backgroundSelected }]}>
                <Text style={[styles.presetText, { color: colors.text }]} numberOfLines={1}>{p}</Text>
              </Pressable>
            ))}
          </View>
          <Button title={isLoading ? 'Asking AI...' : 'Ask AI → Get Songs'} variant="primary" onPress={handleAsk} isLoading={isLoading} disabled={isLoading} icon={<Search size={16} color="#000" />} style={styles.askBtn} />
          {error && <Text style={styles.errorText}>{error}</Text>}
          {error && !isLoading && (
            <Button title="Retry" variant="secondary" onPress={handleAsk} style={styles.retryBtn} textStyle={{ fontSize: 13 }} />
          )}
          {seedNote && <Text style={[styles.seedNote, { color: colors.textSecondary }]}>{seedNote}</Text>}
          {seedInfo && tasteCard != null && (
            <Text style={[styles.seedNote, { color: colors.textSecondary }]}>Seed: {seedInfo.title} — {seedInfo.artist}</Text>
          )}
          {actionMsg && <Text style={[styles.actionMsg, { color: colors.accent }]}>{actionMsg}</Text>}
          {!isConnected && <Text style={[styles.connectHint, { color: colors.textSecondary }]}>Tip: Connect Spotify in “Spotify & DNA” tab to enable Play / Queue / Playlist. Without it you’ll see titles only.</Text>}
        </View>

        {/* Results */}
        {tracks.length > 0 && (
          <>
            <View style={styles.listHeader}>
              <ListMusic size={16} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>AI Picks ({tracks.length})</Text>
              {mode && (
                <View style={[styles.modeBadge, { borderColor: colors.cardBorder, backgroundColor: colors.backgroundSelected }]}>
                  <Text style={[styles.modeBadgeText, { color: colors.primary }]}>{MODE_BADGE[mode]}</Text>
                </View>
              )}
              <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>Tap to select</Text>
            </View>

            {/* Bulk actions */}
            <View style={styles.bulkRow}>
              <Pressable onPress={() => setSelected(new Set(tracks.filter((t) => t.id).map((t) => t.id!)))} style={[styles.bulkBtn, { borderColor: colors.cardBorder }]}>
                <Text style={[styles.bulkText, { color: colors.text }]}>Select all</Text>
              </Pressable>
              <Pressable onPress={() => setSelected(new Set())} style={[styles.bulkBtn, { borderColor: colors.cardBorder }]}>
                <Text style={[styles.bulkText, { color: colors.textSecondary }]}>Clear</Text>
              </Pressable>
              <Text style={[styles.selectCount, { color: colors.primary }]}>{selectedIds.length} selected</Text>
            </View>

            <View style={styles.trackList}>
              {tracks.map((t, idx) => {
                const isSel = t.id ? selected.has(t.id) : false;
                return (
                  <Pressable
                    key={`${t.title}-${t.artist}-${idx}`}
                    onPress={() => t.id && toggleSelect(t.id)}
                    style={[styles.trackCard, { backgroundColor: colors.backgroundElement, borderColor: isSel ? colors.primary : colors.cardBorder }, isSel ? { borderWidth: 1.5 } : {}]}
                  >
                    <View style={[styles.rank, { backgroundColor: isSel ? colors.primary + '18' : colors.backgroundSelected }]}>
                      <Text style={[styles.rankText, { color: isSel ? colors.primary : colors.text }]}>{idx + 1}</Text>
                    </View>
                    {t.image ? <Image source={{ uri: t.image }} style={styles.thumb} /> : <View style={[styles.thumbFallback, { backgroundColor: colors.backgroundSelected }]}><Music size={16} color={colors.textSecondary} /></View>}
                    <View style={styles.trackMeta}>
                      <Text style={[styles.trackTitle, { color: colors.text }]} numberOfLines={1}>
                        {t.title} — {t.artist}{t.language ? ` [${t.language}]` : ''}
                      </Text>
                      {t.albumName || t.year ? (
                        <Text style={[styles.trackArtist, { color: colors.textSecondary }]} numberOfLines={1}>
                          {[t.albumName, t.year ? String(t.year) : null].filter(Boolean).join(' · ')}
                        </Text>
                      ) : null}
                      {t.reason ? <Text style={[styles.trackReason, { color: colors.accent }]} numberOfLines={2}>{t.reason}</Text> : null}
                      {typeof t.v2Score === 'number' && (
                        <Text style={[styles.v2Score, { color: colors.textSecondary }]}>match {(t.v2Score * 100).toFixed(1)}%</Text>
                      )}
                      {!t.id && <Text style={[styles.noId, { color: '#FF3B30' }]}>No Spotify match</Text>}
                    </View>
                    <Pressable onPress={() => handlePlay(t)} hitSlop={8} style={[styles.playBtnSmall, { backgroundColor: colors.primary + '14' }]}>
                      <ExternalLink size={14} color={colors.primary} />
                    </Pressable>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.actionRow}>
              <Button title={isQueuing ? 'Queuing...' : `Add to Queue (${selectedIds.length})`} variant="secondary" onPress={handleAddQueue} isLoading={isQueuing} icon={<ListPlus size={16} color={colors.text} />} style={styles.actionBtn} />
              <Button title={isCreating ? 'Creating...' : `Create Playlist (${selectedIds.length})`} variant="primary" onPress={handleCreatePlaylist} isLoading={isCreating} icon={<ListMusic size={16} color="#000" />} style={styles.actionBtn} />
            </View>
            <Text style={[styles.premiumNote, { color: colors.textSecondary }]}>Spotify Queue needs Premium + an active Spotify device (open Spotify and play something first). If it fails, use Create Playlist instead.</Text>
          </>
        )}

        {isLoading && (
          <View style={styles.centered}>
            <Text style={{ color: colors.textSecondary }}>Asking {provider} & resolving songs...</Text>
          </View>
        )}

        {/* Your Taste Card */}
        <View style={[styles.card, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <Music size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Your Taste Card</Text>
            <Pressable onPress={goEditVibe} hitSlop={8} style={styles.editVibe}>
              <Pencil size={13} color={colors.accent} />
              <Text style={[styles.editVibeText, { color: colors.accent }]}>Edit vibe</Text>
            </Pressable>
          </View>
          {tasteCard == null ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>No taste card saved yet. Build one from onboarding to unlock personalized hybrid picks.</Text>
          ) : typeof tasteCard === 'string' ? (
            <Text style={[styles.tasteText, { color: colors.text }]}>{tasteCard}</Text>
          ) : tasteEntries.length === 0 ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>Taste card is empty.</Text>
          ) : (
            <View style={styles.tasteList}>
              {tasteEntries.map(([k, v]) => (
                <View key={k} style={styles.tasteRow}>
                  <Text style={[styles.tasteKey, { color: colors.textSecondary }]}>{k}</Text>
                  <Text style={[styles.tasteValue, { color: colors.text }]} numberOfLines={3}>
                    {Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <Text style={[styles.tasteMeta, { color: colors.textSecondary }]}>
            Profile: {userProfile ? `9D active (${userProfile.slice(0, 3).map((x) => x.toFixed(2)).join(', ')}…)` : 'not set'}
          </Text>
          <Text style={[styles.tasteMeta, { color: colors.textSecondary }]}>Model: {provider}{seedInfo ? ` · Seed: ${seedInfo.title} — ${seedInfo.artist}` : ''}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, marginBottom: 16 },
  headerSub: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  headerTitle: { fontSize: 22, fontWeight: '700' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  content: { paddingHorizontal: 20, paddingBottom: 100 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 20 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  hint: { fontSize: 12, lineHeight: 16, marginBottom: 12 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, minHeight: 56, textAlignVertical: 'top', marginBottom: 12 },
  langRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  providerLabel: { fontSize: 12, fontWeight: '600' },
  langChip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1 },
  langText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  presetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  presetChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, maxWidth: '100%' },
  presetText: { fontSize: 11, fontWeight: '500' },
  askBtn: { alignSelf: 'stretch' },
  retryBtn: { marginTop: 10, alignSelf: 'stretch' },
  errorText: { color: '#FF3B30', fontSize: 12, marginTop: 10, fontWeight: '600' },
  seedNote: { fontSize: 11, lineHeight: 14, marginTop: 8, fontStyle: 'italic' },
  actionMsg: { fontSize: 12, marginTop: 8, fontWeight: '600' },
  connectHint: { fontSize: 11, lineHeight: 14, marginTop: 8, fontStyle: 'italic' },
  listHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  sectionSub: { fontSize: 11 },
  modeBadge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1 },
  modeBadgeText: { fontSize: 11, fontWeight: '700' },
  bulkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  bulkBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1 },
  bulkText: { fontSize: 12, fontWeight: '600' },
  selectCount: { fontSize: 12, fontWeight: '700', marginLeft: 'auto' },
  trackList: { gap: 10, marginBottom: 16 },
  trackCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 12, fontWeight: '700' },
  thumb: { width: 40, height: 40, borderRadius: 6 },
  thumbFallback: { width: 40, height: 40, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  trackMeta: { flex: 1 },
  trackTitle: { fontSize: 13, fontWeight: '600' },
  trackArtist: { fontSize: 11, marginTop: 1 },
  trackReason: { fontSize: 11, marginTop: 3 },
  v2Score: { fontSize: 10, marginTop: 2, fontStyle: 'italic' },
  noId: { fontSize: 10, fontWeight: '700', marginTop: 2 },
  playBtnSmall: { padding: 8, borderRadius: 16 },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  actionBtn: { flex: 1 },
  premiumNote: { fontSize: 11, lineHeight: 14, fontStyle: 'italic', textAlign: 'center', marginBottom: 10 },
  centered: { alignItems: 'center', paddingVertical: 20 },
  editVibe: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
  editVibeText: { fontSize: 12, fontWeight: '700' },
  tasteList: { gap: 8, marginBottom: 10 },
  tasteRow: { flexDirection: 'row', gap: 8 },
  tasteKey: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize', width: 110 },
  tasteValue: { fontSize: 11, lineHeight: 15, flex: 1 },
  tasteText: { fontSize: 12, lineHeight: 17, marginBottom: 10 },
  tasteMeta: { fontSize: 11, lineHeight: 15, marginTop: 4 },
});
