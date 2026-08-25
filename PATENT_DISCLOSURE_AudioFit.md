# PATENT DISCLOSURE

## AudioFit: A Biometric-Adaptive Music Selection and Song-Performance Correlation System for Personalised Workout Optimisation

**Type:** Provisional Specification (Indian Provisional Application style)
**Prepared by:** Inventor(s) — BTech CSE (Data Science) Final-Year Project, VIT Vellore
**Status:** Preliminary disclosure for attorney review — not a filed document

> **Important caveat to patent counsel / guide:** This disclosure describes a working
> functional prototype (React Native / Expo application) plus a planned production
> architecture. Section 8 separates **verified prototype behaviour** from **proposed
> evaluation protocol**. Any formal filing should be reviewed and re-drafted by a
> registered patent attorney/agent before submission.

---

## 1. Title of the Invention

**"A System and Method for Biometric-Adaptive Music Selection, Song-Performance Correlation, and Personalised Workout Optimisation (AudioFit)"**

Also referred to herein as "the invention", "the system", or "AudioFit".

---

## 2. Field / Area of the Invention

The present invention relates generally to the fields of:

- Fitness tracking and wearable/biometric computing;
- Digital music recommendation and playlist generation systems;
- Real-time, biometric-driven adaptive media (audio) playback;
- Multimodal data fusion of physiological sensor data with streaming-music metadata;
- Machine learning for personalised recommender systems, including content-based
  filtering, collaborative filtering, and explainable AI (XAI);
- Mobile and edge computing, including on-device inference and offline operation.

More particularly, the invention relates to a mobile-first system that captures every
musical track heard during an exercise session, correlates each track in real time with
simultaneously captured physiological and kinematic biometrics (cadence, pace, distance,
heart-rate-derived effort, steps), attributes measurable performance deltas to individual
songs, learns a per-user "Audio DNA" performance profile, and uses that profile to drive
adaptive, in-session music switching and personalised, explainable playlist recommendations
over the user's own streaming-music catalogue.

---

## 3. Prior Patents and Publications from Literature

The following prior art is the closest known to the inventors. It is summarised in the
table below, together with the specific gap(s) relative to the present invention.

### 3.1 Table of Prior Art

