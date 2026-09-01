# CONTEXT_2.md — AudioFit (Phone-Only Scope)

## 1. Project Identity

**Project:** AudioFit — An AI-Driven Music-Performance Intelligence System for Personalised Workout Optimisation  
**Academic Title (recommended):** *AudioFit: An AI-Driven Music-Performance Intelligence System for Personalised Workout Optimisation* — BTech CSE (Data Science)  
**Scope Variant:** This document (`CONTEXT_2.md`) is the **phone-only** specification. Every feature described here can be built and verified using **only sensors and capabilities available on a stock smartphone** (GPS, pedometer/accelerometer, clock, internet + Spotify Web API). No external hardware — no heart-rate strap, no smartwatch, no chest sensor, no HRV, SpO2, power meter, or gym equipment — is required or assumed. For the unconstrained (wearable-inclusive) vision see `context.md`; for the full feature wishlist see `AudioFit_Features.html`.

**Platform:** React Native + Expo (Expo SDK 57) — cross-platform iOS / Android + Web fallback, file-based routing via `expo-router`. See `audiofit/package.json:3-22`.

---

## 2. Problem Statement (Narrowed to Run / Walk)

Millions of runners and walkers train with music, yet no app closes the loop between *what was playing* and *how the user performed while it played*. Fitness apps track the body (pace, distance, cadence). Music apps track the ears (play history, taste). Neither correlates the two at a per-song, per-user level.

Sports-psychology research (Karageorghis & Priest 2012; Karageorghis et al. 2011; Van Dyck et al. 2015; Bood et al. 2013; Terry et al. 2020) consistently shows:

- Synchronous (beat-matched) music improves work output, cadence entrainment, and reduces perceived exertion.
- Preferred tempo scales with exercise intensity (e.g., ~120–140 BPM for moderate locomotion, higher for running).
- Runners spontaneously entrain cadence to music tempo when the two are close.

**Gap:** No consumer product records *every song heard during a Run/Walk*, segments the phone-measurable output (pace, cadence, distance, steps) at song boundaries, attributes a measurable delta to each song, learns a persistent taste→performance profile, and uses it to generate real, playable recommendations from the user's own Spotify catalogue — in real time, on-device.

**AudioFit (phone-only) closes that loop for exactly two activities: Run and Walk.** No cycling, no gym, no rep-counting.

---

## 3. Design Constraint — Phone-Only Sensors

### 3.1 Sensors and Platform Capabilities ALLOWED

| # | Capability | Expo / Phone API | What it measures | Used for |
|---|------------|------------------|------------------|----------|
| 1 | **GPS / Location** | `expo-location` — `watchPositionAsync` with `Accuracy.BestForNavigation`, `timeInterval: 2000ms`, `distanceInterval: 2m` — `audiofit/src/hooks/useGPS.ts:97-144` | Latitude, longitude, altitude, speed (m/s), timestamp | Distance (Haversine), current speed (km/h), average pace, route polyline, pace per song |
| 2 | **Pedometer / Step Counter** | `expo-sensors` — `Pedometer.watchStepCount` — `audiofit/src/hooks/useSensors.ts:85-123` | Step count events | Steps, live cadence (SPM) via 15-second sliding window, cadence per song |
| 3 | **Clock / Timers** | JS `Date.now()`, `setInterval` | Wall time, elapsed time | Session duration, song time-boxing, recency decay |
| 4 | **Internet + Spotify Web API** | `fetch` + OAuth2 PKCE (`expo-auth-session`, `expo-web-browser`) — `audiofit/src/constants/store.ts:236-588` | Streaming catalogue, playback state, audio features (when available) | Currently-playing polling, history sync, live recommendations, genre enrichment |
| 5 | **On-device Storage** | `@react-native-async-storage/async-storage` — `audiofit/src/constants/store.ts:70-75` | Persisted history, caches | Offline operation, Audio DNA, recommendation cache |
| 6 | **Maps rendering** | `react-native-maps` | Visual route | Live map during session |
| 7 | **Device Info / Permissions** | `expo-device`, `expo-location` permission flow | Platform detection | Web fallback / simulator path |

> **Simulation fallback:** On `Platform.OS === 'web'` or when `Pedometer.isAvailableAsync() === false`, both hooks enter a deterministic simulator with activity-appropriate defaults — Walk cadence ~100–115 SPM, Run cadence ~155–175 SPM; GPS speed ~8–12 km/h — `useSensors.ts:27-80`, `useGPS.ts:68-92`. This guarantees the full loop is demonstrable without hardware.

