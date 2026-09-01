import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

interface AudioVisualizerProps {
  isActive: boolean;
  tempoMultiplier?: number; // E.g., 1.5x for high intensity running
  barCount?: number;
  style?: ViewStyle;
}

export function AudioVisualizer({
  isActive,
  tempoMultiplier = 1,
  barCount = 13,
  style,
}: AudioVisualizerProps) {
  const colors = useTheme();

  // Create an array of Animated.Values for the bars
  const animsRef = useRef<Animated.Value[]>(
    Array.from({ length: barCount }, () => new Animated.Value(0.2))
  );

  const animationsRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (animationsRef.current) {
      animationsRef.current.stop();
    }

    if (!isActive) {
      // Animate back to resting state
      const restingAnimations = animsRef.current.map((anim) =>
        Animated.timing(anim, {
          toValue: 0.15,
          duration: 300,
          useNativeDriver: true,
        })
      );
      Animated.parallel(restingAnimations).start();
      return;
    }

    // Build looping animations for each bar with random speeds to simulate audio frequencies
    const activeAnimations = animsRef.current.map((anim, index) => {
      // Calculate randomized frequency duration
      const duration = (400 + Math.random() * 500) / tempoMultiplier;
      
      return Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 0.3 + Math.random() * 0.7, // Random peak
            duration: duration,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.1 + Math.random() * 0.2, // Random valley
            duration: duration,
            useNativeDriver: true,
          }),
        ])
      );
    });

    animationsRef.current = Animated.parallel(activeAnimations);
    animationsRef.current.start();

    return () => {
      if (animationsRef.current) {
        animationsRef.current.stop();
      }
    };
  }, [isActive, tempoMultiplier, barCount]);

  return (
    <View style={[styles.container, style]}>
      {animsRef.current.map((anim, index) => {
        // Stagger visual heights or colors for nice visuals
        const isCenter = Math.abs(index - Math.floor(barCount / 2)) < 2;
        const barColor = isCenter ? colors.primary : colors.accent;
        
        return (
          <Animated.View
            key={index}
            style={[
              styles.bar,
              {
                backgroundColor: barColor,
                transform: [
                  {
                    scaleY: anim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 40], // scale range
                    }),
                  },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 60,
    gap: 4,
    paddingHorizontal: 10,
  },
  bar: {
    width: 4,
    height: 1, // Scaled by transform
    borderRadius: 2,
  },
});