| # | Reference (Patent / Publication) | Year | Core disclosure | Gap vs. the present invention |
|---|----------------------------------|------|-----------------|-------------------------------|
| 1 | **US9183822B2** — *Music selection and adaptation for exercising* | 2015 | Selects music segments based on exercise pace and modifies musical tempo to correlate with the pace of an exercise section. | Works on a library of pre-existing music segments; does **not** build a per-user performance profile, does **not** attribute granular performance deltas (pace/HR/cadence) to individual songs, and does not rank a live streaming catalogue by learned performance affinity. |
| 2 | **US20080103022A1** — *Method and system for dynamic music tempo tracking based on exercise equipment pace* | 2008 | Dynamic music-tempo tracking slaved to the pace of connected exercise equipment. | Tied to gym equipment; no correlation of performance outcome back to individual songs; no user-learning profile; no streaming-catalogue integration. |
| 3 | **US10901683B1** — *Cadence determination and media content selection* | 2021 | Determines a user's cadence (e.g., steps/minute) and selects media content whose tempo approximately equals the cadence (e.g., rounded to the nearest 2.5/5/10 BPM). | Matches tempo to cadence only; does **not** learn which songs *improve* performance, does not maintain a performance ledger, and has no recommendation engine over a live catalogue grounded in observed performance. |
| 4 | **EP3658243A1 / WO2019020755A1** — *Mobile system allowing adaptation of the runner's cadence (BeatHealth)* | 2018–2020 | Uses a modified Kuramoto synchronisation model to adapt music tempo and phase to a runner's cadence in real time. | Focuses purely on tempo/phase entrainment; does not correlate per-song biometric outcome, does not build a recency-weighted preference–performance profile, and has no genre/artist-aware explainable recommendation layer. |
| 5 | **US20150186780A1** — *System and method for biometrics-based music recommendation* | 2015 | Recommends music based on biometrics (heart rate, perspiration, skin response) collected from wearables. | Recommendation is driven by *current* physiological state for mood/arousal matching; does **not** log songs heard during exercise, does **not** compute per-song performance deltas, and does **not** learn a persistent per-user music–performance (Audio DNA) profile from workout history. |
| 6 | **US20140119564A1** — *System and method for using biometrics to select music preference* | 2014 | Uses biometrics to infer/select music preference. | Preference inferred from biometric response, not from an attributable performance ledger; no real-time BPM-cadence gating; no song-level performance attribution. |
| 7 | **US20140277649A1** — *Biometrics-based music recommendation adapting to physical condition* | 2014 | Quickly adapts recommendations to changes in user's physical condition (activities, environment, biometric states). | Continuous re-selection based on current state; no persistent learning of which songs *historically* boost the user's pace/HR/cadence; no per-song ledger; no double-time BPM matching. |
| 8 | **US20180088895A1** — *Multimedia experience according to biometrics (Sonos)* | 2018 | Plays music when the user's biometric state (pulse, perspiration, tone of voice) matches previously observed states, cross-referencing listening history via ML. | Home-media oriented; cross-references biometric state to *listening history* for wellbeing/mood, not to *athletic performance outcome*; no fitness-metric attribution; no in-session adaptive queue switching. |
| 9 | **US20240058650A1** — *Adaptive workout plan creation and personalised fitness coaching based on biosignals (Apple)* | 2023 | Builds workout plans around target heart-rate effort zones estimated from resting/max HR (Karvonen method). | Fitness-planning and HR-zone coaching only; treats music as absent; no song-performance correlation, no adaptive music selection, no Audio DNA profile. |
| 10 | **Product: RockMyRun** | — | Commercial app that changes music tempo based on biometrics. | Operates on a **closed, licensed library**; cannot sync and play the user's own Spotify/Apple Music catalogue; no per-song performance ledger over the user's own tracks; no explainable recommendations. |
| 11 | **Product: Spotify "Running" / BPM-based mixes** | — | Static running mixes tagged by BPM; cadence-driven track selection in playback SDK. | No biometric loop; static curation; no learning; no performance attribution; no adaptive switching based on HR/effort drop. |
| 12 | **Academic: Karageorghis & Priest (2012), *Music in the exercise domain: a review and synthesis* (Parts I–II), Int. Rev. Sport Exerc. Psychol.** | 2012 | Comprehensive review establishing that synchronous (beat-matched) music improves work output and efficiency; motivates the whole field. | Establishes the *effect* (sports-psychology science) but proposes no system to capture the effect per-song per-user at scale. |
| 13 | **Academic: Karageorghis, Jones, Priest, et al. (2011), *Revisiting the exercise heart-rate–music-tempo preference relationship*, Res. Q. Exerc. Sport 82** | 2011 | Demonstrates a cubic relationship between exercise HR intensity and preferred music tempo (e.g., ~123–131 BPM optimal for treadmill exercise). | Population-level statistical preference; does not learn the *individual's* optimal tempo from their own workouts; no automated adaptive playback. |
| 14 | **Academic: Van Dyck et al. (2015), *Spontaneous entrainment of running cadence to music tempo*, Sports Med.-Open 1:15** | 2015 | Shows runners spontaneously entrain cadence to music tempo. | Demonstrates entrainment; no system to exploit it for per-song performance attribution or adaptive queueing. |
| 15 | **Academic: Bood et al. (2013), *The power of auditory-motor synchronization in sports*, PLoS ONE 8(7)** | 2013 | Shows time-to-exhaustion increases with metronome/music matched to cadence; beat prominence matters. | Laboratory result; no personalised learning, no live-catalogue integration, no performance ledger. |
| 16 | **Academic: Terry, Karageorghis, et al. (2020), *Effects of music in exercise and sport: a meta-analytic review*, Psychol. Bull. 146(2)** | 2020 | Meta-analysis confirming music improves performance, especially fast-tempo music; maps moderators. | Aggregate science; does not disclose a system for individualised, closed-loop music–performance intelligence. |
| 17 | **Academic: RunSync (UC Berkeley project)** | 2023 | Academic prototype using HR/HRV to seed Spotify recommendation API parameters for medium-distance running. | Prototype seeds Spotify parameters from HR zones; does **not** maintain a per-song performance ledger, does not compute recency-weighted genre/artist DNA, does not perform sub-second BPM-cadence gating or effort-drop-triggered switching. |

### 3.2 Differentiation statement

None of the above discloses a single integrated system that (i) records every song played
during a workout, (ii) segments time-synchronised biometric/kinematic data at song
boundaries and computes per-song **performance delta scores**, (iii) folds those deltas into
a persistent, **recency-decayed, per-user performance profile (Audio DNA)** spanning genres,
artists, BPM, and energy, (iv) drives **real-time, on-device music switching** using
cadence↔BPM matching (including double-time beat matching) and effort/HR-triggered energy
gating, and (v) generates **explainable, live-catalogue recommendations** seeded solely by
workout listening. This combination is believed to be novel and non-obvious.