### 3.2 Explicitly EXCLUDED (requires external hardware or non-phone sensors)

These features from `context.md` / `AudioFit_Features.html` are **out of scope for this document** and must not be implemented in the phone-only build:

- Heart rate, heart-rate zones, Karvonen effort, HR-triggered music gating (`AudioFit_Features.html:52`)
- HRV, HRV readiness score, recovery-aware music (`AudioFit_Features.html:67`)
- SpO2, blood oxygen, stress tracking (`AudioFit_Features.html:68`)
- Power output, rep counter / accelerometer-based lift detection (`AudioFit_Features.html:70`)
- Calorie-song map derived from HR (a simple MET-based estimate is allowed as a stretch, but not required)
- Wearable data hub (Apple Watch, Garmin, WHOOP, Oura, Fitbit) — `AudioFit_Features.html:66`
- Apple HealthKit / Health Connect ingestion
- Sleep & recovery music driven by sleep/HRV data (`AudioFit_Features.html:85`)
- Smart gym equipment via BLE (`AudioFit_Features.html:113`)
- Standalone watch app (Apple Watch / WearOS) (`AudioFit_Features.html:116`)
- Nutrition tie-in, mental-load tracker from wearable stress signals (`AudioFit_Features.html:128-129`)

**Rationale:** Every excluded item needs either a photoplethysmography sensor, chest strap, or external BLE peripheral — none are reliably present on a stock phone. Phone-camera HR and microphone HR are deliberately *not* used (inaccurate, permission-heavy, and rejected by app review).

### 3.3 What a Phone CAN Reliably Measure for Run/Walk

- **Distance & pace:** GPS Haversine with spike rejection (>100 m per 2 s fix is discarded) — `useGPS.ts:116-119`.
- **Speed:** GPS `coords.speed` (m/s → km/h) with zero-floor — `useGPS.ts:122-123`.
- **Steps & cadence:** Pedometer delta steps accumulated in `sessionStepsRef`; cadence = `totalRecentSteps / activeTimeSpanMinutes` over the last 15 s — `useSensors.ts:99-116`.
- **Duration:** Stopwatch from session start timestamp.
- Everything else is **derived** from these four primitives plus music metadata.

---

## 4. Goals and Non-Goals

### 4.1 Goals (Phone-Only)

1. Track **Run** and **Walk** sessions end-to-end using only GPS + pedometer + clock.
2. Detect and log **every song played during the session** (live Spotify polling or queue-driven) with BPM, energy, valence.
3. Attribute **per-song performance** using only phone-measurable metrics: average speed while the song played, rhythm-match score (BPM ↔ cadence), and a speed-boost delta.
4. Build a persistent, recency-weighted **Audio DNA profile** (genres, artists, BPM preference) from *workout listening only*.
5. Generate **explainable, ranked recommendations** from the live Spotify catalogue seeded by workout listening (offline fallback to curated catalog).
6. Adapt playback **in real time, on-device** using only cadence-drop and pace-drop triggers (no HR gating).
7. Sync **bi-directionally with Spotify** (and optionally YouTube Music) via OAuth2 PKCE for history, playback state, and playlist creation.
8. Function **offline** after first sync (cached history, estimated audio features, local recommendation fallback).

### 4.2 Non-Goals

- Any feature listed in §3.2.
- Automatic activity recognition (user explicitly selects Run or Walk before starting).
- Rep counting, cycling cadence, or gym modes.
- HR-based calorie or zone calculations.

---

## 5. Target Users (Narrowed)

- **Casual runners** who want tempo-locked music without buying a watch.
- **Walkers / brisk walkers** who want motivational music matched to footfall.
- **Students / budget athletes** who own only a phone and Spotify (free or premium).

Explicitly **not** targeting gym-goers, cyclists, or triathletes in this scope.

---

## 6. System Architecture (Phone-Only)

