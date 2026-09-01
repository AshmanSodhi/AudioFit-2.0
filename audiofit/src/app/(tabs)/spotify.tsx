import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Music,
  Zap,
  TrendingUp,
  Sparkles,
  RefreshCw,
  Sliders,
  AlertCircle,
  HelpCircle,
} from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';
import { exchangeCodeAsync, makeRedirectUri, useAuthRequest } from 'expo-auth-session';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/Button';
import { store } from '@/constants/store';
import { getBpmBands, getBestBpmBand, computeReadiness } from '@/constants/insights';

WebBrowser.maybeCompleteAuthSession();

// Cross-platform alert helper (web has no native Alert)
const showAlert = (title: string, msg: string) => {
  if (Platform.OS === 'web') {
    console.log(`${title}: ${msg}`);
  } else {
    Alert.alert(title, msg);
  }
};

// Spotify authorization endpoints
const discovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

// Standard developer app credentials for fallback/demo
const DEFAULT_DEMO_CLIENT_ID = '436f9432173944fd8b76bc1572ea98c0'; // Example Spotify Web Client ID

// Scopes used for real listening data. user-read-recently-played / user-top-read
// can be restricted for brand-new apps, so sync falls back to saved tracks.
const SPOTIFY_SCOPES = [
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-top-read',
  'user-library-read',
  'user-read-private',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-modify-playback-state',
  'user-read-playback-state',
];

const SYNC_SOURCE_LABELS: Record<string, string> = {
  'recently-played': 'Recently Played',
  'top-tracks': 'Top Tracks',
  'saved-tracks': 'Saved Tracks',
};

