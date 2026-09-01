import React from 'react';
import { Pressable, StyleSheet, Text, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

interface ButtonProps {
  onPress: () => void;
  title: string;
  variant?: 'primary' | 'secondary' | 'accent' | 'danger';
  isLoading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  icon?: React.ReactNode;
}

export function Button({
  onPress,
  title,
  variant = 'primary',
  isLoading = false,
  disabled = false,
  style,
  textStyle,
  icon,
}: ButtonProps) {
  const colors = useTheme();

  const getStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          button: { backgroundColor: colors.primary },
          text: { color: '#000000', fontWeight: '700' as const },
        };
      case 'accent':
        return {
          button: { backgroundColor: colors.accent },
          text: { color: '#000000', fontWeight: '700' as const },
        };
      case 'danger':
        return {
          button: { backgroundColor: '#FF3B30' },
          text: { color: '#FFFFFF', fontWeight: '700' as const },
        };
      case 'secondary':
      default:
        return {
          button: {
            backgroundColor: colors.backgroundElement,
            borderWidth: 1,
            borderColor: colors.cardBorder,
          },
          text: { color: colors.text, fontWeight: '600' as const },
        };
    }
  };

  const variantStyles = getStyles();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || isLoading}
      style={({ pressed }) => [
        styles.button,
        variantStyles.button,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {isLoading ? (
        <ActivityIndicator color={variant === 'secondary' ? colors.text : '#000000'} />
      ) : (
        <>
          {icon && <React.Fragment>{icon}</React.Fragment>}
          <Text style={[styles.text, variantStyles.text, icon ? { marginLeft: 8 } : {}, textStyle]}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    minWidth: 120,
  },
  text: {
    fontSize: 15,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  disabled: {
    opacity: 0.5,
  },
});