```
┌─────────────────────────────────────────────────────────────────┐
│  Smartphone (Expo App)                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Session      │  │ Kinematic    │  │ Music-Integration      │  │
│  │ Engine       │◄─┤ Sensor Modul │  │ Module (store.ts)      │  │
│  │ (index.tsx)  │  │ useSensors   │  │  OAuth PKCE, token     │  │
│  │ timer, state │  │ Pedometer →  │  │  refresh, history sync │  │
│  │ idle→track→  │  │ cadence 15s  │  │  currently-playing poll│  │
│  │ summary      │  │ window       │  │  audio-feature enrich  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────────┘  │
│         │                 │                     │                 │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌─────────▼──────────────┐  │
│  │ Location     │  │ Adaptive     │  │ Profile & Recommender  │  │
│  │ Module       │  │ Playback     │  │ recommender.ts         │  │
│  │ useGPS       │  │ Controller   │  │ buildProfile,          │  │
│  │ Haversine +  │  │ matchPct +   │  │ recommend,             │  │
│  │ spike reject │  │ speedBoost   │  │ DISCOVERY_CATALOG      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────────┘  │
│         │                 │                     │                 │
│  ┌──────▼─────────────────▼─────────────────────▼──────────────┐  │
│  │ Insight Engine (insights.ts)                               │  │
│  │ BPM-band → avg speed, best band, readiness 0–100           │  │
│  └──────────────────────┬────────────────────────────────────┘  │
│                         │                                        │
│  ┌──────────────────────▼────────────────────────────────────┐  │
│  │ Persistence (AsyncStorage)                                │  │
│  │ @audiofit:workout_history_v2, :spotify_state_v2,          │  │
│  │ :artist_genres_v1, :recommendations_v1                    │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │  HTTPS (when online)
              ┌────────────▼────────────┐
              │ Spotify Web API         │
              │ /me, /me/player/*,      │
              │ /audio-features,        │
              │ /recommendations,       │
              │ /artists, /search       │
              └─────────────────────────┘
```

**Module → file mapping:**

| Module | File | Role |
|--------|------|------|
| Session Engine | `audiofit/src/app/index.tsx` | Workout lifecycle, stopwatch, queue driver |
| Kinematic Sensor | `audiofit/src/hooks/useSensors.ts` | Steps, cadence, availability check |
| Location | `audiofit/src/hooks/useGPS.ts` | Distance, speed, route, permissions |
| Music Integration | `audiofit/src/constants/store.ts` | Auth, sync, polling, enrichment, caching |
| Recommender | `audiofit/src/constants/recommender.ts` | Pure engine: profile, scoring, ranking |
| Insights | `audiofit/src/constants/insights.ts` | BPM-band analysis, readiness |
| UI — For You | `audiofit/src/app/for-you.tsx` | DNA snapshot + ranked picks |
| UI — Spotify | `audiofit/src/app/spotify.tsx`, `spotify-auth.tsx` | Connect, sync status |

---

## 7. Data Models (Phone-Only)

### 7.1 Workout Record (one per Run/Walk session)

```ts
// audiofit/src/constants/store.ts:12-30
interface Workout {
  id: string;
  type: 'walk' | 'run';          // ONLY these two
  date: string;                  // ISO timestamp of session start
  duration: number;              // seconds (clock)
  distance: number;              // km (GPS Haversine, spike-rejected)
  steps: number;                 // integer (pedometer)
  avgSpeed: number;              // km/h (distance / duration)
  avgCadence: number;            // SPM (pedometer rolling window)
  songsHeard: {
    title: string;
    artist: string;
    bpm: number;                 // from Spotify audio-features or local estimate
    energy: number;              // 0..1
    speedBoost: number;          // % pace boost while song played (derived)
    avgSpeed: number;            // km/h while song played (GPS)
    matchScore: number;          // 0..100 rhythm-match BPM ↔ cadence
  }[];
}
```

No `heartRate`, `hrv`, `caloriesFromHR`, `power`, or `reps` fields. If calories are shown, they are a derived estimate (`MET × weight × duration`) and must be labelled *estimated*.

### 7.2 Listen Record (recommender input)

```ts
// audiofit/src/constants/recommender.ts + store.ts:594-630
interface ListenRecord {
  title: string;
  artist: string;
  artistId?: string;
  genres?: string[];   // resolved from artist-genre cache or catalog
  bpm?: number;
  energy?: number;
  timestamp: number;   // epoch ms — workout start time
  playWeight?: number; // 0..1, defaults to 1
}
```

Built **only** from `Workout.songsHeard` via `store.getListeningHistory()` — never from the user's general Spotify library.

### 7.3 Candidate Song

Same shape as `ListenRecord` plus `popularity?: number` (0..1), `source?: 'spotify-live' | 'catalog'`, and scoring fields.