export default function SpotifyScreen() {
  const colors = useTheme();

  // App Store States
  const [storeState, setStoreState] = useState(store.getSpotifyState());
  const [workoutHistory, setWorkoutHistory] = useState(store.getHistory());

  // Guards against processing the same OAuth response twice (inline handler +
  // the response useEffect both fire when the deep link returns).
  const oauthHandledRef = useRef(false);

  // Listen to central store updates
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setStoreState(store.getSpotifyState());
      setWorkoutHistory(store.getHistory());
    });
    return () => { unsubscribe(); };
  }, []);

  // Redirect URI used for the OAuth request (Expo Go => exp://..., dev build => audiofit://spotify-auth)
  const redirectUri = useMemo(
    () => storeState.customRedirectUri || makeRedirectUri({ scheme: 'audiofit', path: 'spotify-auth' }),
    [storeState.customRedirectUri]
  );

  const authConfig = useMemo(
    () => ({
      clientId: storeState.clientId || DEFAULT_DEMO_CLIENT_ID,
      scopes: SPOTIFY_SCOPES,
      usePKCE: true,
      redirectUri,
    }),
    [storeState.clientId, redirectUri]
  );

  // Settings inputs state
  const [clientIdInput, setClientIdInput] = useState(storeState.clientId || '');
  const [redirectUriInput, setRedirectUriInput] = useState(storeState.customRedirectUri || redirectUri);

  // UI state: 'sync' | 'dna'
  const [activeSubTab, setActiveSubTab] = useState<'sync' | 'dna'>('dna');
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);



  // Complete the OAuth flow: fetch profile, persist tokens, then sync history
  const completeConnection = (
    accessToken: string,
    refreshToken?: string | null,
    expiresIn?: number
  ) => {
    oauthHandledRef.current = true;
    setErrorMessage(null);
    setIsSyncing(true);

    // Perform real data fetch using token
    store
      .fetchUserProfile(accessToken)
      .then((profile) => {
        store.connectSpotify(profile, { accessToken, refreshToken, expiresIn });
        return store.syncHistory(accessToken);
      })
      .then((songs) => {
        setIsSyncing(false);
        if (!songs || songs.length === 0) {
          showAlert(
            'Connected',
            'Connected to Spotify, but no listening history was available. Play some music on Spotify, then hit Sync History.'
          );
        }
      })
      .catch((err) => {
        setIsSyncing(false);
        setErrorMessage('Profile connection failed. Please ensure token is valid.');
        console.warn('OAuth Connection error:', err);
      });
  };

  // Setup Spotify OAuth Request (Authorization Code with PKCE)
  const [request, response, promptAsync] = useAuthRequest(authConfig, discovery);

  // Handle OAuth Response Redirect
  useEffect(() => {
    if (oauthHandledRef.current) return; // Already completed inline in handleConnectSpotify

    if (response?.type !== 'success') {
      if (response?.type === 'error') {
        setErrorMessage(`OAuth Authorization Error: ${response.error?.message || 'Access Denied'}`);
      }
      return;
    }

    const accessToken =
      response.authentication?.accessToken || response.params?.access_token || null;
    const refreshToken =
      response.authentication?.refreshToken || response.params?.refresh_token || null;
    const expiresIn = response.authentication?.expiresIn;

    // PKCE on web does not auto-exchange the code, so exchange manually.
    if (!accessToken && response.params?.code && request?.codeVerifier) {
      exchangeCodeAsync(
        {
          clientId: authConfig.clientId,
          code: response.params.code,
          redirectUri: authConfig.redirectUri,
          extraParams: { code_verifier: request.codeVerifier },
        },
        discovery
      )
        .then((tokenResponse) => {
          completeConnection(
            tokenResponse.accessToken,
            tokenResponse.refreshToken,
            tokenResponse.expiresIn
          );
        })
        .catch((e: any) => {
          setIsSyncing(false);
          setErrorMessage(`Token exchange failed: ${e.message}`);
        });
      return;
    }

    if (!accessToken) {
      setErrorMessage('Authentication succeeded but no token was returned.');
      return;
    }
    completeConnection(accessToken, refreshToken, expiresIn);
  }, [response, authConfig.clientId, authConfig.redirectUri, request?.codeVerifier]);


  // Handle Spotify Connect Click. The success path is processed inline here
  // (instead of only via the response effect) because the OAuth deep link can
  // navigate expo-router to the /spotify-auth route, unmounting this screen.
  const handleConnectSpotify = async () => {
    setErrorMessage(null);
    try {
      const result = await promptAsync();
      if (result.type !== 'success') {
        console.warn('Spotify auth prompt was dismissed or failed');
        return;
      }

      oauthHandledRef.current = true;

      const accessToken =
        result.authentication?.accessToken || result.params?.access_token || null;
      const refreshToken =
        result.authentication?.refreshToken || result.params?.refresh_token || null;
      const expiresIn = result.authentication?.expiresIn;

      // PKCE code flow: exchange the one-time code for tokens.
      if (!accessToken && result.params?.code && request?.codeVerifier) {
        setIsSyncing(true);
        try {
          const tokenResponse = await exchangeCodeAsync(
            {
              clientId: authConfig.clientId,
              code: result.params.code,
              redirectUri: authConfig.redirectUri,
              extraParams: { code_verifier: request.codeVerifier },
            },
            discovery
          );
          completeConnection(
            tokenResponse.accessToken,
            tokenResponse.refreshToken,
            tokenResponse.expiresIn
          );
        } catch (e: any) {
          setIsSyncing(false);
          setErrorMessage(`Token exchange failed: ${e.message}`);
        }
        return;
      }

      if (!accessToken) {
        setErrorMessage('Authentication succeeded but no token was returned.');
        return;
      }
      completeConnection(accessToken, refreshToken, expiresIn);
    } catch (e: any) {
      setErrorMessage(`Failed to open browser: ${e.message}`);
    }
  };

  // Demo connection fallback for offline/non-developer testing
  const handleDemoConnect = () => {
    store.connectSpotify(
      {
        displayName: 'Demo Runner Account',
        id: 'spotify_demo_runner',
        product: 'premium',
        followers: 48,
      },
      { accessToken: 'demo_access_token_xyz_123' }
    );

    // Demo token cannot call the real API, so nothing is seeded.
  };

  const handleDisconnectSpotify = () => {
    store.disconnectSpotify();
    setErrorMessage(null);
  };

  // Save developer credential modifications
  const handleSaveSettings = () => {
    const defaultRedirect = makeRedirectUri({ scheme: 'audiofit', path: 'spotify-auth' });
    // If the redirect matches what the app computes automatically, don't pin a
    // stale copy (Expo Go host IPs change) - always use the live value.
    const redirectToSave = redirectUriInput.trim() === defaultRedirect ? '' : redirectUriInput.trim();
    store.saveSettings(clientIdInput.trim(), redirectToSave);
    setShowSettings(false);
    setErrorMessage(null);
    showAlert('Settings Saved!', `Your custom Spotify Client ID has been registered. If you connect now, it will use your dashboard developer keys.`);
  };



  // Sync action (for currently logged in session)
  const handleSyncHistory = async () => {
    if (!storeState.accessToken) return;
    setIsSyncing(true);
    setErrorMessage(null);

    // Demo tokens can't reach the real API
    if (storeState.accessToken.startsWith('demo_')) {
      setTimeout(() => {
        setIsSyncing(false);
      }, 600);
      return;
    }

    const token = await store.getValidAccessToken();
    if (!token) {
      setIsSyncing(false);
      setErrorMessage('Session expired. Please disconnect and reconnect to Spotify.');
      return;
    }

    store.syncHistory(token)
      .then((songs) => {
        setIsSyncing(false);
        if (songs.length === 0) {
          setErrorMessage('No listening history found. Play some music on Spotify, then try again.');
        }
      })
      .catch((err) => {
        setIsSyncing(false);
        setErrorMessage('Failed to sync. Spotify token may have expired. Please disconnect and reconnect.');
        console.warn('Sync error:', err);
      });
  };

  // Compile Audio DNA Insights from real workout data
  const bpmBands = getBpmBands(workoutHistory);
  const bestBand = getBestBpmBand(workoutHistory);
  const readiness = computeReadiness(workoutHistory);
  const hasRunData = workoutHistory.some(w => w.type === 'run' && w.songsHeard.length > 0);
  const chartData = [
    { ...bpmBands[0], color: colors.primary },
    { ...bpmBands[1], color: colors.accent },
    { ...bpmBands[2], color: colors.textSecondary },
  ];

  const getTopTracks = () => {
    const allTracks: { title: string; artist: string; speedBoost: number; bpm: number }[] = [];
    workoutHistory.forEach(workout => {
      workout.songsHeard.forEach(song => {
        const existing = allTracks.find(t => t.title === song.title);
        if (!existing) {
          allTracks.push({
            title: song.title,
            artist: song.artist,
            speedBoost: song.speedBoost,
            bpm: song.bpm
          });
        }
      });
    });

    return allTracks.sort((a, b) => b.speedBoost - a.speedBoost).slice(0, 4);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Tab Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>Music × Biometrics</Text>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Audio DNA Profile</Text>
        </View>
        <View style={styles.headerBtns}>
          <Pressable
            onPress={() => setShowSettings(!showSettings)}
            style={[styles.settingsBtn, { borderColor: colors.cardBorder }]}
          >
            <Sliders size={18} color={colors.text} />
          </Pressable>
          {storeState.isConnected && (
            <Pressable
              onPress={handleDisconnectSpotify}
              style={[styles.disconnectBtn, { borderColor: colors.cardBorder, marginLeft: 8 }]}
            >
              <Text style={[styles.disconnectText, { color: '#FF3B30' }]}>Disconnect</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Developer Configuration drawer */}
      {showSettings && (
        <View style={[styles.settingsDrawer, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
          <Text style={[styles.settingsTitle, { color: colors.text }]}>OAuth Developer Credentials</Text>
          <Text style={[styles.settingsDesc, { color: colors.textSecondary }]}>
            Use your own app from the Spotify Developer Dashboard (developer.spotify.com/dashboard). Add your Client ID below.
          </Text>

          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Spotify Client ID</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.cardBorder, backgroundColor: colors.background }]}
            value={clientIdInput}
            onChangeText={setClientIdInput}
            placeholder="e.g. e87df346387042a98f1f72a4..."
            placeholderTextColor={colors.textSecondary}
          />

          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Redirect URL (Deep Link)</Text>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.cardBorder, backgroundColor: colors.background }]}
            value={redirectUriInput}
            onChangeText={setRedirectUriInput}
            placeholder="audiofit://spotify-auth"
            placeholderTextColor={colors.textSecondary}
          />

          <View style={[styles.redirectHint, { backgroundColor: colors.background, borderColor: colors.cardBorder }]}>
            <HelpCircle size={14} color={colors.accent} />
            <Text style={[styles.redirectHintText, { color: colors.textSecondary }]}>
              In your Spotify Dashboard open your app → Settings → Redirect URIs, add exactly:
            </Text>
          </View>
          <Pressable
            onPress={() => showAlert('Redirect URI', redirectUri)}
            style={[styles.redirectValueBox, { backgroundColor: colors.background, borderColor: colors.accent }]}
          >
            <Text selectable style={[styles.redirectValue, { color: colors.text }]}>
              {redirectUri}
            </Text>
          </Pressable>
          <Text style={[styles.redirectHintText, { color: colors.textSecondary }]}>
            The URI must match this text exactly (no trailing slash). It auto-updates when your Expo dev-server IP changes, so register it again if you move networks.
          </Text>

          <View style={styles.settingsActions}>
            <Button
              title="Save Client ID"
              variant="accent"
              onPress={handleSaveSettings}
              style={styles.saveSettingsBtn}
              textStyle={{ fontSize: 13 }}
            />
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => setShowSettings(false)}
              style={styles.cancelSettingsBtn}
              textStyle={{ fontSize: 13 }}
            />
          </View>


        </View>
      )}

      {errorMessage && (
        <View style={styles.errorBanner}>
          <AlertCircle size={16} color="#FF3B30" />
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      )}

      {!storeState.isConnected ? (
        <ScrollView contentContainerStyle={styles.centeredScroll} showsVerticalScrollIndicator={false}>
          {/* Brand Connection Card */}
          <View style={[styles.promoCard, { backgroundColor: '#1DB95410', borderColor: '#1DB954' }]}>
            <Music size={48} color="#1DB954" style={styles.promoIcon} />
            <Text style={[styles.promoTitle, { color: colors.text }]}>Synchronize Your Spotify</Text>
            <Text style={[styles.promoDesc, { color: colors.textSecondary }]}>
              Unlock your personalized workout profile. AudioFit tracks the acoustic features of every song you play and correlates them directly to your heart rate zones, running speed, and step cadence.
            </Text>

            <View style={styles.connectButtonsGroup}>
              <Button
                title={isSyncing ? 'Connecting API...' : 'Log in with Spotify'}
                variant="primary"
                onPress={handleConnectSpotify}
                isLoading={isSyncing}
                style={styles.connectBtn}
              />
              <Pressable onPress={handleDemoConnect} style={styles.demoConnectBtn}>
                <Text style={[styles.demoConnectText, { color: colors.primary }]}>Connect Mock Demo Mode</Text>
              </Pressable>
            </View>
          </View>

          {/* Core Science Breakdown */}
          <Text style={[styles.sectionTitle, { color: colors.text }]}>How it works</Text>
          <View style={styles.stepsGrid}>
            <View style={[styles.stepItem, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
              <View style={[styles.stepNum, { backgroundColor: colors.primary + '20' }]}>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>1</Text>
              </View>
              <Text style={[styles.stepTextTitle, { color: colors.text }]}>Listen & Run</Text>
              <Text style={[styles.stepTextDesc, { color: colors.textSecondary }]}>
                Work out normally while playing music on your device.
              </Text>
            </View>

            <View style={[styles.stepItem, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
              <View style={[styles.stepNum, { backgroundColor: colors.accent + '20' }]}>
                <Text style={{ color: colors.accent, fontWeight: '700' }}>2</Text>
              </View>
              <Text style={[styles.stepTextTitle, { color: colors.text }]}>Biometric Fusion</Text>
              <Text style={[styles.stepTextDesc, { color: colors.textSecondary }]}>
                We align GPS speeds and step counts to specific audio tracks.
              </Text>
            </View>

            <View style={[styles.stepItem, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
              <View style={[styles.stepNum, { backgroundColor: '#FFB80020' }]}>
                <Text style={{ color: '#FFB800', fontWeight: '700' }}>3</Text>
              </View>
              <Text style={[styles.stepTextTitle, { color: colors.text }]}>Audio DNA Analysis</Text>
              <Text style={[styles.stepTextDesc, { color: colors.textSecondary }]}>
                We extract BPM, energy, and key vectors to build your recommendation rules.
              </Text>
            </View>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.mainContainer}>
          {/* Sub Navigation Tabs */}
          <View style={[styles.subTabRow, { backgroundColor: colors.backgroundElement }]}>
            <Pressable
              onPress={() => setActiveSubTab('dna')}
              style={[
                styles.subTab,
                activeSubTab === 'dna' ? { backgroundColor: colors.backgroundSelected } : {},
              ]}
            >
              <TrendingUp size={16} color={activeSubTab === 'dna' ? colors.primary : colors.textSecondary} />
              <Text
                style={[
                  styles.subTabText,
                  { color: activeSubTab === 'dna' ? colors.text : colors.textSecondary },
                ]}
              >
                My Audio DNA
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setActiveSubTab('sync')}
              style={[
                styles.subTab,
                activeSubTab === 'sync' ? { backgroundColor: colors.backgroundSelected } : {},
              ]}
            >
              <Music size={16} color={activeSubTab === 'sync' ? colors.primary : colors.textSecondary} />
              <Text
                style={[
                  styles.subTabText,
                  { color: activeSubTab === 'sync' ? colors.text : colors.textSecondary },
                ]}
              >
                Recently Played
              </Text>
            </Pressable>
          </View>

          {activeSubTab === 'dna' ? (
            <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
              {/* Summary Stats Profile */}
              <View style={[styles.dnaSummaryCard, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
                <View style={styles.dnaSummaryHeader}>
                  <Sparkles size={20} color={colors.primary} />
                  <Text style={[styles.dnaSummaryTitle, { color: colors.text }]}>Personalized Insights</Text>
                </View>
                {bestBand ? (
                  <Text style={[styles.dnaSummaryDesc, { color: colors.textSecondary }]}>
                    Your highest average pace is recorded on <Text style={{ color: colors.primary, fontWeight: '600' }}>{bestBand.label}</Text> tracks at{' '}
                    <Text style={{ color: colors.accent, fontWeight: '600' }}>{bestBand.speed.toFixed(1)} km/h</Text>.
                    {readiness !== null ? ` Your current Audio Readiness is ${readiness}% — run this tempo to hit your PR.` : ''}
                  </Text>
                ) : (
                  <Text style={[styles.dnaSummaryDesc, { color: colors.textSecondary }]}>
                    Complete a <Text style={{ color: colors.primary, fontWeight: '600' }}>Tempo Run</Text> while music is playing to build your Audio DNA.
                    AudioFit measures which BPM ranges lift your pace from your real workout data.
                  </Text>
                )}
              </View>

              {/* Chart: Speed vs Tempo */}
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Tempo vs Average Running Speed</Text>
              <View style={[styles.chartContainer, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}>
                {hasRunData ? (
                  chartData.map((item, idx) => (
                    <View key={idx} style={styles.chartRow}>
                      <View style={styles.chartRowMeta}>
                        <Text style={[styles.chartRowLabel, { color: colors.text }]}>{item.label}</Text>
                        <Text style={[styles.chartRowVal, { color: colors.text }]}>
                          {item.hasData ? `${item.speed.toFixed(1)} km/h` : '—'}
                        </Text>
                      </View>
                      <View style={[styles.chartBarBg, { backgroundColor: colors.backgroundSelected }]}>
                        <View
                          style={[
                            styles.chartBarFill,
                            {
                              width: `${item.pct}%`,
                              backgroundColor: item.color,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={[styles.emptyNote, { color: colors.textSecondary }]}>
                    No running data yet — finish a Tempo Run to see which tempo range lifts your pace.
                  </Text>
                )}
              </View>

              {/* Speed Boosters List */}
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Top Performance Boosters</Text>
              <View style={styles.topSongsList}>
                {getTopTracks().length > 0 ? (
                  getTopTracks().map((song, idx) => (
                    <View
                      key={idx}
                      style={[
                        styles.topSongItem,
                        { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder },
                      ]}
                    >
                      <View style={styles.topSongMeta}>
                        <Text style={[styles.topSongTitle, { color: colors.text }]} numberOfLines={1}>
                          {song.title}
                        </Text>
                        <Text style={[styles.topSongArtist, { color: colors.textSecondary }]} numberOfLines={1}>
                          {song.artist} • {song.bpm} BPM
                        </Text>
                      </View>
                      <View style={[styles.boostPill, { backgroundColor: colors.primary + '15' }]}>
                        <Zap size={12} color={colors.primary} />
                        <Text style={[styles.boostText, { color: colors.primary }]}>+{song.speedBoost}% pace</Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={[styles.emptyNote, { color: colors.textSecondary }]}>
                    Songs you hear during workouts will appear here ranked by how much they boosted your pace.
                  </Text>
                )}
              </View>
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
              {/* Sync Actions Bar */}
              <View style={styles.actionBar}>
                <Text style={[styles.syncCount, { color: colors.textSecondary }]}>
                  {storeState.recentlyPlayed.length} songs synced from {SYNC_SOURCE_LABELS[storeState.syncSource || ''] || 'Spotify'}
                </Text>
                <Button
                  title={isSyncing ? 'Syncing...' : 'Sync History'}
                  variant="secondary"
                  isLoading={isSyncing}
                  onPress={handleSyncHistory}
                  icon={<RefreshCw size={14} color={colors.text} />}
                  style={styles.syncBtn}
                  textStyle={{ fontSize: 13 }}
                />
              </View>

              {/* Sync History List */}
              <View style={styles.historyList}>
                {storeState.recentlyPlayed.length === 0 ? (
                  <Text style={[styles.emptyNote, { color: colors.textSecondary }]}>
                    No synced songs yet. Connect Spotify and tap Sync History to pull your real listening data.
                  </Text>
                ) : (
                  storeState.recentlyPlayed.slice(0, 10).map((song, idx) => (
                    <View
                      key={idx}
                      style={[
                        styles.historyItem,
                        { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder },
                      ]}
                    >
                      <View style={styles.historyMeta}>
                        <Text style={[styles.historySongTitle, { color: colors.text }]} numberOfLines={1}>
                          {song.title}
                        </Text>
                        <Text style={[styles.historySongArtist, { color: colors.textSecondary }]} numberOfLines={1}>
                          {song.artist}
                          {song.bpmEstimated ? ' • estimated tempo' : ''}
                        </Text>
                      </View>

                      <View style={styles.historyStats}>
                        <View style={styles.statChip}>
                          <Text style={[styles.statChipLabel, { color: colors.textSecondary }]}>BPM</Text>
                          <Text style={[styles.statChipVal, { color: colors.text }]}>{song.bpm}{song.bpmEstimated ? '~' : ''}</Text>
                        </View>
                        <View style={styles.statChip}>
                          <Text style={[styles.statChipLabel, { color: colors.textSecondary }]}>ENERGY</Text>
                          <Text style={[styles.statChipVal, { color: colors.primary }]}>{Math.round(song.energy * 100)}%</Text>
                        </View>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          )}
        </View>
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
  headerBtns: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingsBtn: {
    borderWidth: 1,
    padding: 8,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disconnectBtn: {
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  disconnectText: {
    fontSize: 12,
    fontWeight: '600',
  },
  settingsDrawer: {
    marginHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  settingsTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  settingsDesc: {
    fontSize: 11.5,
    lineHeight: 16,
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 13,
    marginBottom: 12,
  },
  redirectHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    marginBottom: 8,
  },
  redirectHintText: {
    fontSize: 11,
    lineHeight: 15,
    flex: 1,
  },
  redirectValueBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  redirectValue: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  emptyNote: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  settingsActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  saveSettingsBtn: {
    flex: 1,
    paddingVertical: 10,
  },
  cancelSettingsBtn: {
    flex: 1,
    paddingVertical: 10,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FF3B3012',
    borderWidth: 1,
    borderColor: '#FF3B30',
    marginHorizontal: 20,
    padding: 10,
    borderRadius: 10,
    marginBottom: 20,
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    fontWeight: '500',
    flex: 1,
  },
  centeredScroll: {
    padding: 20,
    paddingBottom: 100,
  },
  promoCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  promoIcon: {
    marginBottom: 20,
  },
  promoTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  promoDesc: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 24,
  },
  connectButtonsGroup: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 12,
  },
  connectBtn: {
    alignSelf: 'stretch',
  },
  demoConnectBtn: {
    padding: 8,
  },
  demoConnectText: {
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 16,
  },
  stepsGrid: {
    gap: 16,
  },
  stepItem: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  stepTextTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  stepTextDesc: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  mainContainer: {
    flex: 1,
  },
  subTabRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    borderRadius: 12,
    padding: 4,
    gap: 4,
    marginBottom: 20,
  },
  subTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  subTabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tabContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  dnaSummaryCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
  },
  dnaSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  dnaSummaryTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  dnaSummaryDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  chartContainer: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 16,
    marginBottom: 28,
  },
  chartRow: {
    gap: 6,
  },
  chartRowMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chartRowLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  chartRowVal: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  chartBarBg: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  chartBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  topSongsList: {
    gap: 10,
  },
  topSongItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  topSongMeta: {
    flex: 1,
    marginRight: 10,
  },
  topSongTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  topSongArtist: {
    fontSize: 11.5,
  },
  boostPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  boostText: {
    fontSize: 11,
    fontWeight: '600',
  },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  syncCount: {
    fontSize: 12,
    fontWeight: '500',
  },
  syncBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    minWidth: 100,
  },
  historyList: {
    gap: 10,
  },
  historyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  historyMeta: {
    flex: 1,
    marginRight: 10,
  },
  historySongTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  historySongArtist: {
    fontSize: 11,
  },
  historyStats: {
    flexDirection: 'row',
    gap: 12,
  },
  statChip: {
    alignItems: 'center',
  },
  statChipLabel: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  statChipVal: {
    fontSize: 12,
    fontWeight: '700',
  },
  mlServiceBox: {
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  mlServiceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mlServiceTitle: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  mlDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  mlServiceDesc: {
    fontSize: 11.5,
    lineHeight: 16,
  },
  mlActions: {
    flexDirection: 'row',
    gap: 8,
  },
  mlHealthBox: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 8,
  },
  mlHealthText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
