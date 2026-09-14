# Invention Disclosure Format (IDF) – B

> **Document No.:** 02-IPR-R003
> **Issue No / Date:** 2 / 01.02.2024
> **Amd. No / Date:** 0 / 00.00.0000
> **Source Template:** `Invention_Disclosure_Format_B (1).pdf` — © VIT IPR & TTCELL
> **Invention:** AudioFit — An AI-Driven Music-Performance Intelligence System for Personalised Workout Optimisation
> **Disclosure Date:** 13 September 2026

> **Inventor details — TO BE FILLED:**
>
> | # | Name | Affiliation (School / Dept., VIT Vellore) | Role (Inventor / Guide) | Email | Mobile | Signature |
> |---|------|-------------------------------------------|-------------------------|-------|--------|-----------|
> | 1 |      |                                           |                         |       |        |           |
> | 2 |      |                                           |                         |       |        |           |
> | 3 |      |                                           |                         |       |        |           |

---

## 1. Title of the Invention

**AudioFit: A Biometric-Correlated, Hybrid Machine-Learning System for Personalised Workout-Music Recommendation Integrating On-Device Sensing, Dual-Catalogue Content Filtering, User-Profile Embedding, and Grounded LLM Re-Ranking**

Short title for filing: **AudioFit — Music-Performance Intelligence System for Personalised Workout Optimisation**

---

## 2. Field / Area of Invention

- Computer Science: Recommender systems, hybrid filtering, applied machine learning
- Mobile computing: React Native / Expo cross-platform fitness tracking (iOS, Android, Web)
- Sports technology: workout sensing via pedometer (cadence/SPM) and GPS (distance, speed, route)
- Music information retrieval: 9-dimensional audio-feature vectors (acousticness, danceability, energy, instrumentalness, liveness, loudness, speechiness, tempo, valence)
- Natural Language Processing: LLM-generated taste cards and grounded playlist re-ranking (Gemini / Mistral)
- Human-Computer Interaction: explainable music recommendation for exercise adherence

IPC indicative classes (for IPR cell review): G06N (machine learning), G06F 16/60 (multimedia retrieval), G06Q 50/00 (fitness / lifestyle services), A63B 24/00 (exercise monitoring).

---

## 3. Prior Patents and Publications from Literature (Prior Art)

| Patent / Publication | Description | Relevance / Limitation vs. Present Invention |
|---|---|---|
| RockMyRun (US commercial system; tempo-adaptive music for running) | Adjusts music tempo/mix based on cadence/HR using a closed, proprietary music library | Proves biometric-tempo coupling is valuable, but **closed catalogue** — cannot use the user's own Spotify library; no per-song performance ledger, no personalised embedding |
| Spotify recommendation / Discover Weekly ecosystem (e.g., US 9,639,201; Spotify publications on collaborative + content filtering) | Large-scale music recommendation from general listening history | Optimised for **general listening**, not workouts; no notion of workout-scoped history, cadence/BPM coupling, or pace-vs-tempo attribution |
| Nike Run Club / Strava / Endomondo class fitness trackers | GPS + sensor workout logging, route maps, pace analytics | Track the **body only**; music (if any) is an external background player with **zero data fusion** between songs heard and biometric output |
| Apple Music / YouTube Music playback apps | Streaming playback, manual playlists | No biometric awareness; a cooldown track and a peak-interval track are treated identically |
| Standard content-based KNN music recommenders (literature: cosine-similarity over audio features with StandardScaler + KNN) | Nearest-neighbour song similarity | Single-catalogue, single-language, non-personalised; no user-profile vector, no bilingual fusion, no LLM grounding |
| LLM playlist chatbots (generic prompt-to-playlist demos) | Open-world LLM song lists from free text | **Ungrounded** — hallucinate titles/artists, no catalogue constraint, no audio-feature scoring, no taste profile |
| Sports-psychology literature on music tempo ↔ performance / perceived exertion | Establishes BPM/energy → pace/motivation correlation at population level | Population-level science only; **no individual, continuously learning Audio DNA profile** and no real-time system implementing it |

**Gap summary:** No single prior system (a) restricts the taste signal to **songs heard during workouts**, (b) fuses **live cadence/GPS speed with per-song audio features**, (c) maintains a **persistent 9-D personalised user-profile embedding**, (d) fuses **bilingual catalogues** through a weighted hybrid score, and (e) constrains an LLM with **catalogue-grounded re-ranking + explainable reasons**. AudioFit is that combination.

---

