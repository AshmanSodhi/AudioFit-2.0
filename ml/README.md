# AudioFit ML — Content-Based Vector Recommender

Phone-only AudioFit (Run/Walk, GPS+pedometer, Spotify-only) with an upgraded **content-based embedding recommender** and a **FastAPI microservice**.

This folder implements your `things to do`:
1. **Make dataset from Spotify** → `extract_dataset.py` (English + Hindi workout playlists, ~5k songs)
2. **Build recommendation system with vector embeddings** → `build_embeddings.py` (TF-IDF or transformer + numeric audio features)
3. **Add model to app via microservice** → `service/app.py` (FastAPI) + app integration in `audiofit/src/constants/recommendationService.ts`

---

## Architecture

```
Spotify Playlists (EN + HI, ~40 playlists, ~5k unique)
   │
   ▼  Client Credentials flow, pagination, dedupe, artist genres, audio-features fallback
ml/data/audiofit_dataset.csv  +  .json   (id, title, artist, genres, bpm, energy, valence, danceability, loudness, popularity, language)
   │
   ▼  build_embeddings.py
ml/data/embeddings.npy (N x D, L2-normalized)   +   embeddings_meta.json + scaler.json + tfidf_model.pkl
   │   text: TF-IDF (256-dim) or MiniLM (384-dim), weighted 0.6
   │   numeric: StandardScaled [bpm, energy, valence, danceability, loudness, popularity], weighted 0.4
   │   combined = concat → L2 norm → cosine = dot
   │
   ▼  FastAPI microservice
POST /recommend  {history: ListenRecord[], limit, exclude_heard}
   │   profile = recency-weighted mean of history vectors (HALF_LIFE_DAYS=30)
   │   scores = cosine(profile, all catalog vectors)
   │   returns top-K with reasons, scaled 0-100
   ▼
React Native app (store.ts → recommendationService.ts → For You + Summary)
   fallback → existing recommender.ts (offline, 20-track catalog) when service unreachable
```

No user Spotify library is used as signal — only **songs heard during workouts** (`store.getListeningHistory()`), same contract as `recommender.ts:594-630`.

---

## Quick Start

### 1. Setup

```bash
# from project root: E:\VIT Vellore\4th Year\Project\React Only Project
python -m pip install -r ml/requirements.txt

# credentials
copy ml\.env.example ml\.env
# edit ml/.env with your SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET from https://developer.spotify.com/dashboard
```

### 2. Extract dataset (~5k songs)

```bash
python ml/extract_dataset.py
# Options:
python ml/extract_dataset.py --target 3000 --out ml/data/audiofit_dataset.csv
python ml/extract_dataset.py --playlists 37i9dQZF1DX76Wlfdnj7AP 37i9dQZF1DX9tPFwDMOaN1  # custom IDs
```

Playlists are defined in `ml/config.py` — `ENGLISH_WORKOUT_PLAYLISTS` + `HINDI_WORKOUT_PLAYLISTS`. Edit them to swap any 404 IDs. The extractor auto-dedupes, batch-fetches artist genres (50/batch) and audio features (100/batch), respects 429, and uses deterministic local estimates when `/v1/audio-features` is blocked (same hash as `store.ts:525-541`).

Output: `ml/data/audiofit_dataset.csv` and `.json` with language tagging (Hindi vs English) and top-genre stats.

### 3. Build embeddings

```bash
# Lightweight TF-IDF (default, no extra deps, viva-friendly)
python ml/build_embeddings.py

# Dense transformer (needs sentence-transformers + torch, better semantic)
python -m pip install sentence-transformers torch
python ml/build_embeddings.py --mode transformer --model sentence-transformers/all-MiniLM-L6-v2
```

Outputs:
- `ml/data/embeddings.npy` — float32, L2-normalized, ~5k x ~262 (TF-IDF) or ~390 (transformer+numeric)
- `ml/data/embeddings_meta.json` — catalog + dims
- `ml/data/scaler.json` — numeric scaler (for live inference)
- `ml/data/tfidf_model.pkl` — vectorizer (TF-IDF mode only)

Smoke test: the script prints self-dot ≈1.0 and top-3 nearest for the first track.

### 4. Run the microservice

```bash
uvicorn ml.service.app:app --reload --port 8000
# or
python -m uvicorn ml.service.app:app --reload --port 8000
```

