import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export interface LiveMapProps {
  coordinates: { latitude: number; longitude: number; timestamp: number }[];
  isActive: boolean;
  style?: object;
}

// Web has no react-native-maps support, so render a themed placeholder.
export default function LiveMap({ isActive, style }: LiveMapProps) {
  const colors = useTheme();

  return (
    <View
      style={[styles.placeholder, style, { backgroundColor: colors.backgroundElement, borderColor: colors.cardBorder }]}
    >
      <Text style={[styles.placeholderTitle, { color: colors.text }]}>
        {isActive ? 'Live route map' : 'Location paused'}
      </Text>
      <Text style={[styles.placeholderText, { color: colors.textSecondary }]}>
        Live maps are available on the Android and iOS apps.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 24,
  },
  placeholderTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  placeholderText: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
});
