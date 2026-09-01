import { useEffect, useRef, useState } from 'react';
import { Pedometer } from 'expo-sensors';
import { Platform } from 'react-native';

export interface SensorMetrics {
  steps: number;
  cadence: number; // steps per minute (SPM)
  isAvailable: boolean;
  errorMsg: string | null;
}

export function useSensors(isWorkoutActive: boolean, activityType: 'walk' | 'run') {
  const [metrics, setMetrics] = useState<SensorMetrics>({
    steps: 0,
    cadence: 0,
    isAvailable: false,
    errorMsg: null,
  });

  const subscriptionRef = useRef<{ remove: () => void } | null>(null);
  const stepHistoryRef = useRef<{ steps: number; timestamp: number }[]>([]);
  const lastStepCountRef = useRef<number>(0);
  const sessionStepsRef = useRef<number>(0);

  const checkAvailability = async () => {
    try {
      if (Platform.OS === 'web') {
        setMetrics((prev) => ({ ...prev, isAvailable: true }));
        return true;
      }
      const isAvailable = await Pedometer.isAvailableAsync();
      setMetrics((prev) => ({ ...prev, isAvailable }));
      return isAvailable;
    } catch (error: any) {
      setMetrics((prev) => ({ ...prev, errorMsg: error.message, isAvailable: false }));
      return false;
    }
  };

  // Wipes all accumulated stats. Only call this when starting a brand-new
  // session — pausing/resuming must keep the step count intact.
  const reset = () => {
    sessionStepsRef.current = 0;
    stepHistoryRef.current = [];
    lastStepCountRef.current = 0;
    setMetrics((prev) => ({ ...prev, steps: 0, cadence: 0 }));
  };

  const startTracking = async () => {
    const available = await checkAvailability();

    if (!available) {
      // Setup web fallback/simulator if pedometer is not available
      const interval = setInterval(() => {
        if (!isWorkoutActive) {
          clearInterval(interval);
          return;
        }

        setMetrics((prev) => {
          // Walking cadence: 100-115 steps/min, Running cadence: 155-175 steps/min
          const baseCadence = activityType === 'run' ? 165 : 110;
          const currentCadence = baseCadence + Math.floor(Math.random() * 10 - 5);
          
          // Steps added in 1 second
          const stepsAdded = currentCadence / 60; 
          const newSteps = prev.steps + stepsAdded;

          return {
            ...prev,
            steps: Math.round(newSteps),
            cadence: currentCadence,
          };
        });
      }, 1000);

      subscriptionRef.current = {
        remove: () => clearInterval(interval),
      };
      return;
    }

    // Real device pedometer tracking
    try {
      const subscription = Pedometer.watchStepCount((result) => {
        const timestamp = Date.now();
        const rawSteps = result.steps;

        // Calculate delta steps since last update
        const deltaSteps = rawSteps - lastStepCountRef.current;
        lastStepCountRef.current = rawSteps;

        // Ignore implausible jumps (e.g. first reading right after resume)
        if (deltaSteps > 0 && deltaSteps < 500) {
          sessionStepsRef.current += deltaSteps;
          stepHistoryRef.current.push({ steps: deltaSteps, timestamp });
        }

        // Clean up history to keep only the last 15 seconds to compute active cadence
        const cutoff = timestamp - 15000;
        stepHistoryRef.current = stepHistoryRef.current.filter((item) => item.timestamp > cutoff);

        // Compute cadence (steps per minute)
        let totalRecentSteps = 0;
        stepHistoryRef.current.forEach((item) => {
          totalRecentSteps += item.steps;
        });

        // Time span in minutes
        const activeTimeSpanMinutes = stepHistoryRef.current.length > 1
          ? (timestamp - stepHistoryRef.current[0].timestamp) / 60000
          : 0.25; // default to 15 seconds (0.25m) if only one point

        const calculatedCadence = activeTimeSpanMinutes > 0
          ? Math.round(totalRecentSteps / activeTimeSpanMinutes)
          : 0;

        setMetrics((prev) => ({
          ...prev,
          steps: sessionStepsRef.current,
          cadence: calculatedCadence || (activityType === 'run' ? 150 : 90), // sensible default based on activity type
        }));
      });

      subscriptionRef.current = subscription;
    } catch (error: any) {
      setMetrics((prev) => ({
        ...prev,
        errorMsg: error.message,
      }));
    }
  };

  const stopTracking = () => {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    setMetrics((prev) => ({
      ...prev,
      cadence: 0,
    }));
  };

  useEffect(() => {
    if (isWorkoutActive) {
      startTracking();
    } else {
      stopTracking();
    }

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
      }
    };
  }, [isWorkoutActive, activityType]);

  return { ...metrics, reset };
}