---

## 4. Summary and Background of the Invention (Gap / Novelty)

### 4.1 Background

Music has a well-documented ergogenic (work-enhancing) effect during exercise. Sports
psychology research (Karageorghis; Bood et al.; Terry et al.) shows that music matched to a
movement's rhythm increases endurance, reduces perceived exertion, and improves pacing
efficiency. Commercially, millions of users exercise with music. Yet the tools that exist
today are one-sided:

- **Fitness applications** (e.g., Apple Fitness+, Strava, Garmin, WHOOP) track the body —
  pace, heart rate, cadence, steps — but treat music as absent or as a passive background
  audio feed with no closed loop.
- **Music applications** (e.g., Spotify, Apple Music, YouTube Music) track the ears — play
  history, preferences — but have no awareness of the user's physical state mid-workout and
  no notion of a song's *performance impact*.
- **Tempo-synced workout music products** (e.g., RockMyRun) can shift tempo with
  biometrics but operate on closed licensed libraries, cannot play the user's own
  catalogue, and do not attribute measured performance gains to individual songs.

Three concrete gaps exist:

1. **No per-song ↔ per-metric attribution.** No system records *which* song was playing and
   correlates it with granular metrics (pace, cadence, HR-zone time, perceived exertion,
   step count) to build a per-song performance ledger for the user.
2. **No real-time adaptive music across the user's own catalogue.** Music platforms have
   zero awareness of the body's state. A cooldown song plays at the same energy as a peak
   interval song. No system switches songs within the user's own Spotify/Apple Music
   catalogue based on live cadence/HR/effort signals.
3. **No learned per-user music–performance profile.** The relationship between a song's
   audio features (tempo/BPM, energy, valence, danceability) and a specific user's
   athletic output is individual; it is not captured, learned continuously, or exploited
   for recommendation.

### 4.2 Summary of the Invention

The present invention closes the loop between what a user listens to and how well they
perform. In a preferred embodiment it is a mobile-first system that:

1. **Captures every song heard** during an exercise session — from the user's actual
   streaming playback (live polling of the streaming API, e.g., Spotify "currently playing")
   or from a locally driven queue — and logs it with a timestamp.
2. **Fuses time-synchronised biometrics** — cadence (steps/minute) from the device
   pedometer using a short sliding window; distance and pace from GPS using Haversine
   distance with GPS-spike rejection; heart-rate-zone/effort signals from wearables.
3. **Attributes performance to each song** — for every song heard, computes a
   **rhythm-match score** (`matchPct`, 0–100) between the song's BPM and the user's live
   cadence (including *double-time matching* for sub-95 BPM tracks against high running
   cadence), and a **speed-boost / performance-delta score** derived from the song's energy
   and the rhythm match.
4. **Builds an Audio DNA profile** — a persistent, per-user representation of genres and
   artists (and BPM preference) heard during workouts, weighted by **exponential recency
   decay** so recent sessions dominate, and L2-normalised to be scale-invariant to history
   length.
5. **Recommends from a live catalogue** — seeds the streaming platform's recommendation
   API with the artists and genres present *only* in workout listening, fetches real
   candidate tracks, and ranks them by a **hybrid score** blending genre similarity and
   artist affinity, with a built-in novelty guard and **human-readable explanations** for
   every recommendation.
6. **Adapts playback in real time, on-device** — while a session is active, the system
   monitors cadence (and HR/effort) and, when the user's cadence falls below a threshold
   (e.g., 145 SPM) while a low-energy track is playing, queues a higher-energy track to
   re-engage performance; conversely, it can switch to recovery/cooldown audio at session
   end.

### 4.3 Novelty highlights

- **Song-performance attribution methodology** (Section 7.3): per-song delta scores from
  time-aligned biometric segmentation at song boundaries.
- **Audio DNA performance profile** (Section 7.4): a recency-decayed, L2-normalised
  genre/artist/BPM profile constructed *only* from workout listening, distinct from any
  generic listening history.
- **Double-time BPM-cadence matching** (Section 7.5): effective-BPM doubling so low-tempo
  tracks (e.g., 85 BPM) correctly lock to high running cadence (e.g., 170 SPM) — capturing
  the sports-science "beat per footfall" alignment.
- **Effort-triggered adaptive switching** (Section 7.5): rule-based gating that replaces a
  low-energy song with a high-energy song when cadence drops below a zone and energy is
  insufficient, plus HR-zone-triggered selection for intensity control.