## 4. Summary and Background of the Invention (Gap / Novelty)

### Problem

Millions exercise with music, yet fitness apps track the body and music apps track the ears — neither talks to the other. Users curate playlists by gut feel with no knowledge of which songs make *them* faster, and playback never adapts to bodily state mid-workout. Engagement/churn in fitness apps remains high for lack of personalised, motivating experiences.

### Existing solutions and limitations

1. **Tempo-shifting apps (RockMyRun class):** adapt tempo but only inside a closed library; users lose their Spotify/existing catalogue.
2. **Streamers (Spotify/Apple/YouTube Music):** zero awareness of HR zone, cadence, or fatigue.
3. **Fitness trackers (Strava/Nike class):** rich GPS/cadence analytics but music-blind.
4. **Recommenders:** either pure collaborative/content KNN (impersonal, monolingual) or pure LLM chat (hallucinated, unscored).

### Novelty of AudioFit

AudioFit treats **music as a measurable performance variable**. Every song heard during a workout is captured with its 9 audio features (via Spotify track ID → ReccoBeats audio-features API) and cross-referenced with simultaneously recorded sensor data (steps/cadence from `expo-sensors` Pedometer, distance/speed/route from `expo-location` GPS with Haversine computation and spike rejection). From this it builds a continuously learning per-user representation — the **Audio DNA / Taste Profile** — and generates the next queue through a novel multi-stage pipeline:

1. **Workout-scoped profiling (on-device):** recency-decayed (30-day half-life) genre/artist affinity built *only* from workout listens, not general Spotify history.
2. **Dual-catalogue KNN retrieval (server):** separate StandardScaler + cosine-KNN models for English (`knn_model_eng.pkl` / `scaler_eng.pkl` / `eng_song_catalog.pkl`) and Hindi (`knn_model_hin.pkl` / `scaler_hin.pkl` / `hin_song_catalog.pkl`) — 50 candidates each.
3. **Personalised V2 hybrid re-rank (server):** candidate set re-scaled with a unified V2 scaler and scored as `v2_score = user_weight × user_similarity + content_weight × content_similarity` against the stored 9-D user profile (`v2_model.pkl`: `scaler`, `user_weight`, `content_weight`) plus current-song similarity.
4. **Grounded LLM layer (server):** LLM-generated **Taste Card** (energy/tempo bias, likes/avoids, archetype) from favourite-song statistics + strict **candidate-grounded re-ranking** (LLM may only return `track_id`s from the supplied candidate list; hallucinated IDs are discarded, with deterministic V2 fallback).
5. **Performance-intelligence UI (device):** per-song BPM-vs-speed bands, best-BPM band, and readiness score computed from real workout logs (`insights.ts`).

The inventive step lies in the **combination and specific data-flow** — particularly the bilingual dual-KNN → unified-scaler hybrid fusion, the 9-D mean-embedding profile from ≥10 favourites, and the hallucination-proof LLM grounding protocol — implemented as one working mobile + cloud system.

---

## 5. Objective(s) of Invention

1. To correlate, at an **individual** level, songs heard during exercise with granular performance output (cadence/SPM, GPS speed, distance, pace per BPM band).
2. To construct a persistent, portable **9-dimensional user taste/performance profile** from a minimum of 10 favourite songs (mean of V2-scaled audio-feature vectors).
3. To generate **personalised, bilingual (English + Hindi) workout queues** via dual-catalogue KNN retrieval fused by a weighted user-plus-content similarity score.
4. To provide **explainable, hallucination-free AI playlists** through an LLM Taste Card plus catalogue-grounded re-ranking with per-song reasons.
5. To deliver a **mobile-first operational prototype** (Expo/React Native + FastAPI backend) that senses, recommends, and visualises music-performance intelligence in real time, including offline/demo fallback.
6. To establish a foundation for **biometric-adaptive playback** (cadence-to-BPM matching) and recovery-aware recommendations in future work.

---

## 6. Working Principle of the Invention (in Brief)

The user works out with the AudioFit mobile app while phone sensors record steps/cadence and GPS track distance/speed/route. Songs heard (Spotify-synced or catalogue/demo tracks) are resolved to 9 audio features via the ReccoBeats API (Spotify track ID → ReccoBeats ID → audio features), with a deterministic hash-based estimator as fallback for catalogue tracks lacking a ReccoBeats entry.

