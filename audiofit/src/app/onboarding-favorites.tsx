import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Check, Music, Search, Sparkles, Trash2 } from 'lucide-react-native';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/Button';
import { store } from '@/constants/store';
import { MIN_FAVORITE_SONGS } from '@/constants/audioFeatures';
import { API_BASE_URL, resolveAudioFeatures } from '@/constants/mlRecommender';
import { searchSpotifyTracks, SpotifySearchHit } from '@/services/spotifyWrite';

interface PickableSong {
  key: string;
  title: string;
  artist: string;
  trackId?: string;
  image?: string | null;
  source: string;
}

const SEARCH_DEBOUNCE_MS = 500;
const TASTE_CARD_KEY = '@audiofit/taste_card';
const TASTE_MAX_LEN = 500;
const TASTE_TIMEOUT_MS = 90000;

// POST /create_taste_card song payload: full 9 feats + names where available.
interface TasteSongPayload {
  acousticness: number;
  danceability: number;
  energy: number;
  instrumentalness: number;
  liveness: number;
  loudness: number;
  speechiness: number;
  tempo: number;
  valence: number;
  track_name?: string;
  artist_name?: string;
  language?: string;
}

async function postTasteCard(body: Record<string, unknown>): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TASTE_TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE_URL}/create_taste_card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: c.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

