# AudioFit Recommendation Engine

How the "For You" recommender works: building a **preference profile** from
listening history and scoring candidate songs by **similarity** to it.

All logic lives in two places:

| File | Role |
|------|------|
| `src/constants/recommender.ts` | Pure engine — profile building, similarity scoring, ranking, discovery catalog. No I/O. |
| `src/constants/store.ts` | Wires the engine to persisted data (AsyncStorage) and the Spotify sync flow. |
| `src/app/for-you.tsx` | UI that renders the profile snapshot and ranked picks. |

The engine is **pure**: pass data in, get results out. This makes it easy to
test and keeps all persistence concerns in the store layer.

---

## 1. Input: what counts as listening history

The engine consumes a list of "listens":

```ts
interface ListenRecord {
  title: string;
  artist: string;
  artistId?: string;
  genres?: string[];   // normalized genre tags (from Spotify artist data or cache)
  bpm?: number;
  energy?: number;
  timestamp: number;   // epoch ms — when it was heard
  playWeight?: number; // optional engagement weight (e.g. completion fraction)
}
```

> **Important: this recommender is activity-only.** It deliberately ignores your
> overall Spotify profile (recently-played, top tracks, saved library). The only
> signal is **songs heard during your workouts** (`store.getListeningHistory()`).

Two scopes use the same engine:

- **Per-activity picks** — `getActivityRecommendations(workoutId)`: profiles
  just that single workout's `songsHeard` and recommends fresh catalog songs
  for the *next* session. Shown on the post-workout summary screen.
- **Overall picks** — `getRecommendations()`: profiles **all** activities
  combined. Shown in the *For You* tab.

Genre metadata for activity songs comes from the Spotify artist cache (filled
during sync, purely as a tag lookup) falling back to the curated catalog's
genre tags for known tracks — again, this is metadata resolution, **not** a
signal from your overall Spotify listening.

---

## 2. Build the preference profile

### 2.1 Recency weighting (exponential time decay)

Recent songs should matter more than old ones. We give every listen a weight
based on how old it is:

```
                  ( ln 2 / HALF_LIFE_DAYS ) * ageDays
w(t) = exp( -  ─────────────────────────────────────  )
                                1
```

- `ageDays = (now − timestamp) / 86_400_000`
- `HALF_LIFE_DAYS = 30`

A song heard 30 days ago is worth `0.5` (50%), 60 days ago `0.25`, etc.

### 2.2 Effective listen weight

`effectiveWeight(listen) = playWeight(listen) * w(listen)` — the recency weight
scaled by engagement (default 1).

### 2.3 Genre scores

A song usually belongs to several genres. To avoid one multi-genre song stuffing
the profile, each listen's weight is split evenly across its distinct genres:

```
                            Σ   wEffective(l)
                             l: genre ∈ songs(l)
genreScore(genre) =   ─────────────────────────────
                            count(genres(l))
```

### 2.4 Artist scores

```
artistScore(artist) = Σ   wEffective(l)
                       l heard artist
```

### 2.5 Normalization

Both maps are **L2-normalized to fractions of the max** (so every value is in
`[0,1]`, with the strongest genre/artist = `1.0`). This keeps the profile scale
invariant to how much history exists.

The store exposes the top 8 genres and artists as the *Your Music DNA* snapshot.

---

## 3. Score each candidate song

For a candidate song `c`, we compute two similarity terms, blended into a
single `score`.

### 3.1 Genre similarity (`simGenre`)

Fraction of the candidate's **distinct** genres that appear in the user's
(likely) genre profile:

```
             Σ  min( profileGenreScore[g] , 1 )      (over distinct g in c)
simGenre =  ────────────────────────────────────  ∈ [0,1]
                  count(distinct genres of c)
```

High when the candidate's genres are strongly matched by the user's taste.
Zero when the candidate has no recognized overlap.

### 3.2 Artist similarity (`simArtist`)

```
simArtist = min( 1, normalizedArtistScore[ c.artist ] )  ∈ [0,1]
```

High when this artist is one the user already enjoys.

### 3.3 Final score

```
score(c) = GENRE_WEIGHT * simGenre(c)  +  ARTIST_WEIGHT * simArtist(c)
         + popularity(c) * 0.01
```

with `GENRE_WEIGHT = 0.65`, `ARTIST_WEIGHT = 0.35`. The popularity term is a
tiny tie-breaker (range contribution ≈ 0–1%). `score` is scaled to `0–100`.

### 3.4 Novelty guard

A candidate is **zeroed out** if the user already heard that exact
`artist | title` combo within the last `RECENTLY_HEARD_DAYS = 14` days, or if it
is explicitly already-owned history and `includeHeard = false`.

---

## 4. Ranking the output

Candidates are scored, filtered to `score > 0`, sorted descending, and the top
`limit` (default 12) are returned:

```
returned = top( limit, sortDesc( filter( score > 0 ) ) )
```

Each pick carries an explainable `reasons[]` list derived directly from the
score terms — e.g. *"Matches your taste in pop"* (genre hit) or *"The Weeknd
is a favorite of yours"* (artist hit).

---

## 5. Candidate pool (real-time Spotify)

Recommendations are **not** computed against a static list. The store calls
Spotify's live `/v1/recommendations` endpoint, seeded by what the user actually
heard during their activity:

1. Take the top artists (by recency-weighted affinity) from the activity's songs.
2. Resolve their real Spotify artist ids via `/v1/search?type=artist`.
3. Call `/v1/recommendations?seed_artists=...&seed_genres=...&limit=...` to fetch
   fresh, real tracks from Spotify's catalog.
4. Enrich each returned track with genre tags (via `/v1/artists`) and cache them.
5. Feed those real tracks through the same `recommend()` scoring engine to rank.

The curated `DISCOVERY_CATALOG` is only a **fallback** when no valid (non-demo)
Spotify token is available — offline or demo mode. When online, picks are real
songs from Spotify, never from a hardcoded list.

Your overall Spotify library is never used as a seed signal; only the artists
and genres present in your activity listening.

Duplicate `artist|title` combos are dropped as the pool is built.

---

## 6. Tuning knobs (all in `recommender.ts`)

| Constant | Default | Effect |
|----------|---------|--------|
| `HALF_LIFE_DAYS` | 30 | How quickly old listens fade. |
| `GENRE_WEIGHT` | 0.65 | Emphasis on genre overlap vs artist identity. |
| `ARTIST_WEIGHT` | 0.35 | Emphasis on known-artist identity. |
| `RECENTLY_HEARD_DAYS` | 14 | Exclude songs just heard. |

---

## 7. Data flow summary

```
Workouts (songs heard) ──► getListeningHistory(workoutId?) ──► ListenRecord[]
   │                                                              │
   │                                   genre tags from cache/catalog (metadata only)
   ▼                                                              ▼
Per-activity: getActivityRecommendations(id) ─┐        buildProfile() ──► genre/artist DNA
Overall:      getRecommendations() ───────────┴─► recommend()  ◄── live Spotify seed
                                                              (top artists/genres of the activity)
   │                                                              ▲
   │                                                   /v1/recommendations ──► real tracks
   ▼                                                              │ (fallback: catalog)
Recommendation[] ──► async stored (@audiofit:recommendations_v1) ──► For You UI / summary screen
```

The whole pipeline runs on-device with data persisted to `AsyncStorage` — no
backend required. When connected to Spotify, candidates are real songs fetched
in real time from your activity's artists; the built-in catalog is only an
offline/demo fallback.