- **Activity-only, explainable recommender** (Section 7.6): recommendations grounded only
  in workout listening, scored by transparent genre/artist terms with human-readable
  reasons (an explainable-AI property useful for trust and regulatory compliance).
- **Closed-loop on-device operation**: the adaptive switching path operates without cloud
  dependency, enabling sub-second response.

---

## 5. Objective(s) of the Invention

The principal objectives of the present invention are:

1. To provide a system and method for **correlating individual musical tracks with
   granular, time-synchronised athletic-performance metrics** (pace, cadence, steps,
   HR-zone effort) and computing per-song **performance-delta scores**.
2. To provide a **per-song performance ledger** — a structured, queryable record of how the
   user performed (average pace, speed boost, rhythm-match score) whenever each track was
   played.
3. To construct and continuously update a **per-user music–performance profile ("Audio
   DNA")** encoding genres, artists, BPM, and energy affinities weighted by recency, so
   that old sessions fade and recent adaptations dominate.
4. To provide **real-time, biometric-adaptive music playback** that switches tracks within
   the user's own streaming-music catalogue based on live cadence↔BPM matching (including
   double-time beat matching), HR/effort gating, and fatigue (cadence-drop) detection —
   executing on-device for sub-second response.
5. To provide an **explainable hybrid recommendation engine** that generates personalised
   playlist recommendations seeded exclusively by workout listening, ranked by blended
   genre/artist similarity, and accompanied by human-readable justifications.
6. To integrate **seamlessly with existing streaming platforms and wearables** (e.g.,
   Spotify, Apple Music, YouTube Music via OAuth; Apple HealthKit; BLE wearables) while
   degrading gracefully to **offline/demo operation** when no platform token is available.
7. To support **recovery-aware and readiness-aware music selection** — e.g., generating
   cooldown/wind-down audio and recommending playlist energy based on a derived readiness
   score.
8. To provide a **gamified/social performance layer** (leaderboards by song, challenges,
   badges) to improve adherence — an objective that, while peripheral to the core method,
   strengthens commercial viability.

---

## 6. Working Principle of the Invention (in Brief)

The system operates as a closed loop during an exercise session and as a learning engine
between sessions:

1. **Ingest.** A session begins; the device captures (a) each song played (live
   streaming-API polling, or the locally driven queue) with its audio features (BPM,
   energy, valence), and (b) biometric/kinematic signals — cadence from the pedometer
   (15-second sliding window), distance/pace from GPS (Haversine with spike rejection),
   and optional HR/HRV from wearables.
2. **Attribute.** Each song is time-boxed; the user's performance during that box is
   compared to their baseline. A **rhythm-match score** is computed between the song BPM
   and live cadence (with double-time adjustment for sub-95 BPM tracks against cadences
   above ~140 SPM). A **speed-boost score** combines the song's energy with the rhythm
   match. These form the song's performance delta.
3. **Learn.** Song events are written to a recency-weighted genre/artist/BPM profile (the
   Audio DNA). Old listens decay exponentially (half-life ≈ 30 days); scores are
   L2-normalised to the maximum so the profile is history-length invariant.
4. **Adapt (real time).** While active, a rule-based gate monitors cadence and song energy.
   If cadence falls below a threshold (e.g., 145 SPM) while a low-energy track plays, the
   system queues a high-energy track to re-engage the user; HR-zone thresholds can also
   trigger higher/lower energy selection. This runs entirely on-device.
5. **Recommend.** Between sessions, the profile seeds the streaming platform's live
   recommendation API with the user's workout-derived artists/genres; real candidate tracks
   are fetched, scored (0.65 × genre similarity + 0.35 × artist similarity + a small
   popularity tie-breaker), filtered by a 14-day novelty guard, ranked, and returned with
   human-readable reasons.
6. **Feedback.** Every recommendation's eventual in-session performance is attributed back
   into the ledger, closing the loop.

The whole pipeline is on-device-first: recommendation ranking and adaptive switching need
no server; streaming-platform calls are used only to obtain real tracks and metadata.

---

## 7. Description of the Invention in Detail

### 7.1 System Architecture

The invention is implemented as a mobile application (in the prototype, a cross-platform
React Native / Expo application) comprising the following functional modules:

| Module | Function |
|--------|----------|
| **Session engine** | Manages workout lifecycle: idle → tracking → summary. Runs the stopwatch, starts/stops sensor and GPS capture, and drives the playback queue. |
| **Kinematic sensor module** (`useSensors`) | Uses the device pedometer; maintains a rolling 15-second step-history buffer to compute live cadence (SPM). Falls back to a simulation on platforms without a pedometer. |
| **Location module** (`useGPS`) | Uses GPS `watchPosition` at ~2 s / 2 m intervals; computes distance via Haversine formula; rejects impossible GPS spikes (>~100 m per fix); computes instantaneous speed (m/s → km/h). |
| **Music-integration module** (`store` + Spotify sync) | OAuth2 (Authorization Code + PKCE) token lifecycle with auto-refresh; resilient history-sync fallback chain (recently played → top tracks → saved tracks); live "currently playing" polling; audio-feature enrichment with deterministic local estimates when the audio-features API is unavailable; artist-genre caching. |
| **Adaptive playback controller** | Computes rhythm-match score and speed-boost for each song; applies cadence/effort-triggered switching and BPM-cadence lock messaging in real time. |
| **Profile & recommender engine** (`recommender.ts`) | Pure, side-effect-free functions that build the Audio DNA profile and score/rank candidate songs. |
| **Insight engine** (`insights.ts`) | Derives BPM-band performance (average speed per tempo band) and a 0–100 Audio Readiness score. |
| **Persistence layer** | On-device storage (AsyncStorage) for workout history, Spotify state, artist-genre cache, and cached recommendations — enabling offline operation. |

### 7.2 Data Models

**Workout record** (one per session):

```
Workout {
  id: string
  type: 'walk' | 'run'
  date: ISO timestamp
  duration: seconds
  distance: km
  steps: integer
  avgSpeed: km/h
  avgCadence: SPM
  songsHeard: [
    {
      title, artist,
      bpm, energy,
      speedBoost: number,   // performance-delta (pace boost %)
      avgSpeed: km/h,       // user's speed while the song played
      matchScore: number    // 0–100 rhythm-match with cadence
    }
  ]
}
```

**Listening record** (recommender input):

```
ListenRecord {
  title, artist, artistId?,
  genres?: string[],   // normalised genre tags
  bpm?, energy?,
  timestamp: epoch ms, // when it was heard
  playWeight?          // optional engagement weight (0..1)
}
```

**Candidate song** (recommender candidate): same audio features plus optional popularity
(0–1) and a source tag (`catalog` / `synced` / `spotify-live`).

### 7.3 Song-Performance Attribution (Performance Deltas)

While a song is playing, the system computes two per-song scores and stores them in the
ledger:

**(a) Rhythm-match score (0–100).** The closeness between the song's tempo (BPM) and the
user's live cadence (SPM), with a double-time adjustment: if cadence exceeds ~140 SPM and
the song BPM is below ~95 BPM, the song's *effective BPM* is doubled (one beat per
footfall), matching the sports-science finding that runners entrain a beat to each step
rather than each stride:

```
effectiveBPM  = (cadence > 140 AND songBPM < 95) ? songBPM × 2 : songBPM
matchPct      = clamp(0, 100, 100 − (|cadence − effectiveBPM| / effectiveBPM) × 100)
```

**(b) Speed-boost / performance-delta score.** A heuristic blend of the song's energy and
its rhythm match, scaled to a percentage pace boost:

```
speedBoost = round( songEnergy × 10 + matchPct / 20 − 2 )   // e.g., −2 .. +13 %
```

This per-song delta is displayed in the session's Song Performance Ledger and stored for
the Audio DNA / insight engines. The generalised production form of this attribution uses
the ratio of the user's mean speed/HR within the song interval to their session baseline
(a "performance-delta ratio"), enabling the data-science extensions described in
Section 9.

### 7.4 Audio DNA Profile Construction

Given the full list of `ListenRecord`s (all songs heard across workouts), the profile is
built as follows:

1. **Recency weighting (exponential decay).** Each listen is weighted so that older listens
   matter less:

   ```
   ageDays = (now − timestamp) / 86 400 000
   w(t)    = exp( −(ln 2 / HALF_LIFE_DAYS) × ageDays )     // HALF_LIFE_DAYS = 30
   ```

   A song heard 30 days ago has weight 0.5; 60 days ago, 0.25; and so on.

2. **Effective listen weight.** `wEffective = playWeight × w(t)` (playWeight defaults to 1).

3. **Genre scores.** A song often belongs to several genres; to avoid one multi-genre song
   dominating, each listen's weight is split evenly across its distinct genres:

   ```
   genreScore(g) = Σ_{l : g ∈ genres(l)} wEffective(l) / count(genres(l))
   ```