On onboarding (≥10 favourites) the backend creates a **9-D user profile** (mean of V2-scaled favourite vectors) returned to and stored solely on the device (`ProfileManager`, AsyncStorage key `@audiofit:user_profile_v2`). At recommendation time the backend (i) retrieves 50 English + 50 Hindi nearest neighbours to the current/seed song via two independent KNN models, (ii) re-scores the ~100-candidate pool with the V2 hybrid formula blending user-profile cosine similarity and current-song cosine similarity, and (iii) optionally passes the top-40 to an LLM which — constrained to those candidate IDs plus the user's Taste Card and workout prompt — returns a ranked, reason-annotated playlist. The app renders ranked picks with explainable reasons ("Matches your taste in dance", similarity/match %, language tag), logs per-song BPM vs. average speed, and surfaces the user's Music DNA, best BPM band, and readiness score.

---

## 7. Description of the Invention in Detail (Components, Data-Flow, Drawings)

### 7.1 System overview

```
┌────────────────────────── DEVICE (Expo React Native, audiofit/) ──────────────────────────┐
│  useSensors.ts (Pedometer → steps, 15-s sliding-window cadence/SPM; sim fallback on web)  │
│  useGPS.ts (expo-location watchPosition 2s/2m → Haversine distance, speed, route;         │
│            spike rejection >100m/2s; web simulator 8–12 km/h)                              │
│  services/spotifyWrite.ts + app/spotify-auth.tsx (Spotify OAuth, sync)                    │
│  constants/recommender.ts (PURE on-device engine: recency decay, genre/artist scoring)    │
│  constants/mlRecommender.ts (ReccoBeats lookup, V1/V2/LLM API client, ProfileManager I/O) │
│  constants/audioFeatures.ts (9-feature DTO, validation, hash estimator fallback)          │
│  constants/profileManager.ts (AsyncStorage 9-D profile cache)                             │
│  constants/insights.ts (BPM-band vs speed, best band, readiness 0–100)                    │
│  app/(tabs)/ index, spotify, for-you, ai + onboarding-favorites + activity/[id]           │
└────────────────────────────────────────────┬────────────────────────────────────────────┘
                                             │ HTTPS JSON (FastAPI, Render)
┌────────────────────────── SERVER ("ml model spotify"/main.py) ───────────────────────────┐
│  /recommend_eng , /recommend_hin  (V1: scaler + cosine-KNN per language, ≤50 results)     │
│  /create_profile  (≥10 favourites → V2-scaled mean → 9-D profile)                         │
│  /recommend_v2    (dual-KNN 50+50 → V2 rescale → user/content cosine → weighted rank)     │
│  /create_taste_card (favourite stats + vibe text → LLM JSON taste card)                   │
│  /ai-recommend    (open-world LLM mode OR hybrid grounded re-rank mode, gemini/mistral)   │
│  Artefacts: knn_model_eng/hin.pkl, scaler_eng/hin.pkl, eng/hin_song_catalog.pkl,          │
│             v2_model.pkl {scaler, user_weight, content_weight}, spotify_tracks.csv,       │
│             synthetic_users/interactions.csv, interactions_train/val/test.csv              │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Component details

**A. Mobile sensing layer (`src/hooks/`)**

- `useSensors.ts`: `Pedometer.watchStepCount` delta accumulation; 15-second sliding window → cadence (SPM); pause/resume-safe session counters; web/simulator fallback (walk ~110 SPM, run ~165 SPM).
- `useGPS.ts`: `Location.watchPositionAsync({BestForNavigation, 2s, 2m})`; Haversine distance; speed from native `coords.speed × 3.6`; >0.1 km per 2-s spike rejection; coordinate trail for `LiveMap` rendering; start/resume/stop lifecycle preserving session distance across pauses.

**B. Audio-feature resolution (`get_song_det.py` pattern → `mlRecommender.ts:getSongFeatures`)**

`Spotify track ID → GET api.reccobeats.com/v1/track?ids=… → ReccoBeats ID → GET /v1/track/{id}/audio-features → 9 features`. All 9 must be finite numbers or the lookup is rejected; `estimateAudioFeatures(seedId)` (salted-hash deterministic ranges, e.g. tempo 90–180 BPM) covers catalogue/demo tracks and is flagged `estimated:true`.

**C. On-device preference engine (`recommender.ts`, `docs/RECOMMENDATION_ENGINE.md`)**

- Input: `ListenRecord[]` built **only** from workout `songsHeard` (deliberately excludes general Spotify top/recent/saved).
- Recency weight: `w(t) = exp(−(ln2/30)·ageDays)`; effective weight × engagement `playWeight`.
- Genre scores split evenly across a song's distinct genres; artist scores summed; genre map L2-max normalised to [0,1]; top-8 genres/artists = "Music DNA"; dominant BPM snapped to nearest 5.
- Candidate score: `score = 0.65·simGenre + 0.35·simArtist + 0.01·popularity` (0–100), with 14-day novelty guard zeroing recently heard `artist|title`. Each pick carries derived `reasons[]`.
- Live-Spotify candidate pool seeded from the activity's top artists (search → `/v1/recommendations` → artist-genre enrichment); static `DISCOVERY_CATALOG` (20 tracks) is offline/demo fallback only.

**D. Server ML pipeline (`main.py`, FastAPI)**

- Feature schema (exact, both V1 and V2): `acousticness, danceability, energy, instrumentalness, liveness, loudness, speechiness, tempo, valence` + `n_recommendations`.
- **V1** (`/recommend_eng`, `/recommend_hin`): per-language scaler transform → `kneighbors(n ≤ 50)` → cosine-derived `similarity = 1 − distance` → `{track_id, track_name, artist_name, album_name, year, language, popularity, similarity}`.
- **Profile** (`/create_profile`): validates ≥10 complete favourites → V2-scaler transform → `profile = mean(scaled, axis=0)` → returns 9-vector + `songs_used`.
- **V2** (`/recommend_v2`, 11 steps in code): current song → V1 50 Eng + V1 50 Hindi → dedupe/concat → V2-scaler transform of candidates + current song → `content_similarity = cos(current, candidates)`, `user_similarity = cos(profile, candidates)` → `v2_score = user_weight·user_sim + content_weight·content_sim` → argsort rank → top-N with all three scores.
- **Taste Card** (`/create_taste_card`, ≥3 favourites): `_summarize_favorites` (means, energy_bias high/med/low at 0.65/0.40, tempo_bias fast/mod/slow at 120/90 BPM, language counts, samples) + vibe text → constrained LLM prompt → strict JSON object `{taste_summary, energy_bias, tempo_bias, languages, likes[], avoids[], workout_use, archetype_hint}`.
- **AI recommend** (`/ai-recommend`, providers `gemini-3.5-flash-lite` / `mistral-small-latest`): legacy open-world JSON-array mode, or **hybrid mode** (triggered by `taste_card`/`user_profile`/`current_song`): top-40 V2 candidates slimmed to `{track_id, title, artist, language, energy, tempo, valence, popularity}` → LLM rerank prompt ("pick ONLY from candidate list by exact track_id") → strict ID-intersection filter (hallucinations dropped) → enriched response `{…, reason, v2_score, mode:"hybrid", candidate_count}` with pure-V2 fallback (`mode:"hybrid-fallback"`).

**E. Performance-intelligence analytics (`insights.ts`)**

Groups run-workout `songsHeard` by song BPM into High (140+), Medium (120–140), Low (<120) bands with mean speed per band; `getBestBpmBand` = fastest band; `computeReadiness` = `clamp(50 + 5·lift%, 0, 100)` where lift = (best − mean(others))/mean(others); null until ≥2 bands have data.

**F. App surfaces**

Tabs: run tracker (`index.tsx`, sensors + GPS + LiveMap), Spotify sync (`spotify.tsx`), For You (`for-you.tsx`, DNA + ranked picks persisted at `@audiofit:recommendations_v1`), AI coach (`ai.tsx`, prompt + language + Taste Card → `/ai-recommend`), onboarding favourites (`onboarding-favorites.tsx`, ≥10-track profile bootstrap), post-workout `activity/[id]` per-session next-time picks.

### 7.3 Novel data-flow (claim-oriented)

1. Workout-scoped listen capture → 2. ReccoBeats 9-feature resolution (with flagged estimation fallback) → 3. Dual-language KNN candidate generation (50+50) → 4. Unified V2-scale hybrid user+content scoring → 5. Optional LLM Taste-Card profiling → 6. Catalogue-grounded LLM re-rank with hallucination rejection → 7. Explainable ranked queue + BPM-band performance feedback loop.

### 7.4 Diagrams (to be replaced with formal patent drawings before filing)

- **Fig. 1 — End-to-end architecture:** device sensors → Spotify/ReccoBeats → FastAPI V1/V2/LLM → app UI (see ASCII diagram §7.1).
- **Fig. 2 — V2 hybrid scoring:** current song + 9-D profile → cosine similarities → weighted `v2_score` → ranked list (code steps 1–11, `recommend_v2`).
- **Fig. 3 — Hybrid LLM grounding protocol:** 40 slimmed candidates + taste card + prompt → LLM track_id-only array → ID-intersection filter → fallback chain.
- **Fig. 4 — Workout UI loop:** live cadence/speed → songsHeard log → DNA → For-You/AI picks → next workout.

---

## 8. Experimental Validation Results

Status: **working prototype demonstrated in a relevant environment** (device/emulator + hosted backend). No clinical or population-scale trial is claimed.

| Validation item | Method / artefact | Outcome |
|---|---|---|
| Mobile sensing | `useSensors` (pedometer cadence) + `useGPS` (Haversine distance/speed/route) on Expo dev-client / emulator / web simulator | Live steps, SPM, km, km/h and route trail demonstrated; pause/resume preserves session totals; GPS spike filter active |
| Audio-feature resolution | `get_song_det.py` + `getSongFeatures` via ReccoBeats `track` + `audio-features` endpoints | Real 9-feature vectors retrieved for Spotify IDs; deterministic estimator covers catalogue tracks without ReccoBeats entries |
| V1 retrieval | `knn_model_eng/hin.pkl` + scalers + catalogues served by `/recommend_eng`, `/recommend_hin` (live at `https://audiofit-ml-backend.onrender.com`) | Top-N similar tracks with similarity scores returned for both languages; seed track excluded; dedupe verified in `recommendForTracks` |
| V2 personalisation | `/create_profile` (≥10 favourites → 9-D mean vector) + `/recommend_v2` (50+50 → hybrid weighted rank with `v2_score`, `user_similarity`, `content_similarity`) | Personalised re-ranked lists returned; invalid-profile and incomplete-feature requests correctly rejected with 400 errors |
| LLM Taste Card + grounded re-rank | `/create_taste_card` + `/ai-recommend` hybrid mode (Gemini/Mistral), strict `track_id` intersection + V2 fallback | Taste-card JSON + reason-annotated, catalogue-grounded playlists returned; hallucinated IDs discarded by construction |
| On-device engine math | `recommender.ts` + `docs/RECOMMENDATION_ENGINE.md` (30-day half-life decay, 0.65/0.35 genre/artist blend, 14-day novelty guard) + `insights.ts` BPM bands | Deterministic, testable pure functions; DNA snapshot, ranked picks with reasons, and readiness score render in For-You / activity screens |
| Training artefacts | `spotify_tracks.csv`, `synthetic_users.csv`, `synthetic_interactions.csv`, `interactions_train/validation/test.csv`, `user_profiles.csv`, notebooks (`Language Based Model.ipynb`, `V2 Model Generation.ipynb`, `Song prediciton.ipynb`) | Dual-catalogue models and V2 weights trained and serialised (`eng/hin/v2` pkls); offline NDCG/Precision@K evaluation is **proposed future work**, not claimed as completed |

