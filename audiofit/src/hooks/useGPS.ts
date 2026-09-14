import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

export interface GPSMetrics {
  distance: number; // in kilometers
  currentSpeed: number; // in km/h
  coordinates: { latitude: number; longitude: number; timestamp: number }[];
  isTracking: boolean;
  errorMsg: string | null;
  hasPermission: boolean;
}

// Must be defined in top-level scope per Expo docs, so the OS can wake it
// even when the app is backgrounded / phone is locked.
export const BACKGROUND_LOCATION_TASK = 'audiofit-background-location';

type LocationHandler = (location: Location.LocationObject) => void;

// Module-level hub: both the foreground watcher and the background task
// funnel through here, so distance is never double-counted and UI listeners
// keep receiving updates while backgrounded.
const locationHandlers = new Set<LocationHandler>();
let lastBackgroundLocation: Location.LocationObject | null = null;
const seenTimestamps = new Set<number>();

function broadcastLocation(location: Location.LocationObject) {
  // Dedupe: foreground watch + background task can deliver the same fix.
  const key = location.timestamp;
  if (seenTimestamps.has(key)) return;
  seenTimestamps.add(key);
  // Keep the set bounded.
  if (seenTimestamps.size > 500) {
    const oldest = Array.from(seenTimestamps).slice(0, 100);
    oldest.forEach((t) => seenTimestamps.delete(t));
  }
  lastBackgroundLocation = location;
  locationHandlers.forEach((handler) => {
    try {
      handler(location);
    } catch (e) {
      console.warn('GPS handler error:', e);
    }
  });
}

// Background task entry point — runs even when app is backgrounded.
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error) {
    console.warn('Background location error:', error.message);
    return;
  }
  const locations = data?.locations as Location.LocationObject[] | undefined;
  if (locations && locations.length > 0) {
    locations.forEach(broadcastLocation);
  }
});

// Helper function to calculate distance using Haversine formula
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

