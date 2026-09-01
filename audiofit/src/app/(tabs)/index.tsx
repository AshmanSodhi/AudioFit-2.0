import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Activity,
  Flame,
  Footprints,
  Zap,
  Play,
  Pause,
  Square,
  Music,
  Sparkles,
  ChevronRight,
  History,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/hooks/use-theme';
import { useGPS } from '@/hooks/useGPS';
import { useSensors } from '@/hooks/useSensors';
import { Button } from '@/components/Button';
import { MetricCard } from '@/components/MetricCard';
import { AudioVisualizer } from '@/components/AudioVisualizer';
import LiveMap from '@/components/LiveMap';
import { store, Workout } from '@/constants/store';
import { computeReadiness, getBestBpmBand } from '@/constants/insights';
import { Recommendation } from '@/constants/recommender';

// Fallback tracks used only when no Spotify listening data has been synced.
// Once the user syncs Spotify, their real tracks drive the workout queue.
const WORKOUT_PLAYLIST = [
  { title: 'Blinding Lights', artist: 'The Weeknd', bpm: 171, energy: 0.82, type: 'run' },
  { title: 'Remember', artist: 'Becky Hill & David Guetta', bpm: 124, energy: 0.88, type: 'run' },
  { title: 'Lose Yourself', artist: 'Eminem', bpm: 86, energy: 0.74, type: 'run' }, // high cadence double-time
  { title: 'Titanium', artist: 'David Guetta', bpm: 126, energy: 0.79, type: 'run' },
  { title: 'Level Up', artist: 'Ciara', bpm: 153, energy: 0.85, type: 'run' },
  { title: 'Flowers', artist: 'Miley Cyrus', bpm: 118, energy: 0.68, type: 'walk' },
  { title: 'As It Was', artist: 'Harry Styles', bpm: 174, energy: 0.73, type: 'walk' }, // chill bpm
  { title: 'Golden', artist: 'Harry Styles', bpm: 140, energy: 0.61, type: 'walk' },
  { title: 'Mood', artist: '24kGoldn', bpm: 91, energy: 0.72, type: 'walk' },
  { title: 'Levitating', artist: 'Dua Lipa', bpm: 103, energy: 0.82, type: 'walk' },
];