**Proposed formal evaluation (for complete specification):** (i) offline ranking quality (NDCG, Precision@K on held-out session logs), (ii) latency (<500 ms on-device switch target; server p95), (iii) longitudinal pace/skip-rate improvement after personalised-playlist adoption, (iv) playlist retention (skip rate vs. manual queues).

---

## 9. What Aspect(s) of the Invention Need(s) Protection?

Protection is sought for the **system as a whole and the following inventive features**, individually and in combination:

1. **Workout-scoped music-performance profiling method:** building the taste/performance signal exclusively from songs heard during workouts (with recency-decayed genre/artist affinity and dominant-BPM extraction), excluding general listening history.
2. **Dual-catalogue bilingual retrieval + unified hybrid re-rank:** independent per-language (English/Hindi) StandardScaler + cosine-KNN candidate generation (50+50) followed by re-scaling under a unified V2 scaler and weighted scoring `user_weight × user_similarity + content_weight × content_similarity` against a persistent 9-D mean-embedding user profile.
3. **9-D user-profile construction and storage protocol:** mean-of-scaled-favourites profile creation requiring ≥10 complete 9-feature songs, device-only persistence, and reuse as the personalisation vector for all subsequent V2 and hybrid calls.
4. **Hallucination-proof LLM playlist grounding protocol:** LLM Taste-Card generation from aggregate audio-feature statistics + vibe text, and candidate-constrained re-ranking in which the LLM may return only exact `track_id`s from a supplied slimmed candidate list, with strict ID-intersection filtering and deterministic V2 fallback.
5. **Sensor-fused song-performance ledger and analytics:** simultaneous capture of pedometer-derived cadence and GPS-derived speed/distance per song boundary, with BPM-band-vs-speed attribution, best-BPM-band detection, and readiness scoring.
6. **End-to-end mobile-cloud architecture** implementing (1)–(5): Expo/React Native sensing + Spotify/ReccoBeats feature resolution + FastAPI dual-KNN/V2/LLM backend + explainable on-device ranking and UI loop.
7. **Explainability outputs:** per-recommendation reasons derived from score terms (genre/artist match, similarity/match %, language tag) and per-song performance deltas.