---

## 8. Song-Performance Attribution (Phone-Only Metrics)

While a song is playing, the session engine time-boxes GPS + cadence samples to the song's wall-clock interval and computes two scores. These are the **only** performance signals.

### 8.1 Rhythm-Match Score `matchPct` (0–100)

Closeness between the song's tempo and the user's live cadence, with double-time correction for low-tempo tracks during running — a sports-science-aligned rule:

```
// store.ts / session engine — derived from PATENT_DISCLOSURE §7.3
effectiveBPM = (cadence > 140 && songBPM < 95) ? songBPM * 2 : songBPM
matchPct     = clamp(0, 100, 100 - (|cadence - effectiveBPM| / effectiveBPM) * 100)
```

- Walk: typical cadence 100–115 SPM → matches ~100–115 BPM directly.
- Run: typical cadence 155–175 SPM → an 85 BPM track doubles to 170 effective BPM and scores ~100 at 170 SPM.
- Displayed in the Song Performance Ledger per track.

### 8.2 Speed-Boost / Performance-Delta Score (Phone-Only Formula)

A heuristic blended from the song's energy and its rhythm match, expressed as a percentage pace boost. No HR term:

```
// Adapted from PATENT_DISCLOSURE §7.3 — HR term removed
speedBoost = round( songEnergy * 10 + matchPct / 20 - 2 )   // e.g. -2 .. +13 %
```

Production generalisation (when enough history exists) can replace this with the ratio `meanSpeedDuringSong / sessionBaselineSpeed`, but the heuristic above is the v1 phone-only implementation.

### 8.3 Average Speed While Song Played

`avgSpeed` for the song = `distanceCoveredDuringSong / timeSongPlayed` from GPS — stored alongside `matchScore` and `speedBoost` in the ledger.

All three are visible on the post-workout summary: per-song BPM, energy, `matchScore`, `speedBoost`, and `avgSpeed`.

---

## 9. Audio DNA Profile (Phone-Only Construction)

Built exclusively from workout listening via `recommender.ts:buildProfile` — `audiofit/src/constants/recommender.ts:56-104`.

1. **Recency weighting (exponential decay):**
   ```
   ageDays = (now - timestamp) / 86_400_000
   w(t)    = exp( -(ln 2 / 30) * ageDays )   // HALF_LIFE_DAYS = 30
   ```
   A song from 30 days ago weighs 0.5; 60 days ago 0.25.

2. **Effective listen weight:** `wEffective = playWeight * w(t)`, default `playWeight = 1`.

3. **Genre scores:** weight split evenly across a song's distinct genres to avoid multi-tag inflation:
   ```
   genreScore(g) = Σ wEffective(l) / count(genres(l))   over listens l containing g
   ```

4. **Artist scores:** `artistScore(a) = Σ wEffective(l)` over listens of artist `a`.

5. **Normalisation:** both maps L2-normalised to the max value → every score in `[0,1]`, strongest = `1.0`, invariant to history length. Surfaced as top-8 genres, top-8 artists, and dominant BPM (mean BPM snapped to nearest 5) — the *Your Music DNA* snapshot in `for-you.tsx`.

No HR, no energy-expenditure, no sleep term enters the profile.

---

## 10. Real-Time Adaptive Playback (Phone-Only Gating)

All switching decisions run **on-device** with no cloud round-trip (sub-second). The controller evaluates every sensor tick (cadence + GPS speed update) and every song change.

### 10.1 Cadence-Lock Messaging (passive, always on)

Continuously compute `matchPct` for the current song and surface one of:

- `matchPct ≥ 85` → "Perfect Rhythm! Music locked at N% cadence match"
- `60 ≤ matchPct < 85` → "Rhythm lock: N%. Adjusting song queue…"
- `cadence dropping` → "Cadence dropped! Queuing high-energy song…"

### 10.2 Effort-Drop / Fatigue Trigger (active, Run only)

Phone-only fatigue is inferred from **cadence drop** (and optionally pace drop), not HR:

```
IF activityType == 'run'
   AND cadence < 145 SPM               // below efficient running cadence
   AND currentSong.energy < 0.75       // current track is not high-energy
THEN queue( first queued song with energy > 0.8 )
```

An analogous pace-drop guard can be added once baseline pace is known:

```
IF avgSpeedLast30s < 0.85 * sessionAvgSpeed AND currentSong.energy < 0.75
THEN queue(highEnergyTrack)
```

Both run locally; a short debounce delay prevents thrashing.

### 10.3 Cooldown Detection (end-of-session)

When `duration` exceeds the user's typical session length or pace/cadence decays monotonically for >60 s after the user taps *Pause*, the queue can auto-select a lower-energy / lower-BPM track (energy < 0.5, BPM < 100) as a wind-down cue. No HR/HRV threshold is used.

### 10.4 What is NOT done phone-only

- No HR-zone gating (e.g., "stay in Zone 2") — requires HR.
- No HRV-based readiness gating of playlist energy — handled instead by the pace-based readiness score (§11).
- No double-time HR coupling — double-time applies only to BPM↔cadence.

---

## 11. Insight and Readiness Engine (Phone-Only)

From `audiofit/src/constants/insights.ts:16-64` — computed strictly from stored `Workout` records, **Run sessions only**.

- **BPM bands:** High ≥ 140 BPM, Medium 120–140 BPM, Low < 120 BPM.
- **Per-band average speed:** mean of `s.avgSpeed` for all songs in that band.
- **Best band:** band with the highest average speed (requires `hasData`).
- **Readiness score (0–100):**
  ```
  medianOther = mean(speed of other bands with data)
  lift        = (bestBandSpeed - medianOther) / medianOther * 100
  readiness   = clamp(0, 100, round(50 + lift * 5))
  ```
  Returns `null` until at least two bands have data. Drives the pre-session nudge: *"Your pace is strongest on High-Tempo tracks — queue them today."*

No HRV, sleep, or calorie term enters this score.

---

## 12. Hybrid Explainable Recommender (Phone-Only)

Two scopes, same pure engine (`recommender.ts`):

| Scope | Profile source | Candidates seeded by | Shown on |
|-------|---------------|----------------------|----------|
| **Per-activity picks** | `getListeningHistory(workoutId)` — songs from one just-finished session | Top artists/genres of that session | Post-workout summary |
| **Overall picks** | `getListeningHistory()` — all sessions | Top artists/genres across all workouts | *For You* tab |

### 12.1 Candidate Acquisition

1. Build the Audio DNA profile from workout `ListenRecord`s.
2. Take top artists (by recency-weighted affinity) and top genres.
3. Resolve real Spotify artist IDs via `GET /v1/search?type=artist` — `store.ts:662-675`.
4. Call live `GET /v1/recommendations?seed_artists=...&seed_genres=...&limit=...` — `store.ts:679-738`.
5. Enrich each returned track with genre tags via `GET /v1/artists?ids=...` and cache them.
6. **Offline/demo fallback:** if no valid (non-`demo_`) token — `store.ts:748-751` — use `DISCOVERY_CATALOG` plus the user's own history via `buildCandidatePool()`.

The user's overall Spotify library (top tracks / saved tracks) is **never** used as a signal — only workout listening seeds the call.

### 12.2 Scoring and Ranking

For each candidate `c` against the profile:

```
simGenre(c)  = Σ min(profileGenre[g], 1) / |distinct genres(c)|   ∈ [0,1]
simArtist(c) = min(1, artistScore[c.artist])                      ∈ [0,1]
score(c)     = 0.65 * simGenre(c) + 0.35 * simArtist(c) + popularity(c) * 0.01
             → scaled to 0–100
```

- `GENRE_WEIGHT = 0.65`, `ARTIST_WEIGHT = 0.35`, tiny popularity tie-breaker `0.01` — `recommender.ts`.
- **Novelty guard:** candidates with exact `artist|title` heard within `RECENTLY_HEARD_DAYS = 14` are zeroed; `includeHeard = false` by default — `recommender.ts`.
- **Ranking:** `top(limit, sortDesc(filter(score > 0)))` — default `limit = 12` (overall) or `5` (per-activity).
- **Explainability:** each pick carries `reasons[]` derived directly from the score terms, e.g., *"Matches your taste in pop"* (genre hit) or *"The Weeknd is a favorite of yours"* (artist hit). This is an XAI property useful for trust without needing SHAP.

### 12.3 Tuning Knobs (`recommender.ts`)