export default function OnboardingFavoritesScreen() {
  const colors = useTheme();
  const router = useRouter();

  const [spotifyState, setSpotifyState] = useState(store.getSpotifyState());
  const [hasProfile, setHasProfile] = useState(store.hasUserProfile());
  useEffect(() => {
    const unsub = store.subscribe(() => {
      setSpotifyState(store.getSpotifyState());
      setHasProfile(store.hasUserProfile());
    });
    return () => { unsub(); };
  }, []);

  // Library = real synced Spotify tracks (have trackIds).
  // Key includes the list index: the same track can legitimately appear
  // multiple times (re-syncs, workout-added songs), and trackId-only keys
  // caused "two children with the same key" warnings.
  const librarySongs: PickableSong[] = useMemo(
    () =>
      spotifyState.recentlyPlayed.map((s, i) => ({
        key: `library-${(s as any).trackId ?? 'noid'}-${i}`,
        title: s.title,
        artist: s.artist,
        trackId: (s as any).trackId,
        source: 'Your library',
      })),
    [spotifyState.recentlyPlayed]
  );

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SpotifySearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchSeq = useRef(0);

  // Debounced live Spotify search — every result carries a real track ID,
  // so feature resolution later uses real ReccoBeats values (no estimates).
  const searchActive = query.trim().length >= 2 && spotifyState.isConnected;
  useEffect(() => {
    if (!searchActive) return;
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      if (seq !== searchSeq.current) return;
      setIsSearching(true);
      setSearchError(null);
      try {
        let token = await store.getValidAccessToken();
        if (seq !== searchSeq.current) return;
        if (!token) {
          setIsSearching(false);
          setSearchError('Spotify session expired. Reconnect in the Spotify & DNA tab.');
          return;
        }
        try {
          const results = await searchSpotifyTracks(token, query.trim(), 20);
          if (seq !== searchSeq.current) return;
          setHits(results);
          setIsSearching(false);
        } catch (firstErr: any) {
          // One retry with a force-refreshed token on 401, then surface the real cause.
          if (String(firstErr?.message || '').includes('401')) {
            const retried = await store.refreshAccessToken();
            if (retried) {
              const results = await searchSpotifyTracks(retried, query.trim(), 20);
              if (seq !== searchSeq.current) return;
              setHits(results);
              setIsSearching(false);
              return;
            }
          }
          throw firstErr;
        }
      } catch (e: any) {
        if (seq !== searchSeq.current) return;
        setIsSearching(false);
        const msg = String(e?.message || '');
        console.warn('[favorites] live Spotify search failed:', msg);
        setSearchError(
          msg.includes('401')
            ? 'Spotify session expired. Reconnect in the Spotify & DNA tab.'
            : msg.includes('demo mode')
              ? 'Demo mode has no live search — connect your real Spotify account in the Spotify & DNA tab.'
              : msg.includes('Network error')
                ? `Couldn't reach Spotify (${msg}). Check your connection and try again.`
                : msg.includes('429')
                  ? 'Spotify is rate-limiting searches. Wait a few seconds and try again.'
                  : msg.includes('(404)')
                    ? 'Spotify couldn\'t process that search text. Try simpler words (no symbols).'
                    : 'Search failed. Check your connection and try again.'
        );
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchActive, query, spotifyState.isConnected]);

  // Stale hits are hidden at render time when search is inactive.
  // Index in the key guards against duplicate ids in one response batch.
  const searchSongs: PickableSong[] = useMemo(
    () =>
      (searchActive ? hits : []).map((h, i) => ({
        key: `search-${h.id}-${i}`,
        title: h.title,
        artist: h.artist,
        trackId: h.id,
        image: h.image,
        source: 'Search',
      })),
    [searchActive, hits]
  );

  // Library filtered locally by the same query.
  const filteredLibrary = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return librarySongs;
    return librarySongs.filter(
      (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
    );
  }, [librarySongs, query]);

  // Selection kept in a map so picks survive list/search changes.
  // (Selected rows show a check mark in place — no separate tray.)
  const [selectedMap, setSelectedMap] = useState<Map<string, PickableSong>>(new Map());
  const selected = useMemo(() => [...selectedMap.values()], [selectedMap]);

  // Optional free-text taste note, stored as the taste card for hybrid AI picks.
  const [tasteText, setTasteText] = useState('');
  useEffect(() => {
    AsyncStorage.getItem(TASTE_CARD_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === 'string') setTasteText(parsed);
          else if (parsed && typeof (parsed as { text?: unknown }).text === 'string') {
            setTasteText((parsed as { text: string }).text);
          }
        } catch {
          setTasteText(raw);
        }
      })
      .catch(() => {});
  }, []);

  const toggle = (song: PickableSong) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(song.key)) next.delete(song.key);
      else next.set(song.key, song);
      return next;
    });
  };

  const [phase, setPhase] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSubmit = selected.length >= MIN_FAVORITE_SONGS && !isSubmitting;

  const handleSubmit = async () => {
    if (selected.length < MIN_FAVORITE_SONGS) {
      setError(`Select at least ${MIN_FAVORITE_SONGS} songs (you have ${selected.length}).`);
      return;
    }
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      console.log('[onboarding] profile creation started, favorites:', selected.length);
      const favorites = [];
      const tasteSongs: TasteSongPayload[] = [];
      let i = 0;
      for (const p of selected) {
        i += 1;
        setPhase(`Resolving audio features ${i}/${selected.length}…`);
        const seed = p.trackId || `${p.artist}|${p.title}`;
        const { features, estimated } = await resolveAudioFeatures(seed);
        if (estimated) console.log('[onboarding] estimated features for:', p.title);
        favorites.push(features);
        // Full 9 feats + names — bare ids are rejected by /create_taste_card.
        tasteSongs.push({ ...features, track_name: p.title, artist_name: p.artist });
      }
      setPhase('Creating your profile…');
      await store.createProfileFromFavorites(favorites);

      // Taste card: backend-made from the same songs + vibe text.
      const trimmedTaste = tasteText.trim().slice(0, TASTE_MAX_LEN);
      setPhase('Creating your taste card…');
      const [storedLang, storedProv] = await Promise.all([
        AsyncStorage.getItem('@audiofit/ai_language'),
        AsyncStorage.getItem('@audiofit/provider'),
      ]);
      const language =
        storedLang === 'english' || storedLang === 'hindi' || storedLang === 'mix' ? storedLang : 'mix';
      const provider = storedProv === 'mistral' || storedProv === 'gemini' ? storedProv : 'gemini';
      try {
        if (tasteSongs.length < 3) throw new Error('Pick at least 3 songs.');
        const body = { favorite_songs: tasteSongs, vibe_text: trimmedTaste, language, provider };
        let res = await postTasteCard(body);
        if (res.status === 502) res = await postTasteCard(body); // one retry on LLM bad JSON
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(`taste-card ${res.status}: ${t.slice(0, 200)}`);
        }
        const data = await res.json();
        if (!data?.taste_card) throw new Error('Invalid taste card response.');
        // Same key the AI page reads — verified against its AsyncStorage.getItem call.
        await AsyncStorage.setItem(TASTE_CARD_KEY, JSON.stringify(data.taste_card));
        console.log('[onboarding] taste card created, model:', data?.model);
      } catch (tcErr: any) {
        // Local-save fallback — never leave the key empty after submit.
        try {
          const existing = await AsyncStorage.getItem(TASTE_CARD_KEY);
          if (!existing) {
            await AsyncStorage.setItem(
              TASTE_CARD_KEY,
              JSON.stringify({
                taste_summary: trimmedTaste || language,
                languages: language,
                likes: trimmedTaste ? [trimmedTaste] : [],
                avoids: [],
                archetype_hint: '',
                fallback: true,
              })
            );
          }
        } catch {
          // ignore storage failure
        }
        console.log('[onboarding] taste card backend failed, local fallback kept:', tcErr?.message);
        setNotice('Saved locally — AI will still use your vibe.');
      }
      console.log('[onboarding] profile successfully created');
      setDone(true);
      setPhase(null);
    } catch (e: any) {
      console.log('[onboarding] profile creation failed:', e?.message);
      setError(e?.message || 'Profile creation failed. Check your connection and retry.');
      setPhase(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = async () => {
    await store.clearUserProfile();
    try {
      await AsyncStorage.removeItem(TASTE_CARD_KEY);
    } catch {
      // ignore storage failure
    }
    setSelectedMap(new Map());
    setTasteText('');
    setNotice(null);
    setDone(false);
  };

  const goHome = () => router.replace('/' as any);

  const renderRow = (s: PickableSong) => {
    const isSel = selectedMap.has(s.key);
    return (
      <Pressable
        key={s.key}
        onPress={() => toggle(s)}
        style={[
          styles.songCard,
          { backgroundColor: colors.backgroundElement, borderColor: isSel ? colors.primary : colors.cardBorder },
          isSel ? { borderWidth: 1.5 } : {},
        ]}
      >
        <View style={[styles.check, { backgroundColor: isSel ? colors.primary : colors.backgroundSelected }]}>
          {isSel && <Check size={14} color="#000" />}
        </View>
        {s.image ? (
          <Image source={{ uri: s.image }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumbFallback, { backgroundColor: colors.backgroundSelected }]}>
            <Music size={14} color={colors.textSecondary} />
          </View>
        )}
        <View style={styles.songMeta}>
          <Text style={[styles.songTitle, { color: colors.text }]} numberOfLines={1}>{s.title}</Text>
          <Text style={[styles.songArtist, { color: colors.textSecondary }]} numberOfLines={1}>
            {s.artist} · {s.source}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
            {hasProfile || done ? 'Personalization active' : 'Step 1 of 1 · Personalization'}
          </Text>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {hasProfile && !done ? 'Edit favorite songs' : 'Pick your favorite songs'}
          </Text>
        </View>
        <View style={[styles.countBadge, { borderColor: colors.cardBorder, backgroundColor: colors.backgroundElement }]}>
          <Text style={[styles.countText, { color: selected.length >= MIN_FAVORITE_SONGS ? colors.primary : colors.text }]}>
            {selected.length} / {MIN_FAVORITE_SONGS}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.infoCard, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
          <Sparkles size={18} color={colors.accent} />
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            Search Spotify and tap at least {MIN_FAVORITE_SONGS} songs you love training to.
            Selected songs show a check mark — your progress is in the counter above.
          </Text>
        </View>

        {!spotifyState.isConnected && (
          <View style={[styles.warnCard, { backgroundColor: '#FFB80012', borderColor: '#FFB800' }]}>
            <Text style={[styles.warnText, { color: colors.text }]}>
              Connect Spotify in the “Spotify & DNA” tab to search the full catalog. Your synced
              library tracks (if any) are still pickable below.
            </Text>
          </View>
        )}

        <View style={[styles.searchBox, { borderColor: colors.cardBorder, backgroundColor: colors.backgroundElement }]}>
          <Search size={16} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search Spotify songs or artists…"
            placeholderTextColor={colors.textSecondary}
            style={[styles.searchInput, { color: colors.text }]}
            autoCorrect={false}
          />
          {isSearching && <ActivityIndicator size="small" color={colors.primary} />}
        </View>

        {done ? (
          <View style={[styles.doneCard, { backgroundColor: colors.backgroundElement, borderColor: colors.primary }]}>
            <Check size={28} color={colors.primary} />
            <Text style={[styles.doneTitle, { color: colors.text }]}>Profile created!</Text>
            <Text style={[styles.doneDesc, { color: colors.textSecondary }]}>
              Your personalized recommendations are ready. They now appear alongside the standard picks.
            </Text>
            <Button title="Continue to app" variant="primary" onPress={goHome} style={styles.doneBtn} />
            <Pressable onPress={handleReset} style={styles.resetRow}>
              <Trash2 size={14} color="#FF3B30" />
              <Text style={styles.resetText}>Reset profile</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Live Spotify results */}
            {query.trim().length >= 2 && spotifyState.isConnected && (
              <>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Spotify results</Text>
                {searchError ? (
                  <Text style={styles.errorText}>{searchError}</Text>
                ) : (
                  <View style={styles.list}>
                    {searchSongs.map(renderRow)}
                    {!isSearching && searchSongs.length === 0 && (
                      <Text style={[styles.empty, { color: colors.textSecondary }]}>
                        No Spotify matches for “{query.trim()}”.
                      </Text>
                    )}
                  </View>
                )}
              </>
            )}

            {/* Library */}
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Your library</Text>
            <View style={styles.list}>
              {filteredLibrary.map(renderRow)}
              {filteredLibrary.length === 0 && (
                <Text style={[styles.empty, { color: colors.textSecondary }]}>
                  {librarySongs.length === 0
                    ? 'No synced tracks yet. Sync history in the Spotify & DNA tab, or search above.'
                    : `No library tracks match “${query}”.`}
                </Text>
              )}
            </View>

            {/* Optional taste note */}
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Your vibe <Text style={[styles.optionalTag, { color: colors.textSecondary }]}>(optional)</Text>
            </Text>
            <TextInput
              value={tasteText}
              onChangeText={(t) => setTasteText(t.slice(0, TASTE_MAX_LEN))}
              placeholder="e.g. High-energy Punjabi hip-hop for runs, mellow acoustic for cooldowns…"
              placeholderTextColor={colors.textSecondary}
              multiline
              style={[styles.tasteInput, { color: colors.text, borderColor: colors.cardBorder, backgroundColor: colors.backgroundElement }]}
            />

            {error && <Text style={styles.errorText}>{error}</Text>}
            {notice && <Text style={[styles.notice, { color: colors.accent }]}>{notice}</Text>}
            {phase && (
              <View style={styles.phaseRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.phaseText, { color: colors.textSecondary }]}>{phase}</Text>
              </View>
            )}

            <Button
              title={isSubmitting ? 'Creating profile…' : `Create profile (${selected.length}/${MIN_FAVORITE_SONGS})`}
              variant="primary"
              onPress={handleSubmit}
              isLoading={isSubmitting}
              disabled={!canSubmit}
              style={styles.submitBtn}
            />
            {!canSubmit && !isSubmitting && (
              <Text style={[styles.hint, { color: colors.textSecondary }]}>
                Select {Math.max(0, MIN_FAVORITE_SONGS - selected.length)} more song(s) to continue.
              </Text>
            )}
            {hasProfile && (
              <Pressable onPress={handleReset} style={styles.resetRow}>
                <Trash2 size={14} color="#FF3B30" />
                <Text style={styles.resetText}>Reset existing profile</Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, marginBottom: 16 },
  headerSub: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  headerTitle: { fontSize: 22, fontWeight: '700' },
  countBadge: { borderWidth: 1, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  countText: { fontSize: 13, fontWeight: '700' },
  content: { paddingHorizontal: 20, paddingBottom: 60 },
  infoCard: { flexDirection: 'row', gap: 10, borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 14 },
  infoText: { fontSize: 12.5, lineHeight: 18, flex: 1 },
  warnCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 14 },
  warnText: { fontSize: 12.5, lineHeight: 17 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14 },
  searchInput: { flex: 1, fontSize: 14 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 10, marginTop: 6 },
  optionalTag: { fontSize: 12, fontWeight: '400' },
  tasteInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, minHeight: 64, textAlignVertical: 'top', marginBottom: 16 },
  list: { gap: 8, marginBottom: 16 },
  songCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1, padding: 12 },
  check: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 40, height: 40, borderRadius: 6 },
  thumbFallback: { width: 40, height: 40, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  songMeta: { flex: 1 },
  songTitle: { fontSize: 13.5, fontWeight: '600' },
  songArtist: { fontSize: 11, marginTop: 1 },
  empty: { textAlign: 'center', fontSize: 13, paddingVertical: 20 },
  errorText: { color: '#FF3B30', fontSize: 12.5, fontWeight: '600', marginBottom: 10, textAlign: 'center' },
  notice: { fontSize: 12.5, fontWeight: '600', marginBottom: 10, textAlign: 'center' },
  phaseRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 },
  phaseText: { fontSize: 12 },
  submitBtn: { alignSelf: 'stretch' },
  hint: { fontSize: 12, textAlign: 'center', marginTop: 8 },
  doneCard: { borderRadius: 16, borderWidth: 1, padding: 24, alignItems: 'center', gap: 8 },
  doneTitle: { fontSize: 18, fontWeight: '700' },
  doneDesc: { fontSize: 13, lineHeight: 18, textAlign: 'center', marginBottom: 8 },
  doneBtn: { alignSelf: 'stretch', marginTop: 8 },
  resetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12 },
  resetText: { fontSize: 12.5, fontWeight: '600', color: '#FF3B30' },
});