*Future continuations envisaged (disclosed, protection to be extended): real-time biometric-gated track switching (cadence-to-BPM lock, HR-zone thresholds) and recovery-aware (HRV/sleep) playlist generation.*

---

## 10. What Is Technology Readiness Level of Your Invention? (Tick the Appropriate TRL)

**Claimed: TRL 6 — Technology demonstrated in a relevant environment.**

| Level | Stage | Status |
|---|---|---|
| TRL 1 | Basic principles observed | ✅ (sports-psychology music↔performance basis) |
| TRL 2 | Technology concept formulated | ✅ (AudioFit / Audio DNA concept, abstract, pipeline design) |
| TRL 3 | Experimental proof of concept | ✅ (notebooks, synthetic interactions, trained KNN/V2 artefacts) |
| TRL 4 | Technology validated in a lab | ✅ (backend endpoints + pure on-device engine functions verified) |
| TRL 5 | Technology validated in a relevant environment | ✅ (Expo app sensing + hosted Render backend exercised end-to-end) |
| **TRL 6** | **Technology demonstrated in a relevant environment** | **✅ CLAIMED — working mobile + cloud prototype demonstrated with real sensors, real Spotify/ReccoBeats lookups, and personalised playlists** |
| TRL 7 | System prototype demonstration in an operational environment | ⬜ Not claimed (no App Store/Play release, no longitudinal user study) |
| TRL 8 | System complete and qualified | ⬜ Not claimed |
| TRL 9 | Actual system proven in operational environment | ⬜ Not claimed |