| Constant | Default | Effect |
|----------|---------|--------|
| `HALF_LIFE_DAYS` | 30 | How quickly old listens fade |
| `GENRE_WEIGHT` | 0.65 | Genre overlap vs. artist identity |
| `ARTIST_WEIGHT` | 0.35 | Artist identity weight |
| `RECENTLY_HEARD_DAYS` | 14 | Novelty window |
| `limit` | 12 / 5 | Picks returned per scope |

---

## 13. Spotify Integration (Phone-Only)

From `audiofit/src/constants/store.ts:236-588`.

- **Auth:** OAuth2 Authorization Code + PKCE via `expo-auth-session` + `expo-web-browser` + `expo-crypto`. `clientId` + `customRedirectUri` stored in `AsyncStorage`.
- **Token lifecycle:** `tokenExpiresAt` tracked; `getValidAccessToken()` auto-refreshes when `expiresAt - now < 5 min` via `POST https://accounts.spotify.com/api/token` with `refresh_token`.
- **History sync — resilient fallback chain:**
  1. `GET /v1/me/player/recently-played?limit=20` (needs `user-read-recently-played`)
  2. fallback → `GET /v1/me/top/tracks?limit=20&time_range=short_term` (needs `user-top-read`)
  3. fallback → `GET /v1/me/tracks?limit=20` (saved tracks, needs `user-library-read`)
  Result stored as `SpotifyState.recentlyPlayed` with `syncSource` tag.
- **Live currently-playing poll:** `GET /v1/me/player/currently-playing` every ~10 s during an active session; `204 = nothing playing`. Track's BPM/energy fetched via `GET /v1/audio-features/{id}` when available; otherwise deterministic local estimates `estimateBpm(id)` → 90–180 BPM, `estimateEnergy(id)` → 0.4–0.9 — `store.ts:525-541`. Result flagged `bpmEstimated`.
- **Genre enrichment:** `GET /v1/artists?ids=...` in batches of 50; cached in `artistGenres` map keyed by `id` and normalised name; persisted to `@audiofit:artist_genres_v1`.
- **YouTube Music:** listed as a future sync target; phone-only v1 ships **Spotify-only** to keep scope tight (see Open Questions).

Audio features API is restricted for new Spotify apps — the local-estimate fallback is therefore a first-class path, not an error case.

---

## 14. Permissions and Lifecycle

| Permission | When requested | Fallback if denied |
|------------|---------------|--------------------|
| Foreground Location | `Location.requestForegroundPermissionsAsync()` at session start — `useGPS.ts:42-64` | Session runs without distance/pace/route; cadence still works; user warned |
| Motion / Pedometer | `Pedometer.isAvailableAsync()` check — `useSensors.ts:25-31` | Simulator cadence based on activity type |
| Internet | Implicit | Offline mode: cached history + estimated features + catalog fallback |
| Spotify OAuth | User taps *Connect Spotify* | App fully functional offline; recommendations from catalog, no live polling |

**Lifecycle:** `idle → tracking → paused → tracking → stopped → summary`. `reset()` wipes step history only on brand-new session; pause/resume preserves `sessionStepsRef` and GPS `distance` — `useSensors.ts:42-47`, `useGPS.ts:174-180`.

---

## 15. Screens and User Flows (Phone-Only)

### 15.1 Core Screens

| Screen | File | Phone-only content |
|--------|------|--------------------|
| **Tracker / Home** | `src/app/index.tsx` | Activity selector (Walk/Run), Start/Pause/Stop, live stopwatch, live GPS map (`LiveMap.tsx`), live cadence + pace + distance + steps (`MetricCard.tsx`), current song card with BPM/energy/matchPct, cadence-lock banner, queue |
| **Post-Workout Summary** | summary view in `index.tsx` | Duration, distance, avg pace, avg cadence, steps, Song Performance Ledger (per-song BPM, energy, matchScore, speedBoost, avgSpeed), per-activity recommendations (`getActivityRecommendations`) |
| **History** | history list in `index.tsx` | All past workouts, filterable by type, with per-workout ledger |
| **For You** | `src/app/for-you.tsx` | Your Music DNA (top genres, top artists, dominant BPM), overall recommendations (`getRecommendations`), BPM-band insight cards, readiness score |
| **Spotify Sync** | `src/app/spotify.tsx` + `spotify-auth.tsx` | Connect/disconnect, sync source badge, recently-played list, token status |

### 15.2 Social & Gamification (software-only, therefore kept)