4. **Artist scores.** `artistScore(a) = Σ wEffective(l)` over all listens of artist `a`
   (keyed by artist ID when available, else normalised artist name).

5. **Normalisation.** Both maps are L2-normalised to the maximum value, so every score lies
   in [0,1] and the profile is invariant to the volume of history. The top-8 genres and
   artists are surfaced as the "Your Music DNA" snapshot, together with a dominant BPM
   (mean BPM snapped to the nearest 5).

This profile is deliberately built **only from workout listening**, not from the user's
general streaming history — a key differentiator.

### 7.5 Real-Time Adaptive Playback (On-Device Gating)

During an active session, a rule-based controller evaluates each sensor update:

- **Cadence lock messaging.** The current matchPct is computed continuously; the UI shows
  "Perfect Rhythm! Music locked at N% cadence match", "Rhythm lock: N%. Adjusting song
  queue...", or a warning when cadence is dropping.
- **Effort-drop / fatigue trigger.** For a running session, if **cadence < 145 SPM AND the
  current song's energy < 0.75**, the controller queues the highest-energy running track
  from the queue (after a short delay) to re-engage the user:

  ```
  IF activityType == 'run' AND cadence < 145 AND currentSong.energy < 0.75
      queue( first song with type 'run' AND energy > 0.8 )
  ```

- **HR/effort gating (extended).** In the generalised system, heart-rate-zone thresholds
  (e.g., from the Karvonen resting/max-HR method) select higher-energy tracks to push into
  a target zone and lower-energy tracks to keep a session in Zone 2, with the same
  on-device rule engine. A cooldown/recovery mode auto-selects relaxation audio and guided
  breathing at session end.

All switching decisions execute locally (no cloud round-trip), giving sub-second response.

### 7.6 Hybrid Explainable Recommender

Recommendation generation proceeds in two stages:

**Stage A — Candidate acquisition (live catalogue).**
1. Build the Audio DNA profile from workout listening records.
2. Take the top artists (by recency-weighted affinity) and top genres; resolve real artist
   IDs via the streaming API search endpoint.
3. Call the streaming platform's live recommendation endpoint
   (e.g., Spotify `GET /v1/recommendations`) seeded with those artists and genres
   (`seed_artists`, `seed_genres`, `limit`), fetching **real catalogue tracks**.
4. Enrich each candidate with real genre tags (via the artists endpoint) and cache them.
5. If no valid platform token is available (offline/demo), fall back to a curated discovery
   catalogue plus the user's own history — the live path is always preferred.

**Stage B — Scoring and ranking.** Each candidate `c` is scored against the profile:

```
simGenre(c)  = Σ_{g ∈ distinct genres(c)} min(profileGenre[g], 1)  /  |distinct genres(c)|     ∈ [0,1]
simArtist(c) = min(1, artistScore[c.artist])                                                     ∈ [0,1]
score(c)     = GENRE_WEIGHT × simGenre(c) + ARTIST_WEIGHT × simArtist(c) + popularity(c) × 0.01
               GENRE_WEIGHT = 0.65, ARTIST_WEIGHT = 0.35   → scaled to 0–100
```

- **Novelty guard.** Candidates heard within the last `RECENTLY_HEARD_DAYS = 14` days are
  zeroed out (and explicitly owned history is excluded unless requested).
- **Ranking.** `top(limit, sortDesc(filter(score > 0)))` — default limit 12 (5 on the
  post-workout screen).
- **Explainability.** Each pick carries `reasons[]` generated directly from the score terms,
  e.g., *"Matches your taste in pop"* (genre hit) or *"The Weeknd is a favorite of yours"*
  (artist hit) — giving transparent, human-interpretable recommendations (an XAI property).

The same engine serves two scopes: **per-activity picks** (profile built from a single
just-completed workout, shown on the post-workout summary) and **overall picks** (profile
built from all activities, shown in the "For You" screen).

### 7.7 Insight and Readiness Engine

From stored workouts, the insight engine:
- Groups songs into BPM bands (High ≥ 140, Medium 120–140, Low < 120);
- Computes the average running speed achieved within each band from **real data only**;
- Identifies the user's best-performing BPM band;
- Derives a 0–100 **Audio Readiness score**:

  ```
  lift        = (bestBandSpeed − mean(otherBandSpeeds)) / mean(otherBandSpeeds) × 100
  readiness   = clamp(0, 100, 50 + lift × 5)
  ```