**Justification:** all subsystems (pedometer/GPS sensing, Spotify + ReccoBeats resolution, V1 dual-KNN, V2 hybrid profile/rank, LLM taste-card/grounded rerank, DNA/insights UI) exist as running code and interoperate as a prototype; what remains for TRL 7+ is operational hardening (store release, wearable BLE/HR integration, large-scale validation).

---

## Annex A — Key Source References (for the IPR examiner / drafter)

- App: `audiofit/src/hooks/useSensors.ts`, `src/hooks/useGPS.ts`, `src/constants/recommender.ts`, `src/constants/mlRecommender.ts`, `src/constants/audioFeatures.ts`, `src/constants/profileManager.ts`, `src/constants/insights.ts`, `src/constants/store.ts`, `src/services/spotifyWrite.ts`, `src/app/(tabs)/{index,spotify,for-you,ai}.tsx`, `src/app/onboarding-favorites.tsx`, `src/app/activity/[id].tsx`, `docs/RECOMMENDATION_ENGINE.md`, `get_song_det.py`
- Backend: `ml model spotify/main.py` (endpoints `/`, `/recommend_eng`, `/recommend_hin`, `/ai-recommend`, `/create_taste_card`, `/create_profile`, `/recommend_v2`); artefacts `knn_model_eng/hin.pkl`, `scaler_eng/hin.pkl`, `eng/hin_song_catalog.pkl`, `v2_model.pkl`, `v2_scaler.pkl`, `v2_user_profiles.pkl`, `spotify_tracks.csv`, `synthetic_*.csv`, `interactions_*.csv`, notebooks `Language Based Model.ipynb`, `V2 Model Generation.ipynb`, `Song prediciton.ipynb`
- Live backend base URL: `https://audiofit-ml-backend.onrender.com` (`API_BASE_URL` in `mlRecommender.ts`)

## Annex B — Formalities Checklist (VIT IPR & TTCELL)

- [ ] Inventor names, affiliations, signatures completed on cover table
- [ ] Formal patent drawings (Figs. 1–4) drafted from §7.4 ASCII flows
- [ ] Prior-art patent numbers verified by IPR search (Indian + foreign citations to be added)
- [ ] Complete specification with claims based on §9 drafted by patent agent
- [ ] TRL evidence annexed (demo video, endpoint logs, app screenshots)

---------------------- END OF THE DOCUMENT ----------------------
