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
import { Check, Music, Search, Sparkles, Trash2, X } from 'lucide-react-native';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/Button';
import { store } from '@/constants/store';
import { MIN_FAVORITE_SONGS } from '@/constants/audioFeatures';
import { resolveAudioFeatures } from '@/constants/mlRecommender';
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
  const librarySongs: PickableSong[] = useMemo(
    () =>
      spotifyState.recentlyPlayed.map((s, i) => ({
        key: `library-${(s as any).trackId ?? i}`,
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
        const token = await store.getValidAccessToken();
        if (seq !== searchSeq.current) return;
        if (!token) {
          setIsSearching(false);
          setSearchError('Spotify session expired. Reconnect in the Spotify & DNA tab.');
          return;
        }
        const results = await searchSpotifyTracks(token, query.trim(), 20);
        if (seq !== searchSeq.current) return;
        setHits(results);
        setIsSearching(false);
      } catch (e: any) {
        if (seq !== searchSeq.current) return;
        setIsSearching(false);
        const msg = String(e?.message || '');
        setSearchError(
          msg.includes('401')
            ? 'Spotify session expired. Reconnect in the Spotify & DNA tab.'
            : 'Search failed. Check your connection and try again.'
        );
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchActive, query, spotifyState.isConnected]);

  // Stale hits are hidden at render time when search is inactive.
  const searchSongs: PickableSong[] = useMemo(
    () =>
      (searchActive ? hits : []).map((h) => ({
        key: `search-${h.id}`,
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

  // Selection kept in a map so picks survive list/search changes (tracked tray below).
  const [selectedMap, setSelectedMap] = useState<Map<string, PickableSong>>(new Map());
  const selected = useMemo(() => [...selectedMap.values()], [selectedMap]);

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
  const [done, setDone] = useState(false);

  const canSubmit = selected.length >= MIN_FAVORITE_SONGS && !isSubmitting;

  const handleSubmit = async () => {
    if (selected.length < MIN_FAVORITE_SONGS) {
      setError(`Select at least ${MIN_FAVORITE_SONGS} songs (you have ${selected.length}).`);
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      console.log('[onboarding] profile creation started, favorites:', selected.length);
      const favorites = [];
      let i = 0;
      for (const p of selected) {
        i += 1;
        setPhase(`Resolving audio features ${i}/${selected.length}…`);
        const seed = p.trackId || `${p.artist}|${p.title}`;
        const { features, estimated } = await resolveAudioFeatures(seed);
        if (estimated) console.log('[onboarding] estimated features for:', p.title);
        favorites.push(features);
      }
      setPhase('Creating your profile…');
      await store.createProfileFromFavorites(favorites);
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
    setSelectedMap(new Map());
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
            Search Spotify and tap at least {MIN_FAVORITE_SONGS} songs you love training to. Your
            picks stay tracked below while you keep searching.
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
            {/* Tracked picks */}
            {selected.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Your picks ({selected.length})
                </Text>
                <View style={styles.list}>
                  {selected.map((s) => (
                    <View
                      key={`sel-${s.key}`}
                      style={[styles.songCard, styles.selectedCard, { backgroundColor: colors.primary + '10', borderColor: colors.primary }]}
                    >
                      {s.image ? (
                        <Image source={{ uri: s.image }} style={styles.thumb} />
                      ) : (
                        <View style={[styles.thumbFallback, { backgroundColor: colors.backgroundSelected }]}>
                          <Music size={14} color={colors.primary} />
                        </View>
                      )}
                      <View style={styles.songMeta}>
                        <Text style={[styles.songTitle, { color: colors.text }]} numberOfLines={1}>{s.title}</Text>
                        <Text style={[styles.songArtist, { color: colors.textSecondary }]} numberOfLines={1}>{s.artist}</Text>
                      </View>
                      <Pressable onPress={() => toggle(s)} hitSlop={8} style={styles.removeBtn}>
                        <X size={16} color={colors.textSecondary} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </>
            )}

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

            {error && <Text style={styles.errorText}>{error}</Text>}
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
  list: { gap: 8, marginBottom: 16 },
  songCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1, padding: 12 },
  selectedCard: { borderWidth: 1.5 },
  check: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 40, height: 40, borderRadius: 6 },
  thumbFallback: { width: 40, height: 40, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  songMeta: { flex: 1 },
  songTitle: { fontSize: 13.5, fontWeight: '600' },
  songArtist: { fontSize: 11, marginTop: 1 },
  removeBtn: { padding: 6 },
  empty: { textAlign: 'center', fontSize: 13, paddingVertical: 20 },
  errorText: { color: '#FF3B30', fontSize: 12.5, fontWeight: '600', marginBottom: 10, textAlign: 'center' },
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