This readiness score drives the pre-session recommendation ("Your pace is strongest on
High-Tempo tracks — queue them today to hit your PR").

### 7.8 Description of the Accompanying Drawings / Figures

The following figures should be prepared to accompany the complete specification. Each is
described below so that it can be drawn by a patent illustrator.

**Figure 1 — System architecture.** A block diagram showing: a user with a wearable device
(heart-rate/HRV) and a smartphone; the smartphone hosting the AudioFit application with
modules (Session Engine, Sensor/GPS Modules, Music-Integration Module, Adaptive Playback
Controller, Recommender Engine, Insight Engine, Persistence Layer); cloud interfaces to
Streaming Music Platform APIs (OAuth2, search, recommendations, currently-playing,
audio-features) and wearable/HealthKit data sources; arrows labelled with data flows.

**Figure 2 — End-to-end data flow.** A flow diagram: Session Start → concurrent capture of
(Per-song playback events) and (Cadence / Steps / GPS pace / HR) → song-boundary
segmentation → per-song performance-delta computation (matchScore, speedBoost) → Song
Performance Ledger → recency-weighted Audio DNA profile → candidate acquisition from live
API → similarity scoring/ranking → ranked explainable recommendations → playback →
feedback into the ledger (closed loop).

**Figure 3 — Real-time adaptation algorithm.** A flowchart of the on-device gating loop:
read cadence and current song → compute effectiveBPM (double-time rule) → compute matchPct
→ if run AND cadence < 145 AND energy < 0.75 → queue high-energy track; else update
cadence-lock message → repeat every sensor tick. Secondary branch for HR-zone-triggered
energy selection and cooldown detection.

**Figure 4 — Recommender scoring.** A diagram showing the preference profile (genre scores,
artist scores, L2-normalised) on one side, candidate songs on the other, and the blended
score formula `0.65·simGenre + 0.35·simArtist + 0.01·popularity`, the novelty guard (14-day
filter), ranking, and reason generation.

**Figure 5 — Representative user-interface screens (photos/screenshots from the working
prototype).** (a) Session tracker with live map, cadence/pace metrics, adaptive music player
and rhythm-lock alert; (b) post-workout summary with the Song Performance Ledger (per-song
BPM, speed-boost %, rhythm-match %) and per-activity recommendations; (c) "For You" screen
showing the Music DNA snapshot (top genres, top artists, dominant BPM) and ranked picks with
explainable reasons; (d) Spotify-sync screen.

*(Note: the working prototype's UI screens are available as screenshots in the project
"reference UI" folder; they should be embedded as the drawing set for Figure 5.)*

---

## 8. Experimental Validation Results

### 8.1 Verified Prototype Behaviour (as demonstrated by the working system)

The implemented prototype was exercised and the following functional behaviours were
verified in operation (each maps to specific code paths):

1. **Real-time cadence capture:** the device pedometer streams step counts; live cadence
   (SPM) is computed from a rolling 15-second sliding window, with sensible activity-type
   defaults where hardware is absent. Verified: cadence updates continuously during active
   sessions and resets cleanly between sessions.
2. **GPS pace/distance fusion:** distance is computed with the Haversine formula at ~2 s /
   2 m position updates; impossible GPS spikes (>100 m per fix) are rejected to prevent
   distance corruption; instantaneous speed is converted from m/s to km/h. Verified: no
   spike contamination observed during simulated/on-device runs.
3. **Rhythm-match scoring incl. double-time:** the effective-BPM rule (sub-95 BPM doubled
   against cadence > 140 SPM) correctly raises the match score of low-tempo tracks during
   high-cadence running (e.g., an 86-BPM track at 172 SPM scores ≈ 100% via 2× = 172).
4. **Effort-drop adaptive switching:** with cadence < 145 SPM and a low-energy (< 0.75)
   track active, the controller schedules the highest-energy running track; the UI reports
   "Cadence dropped! Queuing high-energy song...". Verified: switch fires deterministically
   under the stated conditions.
5. **Live streaming integration:** OAuth2 (PKCE) connect, token refresh before expiry/on
   401, resilient history-sync fallback chain, 10-second "currently playing" polling, and
   audio-feature enrichment with deterministic local estimates when the audio-features API
   is restricted. Verified: real catalogue tracks flow into the session queue and ledger.
6. **Audio DNA & recommender:** recency-decayed genre/artist profile, L2-normalised;
   hybrid scoring; 14-day novelty guard; explainable reasons; live-API seeding with
   offline-catalog fallback. Verified: ranking is deterministic given the same history, and
   recommendations are grounded only in workout listening.
7. **Insight engine:** BPM-band → average-pace analysis and the 0–100 Audio Readiness score
   are computed strictly from real stored workouts (no data ⇒ no score).

### 8.2 Proposed Evaluation Protocol (planned metrics — not yet executed)

The following evaluation framework is defined for the production data-science pipeline and
represents the planned experimental validation, not completed experiments:

| Metric | Definition | Target |
|--------|-----------|--------|
| **Recommendation ranking accuracy** | Offline evaluation on session logs: NDCG@K and Precision@K for the recommend() ranking against held-out songs actually chosen/played in later sessions. | NDCG@10 ≥ 0.6 on first production cohort |
| **Adaptation latency** | Time from cadence/HR trigger to queued-song playback switch. | < 500 ms (on-device path) |
| **Performance uplift** | Longitudinal comparison of athletic metrics (pace, HR-zone time) before vs. after adoption of Audio-DNA-driven playlists. | Positive mean delta; p < 0.05 |
| **Playlist retention** | Skip rate of auto-generated queue vs. user's manual playlists. | Auto queue skipped less |
| **Churn/engagement** | WAU and streak length; churn vs. users who reach a "PR moment" linked to a recommended song. | Qualitative + cohort analytics |

The honest status is: **functional/prototype evidence is available (Section 8.1); formal
quantitative experiments remain planned.** No unrun numbers are claimed as results.

---

## 9. What Aspect(s) of the Invention Need(s) Protection?

The following aspects are believed to be the key inventive (claimable) contributions and
should be protected. They are presented as claim-categories for the attorney:

1. **A system and method for song-performance attribution during exercise**, comprising:
   capturing each musical track played during a session; capturing time-synchronised
   biometric/kinematic signals; segmenting the signals at song boundaries; and computing a
   per-song performance-delta score (rhythm-match and speed-boost/pace-delta) for a
   per-song performance ledger.

2. **A per-user, recency-weighted music-performance profile ("Audio DNA")**, built
   exclusively from workout listening, using exponential time-decay weighting,
   genre-weight splitting, artist scoring, and L2-normalisation to a history-invariant
   scale — and the use of said profile for recommendation and readiness scoring.

3. **Real-time, on-device, biometric-adaptive music switching**, including: BPM↔cadence
   rhythm-lock scoring with **double-time effective-BPM matching** for sub-95 BPM tracks
   against high running cadence; effort-drop/fatigue-triggered high-energy track queueing
   (cadence-threshold AND low-energy rules); and HR-zone/effort-gated energy selection —
   executed locally without cloud dependency.

4. **An activity-only hybrid explainable recommender**, wherein candidate tracks are fetched
   live from the user's streaming platform seeded solely by workout-derived artists/genres,
   scored by blended genre-similarity and artist-affinity terms, filtered by a novelty
   guard, and surfaced with human-readable, machine-generated justification reasons.

5. **A closed-loop feedback architecture** in which recommendations are played, their
   in-session performance deltas are attributed back into the ledger, and the Audio DNA
   profile is updated accordingly — i.e., continuous, self-improving personalisation.

6. **An insight/readiness engine** producing per-BPM-band performance analytics and a
   0–100 Audio Readiness score that drives pre-session playlist-energy recommendations and
   recovery-aware (cooldown/wind-down) music selection.

7. **Offline/graceful-degradation operation** of the above: the full capture–attribute–
   learn–adapt–recommend loop functioning on-device with only local storage, using
   deterministic per-track audio-feature estimation and a curated fallback catalogue when
   no streaming-platform token is available.

8. **(Optional dependent aspects)** wearable/HealthKit integration for HR & HRV; the
   social/gamification layer (per-song leaderboards, challenges, badges); and the
   LLM-based conversational coaching layer (retrieval-augmented generation over the Audio
   DNA profile) as described in the project roadmap.

**Recommended filing strategy:** file a **provisional specification** covering claims 1–7
(and optionally 8) promptly to establish priority, with the working prototype preserved as
evidence of reduction to practice. Formal claims to be drafted by patent counsel.

---

*End of disclosure. Prepared from the AudioFit project codebase (recommendation engine,
session tracker, sensor/GPS hooks, insights, Spotify integration) and the project
specification (CONTEXT.md, AudioFit_Features.html). References to specific implementation
files: `src/constants/recommender.ts`, `src/constants/store.ts`, `src/constants/insights.ts`,
`src/hooks/useSensors.ts`, `src/hooks/useGPS.ts`, `src/app/index.tsx`, `src/app/for-you.tsx`.*