export function useGPS() {
  const [metrics, setMetrics] = useState<GPSMetrics>({
    distance: 0,
    currentSpeed: 0,
    coordinates: [],
    isTracking: false,
    errorMsg: null,
    hasPermission: false,
  });

  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const lastLocationRef = useRef<Location.LocationObject | null>(null);
  const isTrackingRef = useRef(false);

  const requestPermission = async () => {
    try {
      if (Platform.OS === 'web') {
        setMetrics((prev) => ({ ...prev, hasPermission: true }));
        return true;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setMetrics((prev) => ({
          ...prev,
          errorMsg: 'Permission to access location was denied',
          hasPermission: false,
        }));
        return false;
      }

      // Ask for background ("Always") so tracking survives
      // app-switch / screen lock. If denied we still track in foreground.
      try {
        const bg = await Location.requestBackgroundPermissionsAsync();
        if (bg.status !== 'granted') {
          setMetrics((prev) => ({
            ...prev,
            hasPermission: true,
            errorMsg:
              'Background location denied — tracking pauses when the app is backgrounded. Enable "Allow all the time" in Settings.',
          }));
        } else {
          setMetrics((prev) => ({ ...prev, hasPermission: true, errorMsg: null }));
        }
      } catch {
        setMetrics((prev) => ({ ...prev, hasPermission: true }));
      }
      return true;
    } catch (error: any) {
      setMetrics((prev) => ({ ...prev, errorMsg: error.message }));
      return false;
    }
  };

  // Shared per-fix processing: distance + speed + route append.
  const handleLocation = (location: Location.LocationObject) => {
    if (!isTrackingRef.current) return;
    setMetrics((prev) => {
      let addedDistance = 0;
      if (lastLocationRef.current) {
        addedDistance = getDistance(
          lastLocationRef.current.coords.latitude,
          lastLocationRef.current.coords.longitude,
          location.coords.latitude,
          location.coords.longitude
        );
      }

      // Clean up unreasonable spikes (GPS errors)
      if (addedDistance > 0.1) {
        // more than 100m in 2 seconds is impossible (~180 km/h)
        addedDistance = 0;
      }

      // Speed in m/s converted to km/h
      const rawSpeed = location.coords.speed ?? 0;
      const currentSpeed = rawSpeed > 0 ? rawSpeed * 3.6 : 0;

      const newCoords = [
        ...prev.coordinates,
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          timestamp: location.timestamp,
        },
      ];

      lastLocationRef.current = location;

      return {
        ...prev,
        distance: prev.distance + addedDistance,
        currentSpeed,
        coordinates: newCoords,
      };
    });
  };

  const startBackgroundUpdates = async () => {
    if (Platform.OS === 'web') return;
    try {
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(
        BACKGROUND_LOCATION_TASK
      );
      if (hasStarted) return;
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 2000,
        distanceInterval: 2,
        activityType: Location.ActivityType.Fitness,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'AudioFit tracking your workout',
          notificationBody: 'Recording route, distance and pace…',
          notificationColor: '#208AEF',
          killServiceOnDestroy: false,
        },
      });
    } catch (error: any) {
      console.warn('startLocationUpdatesAsync failed:', error?.message);
      // Non-fatal: foreground watch still works while app is open.
      setMetrics((prev) => ({
        ...prev,
        errorMsg: prev.errorMsg ?? 'Background tracking unavailable — foreground only.',
      }));
    }
  };

  const stopBackgroundUpdates = async () => {
    if (Platform.OS === 'web') return;
    try {
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(
        BACKGROUND_LOCATION_TASK
      );
      if (hasStarted) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      }
    } catch (error: any) {
      console.warn('stopLocationUpdatesAsync failed:', error?.message);
    }
  };

  // Attaches location updates without touching any accumulated session stats.
  const subscribe = async () => {
    // Register this hook instance to receive background-task fixes.
    locationHandlers.add(handleLocation);

    if (Platform.OS === 'web') {
      // Mock tracking for web
      const interval = setInterval(() => {
        setMetrics((prev) => {
          if (!prev.isTracking) {
            clearInterval(interval);
            return prev;
          }
          // Simulate slight movement (approx. 8-12 km/h running pace)
          const simulatedSpeed = 8 + Math.random() * 4; // km/h
          const timeElapsedHours = 1 / 3600; // 1 second in hours
          const addedDistance = simulatedSpeed * timeElapsedHours;
          return {
            ...prev,
            distance: prev.distance + addedDistance,
            currentSpeed: simulatedSpeed,
          };
        });
      }, 1000);

      // Save interval reference as subscriptionRef
      subscriptionRef.current = {
        remove: () => {
          clearInterval(interval);
          locationHandlers.delete(handleLocation);
        },
      };
      return;
    }

    // 1) Background task: keeps delivering when app is backgrounded/locked.
    await startBackgroundUpdates();

    try {
      // 2) Foreground watcher: low-latency UI updates while app is open.
      // Both funnel into broadcastLocation -> handleLocation with dedupe.
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000,
          distanceInterval: 2,
        },
        (location) => {
          broadcastLocation(location);
        }
      );

      const prevRemove = subscription.remove.bind(subscription);
      subscriptionRef.current = {
        remove: () => {
          prevRemove();
          locationHandlers.delete(handleLocation);
        },
      };
    } catch (error: any) {
      setMetrics((prev) => ({
        ...prev,
        isTracking: false,
        errorMsg: error.message,
      }));
      isTrackingRef.current = false;
    }
  };

  const detachForegroundOnly = () => {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
  };

  const startTracking = async () => {
    const hasPermission = await requestPermission();
    if (!hasPermission) return;

    // Reset stats for a brand-new session
    seenTimestamps.clear();
    lastBackgroundLocation = null;
    lastLocationRef.current = null;
    isTrackingRef.current = true;
    setMetrics((prev) => ({
      ...prev,
      distance: 0,
      currentSpeed: 0,
      coordinates: [],
      isTracking: true,
      errorMsg: null,
    }));

    await subscribe();
  };

  // Resume after pause: re-attach updates but keep distance, speed and route.
  const resumeTracking = async () => {
    if (subscriptionRef.current) return;
    isTrackingRef.current = true;
    setMetrics((prev) => ({ ...prev, isTracking: true, errorMsg: null }));
    lastLocationRef.current = lastBackgroundLocation;
    await subscribe();
  };

  // Stop = halt OS updates (foreground watch + background task).
  // Async because it stops the OS background task; callers may
  // `await` it or fire-and-forget from sync event handlers.
  const stopTracking = async () => {
    isTrackingRef.current = false;
    detachForegroundOnly();
    await stopBackgroundUpdates();
    setMetrics((prev) => ({
      ...prev,
      isTracking: false,
      currentSpeed: 0,
    }));
    lastLocationRef.current = null;
  };

  useEffect(() => {
    return () => {
      // Unmount: detach UI listener only. The OS background task keeps
      // running until stopTracking() so navigation within the app
      // doesn't kill a live workout.
      locationHandlers.delete(handleLocation);
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
    };
  }, []);

  return {
    ...metrics,
    startTracking,
    resumeTracking,
    stopTracking: stopTracking,
    requestPermission,
  };
}
