import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

export interface GPSMetrics {
  distance: number; // in kilometers
  currentSpeed: number; // in km/h
  coordinates: { latitude: number; longitude: number; timestamp: number }[];
  isTracking: boolean;
  errorMsg: string | null;
  hasPermission: boolean;
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

  // Helper function to calculate distance using Haversine formula
  const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
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
  };

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
      setMetrics((prev) => ({ ...prev, hasPermission: true, errorMsg: null }));
      return true;
    } catch (error: any) {
      setMetrics((prev) => ({ ...prev, errorMsg: error.message }));
      return false;
    }
  };

  // Attaches location updates without touching any accumulated session stats.
  const subscribe = async () => {
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
        remove: () => clearInterval(interval),
      };
      return;
    }

    try {
      // Configure high accuracy location updates every 2 seconds or 2 meters displacement
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000,
          distanceInterval: 2,
        },
        (location) => {
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
        }
      );

      subscriptionRef.current = subscription;
    } catch (error: any) {
      setMetrics((prev) => ({
        ...prev,
        isTracking: false,
        errorMsg: error.message,
      }));
    }
  };

  const startTracking = async () => {
    const hasPermission = await requestPermission();
    if (!hasPermission) return;

    // Reset stats for a brand-new session
    setMetrics((prev) => ({
      ...prev,
      distance: 0,
      currentSpeed: 0,
      coordinates: [],
      isTracking: true,
      errorMsg: null,
    }));
    lastLocationRef.current = null;

    await subscribe();
  };

  // Resume after pause: re-attach updates but keep distance, speed and route.
  const resumeTracking = async () => {
    if (subscriptionRef.current) return;
    setMetrics((prev) => ({ ...prev, isTracking: true, errorMsg: null }));
    lastLocationRef.current = null;
    await subscribe();
  };

  const stopTracking = () => {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    setMetrics((prev) => ({
      ...prev,
      isTracking: false,
      currentSpeed: 0,
    }));
    lastLocationRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
      }
    };
  }, []);

  return {
    ...metrics,
    startTracking,
    resumeTracking,
    stopTracking,
    requestPermission,
  };
}