- Song leaderboards — "who ran fastest to this song" (pace-based, not HR).
- Workout streaks & badges — e.g., "Iron Playlist", "BPM Beast" triggered by cadence/BPM milestones.
- Crew challenges — shared playlist for a week; ranking by distance/pace.
- Session sharing — story card (workout + playlist) to Instagram/WhatsApp/X.
- Community playlist voting; monthly "Top song by activity type".

These require no sensors and are retained.

---

## 16. Calibration and Thresholds (Phone-Only Defaults)

| Parameter | Value | Source / Rationale |
|-----------|-------|--------------------|
| Walk cadence (simulator & default) | 110 SPM (±5) | `useSensors.ts:62`, typical walk 100–115 |
| Run cadence (simulator & default) | 165 SPM (±5) | `useSensors.ts:62`, typical easy run 155–175 |
| Fatigue cadence threshold (Run) | 145 SPM | Below efficient running cadence; triggers high-energy queue — `§10.2` |
| Energy thresholds | low < 0.75, high > 0.8 | Spotify energy 0..1; separates chill vs. hype |
| Double-time rule | `cadence > 140 && BPM < 95 → effectiveBPM = BPM*2` | `§8.1`, beat-per-footfall entrainment |
| GPS spike reject | > 0.1 km per 2 s fix (~180 km/h) | `useGPS.ts:116-119`, impossible for Run/Walk |
| GPS watch cadence | `timeInterval: 2000ms`, `distanceInterval: 2m`, `BestForNavigation` | `useGPS.ts:99-102` |
| Cadence window | 15 s rolling | `useSensors.ts:99-100` |
| Spotify poll | ~10 s during active session | `store.ts:544-588` |
| Recency half-life | 30 days | `recommender.ts` |
| Novelty guard | 14 days | `recommender.ts` |

---

## 17. Evaluation (Phone-Only Metrics)

No HR/HRV means evaluation uses only phone-measurable outcomes:

| Metric | Definition | Target |
|--------|-----------|--------|
| **Recommendation ranking accuracy** | Offline NDCG@K / Precision@K on held-out later sessions (did the user play a recommended song?) | NDCG@10 ≥ 0.6 on first cohort |
| **Cadence-BPM match uplift** | Mean `matchPct` of recommended queue vs. user's manual queue | Positive delta, p < 0.05 |
| **Pace uplift** | Mean `avgSpeed` during recommended songs vs. baseline (same user, same activity) | Positive delta |
| **Adaptation latency** | Time from cadence-drop trigger to queued-song switch (on-device) | < 500 ms |
| **Playlist retention** | Skip rate of auto-generated queue vs. manual playlist | Auto queue skipped less |
| **Engagement** | Weekly active users, streak length, sessions per week | Cohort analytics |

All metrics computable from `Workout` records alone.

---

## 18. Tech Stack (Phone-Only)

| Layer | Choice |
|-------|--------|
| App framework | React Native + Expo SDK 57, `expo-router` |
| Language | TypeScript |
| Sensors | `expo-sensors` (Pedometer), `expo-location` (GPS) |
| Auth | `expo-auth-session`, `expo-web-browser`, `expo-crypto` (PKCE) |
| Storage | `@react-native-async-storage/async-storage` |
| Maps | `react-native-maps` |
| Streaming | Spotify Web API (OAuth2 PKCE, `/me`, `/player`, `/recommendations`, `/artists`, `/search`); YouTube Music deferred |
| Recommendation | Pure TS engine in `recommender.ts` (content-based over genre/artist + recency decay), no backend |
| Hosting | On-device-first; no mandatory server — optional thin Node.js/Supabase backend only if cross-device sync is added later |

---

## 19. What Changed vs. `context.md` / `AudioFit_Features.html`

| Feature | Unconstrained vision | Phone-only (this doc) |
|---------|----------------------|----------------------|
| Activities | Run, Walk, Cycle, Gym, HIIT | **Run, Walk only** |
| Biometrics | HR, HRV, SpO2, power, pace, cadence | **Pace, cadence, distance, steps, duration only** |
| Adaptive gating | HR zones + cadence + fatigue | **Cadence-drop + pace-drop only** |
| Readiness | HRV + sleep + pace | **Pace per BPM band only** |
| Calorie map | HR-derived | **Removed or MET-estimate labelled estimated** |
| Audio DNA | Genres, artists, BPM, energy, HR response | **Genres, artists, BPM, energy only** |
| Integrations | Spotify, Apple Music, HealthKit, BLE wearables | **Spotify only (v1)** |
| Watch app | Apple Watch / WearOS standalone | **Removed** |
| Recovery music | HRV/sleep wind-down | **Simple pace-decay cooldown cue** |
| Offline | Full | **Retained — catalog fallback + estimated features** |

