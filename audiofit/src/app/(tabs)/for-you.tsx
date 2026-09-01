import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Sparkles,
  RefreshCw,
  Music,
  ListMusic,
  Gauge,
} from 'lucide-react-native';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/Button';
import { store } from '@/constants/store';
import {
  PreferenceProfile,
  Recommendation,
} from '@/constants/recommender';

// Signature that changes only when workout listening-data changes (any activity
// saved). Used to trigger a live recommendation refresh without re-querying
// Spotify on unrelated store updates.
function historySignature(): string {
  return store
    .getHistory()
    .map((w) => `${w.id}:${w.songsHeard.length}`)
    .join('|');
}

export default function ForYouScreen() {
  const colors = useTheme();

  const [profile, setProfile] = useState<PreferenceProfile | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setProfile(store.getPreferenceProfile());
    const recs = await store.getRecommendations({ limit: 12, includeHeard: false });
    setRecommendations(recs);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // Track the activity history signature so we only re-fetch from Spotify when
    // the user actually completes a new activity (avoids spamming the API on
    // unrelated store updates like Spotify connect/disconnect).
    const lastSignature = { current: historySignature() };
    const unsubscribe = store.subscribe(() => {
      setProfile(store.getPreferenceProfile());
      const next = historySignature();
      if (next !== lastSignature.current) {
        lastSignature.current = next;
        refresh();
      }
    });
    return () => { unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasHistory = (profile?.totalListens ?? 0) > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>Music × Performance</Text>
          <Text style={[styles.headerTitle, { color: colors.text }]}>For You</Text>
        </View>
        <Pressable
          onPress={refresh}
          style={[styles.refreshBtn, { borderColor: colors.cardBorder }]}
        >
          <RefreshCw size={18} color={colors.text} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.textSecondary }}>Analyzing your taste...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Taste snapshot */}
          <View style={[styles.profileCard, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
            <View style={styles.profileHeader}>
              <Sparkles size={20} color={colors.accent} />
              <Text style={[styles.profileTitle, { color: colors.text }]}>Your Music DNA</Text>
            </View>

            {!hasHistory ? (
              <Text style={[styles.profileDesc, { color: colors.textSecondary }]}>
                Complete a workout while music plays and AudioFit will learn what
                you enjoy from your activities — then recommend songs that fit your taste.
              </Text>
            ) : (
              <>
                <Text style={[styles.profileMeta, { color: colors.textSecondary }]}>
                  Based on {profile?.totalListens} songs
                  {profile?.dominantBpm ? ` · preferring ~${profile.dominantBpm} BPM` : ''}
                </Text>

                {profile && profile.topGenres.length > 0 && (
                  <View style={styles.chipSection}>
                    <Text style={[styles.tagLabel, { color: colors.textSecondary }]}>Top Genres</Text>
                    <View style={styles.chips}>
                      {profile.topGenres.map((g, i) => (
                        <View key={g.label} style={[styles.chip, { backgroundColor: colors.accent + '1A', borderColor: colors.accent + '55' }]}>
                          <Text style={[styles.chipText, { color: colors.accent }]}>
                            {i + 1}. {g.label}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {profile && profile.topArtists.length > 0 && (
                  <View style={styles.chipSection}>
                    <Text style={[styles.tagLabel, { color: colors.textSecondary }]}>Top Artists</Text>
                    <View style={styles.chips}>
                      {profile.topArtists.map((a) => (
                        <View key={a.label} style={[styles.chip, styles.artistChip, { backgroundColor: colors.primary + '15', borderColor: colors.cardBorder }]}>
                          <Text style={[styles.chipText, { color: colors.text }]}>{a.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </>
            )}
          </View>

          {/* Recommendations */}
          <View style={styles.recListHeader}>
            <ListMusic size={16} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Recommended for you</Text>
          </View>

          {recommendations.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
              <Music size={28} color={colors.textSecondary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No picks yet</Text>
              <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>
                Finish an activity with music playing, then refresh to see songs
                matched to what you hear during your workouts.
              </Text>
            </View>
          ) : (
            <View style={styles.recList}>
              {recommendations.map((rec, idx) => (
                <View
                  key={`${rec.song.artist}-${rec.song.title}-${idx}`}
                  style={[
                    styles.recCard,
                    { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder },
                  ]}
                >
                  <View style={styles.recRank}>
                    <Text style={[styles.recRankText, { color: colors.primary }]}>{idx + 1}</Text>
                  </View>

                  <View style={styles.recMeta}>
                    <Text style={[styles.recTitle, { color: colors.text }]} numberOfLines={1}>
                      {rec.song.title}
                    </Text>
                    <Text style={[styles.recArtist, { color: colors.textSecondary }]} numberOfLines={1}>
                      {rec.song.artist}{rec.song.bpm ? ` · ${rec.song.bpm} BPM` : ''}
                    </Text>
                    {rec.reasons.length > 0 && (
                      <Text style={[styles.recReason, { color: colors.accent }]} numberOfLines={1}>
                        {rec.reasons[0]}
                      </Text>
                    )}
                  </View>

                  <View style={styles.scoreWrap}>
                    <Gauge size={14} color={colors.primary} />
                    <Text style={[styles.scoreText, { color: colors.primary }]}>{rec.score}%</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={styles.actions}>
            <Button
              title="Refresh Picks"
              variant="secondary"
              onPress={refresh}
              isLoading={isLoading}
              icon={<ListMusic size={15} color={colors.text} />}
              style={styles.actionBtn}
              textStyle={{ fontSize: 13 }}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    marginBottom: 20,
  },
  headerSub: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
  },
  refreshBtn: {
    borderWidth: 1,
    padding: 8,
    borderRadius: 20,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 120,
  },
  profileCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  profileTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  profileDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  profileMeta: {
    fontSize: 12,
    marginBottom: 12,
  },
  tagLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  chipSection: {
    marginTop: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  artistChip: {
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  recListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  emptyDesc: {
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
  },
  recList: {
    gap: 10,
  },
  recCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  recRank: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 255, 102, 0.1)',
    marginRight: 12,
  },
  recRankText: {
    fontSize: 14,
    fontWeight: '700',
  },
  recMeta: {
    flex: 1,
  },
  recTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  recArtist: {
    fontSize: 11.5,
  },
  recReason: {
    fontSize: 11,
    marginTop: 4,
  },
  scoreWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 255, 102, 0.1)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  scoreText: {
    fontSize: 12,
    fontWeight: '700',
  },
  actions: {
    marginTop: 24,
    alignItems: 'center',
  },
  actionBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
});