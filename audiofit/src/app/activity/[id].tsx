import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Trash2, Music, Clock, MapPin, Footprints, Zap, Activity } from 'lucide-react-native';

import { useTheme } from '@/hooks/use-theme';
import { store, Workout } from '@/constants/store';
import LiveMap from '@/components/LiveMap';

function formatTime(secs: number) {
  const mins = Math.floor(secs / 60);
  const s = secs % 60;
  return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}

export default function ActivityDetailScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [workout, setWorkout] = useState<Workout | undefined>(() => store.getWorkoutById(String(id)));
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    const unsub = store.subscribe(() => setWorkout(store.getWorkoutById(String(id))));
    return () => {
      unsub();
    };
  }, [id]);

  // ponytail: lazy-fill cached recs only once if missing — embedded in Workout JSON, no re-fetch later
  useEffect(() => {
    if (!workout) return;
    if (workout.recommendations && workout.recommendations.length > 0) return;
    const hasTrackIds = workout.songsHeard.some((s) => !!s.trackId);
    if (!hasTrackIds) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFetching(true);
    store
      .getActivityRecommendations(workout.id, 5)
      .then((recs) => {
        if (cancelled) return;
        if (recs.length > 0) store.setWorkoutRecommendations(workout.id, recs);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workout?.id]);

  const handleDelete = () => {
    if (!workout) return;
    const doDelete = () => {
      store.removeWorkout(workout.id);
      router.replace('/' as any);
    };
    // Alert works on native; on web fallback to confirm
    if (typeof window !== 'undefined' && (window as any).confirm) {
      if ((window as any).confirm('Delete this activity? This cannot be undone.')) doDelete();
      return;
    }
    Alert.alert('Delete activity?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: doDelete },
    ]);
  };

  if (!workout) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.notFound}>
          <Text style={[styles.notFoundTitle, { color: colors.text }]}>Activity not found</Text>
          <Text style={[styles.notFoundSub, { color: colors.textSecondary }]}>It may have been deleted.</Text>
          <Pressable onPress={() => router.replace('/' as any)} style={[styles.backBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.backBtnText}>Back to Home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const recs = workout.recommendations ?? [];
  const hasRoute = (workout.route?.length ?? 0) > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backHit}>
            <ArrowLeft size={22} color={colors.text} />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
              {workout.type === 'run' ? '🏃 Tempo Run' : '🚶 Power Walk'}
            </Text>
            <Text style={[styles.headerSub, { color: colors.textSecondary }]} numberOfLines={1}>
              {formatDate(workout.date)}
            </Text>
          </View>
          <Pressable onPress={handleDelete} hitSlop={8} style={[styles.deleteBtn, { borderColor: colors.cardBorder }]}>
            <Trash2 size={18} color="#FF3B30" />
          </Pressable>
        </View>

        {/* Stats grid — minimal Strava-like */}
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
            <Clock size={16} color={colors.primary} />
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Duration</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{formatTime(workout.duration)}</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
            <MapPin size={16} color={colors.primary} />
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Distance</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{workout.distance.toFixed(2)} km</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
            <Zap size={16} color={colors.accent} />
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Avg Speed</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{workout.avgSpeed} km/h</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
            <Footprints size={16} color={colors.warning} />
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Steps</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{workout.steps}</Text>
          </View>
        </View>
        <View style={[styles.statCard, styles.cadenceCard, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
          <Activity size={16} color="#FF3B30" />
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Avg Cadence</Text>
          <Text style={[styles.statValue, { color: colors.text }]}>{workout.avgCadence} SPM</Text>
        </View>

        {/* Map — uses same LiveMap, static (isActive false) */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Route</Text>
        {hasRoute ? (
          <LiveMap coordinates={workout.route!} isActive={false} style={styles.map} />
        ) : (
          <View style={[styles.mapPlaceholder, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
            <MapPin size={20} color={colors.textSecondary} />
            <Text style={[styles.mapPlaceholderText, { color: colors.textSecondary }]}>No route recorded for this activity.</Text>
            <Text style={[styles.mapPlaceholderSub, { color: colors.textSecondary }]}>
              Routes are saved for new activities after this update.
            </Text>
          </View>
        )}

        {/* Songs listened */}
        <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 24 }]}>Songs listened</Text>
        <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>{workout.songsHeard.length} track{workout.songsHeard.length === 1 ? '' : 's'} during this activity</Text>
        <View style={styles.listGap}>
          {workout.songsHeard.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>No songs were recorded during this activity.</Text>
          ) : (
            workout.songsHeard.map((song, idx) => {
              const boost = song.speedBoost ?? 0;
              return (
                <View
                  key={idx}
                  style={[styles.songItem, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}
                >
                  <Music size={14} color="#1DB954" />
                  <View style={styles.songText}>
                    <Text style={[styles.songTitle, { color: colors.text }]} numberOfLines={1}>
                      {song.title}
                    </Text>
                    <Text style={[styles.songArtist, { color: colors.textSecondary }]} numberOfLines={1}>
                      {song.artist} · {song.bpm} BPM
                    </Text>
                  </View>
                  <View style={[styles.boostPill, { backgroundColor: colors.primary + '15' }]}>
                    <Text style={[styles.boostText, { color: colors.primary }]}>{boost >= 0 ? `+${boost}%` : `${boost}%`} pace</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Recommended songs — cached in workout.recommendations */}
        <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 24 }]}>Recommended for next {workout.type}</Text>
        <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>Matched to the songs you played this session</Text>
        {fetching && recs.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textSecondary }]}>Finding recommendations…</Text>
        ) : recs.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textSecondary }]}>
            No recommendations for this activity yet. Play Spotify tracks with IDs during a workout to generate picks.
          </Text>
        ) : (
          <View style={styles.listGap}>
            {recs.map((rec, i) => (
              <View
                key={`${rec.song.artist}-${rec.song.title}-${i}`}
                style={[styles.songItem, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}
              >
                <View style={[styles.rank, { backgroundColor: colors.primary + '15' }]}>
                  <Text style={[styles.rankText, { color: colors.primary }]}>{i + 1}</Text>
                </View>
                <View style={styles.songText}>
                  <Text style={[styles.songTitle, { color: colors.text }]} numberOfLines={1}>
                    {rec.song.title}
                  </Text>
                  <Text style={[styles.songArtist, { color: colors.textSecondary }]} numberOfLines={1}>
                    {rec.song.artist}
                    {rec.song.bpm ? ` · ${rec.song.bpm} BPM` : ''}
                  </Text>
                  {rec.reasons.length > 0 && (
                    <Text style={[styles.recReason, { color: colors.accent }]} numberOfLines={1}>
                      {rec.reasons[0]}
                    </Text>
                  )}
                </View>
                <Text style={[styles.recScore, { color: colors.primary }]}>{rec.score}%</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  backHit: { padding: 4 },
  headerTitleWrap: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSub: { fontSize: 12, marginTop: 2 },
  deleteBtn: { padding: 8, borderRadius: 10, borderWidth: 1 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  statCard: { flexBasis: '48%', flexGrow: 1, borderRadius: 14, borderWidth: 1, padding: 14, gap: 4 },
  cadenceCard: { marginBottom: 4 },
  statLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  statValue: { fontSize: 20, fontWeight: '700' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  sectionSub: { fontSize: 12, marginBottom: 10 },
  map: { height: 240, borderRadius: 16, marginBottom: 4 },
  mapPlaceholder: {
    height: 160,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 16,
  },
  mapPlaceholderText: { fontSize: 13, fontWeight: '600' },
  mapPlaceholderSub: { fontSize: 11, textAlign: 'center' },
  listGap: { gap: 8 },
  songItem: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  songText: { flex: 1 },
  songTitle: { fontSize: 13, fontWeight: '600' },
  songArtist: { fontSize: 11, marginTop: 1 },
  boostPill: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8 },
  boostText: { fontSize: 11, fontWeight: '700' },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 13, fontWeight: '700' },
  recReason: { fontSize: 11, marginTop: 2 },
  recScore: { fontSize: 13, fontWeight: '700' },
  empty: { fontSize: 12, fontStyle: 'italic', paddingVertical: 8 },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  notFoundTitle: { fontSize: 18, fontWeight: '700' },
  notFoundSub: { fontSize: 13 },
  backBtn: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12 },
  backBtnText: { color: '#fff', fontWeight: '700' },
});