---

## 20. Risks and Limitations (Phone-Only)

- **GPS accuracy:** urban canyons, treadmill (no GPS). Mitigation: cadence remains available indoors; distance falls back to step-length estimate if GPS is absent.
- **Pedometer variance:** step detection differs across OEMs. Mitigation: 15 s window smooths spikes; simulator path exists.
- **Spotify audio-features deprecation:** new apps cannot reliably fetch tempo/energy. Mitigation: deterministic per-track estimates (stable, testable) already implemented — `store.ts:525-541`.
- **Battery:** continuous GPS at 2 s interval. Mitigation: stop tracking on pause/stop; no background HR polling to drain further.
- **Free Spotify tier:** no `currently-playing` for free users on some devices. Mitigation: queue-driven ledger still works without live polling.

---

## 21. Roadmap (Phone-Only, Suggested Order)

1. **M1 — Tracker:** Run/Walk lifecycle, GPS + pedometer, permissions, map, simulator parity.
2. **M2 — Music capture:** Spotify PKCE connect, history sync fallback chain, currently-playing poll, estimated-features fallback.
3. **M3 — Ledger:** per-song `matchScore` + `speedBoost` + `avgSpeed`, persisted to `@audiofit:workout_history_v2`.
4. **M4 — Audio DNA + For You:** `buildProfile` + DNA snapshot UI.
5. **M5 — Recommender:** live Spotify recommendations seeded by workout listening + offline fallback + explainable reasons.
6. **M6 — Adaptive queue:** cadence-drop high-energy switching + cadence-lock messaging + cooldown cue.
7. **M7 — Insights:** BPM-band cards + readiness score + sharing.
8. **M8 — Polish:** streaks, badges, leaderboards (pace-based), playlist export to Spotify.

---

## 22. Open Questions for the Owner (to lock before build)

1. **Calories:** keep a weight-input MET estimate (phone-computable) or remove calories entirely to stay strictly sensor-measured?
2. **Pace-drop guard:** add the `avgSpeedLast30s < 0.85 * sessionAvg` trigger alongside the cadence < 145 rule, or keep cadence-only for v1?
3. **YouTube Music:** defer to v2 (Spotify-only v1) or include as a parallel auth/sync target from M2?
4. **Weather/mood:** `AudioFit_Features.html:127` mood+weather aware — exclude completely (not a phone sensor) or allow weather via internet API (`expo-location` → weather fetch) and a manual pre-workout mood picker?
5. **Treadmill mode:** support indoor Run/Walk with GPS disabled (steps × estimated stride length) or require outdoor GPS for v1?
6. **RPE input:** add an optional post-workout perceived-exertion slider (1–10) to enrich the ledger with a subjective signal, or keep the ledger fully passive?

---

## 23. References (for Report / Patent Background)

- Karageorghis & Priest (2012), *Music in the exercise domain: a review and synthesis*, Int. Rev. Sport Exerc. Psychol.
- Karageorghis, Jones, Priest et al. (2011), *Revisiting the exercise heart-rate–music-tempo preference relationship*, Res. Q. Exerc. Sport 82.
- Van Dyck et al. (2015), *Spontaneous entrainment of running cadence to music tempo*, Sports Med.-Open 1:15.
- Bood et al. (2013), *The power of auditory-motor synchronization in sports*, PLoS ONE 8(7).
- Terry, Karageorghis et al. (2020), *Effects of music in exercise and sport: a meta-analytic review*, Psychol. Bull. 146(2).

*All citations support the BPM↔cadence entrainment claim and motivate the phone-only design (no HR needed to exploit it).*

---

## 24. Source of Truth

This document is derived from:

- `context.md` — unconstrained vision and abstract
- `AudioFit_Features.html` — full feature matrix
- `PATENT_DISCLOSURE_AudioFit.md` — architecture, formulas, and verified prototype behaviour
- `audiofit/src/constants/recommender.ts`, `store.ts`, `insights.ts`, `hooks/useSensors.ts`, `hooks/useGPS.ts` — implemented phone-only paths

Where this document conflicts with `context.md`, **this document governs** for the phone-only build.
