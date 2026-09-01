import { Workout } from './store';

export interface BpmBand {
  label: string;
  speed: number; // avg running speed (km/h) for the band
  pct: number; // relative share of the fastest band
  hasData: boolean;
}

const BANDS = [
  { label: 'High Tempo (140+ BPM)', min: 140 },
  { label: 'Medium Tempo (120-140 BPM)', min: 120 },
  { label: 'Low Tempo (<120 BPM)', min: 0 },
];

// Computes average running speed per BPM band from real workout data.
export function getBpmBands(workouts: Workout[]): BpmBand[] {
  const speeds = { high: [] as number[], med: [] as number[], low: [] as number[] };

  workouts
    .filter((w) => w.type === 'run')
    .forEach((w) => {
      w.songsHeard.forEach((s) => {
        if (s.bpm >= 140) speeds.high.push(s.avgSpeed);
        else if (s.bpm >= 120) speeds.med.push(s.avgSpeed);
        else speeds.low.push(s.avgSpeed);
      });
    });

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const entries = [
    { label: BANDS[0].label, speed: avg(speeds.high), hasData: speeds.high.length > 0 },
    { label: BANDS[1].label, speed: avg(speeds.med), hasData: speeds.med.length > 0 },
    { label: BANDS[2].label, speed: avg(speeds.low), hasData: speeds.low.length > 0 },
  ];

  const maxVal = Math.max(...entries.map((e) => e.speed));
  return entries.map((e) => ({
    label: e.label,
    speed: e.speed,
    hasData: e.hasData,
    pct: e.hasData && maxVal > 0 ? Math.round((e.speed / maxVal) * 100) : 0,
  }));
}

// The BPM band where the user's pace is fastest (only from real data).
export function getBestBpmBand(workouts: Workout[]): BpmBand | null {
  const bands = getBpmBands(workouts).filter((b) => b.hasData && b.speed > 0);
  if (bands.length === 0) return null;
  return bands.reduce((a, b) => (b.speed > a.speed ? b : a));
}

// 0-100 readiness score based on how much the best BPM band lifts pace
// versus the user's other bands. Returns null until enough real data exists.
export function computeReadiness(workouts: Workout[]): number | null {
  const best = getBestBpmBand(workouts);
  if (!best) return null;
  const others = getBpmBands(workouts).filter((b) => b.hasData && b.label !== best.label && b.speed > 0);
  if (others.length === 0) return null;
  const medianOther = others.reduce((a, b) => a + b.speed, 0) / others.length;
  if (medianOther <= 0) return null;
  const lift = ((best.speed - medianOther) / medianOther) * 100;
  return Math.max(0, Math.min(100, Math.round(50 + lift * 5)));
}
