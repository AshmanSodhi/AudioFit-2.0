import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Music } from 'lucide-react-native';

import { useTheme } from '@/hooks/use-theme';
import { store } from '@/constants/store';

export default function SpotifyAuthScreen() {
  const colors = useTheme();
  const router = useRouter();
  const redirectedRef = useRef(false);

  const goToSpotify = () => {
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    router.replace('/spotify');
  };

  useEffect(() => {
    if (store.getSpotifyState().isConnected) {
      goToSpotify();
      return;
    }

    const unsubscribe = store.subscribe(() => {
      if (store.getSpotifyState().isConnected) {
        goToSpotify();
      }
    });

    // Fallback in case the flow errors out — always land back on the Spotify tab.
    const timeout = setTimeout(goToSpotify, 3000);

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.center}>
        <Music size={44} color="#1DB954" />
        <ActivityIndicator size="small" color={colors.primary} style={styles.spinner} />
        <Text style={[styles.title, { color: colors.text }]}>Completing Spotify sign-in...</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Trading your authorization code for a listening token.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  spinner: {
    marginTop: 24,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
  },
});