export default function HomeScreen() {
  const colors = useTheme();
  const router = useRouter();
  
  // App Store States
  const [spotifyState, setSpotifyState] = useState(store.getSpotifyState());
  const [workoutHistory, setWorkoutHistory] = useState(store.getHistory());
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setSpotifyState(store.getSpotifyState());
      setWorkoutHistory(store.getHistory());
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Workout queue is driven by the user's real synced Spotify tracks when
  // available, falling back to the sample playlist only before any sync.
  const workoutPlaylist = useMemo(() => {
    const synced = spotifyState.recentlyPlayed.filter((s) => s.bpm > 0);
    if (synced.length > 0) {
      return synced.map((s) => ({
        trackId: (s as any).trackId,
        title: s.title,
        artist: s.artist,
        bpm: s.bpm,
        energy: s.energy,
        type: s.bpm >= 130 ? 'run' : 'walk',
      }));
    }
    return WORKOUT_PLAYLIST;
  }, [spotifyState.recentlyPlayed]);

  // Dynamic DNA insights derived from real workout history
  const readiness = computeReadiness(workoutHistory);
  const bestBand = getBestBpmBand(workoutHistory);

  // Screen layout state: 'idle' | 'tracking' | 'summary'
  const [sessionState, setSessionState] = useState<'idle' | 'tracking' | 'summary'>('idle');
  const [activityType, setActivityType] = useState<'walk' | 'run'>('run');

  // Active workout metrics state
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const timerIntervalRef = useRef<any>(null);

  // Custom sensor & location tracking hooks
  const isTrackingActive = sessionState === 'tracking' && !isPaused;
  const gps = useGPS();
  const sensors = useSensors(isTrackingActive, activityType);

  // Music adaptation states
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [bpmSyncAlert, setBpmSyncAlert] = useState<string>('Syncing music to your pace...');
  const [songsHeardThisSession, setSongsHeardThisSession] = useState<any[]>([]);

  // Real-time "now playing" track from the user's actual Spotify playback.
  const [liveTrack, setLiveTrack] = useState<{
    id: string;
    title: string;
    artist: string;
    bpm: number;
    energy: number;
  } | null>(null);

  // Latest biometric values, read inside the Spotify polling loop.
  const currentSpeedRef = useRef(gps.currentSpeed);
  const cadenceRef = useRef(sensors.cadence);

  useEffect(() => {
    currentSpeedRef.current = gps.currentSpeed;
  }, [gps.currentSpeed]);

  useEffect(() => {
    cadenceRef.current = sensors.cadence;
  }, [sensors.cadence]);

  // Session summary cache
  const [summaryData, setSummaryData] = useState<Workout | null>(null);

  // Activity-based song picks for the just-finished workout.
  const [activityRecs, setActivityRecs] = useState<Recommendation[]>([]);

  // ponytail: no expanded state — tap navigates to detail page

  // Stopwatch effect
  useEffect(() => {
    if (isTrackingActive) {
      timerIntervalRef.current = setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [isTrackingActive]);

  // Start Workout Action
  const handleStartWorkout = () => {
    setTimerSeconds(0);
    setIsPaused(false);
    setSongsHeardThisSession([]);
    setLiveTrack(null);
    sensors.reset();
    gps.startTracking();
    setSessionState('tracking');

    // Select initial song matching activity type
    const initialIndex = workoutPlaylist.findIndex((s) => s.type === activityType);
    setCurrentSongIndex(initialIndex >= 0 ? initialIndex : 0);
  };

  // Real-Time Music Gating Adaptation Algorithm
  useEffect(() => {
    if (!isTrackingActive) return;

    // When Spotify is connected the live polling loop drives the queue.
    if (spotifyState.isConnected) return;

    const currentCadence = sensors.cadence;
    const currentSong = workoutPlaylist[currentSongIndex];
    
    // Check cadence mismatch & switch tracks or update status
    let matchPct = 0;
    if (currentSong && currentCadence > 0) {
      const songBpm = currentSong.bpm;
      // Calculate closeness to target cadence
      // For double-time (e.g. 85bpm song matches 170 cadence)
      const effectiveBPM = currentCadence > 140 && songBpm < 95 ? songBpm * 2 : songBpm;
      const difference = Math.abs(currentCadence - effectiveBPM);
      matchPct = Math.max(0, Math.min(100, Math.round(100 - (difference / effectiveBPM) * 100)));

      // Add currently playing song to session log if not already added
      setSongsHeardThisSession((prev) => {
        const exists = prev.some((s) => s.title === currentSong.title);
        if (!exists) {
          // Compute a speed boost factor based on biometric alignment
          const speedBoost = Math.round((currentSong.energy * 10) + (matchPct / 20) - 2);
          return [
            ...prev,
            {
              ...currentSong,
              speedBoost,
              matchScore: matchPct,
              avgSpeed: gps.currentSpeed,
            },
          ];
        }
        return prev;
      });

      // Adaptive response trigger: If cadence drops below standard running zone and a low energy song is playing
      if (activityType === 'run' && currentCadence < 145 && currentSong.energy < 0.75) {
        setBpmSyncAlert('⚠️ Cadence dropped! Queuing high-energy song to boost your pace...');
        // Switch to the highest BPM song in playlist
        const highEnergyIndex = workoutPlaylist.findIndex((s) => s.type === 'run' && s.energy > 0.8);
        if (highEnergyIndex !== -1 && highEnergyIndex !== currentSongIndex) {
          setTimeout(() => setCurrentSongIndex(highEnergyIndex), 1500);
        }
      } else if (matchPct > 85) {
        setBpmSyncAlert(`🔥 Perfect Rhythm! Music is locked at ${matchPct}% cadence match.`);
      } else {
        setBpmSyncAlert(`🎵 Rhythm lock: ${matchPct}%. Adjusting song queue...`);
      }
    }
  }, [sensors.cadence, currentSongIndex, isTrackingActive, activityType, gps.currentSpeed, workoutPlaylist, spotifyState.isConnected]);

  // Live Spotify Polling: fetch the user's real currently-playing track while
  // a session is active and Spotify is connected, and log it to the session.
  useEffect(() => {
    if (!isTrackingActive || !spotifyState.isConnected) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const token = await store.getValidAccessToken();
        if (!token || cancelled) return;
        const track = await store.fetchCurrentlyPlaying(token);
        if (!track || cancelled) return;

        setLiveTrack({
          id: track.id,
          title: track.title,
          artist: track.artist,
          bpm: track.bpm,
          energy: track.energy,
        });

        const cadence = cadenceRef.current;
        let matchPct = 0;
        if (cadence > 0 && track.bpm > 0) {
          // Double-time: a sub-95 BPM song can match a high running cadence.
          const effectiveBPM = cadence > 140 && track.bpm < 95 ? track.bpm * 2 : track.bpm;
          const difference = Math.abs(cadence - effectiveBPM);
          matchPct = Math.max(0, Math.min(100, Math.round(100 - (difference / effectiveBPM) * 100)));
        }
        setBpmSyncAlert(
          matchPct > 85
            ? `🔥 Perfect Rhythm! Live track locked at ${matchPct}% cadence match.`
            : `🎵 Rhythm lock: ${matchPct}%. Adjusting song queue...`
        );

        setSongsHeardThisSession((prev) => {
          const exists = prev.some((s) => s.title === track.title);
          if (exists) return prev;
          const speedBoost = Math.round(track.energy * 10 + matchPct / 20 - 2);
          return [
            ...prev,
            {
              trackId: track.id,
              title: track.title,
              artist: track.artist,
              bpm: track.bpm,
              energy: track.energy,
              type: track.bpm >= 130 ? 'run' : 'walk',
              speedBoost,
              matchScore: matchPct,
              avgSpeed: currentSpeedRef.current,
            },
          ];
        });
      } catch {
        // Transient network/token errors are ignored; the next poll retries.
      }
    };

    poll();
    const interval = setInterval(poll, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isTrackingActive, spotifyState.isConnected]);

  // Pause / Resume Toggle
  const handlePauseToggle = () => {
    if (isPaused) {
      // Resume: re-attach GPS updates without wiping accumulated stats
      gps.resumeTracking();
      setIsPaused(false);
    } else {
      gps.stopTracking();
      setIsPaused(true);
    }
  };

  // Complete Workout & Save Stats
  const handleFinishWorkout = () => {
    gps.stopTracking();
    
    // Calculate final metrics
    const finalDuration = timerSeconds;
    const finalDistance = Math.round(gps.distance * 100) / 100;
    const finalSteps = sensors.steps;
    const avgSpeed = finalDuration > 0 ? Math.round((finalDistance / (finalDuration / 3600)) * 10) / 10 : 0;
    const avgCadence = finalSteps > 0 && finalDuration > 0 ? Math.round(finalSteps / (finalDuration / 60)) : 0;
    
    // Save to global history
    const finalWorkout: Workout = {
      id: Date.now().toString(),
      type: activityType,
      date: new Date().toISOString(),
      duration: finalDuration,
      distance: finalDistance,
      steps: finalSteps,
      avgSpeed: avgSpeed,
      avgCadence: avgCadence,
      songsHeard: songsHeardThisSession,
      route: [...gps.coordinates],
      recommendations: [],
    };

    store.addWorkout(finalWorkout);
    setActivityRecs([]);
    store
      .getActivityRecommendations(finalWorkout.id, 5)
      .then((recs) => {
        setActivityRecs(recs);
        // ponytail: cache recs inside workout so detail page never re-fetches
        if (recs.length > 0) store.setWorkoutRecommendations(finalWorkout.id, recs);
      })
      .catch((err) => {
        console.warn('Activity recommendations failed:', err);
        setActivityRecs([]);
      });
    setSummaryData(finalWorkout);
    setSessionState('summary');
  };

  // Discard the just-finished workout instead of saving it to history.
  const handleDiscardWorkout = () => {
    if (summaryData) {
      store.removeWorkout(summaryData.id);
    }
    setActivityRecs([]);
    setSummaryData(null);
    setSessionState('idle');
  };

  // ponytail: delete now lives on detail page; Home only navigates

  // Helper formats duration
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  };

  // Helper formats an ISO timestamp as e.g. "Aug 6 · 2:30 PM"
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return (
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' · ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    );
  };

  // When Spotify is connected the player reflects the real live track;
  // otherwise it walks the simulated queue.
  const displaySong = spotifyState.isConnected
    ? liveTrack
    : workoutPlaylist[currentSongIndex];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {sessionState === 'idle' && (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={[styles.welcomeText, { color: colors.textSecondary }]}>Ready to sweat?</Text>
              <Text style={[styles.appName, { color: colors.text }]}>AudioFit Tracking</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: colors.primary + '15' }]}>
              <View style={[styles.dot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.statusText, { color: colors.primary }]}>GPS Live</Text>
            </View>
          </View>

          {/* Quick Metrics Readiness Card */}
          <View style={[styles.readyCard, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
            <View style={styles.readyHeader}>
              <Sparkles size={20} color={colors.accent} />
              <Text style={[styles.readyTitle, { color: colors.text }]}>
                {readiness !== null ? `Audio Readiness Score: ${readiness}%` : 'Build Your Audio Readiness'}
              </Text>
            </View>
            <Text style={[styles.readyDesc, { color: colors.textSecondary }]}>
              {bestBand
                ? `Your pace is strongest on ${bestBand.label} tracks (${bestBand.speed.toFixed(1)} km/h avg). Queue ${bestBand.label} today to hit your PR.`
                : 'Start a Tempo Run while music plays on Spotify. AudioFit learns which BPM ranges push your pace most and scores your readiness from real workouts.'}
            </Text>
          </View>

          {/* Activity Selector */}
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Choose Your Session</Text>
          <View style={styles.activityContainer}>
            <Pressable
              onPress={() => setActivityType('walk')}
              style={[
                styles.activityCard,
                { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder },
                activityType === 'walk' ? { borderColor: colors.accent, borderWidth: 2 } : {},
              ]}
            >
              <Text style={styles.activityEmoji}>🚶</Text>
              <Text style={[styles.activityTitle, { color: colors.text }]}>Power Walk</Text>
              <Text style={[styles.activitySub, { color: colors.textSecondary }]}>Rhythm Match: 90-120 BPM</Text>
              {activityType === 'walk' && <View style={[styles.cardDot, { backgroundColor: colors.accent }]} />}
            </Pressable>

            <Pressable
              onPress={() => setActivityType('run')}
              style={[
                styles.activityCard,
                { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder },
                activityType === 'run' ? { borderColor: colors.primary, borderWidth: 2 } : {},
              ]}
            >
              <Text style={styles.activityEmoji}>🏃</Text>
              <Text style={[styles.activityTitle, { color: colors.text }]}>Tempo Run</Text>
              <Text style={[styles.activitySub, { color: colors.textSecondary }]}>Rhythm Match: 135-180 BPM</Text>
              {activityType === 'run' && <View style={[styles.cardDot, { backgroundColor: colors.primary }]} />}
            </Pressable>
          </View>

          {/* Spotify Integration Banner */}
          <View
            style={[
              styles.spotifyBanner,
              {
                backgroundColor: spotifyState.isConnected ? '#1DB95415' : colors.backgroundElement,
                borderColor: spotifyState.isConnected ? '#1DB954' : colors.cardBorder,
              },
            ]}
          >
            <View style={styles.spotifyBannerInfo}>
              <Music size={24} color="#1DB954" />
              <View style={styles.spotifyBannerText}>
                <Text style={[styles.spotifyTitle, { color: colors.text }]}>
                  {spotifyState.isConnected ? `Connected to Spotify` : 'Connect Spotify Account'}
                </Text>
                <Text style={[styles.spotifySub, { color: colors.textSecondary }]}>
                  {spotifyState.isConnected
                    ? `Synced with ${spotifyState.user?.displayName}`
                    : 'Correlate songs with physical performance deltas'}
                </Text>
              </View>
            </View>
            {!spotifyState.isConnected && <ChevronRight size={18} color={colors.textSecondary} />}
          </View>

          {/* Start Session Button */}
          <Button
            title={`Start ${activityType === 'run' ? 'Tempo Run' : 'Power Walk'}`}
            variant="primary"
            onPress={handleStartWorkout}
            style={styles.startButton}
          />

          {/* Recent Workouts - tap to open detail page */}
          {workoutHistory.length > 0 && (
            <View style={styles.historySection}>
              <View style={styles.historySectionHeader}>
                <History size={16} color={colors.textSecondary} />
                <Text style={[styles.sectionTitle, styles.historySectionTitle, { color: colors.text }]}>
                  Recent Workouts
                </Text>
              </View>
              <Text style={[styles.historySectionSub, { color: colors.textSecondary }]}>
                Tap an activity to see full record, songs & recommendations
              </Text>
              {workoutHistory.map((workout) => (
                <Pressable
                  key={workout.id}
                  onPress={() => router.push(`/activity/${workout.id}` as any)}
                  style={[
                    styles.historyCard,
                    { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder },
                  ]}
                >
                  <View style={styles.historyCardHeader}>
                    <View style={styles.historyCardMeta}>
                      <Text style={styles.historyEmoji}>{workout.type === 'run' ? '🏃' : '🚶'}</Text>
                      <View style={styles.historyCardText}>
                        <Text style={[styles.historyCardTitle, { color: colors.text }]} numberOfLines={1}>
                          {workout.type === 'run' ? 'Tempo Run' : 'Power Walk'} · {formatDate(workout.date)}
                        </Text>
                        <Text style={[styles.historyCardSub, { color: colors.textSecondary }]}>
                          {formatTime(workout.duration)} · {workout.distance.toFixed(2)} km ·{' '}
                          {workout.songsHeard.length} song{workout.songsHeard.length === 1 ? '' : 's'}
                        </Text>
                      </View>
                    </View>
                    <ChevronRight size={18} color={colors.textSecondary} />
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {sessionState === 'tracking' && (
        <View style={styles.trackingContainer}>
          <ScrollView
            style={styles.trackingScroll}
            contentContainerStyle={styles.trackingScrollContent}
            showsVerticalScrollIndicator={false}
          >
          {/* Active Tracker Header */}
          <View style={styles.trackingHeader}>
            <View style={styles.badgeRow}>
              <View style={[styles.activeBadge, { backgroundColor: isPaused ? colors.warning + '20' : colors.primary + '20' }]}>
                <Text style={[styles.activeBadgeText, { color: isPaused ? colors.warning : colors.primary }]}>
                  {isPaused ? 'PAUSED' : 'TRACKING ON'}
                </Text>
              </View>
              <View style={[styles.activeBadge, { backgroundColor: colors.backgroundElement, marginLeft: 8 }]}>
                <Text style={[styles.activeBadgeText, { color: colors.text }]}>
                  {activityType === 'run' ? '🏃 RUN' : '🚶 WALK'}
                </Text>
              </View>
            </View>
            <Text style={[styles.timer, { color: colors.text }]}>{formatTime(timerSeconds)}</Text>
          </View>

          {/* Live Route Map */}
          <LiveMap coordinates={gps.coordinates} isActive={!isPaused} style={styles.liveMap} />

          {/* Visual Waveform */}
          <AudioVisualizer
            isActive={!isPaused}
            tempoMultiplier={activityType === 'run' ? 1.5 : 0.8}
            style={styles.visualizer}
          />

          {/* Metrics Dashboard */}
          <View style={styles.metricsGrid}>
            <View style={styles.row}>
              <MetricCard
                label="Distance"
                value={gps.distance > 0 ? (Math.round(gps.distance * 100) / 100).toFixed(2) : '0.00'}
                unit="km"
                icon={<Activity size={18} color={colors.primary} />}
                accentColor={colors.primary}
              />
              <MetricCard
                label="Speed"
                value={gps.currentSpeed > 0 ? (Math.round(gps.currentSpeed * 10) / 10).toFixed(1) : '0.0'}
                unit="km/h"
                icon={<Zap size={18} color={colors.accent} />}
                accentColor={colors.accent}
              />
            </View>
            <View style={styles.row}>
              <MetricCard
                label="Steps"
                value={sensors.steps}
                unit="steps"
                icon={<Footprints size={18} color={colors.warning} />}
                accentColor={colors.warning}
              />
              <MetricCard
                label="Cadence"
                value={sensors.cadence}
                unit="SPM"
                icon={<Flame size={18} color="#FF3B30" />}
                accentColor="#FF3B30"
              />
            </View>
          </View>
          </ScrollView>

          {/* Live Adaptive Music Player Panel */}
          <View style={[styles.musicPlayer, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
            <View style={styles.songMeta}>
              <View style={styles.albumCoverPlaceholder}>
                <Music size={24} color={colors.primary} />
              </View>
              <View style={styles.songTitleGroup}>
                <Text numberOfLines={1} style={[styles.songTitle, { color: colors.text }]}>
                  {displaySong?.title ?? 'Nothing playing'}
                </Text>
                <Text numberOfLines={1} style={[styles.songArtist, { color: colors.textSecondary }]}>
                  {displaySong?.artist ??
                    (spotifyState.isConnected
                      ? 'Play music on Spotify to see it live'
                      : 'Connect Spotify to build your queue')}
                </Text>
              </View>
              {liveTrack && (
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
              )}
              <View style={[styles.bpmBadge, { backgroundColor: colors.primary + '15' }]}>
                <Text style={[styles.bpmText, { color: colors.primary }]}>
                  {displaySong?.bpm ?? '--'} BPM
                </Text>
              </View>
            </View>

            {/* Adaptation Alert Display */}
            <View style={styles.adaptationAlert}>
              <Sparkles size={14} color={colors.accent} />
              <Text numberOfLines={2} style={[styles.adaptationAlertText, { color: colors.text }]}>
                {bpmSyncAlert}
              </Text>
            </View>

            {/* Simulated Track Controls */}
            <View style={styles.playerButtons}>
              <Pressable
                onPress={() => {
                  // Cycle song index
                  setCurrentSongIndex((prev) => (prev + 1) % Math.max(workoutPlaylist.length, 1));
                  setBpmSyncAlert('Skipping track... recalculating biomechanical pacing sync.');
                }}
                style={styles.controlBtn}
              >
                <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>SKIP</Text>
              </Pressable>
              <Pressable onPress={handlePauseToggle} style={[styles.playBtn, { backgroundColor: colors.primary }]}>
                {isPaused ? <Play size={20} color="#000" /> : <Pause size={20} color="#000" />}
              </Pressable>
              <Pressable onPress={handleFinishWorkout} style={[styles.stopBtn, { backgroundColor: '#FF3B30' }]}>
                <Square size={16} color="#FFF" />
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {sessionState === 'summary' && summaryData && (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.centerHeader}>
            <View style={[styles.checkCircle, { backgroundColor: colors.primary + '15' }]}>
              <Activity size={32} color={colors.primary} />
            </View>
            <Text style={[styles.summaryTitle, { color: colors.text }]}>Workout Complete!</Text>
            <Text style={[styles.summarySub, { color: colors.textSecondary }]}>
              Your music and biometrics have been fused.
            </Text>
          </View>

          {/* Stats Summary Grid */}
          <View style={styles.summaryStats}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryStatItem}>
                <Text style={[styles.summaryStatLabel, { color: colors.textSecondary }]}>Distance</Text>
                <Text style={[styles.summaryStatValue, { color: colors.text }]}>{summaryData.distance.toFixed(2)} km</Text>
              </View>
              <View style={styles.summaryStatItem}>
                <Text style={[styles.summaryStatLabel, { color: colors.textSecondary }]}>Duration</Text>
                <Text style={[styles.summaryStatValue, { color: colors.text }]}>{formatTime(summaryData.duration)}</Text>
              </View>
            </View>
            <View style={styles.summaryRow}>
              <View style={styles.summaryStatItem}>
                <Text style={[styles.summaryStatLabel, { color: colors.textSecondary }]}>Steps</Text>
                <Text style={[styles.summaryStatValue, { color: colors.text }]}>{summaryData.steps}</Text>
              </View>
              <View style={styles.summaryStatItem}>
                <Text style={[styles.summaryStatLabel, { color: colors.textSecondary }]}>Avg Speed</Text>
                <Text style={[styles.summaryStatValue, { color: colors.text }]}>{summaryData.avgSpeed} km/h</Text>
              </View>
            </View>
          </View>

          {/* Song Performance Ledger */}
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Song Performance Ledger</Text>
          <View style={styles.ledgerList}>
            {summaryData.songsHeard.length === 0 && (
              <Text style={[styles.ledgerEmpty, { color: colors.textSecondary }]}>
                No songs were heard this session. Play music on Spotify while you work out so AudioFit can log each track and measure its impact on your performance.
              </Text>
            )}
            {summaryData.songsHeard.map((song, index) => (
              <View
                key={index}
                style={[
                  styles.ledgerItem,
                  { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder },
                ]}
              >
                <View style={styles.ledgerMeta}>
                  <Text style={[styles.ledgerName, { color: colors.text }]} numberOfLines={1}>
                    {song.title}
                  </Text>
                  <Text style={[styles.ledgerArtist, { color: colors.textSecondary }]} numberOfLines={1}>
                    {song.artist} • {song.bpm} BPM
                  </Text>
                </View>
                <View style={styles.ledgerStats}>
                  <Text
                    style={[
                      styles.speedBoostText,
                      { color: song.speedBoost >= 0 ? colors.primary : '#FF3B30' },
                    ]}
                  >
                    {song.speedBoost >= 0 ? `+${song.speedBoost}%` : `${song.speedBoost}%`} Speed
                  </Text>
                  <Text style={[styles.matchScoreText, { color: colors.textSecondary }]}>
                    {song.matchScore}% Rhythm Sync
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* Activity-based recommended songs */}
          {activityRecs.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Recommended for your next {activityType}
              </Text>
              <Text style={[styles.recSectionSub, { color: colors.textSecondary }]}>
                Matched to the songs you played this session
              </Text>
              <View style={styles.ledgerList}>
                {activityRecs.map((rec, index) => (
                  <View
                    key={`${rec.song.artist}-${rec.song.title}-${index}`}
                    style={[
                      styles.ledgerItem,
                      { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder },
                    ]}
                  >
                    <View style={[styles.recRank, { backgroundColor: colors.primary + '15' }]}>
                      <Text style={[styles.recRankText, { color: colors.primary }]}>{index + 1}</Text>
                    </View>
                    <View style={styles.ledgerMeta}>
                      <Text style={[styles.ledgerName, { color: colors.text }]} numberOfLines={1}>
                        {rec.song.title}
                      </Text>
                      <Text style={[styles.ledgerArtist, { color: colors.textSecondary }]} numberOfLines={1}>
                        {rec.song.artist}
                        {rec.song.bpm ? ` • ${rec.song.bpm} BPM` : ''}
                      </Text>
                      {rec.reasons.length > 0 && (
                        <Text style={[styles.recReason, { color: colors.accent }]} numberOfLines={1}>
                          {rec.reasons[0]}
                        </Text>
                      )}
                    </View>
                    <View style={styles.scoreWrap}>
                      <Text style={[styles.recScoreText, { color: colors.primary }]}>{rec.score}%</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Close / Return Button */}
          <View style={styles.summaryActions}>
            <Button
              title="Discard Session"
              variant="secondary"
              onPress={handleDiscardWorkout}
              style={styles.discardButton}
              textStyle={{ fontSize: 13, color: '#FF3B30' }}
            />
            <Button
              title="Save & Done"
              variant="primary"
              onPress={() => setSessionState('idle')}
              style={styles.doneButton}
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
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  welcomeText: {
    fontSize: 14,
    fontWeight: '500',
  },
  appName: {
    fontSize: 24,
    fontWeight: '700',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  readyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
  },
  readyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  readyTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  readyDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  activityContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  activityCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    position: 'relative',
  },
  activityEmoji: {
    fontSize: 32,
    marginBottom: 12,
  },
  activityTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  activitySub: {
    fontSize: 12,
  },
  cardDot: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  spotifyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 32,
  },
  spotifyBannerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  spotifyBannerText: {
    flex: 1,
  },
  spotifyTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  spotifySub: {
    fontSize: 11,
  },
  startButton: {
    alignSelf: 'stretch',
  },
  historySection: {
    marginTop: 28,
  },
  historySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  historySectionTitle: {
    marginBottom: 0,
  },
  historySectionSub: {
    fontSize: 12,
    marginTop: 4,
    marginBottom: 14,
  },
  historyList: {
    gap: 10,
  },
  historyCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 10,
  },
  historyCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  historyCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  historyEmoji: {
    fontSize: 22,
  },
  historyCardText: {
    flex: 1,
  },
  historyCardTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  historyCardSub: {
    fontSize: 12,
    marginTop: 2,
  },
  historySongs: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 8,
  },
  historyNoSongs: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  historySongItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  historySongText: {
    flex: 1,
  },
  historySongTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  historySongArtist: {
    fontSize: 11,
    marginTop: 1,
  },
  historyBoostPill: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  historyBoostText: {
    fontSize: 11,
    fontWeight: '700',
  },
  trackingContainer: {
    flex: 1,
    padding: 20,
  },
  trackingScroll: {
    flex: 1,
  },
  trackingScrollContent: {
    paddingBottom: 16,
  },
  liveMap: {
    height: 220,
    borderRadius: 16,
    marginBottom: 16,
  },
  trackingHeader: {
    alignItems: 'center',
    marginTop: 20,
  },
  badgeRow: {
    flexDirection: 'row',
  },
  activeBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  activeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  timer: {
    fontSize: 54,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 10,
  },
  visualizer: {
    marginVertical: 10,
  },
  metricsGrid: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  musicPlayer: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
    marginBottom: 10,
  },
  songMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  albumCoverPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#1DB95420',
    alignItems: 'center',
    justifyContent: 'center',
  },
  songTitleGroup: {
    flex: 1,
  },
  songTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  songArtist: {
    fontSize: 12,
    marginTop: 2,
  },
  bpmBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  bpmText: {
    fontSize: 11,
    fontWeight: '600',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#1DB95415',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1DB954',
  },
  liveText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1DB954',
    letterSpacing: 0.5,
  },
  adaptationAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 240, 255, 0.06)',
  },
  adaptationAlertText: {
    fontSize: 11.5,
    fontWeight: '500',
    flex: 1,
  },
  playerButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  controlBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  stopBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerHeader: {
    alignItems: 'center',
    marginVertical: 30,
  },
  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  summaryTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  summarySub: {
    fontSize: 13,
  },
  summaryStats: {
    gap: 12,
    marginBottom: 28,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryStatItem: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  summaryStatLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  summaryStatValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  ledgerList: {
    gap: 10,
    marginBottom: 32,
  },
  ledgerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  ledgerMeta: {
    flex: 1,
    marginRight: 10,
  },
  ledgerName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  ledgerEmpty: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  ledgerArtist: {
    fontSize: 11,
  },
  ledgerStats: {
    alignItems: 'flex-end',
  },
  speedBoostText: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  matchScoreText: {
    fontSize: 11,
  },
  recSectionSub: {
    fontSize: 12,
    marginTop: -10,
    marginBottom: 14,
  },
  recRank: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  recRankText: {
    fontSize: 14,
    fontWeight: '700',
  },
  recReason: {
    fontSize: 11,
    marginTop: 4,
  },
  scoreWrap: {
    alignItems: 'flex-end',
  },
  recScoreText: {
    fontSize: 13,
    fontWeight: '700',
  },
  doneButton: {
    alignSelf: 'stretch',
  },
  summaryActions: {
    flexDirection: 'row',
    gap: 10,
  },
  discardButton: {
    flex: 1,
    alignSelf: 'stretch',
  },
  historyCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deleteBtn: {
    padding: 4,
  },
});