Test:
```bash
curl http://localhost:8000/health
curl http://localhost:8000/tracks?limit=3
curl -X POST http://localhost:8000/recommend -H "Content-Type: application/json" -d "{\"history\":[{\"title\":\"Blinding Lights\",\"artist\":\"The Weeknd\",\"genres\":[\"synthwave\",\"pop\"],\"bpm\":171,\"energy\":0.82,\"timestamp\": 1700000000000}],\"limit\":5}"
```

Deploy: set start command to `uvicorn ml.service.app:app --host 0.0.0.0 --port $PORT` on Railway/Render/Fly. Bake `ml/data/` into the image.

### 5. Wire the app

The app already has offline fallback (`recommender.ts` + `DISCOVERY_CATALOG`). After deploying the service:

1. Set the service URL in the app:
   - In `audiofit/src/constants/recommendationService.ts` → `SERVICE_URL`
   - Or at runtime via `store.setRecommendationServiceUrl(url)` (persisted in AsyncStorage)

2. `store.getRecommendations()` and `store.getActivityRecommendations()` first try `service → /recommend`; on failure they fall back locally — no UX break.

See `audiofit/src/constants/recommendationService.ts` for the client.

---

## Files

| Path | Role |
|------|------|
| `ml/config.py` | Playlist IDs, target size, weights, mode |
| `ml/spotify_client.py` | Client Credentials + batched API helpers |
| `ml/extract_dataset.py` | Playlist sweep → CSV/JSON dataset |
| `ml/build_embeddings.py` | TF-IDF/transformer + numeric → combined vectors |
| `ml/service/app.py` | FastAPI recommender (profile → cosine rank) |
| `ml/.env.example` | Credential template |
| `ml/data/` | Dataset + artifacts (git-ignored except .gitkeep) |

---

## Evaluation (for your report)

After building, you can report:

| Metric | How to compute | Target |
|--------|----------------|--------|
| **Recall@K / Precision@K** | Hold out last workout's songs, recommend from earlier history, check hit rate | Recall@10 ≥ 0.3 |
| **NDCG@K** | Rank-aware relevance (1 if recommended track shares genre/artist with held-out) | ≥ 0.6 |
| **Catalog coverage** | % of catalog that can be recommended (all vectors reachable) | ~100% |
| **Latency** | p50 /recommend on 5k catalog (numpy dot) | < 50ms CPU, < 500ms end-to-end |
| **Language balance** | Hindi vs English in recommendations vs history | Matches user profile |

Example evaluation snippet (add to `ml/evaluate.py` next):

```python
# Split history 80/20 by time, build profile on train, score test hits in top-K
```

For viva, explain:
- Why `TEXT 0.6 + NUMERIC 0.4` → taste dominates, tempo nudges Run/Walk suitability
- Why recency decay `exp(-ln2/30 * ageDays)` → 30-day half-life, matches `recommender.ts:82-85`
- Why L2 normalization → cosine is just dot product, phone-friendly numpy, no FAISS needed at 5k
- Why TF-IDF is explainable → each dimension is a genre/artist token, SHAP-style reasoning maps to `reasons[]`

---

## Troubleshooting

- **`403 /v1/audio-features`** → Expected for new Spotify apps. The extractor auto-falls back to deterministic estimates. For *real* features, set `USE_RECCOBEATS_FALLBACK = True` in `config.py` or analyze audio locally with librosa/Essentia (out of scope for phone-only).
- **Playlist 404** → Spotify rotated the curated ID. Replace it in `config.py` with any workout playlist ID from Spotify search.
- **`embeddings not loaded` in /health** → Run `python ml/build_embeddings.py`; ensure `ml/data/embeddings.npy` exists in the deployed image.
- **Transformer OOM** → Use `EMBEDDING_MODE = "tfidf"` (default) on low-RAM hosts.

---

## References (cite in report)

- `audiofit/src/constants/recommender.ts` — v1 baseline (genre 0.65 + artist 0.35, recency decay)
- `audiofit/src/constants/store.ts:525-541` — audio-features fallback hash (mirrored here)
- `docs/RECOMMENDATION_ENGINE.md` — math for v1
- `CONTEXT_2.md §8-12` — phone-only scoring (matchPct, speedBoost, profile)
