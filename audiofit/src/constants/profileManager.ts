// ============================================================================
// AudioFit — ProfileManager: single abstraction over the V2 user profile.
//
// The backend CREATES the 9D profile; the app only stores it locally.
// Nothing else in the app should touch the raw AsyncStorage key directly.
// ============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { PROFILE_DIMENSIONS, isValidUserProfile } from './audioFeatures';

const PROFILE_KEY = '@audiofit:user_profile_v2';

let cache: number[] | null | undefined;

export const ProfileManager = {
  async load(): Promise<number[] | null> {
    if (cache !== undefined) {
      console.log('[profile] loaded from memory, length:', cache?.length ?? 0);
      return cache;
    }
    try {
      const raw = await AsyncStorage.getItem(PROFILE_KEY);
      if (!raw) {
        console.log('[profile] no stored profile found');
        cache = null;
        return null;
      }
      const parsed: unknown = JSON.parse(raw);
      const profile = Array.isArray(parsed) ? parsed : (parsed as { profile?: unknown })?.profile;
      if (!isValidUserProfile(profile)) {
        console.log('[profile] stored profile invalid (need exactly 9 numbers), discarding');
        cache = null;
        await AsyncStorage.removeItem(PROFILE_KEY).catch(() => {});
        return null;
      }
      console.log('[profile] loaded from storage, length:', profile.length);
      cache = profile;
      return profile;
    } catch (e) {
      console.warn('[profile] load failed:', e);
      cache = null;
      return null;
    }
  },

  getSync(): number[] | null {
    return cache ?? null;
  },

  hasProfile(): boolean {
    return isValidUserProfile(cache);
  },

  async saveProfile(profile: number[]): Promise<void> {
    if (!isValidUserProfile(profile)) {
      throw new Error(`Cannot save profile: expected exactly ${PROFILE_DIMENSIONS} numeric values.`);
    }
    cache = [...profile];
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    console.log('[profile] saved locally, length:', profile.length);
  },

  async clearProfile(): Promise<void> {
    cache = null;
    await AsyncStorage.removeItem(PROFILE_KEY).catch(() => {});
    console.log('[profile] cleared, V1 fallback active');
  },
};
