import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput, Linking, Alert, Platform, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sparkles, Music, ListPlus, ListMusic, Search, ExternalLink } from 'lucide-react-native';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/Button';
import { store } from '@/constants/store';
import { resolveTracks, addToQueue, createPlaylist, ResolvedTrack } from '@/services/spotifyWrite';

const AI_BASE = 'https://audiofit-ml-backend.onrender.com';
const PRESETS = [
  '30 min easy run 6:30-7/km mix English Hindi',
  'Hindi workout push 140+ BPM',
  'English chill warmup',
  'Cooldown Hindi romantic',
  'PR tempo run high energy',
];

type Lang = 'mix' | 'english' | 'hindi';

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

export default function AIRecommenderScreen() {
  const colors = useTheme();

  const [storeState, setStoreState] = useState(store.getSpotifyState());
  useEffect(() => {
    const unsub = store.subscribe(() => setStoreState(store.getSpotifyState()));
    return () => { unsub(); };
  }, []);

  const [prompt, setPrompt] = useState('');
  const [lang, setLang] = useState<Lang>('mix');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<ResolvedTrack[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [isQueuing, setIsQueuing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const showAlert = (title: string, msg: string) => {
    if (Platform.OS === 'web') setActionMsg(`${title}: ${msg}`);
    else Alert.alert(title, msg);
  };

  const handleAsk = async () => {
    const q = prompt.trim();
    if (!q) {
      setError('Type something — e.g. "30 min easy run mix English Hindi"');
      return;
    }
    setError(null);
    setActionMsg(null);
    setIsLoading(true);
    setTracks([]);
    setSelected(new Set());
    try {
      // 1) LLM direct (no ML) — duration-aware count, min 3, no cap
      const count = countForDuration(q);
      const res = await fetch(`${AI_BASE}/ai-recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: q, language: lang, count }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(t.slice(0, 400) || `AI ${res.status}`);
      }
      const data = await res.json();
      const songs: { title: string; artist: string; reason: string }[] = data.songs || data.recommendations || [];
      if (!songs.length) throw new Error('No songs returned. Try a different prompt.');

      // 2) Resolve to real Spotify IDs (needs user token if available, else try without? — require token)
      if (!storeState.isConnected || !storeState.accessToken) {
        // still show titles without IDs, allow copy but disable queue/playlist
        const unresolved: ResolvedTrack[] = songs.map((s) => ({ ...s, id: null, image: null, previewUrl: null, uri: null }));
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
    } catch (e: any) {
      setError(e.message || 'Failed to get recommendations');
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

  const handlePlay = (t: ResolvedTrack) => {
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
    } catch (e: any) {
      const msg = String(e.message || '');
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
    } catch (e: any) {
      showAlert('Playlist failed', String(e.message).slice(0, 300));
      setActionMsg(`Playlist failed: ${String(e.message).slice(0, 120)}`);
    } finally {
      setIsCreating(false);
    }
  };

  const isConnected = storeState.isConnected;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>Direct LLM · No ML</Text>
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
              <Pressable key={l} onPress={() => setLang(l)} style={[styles.langChip, { borderColor: colors.cardBorder, backgroundColor: lang === l ? colors.primary + '18' : colors.background }, lang === l ? { borderColor: colors.primary } : {}]}>
                <Text style={[styles.langText, { color: lang === l ? colors.primary : colors.textSecondary }]}>{l === 'mix' ? 'Mix' : l === 'english' ? 'English' : 'Hindi'}</Text>
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
          <Button title={isLoading ? 'Asking AI...' : 'Ask AI → Get Songs'} variant="primary" onPress={handleAsk} isLoading={isLoading} icon={<Search size={16} color="#000" />} style={styles.askBtn} />
          {error && <Text style={styles.errorText}>{error}</Text>}
          {actionMsg && <Text style={[styles.actionMsg, { color: colors.accent }]}>{actionMsg}</Text>}
          {!isConnected && <Text style={[styles.connectHint, { color: colors.textSecondary }]}>Tip: Connect Spotify in “Spotify & DNA” tab to enable Play / Queue / Playlist. Without it you’ll see titles only.</Text>}
        </View>

        {/* Results */}
        {tracks.length > 0 && (
          <>
            <View style={styles.listHeader}>
              <ListMusic size={16} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>AI Picks ({tracks.length})</Text>
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
                      <Text style={[styles.trackTitle, { color: colors.text }]} numberOfLines={1}>{t.title}</Text>
                      <Text style={[styles.trackArtist, { color: colors.textSecondary }]} numberOfLines={1}>{t.artist}</Text>
                      {t.reason ? <Text style={[styles.trackReason, { color: colors.accent }]} numberOfLines={1}>{t.reason}</Text> : null}
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
            <Text style={{ color: colors.textSecondary }}>Asking Mistral & resolving Spotify IDs...</Text>
          </View>
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
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  content: { paddingHorizontal: 20, paddingBottom: 100 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 20 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 16, marginBottom: 12 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, minHeight: 56, textAlignVertical: 'top', marginBottom: 12 },
  langRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  langChip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1 },
  langText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  presetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  presetChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, maxWidth: '100%' },
  presetText: { fontSize: 11, fontWeight: '500' },
  askBtn: { alignSelf: 'stretch' },
  errorText: { color: '#FF3B30', fontSize: 12, marginTop: 10, fontWeight: '600' },
  actionMsg: { fontSize: 12, marginTop: 8, fontWeight: '600' },
  connectHint: { fontSize: 11, lineHeight: 14, marginTop: 8, fontStyle: 'italic' },
  listHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  sectionSub: { fontSize: 11 },
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
  noId: { fontSize: 10, fontWeight: '700', marginTop: 2 },
  playBtnSmall: { padding: 8, borderRadius: 16 },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  actionBtn: { flex: 1 },
  premiumNote: { fontSize: 11, lineHeight: 14, fontStyle: 'italic', textAlign: 'center', marginBottom: 10 },
  centered: { alignItems: 'center', paddingVertical: 20 },
});
