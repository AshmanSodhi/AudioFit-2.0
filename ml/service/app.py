"""
AudioFit Recommendation Microservice - FastAPI

Exposes content-based vector recommendations over the 5k-song workout dataset.

Endpoints:
  GET  /health                    - liveness + catalog stats
  GET  /tracks                    - paginated track list (for debugging)
  POST /recommend                - main recommender (history -> ranked tracks)
  POST /recommend/workout/{id}   - scoped to a single workout (mirrors store.getActivityRecommendations)
  GET  /profile                  - build Audio DNA profile from history (debug)

Run locally:
  python -m pip install -r ml/requirements.txt
  python ml/build_embeddings.py                          # build vectors first
  uvicorn ml.service.app:app --reload --port 8000
  # then in another shell:
  curl -X POST http://localhost:8000/recommend -H "Content-Type: application/json" -d @example_history.json

Deploy:
  Railway / Render / Fly.io - point start command to: uvicorn ml.service.app:app --host 0.0.0.0 --port $PORT
  The app loads embeddings at startup from ml/data/ (bake them into the image).

Design mirrors recommender.ts but upgrades the scoring:
  recommender.ts (v1):  0.65*genre_overlap + 0.35*artist_match + 0.01*popularity
  this service (v2):    cosine(profile_vector, candidate_vector)
                        where profile = recency-weighted mean of history track vectors
                        and candidate vectors are precomputed combined embeddings
                        (text TF-IDF/transformer + numeric audio features)
"""
import json
import pickle
import math
import time
from collections import Counter
from pathlib import Path
from typing import List, Optional, Dict, Any

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ---- Paths ----
BASE = Path(__file__).parent.parent  # ml/
DATA_DIR = BASE / "data"
EMB_NPY = DATA_DIR / "embeddings.npy"
META_JSON = DATA_DIR / "embeddings_meta.json"
SCALER_JSON = DATA_DIR / "scaler.json"
TFIDF_PKL = DATA_DIR / "tfidf_model.pkl"

# ---- FastAPI ----
app = FastAPI(
    title="AudioFit Recommendation Service",
    version="2.0.0",
    description="Content-based vector recommender over Spotify workout dataset (English+Hindi, ~5k tracks)",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in prod: ["http://localhost:19006", "exp://..."]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Global state (loaded at startup) ----
embeddings: Optional[np.ndarray] = None  # (N, D) L2-normalized
tracks: List[Dict[str, Any]] = []        # length N, aligned with embeddings
track_id_to_idx: Dict[str, int] = {}
scaler_mean: Optional[np.ndarray] = None
scaler_scale: Optional[np.ndarray] = None
numeric_cols: List[str] = []
text_dim: int = 0
numeric_dim: int = 0
numeric_weight: float = 0.4
text_weight: float = 0.6
tfidf_vectorizer = None
mode: str = "tfidf"
model_name: str = ""
transformer_model = None  # lazy load

HALF_LIFE_DAYS = 30
RECENTLY_HEARD_DAYS = 14

def _load_artifacts():
    global embeddings, tracks, track_id_to_idx
    global scaler_mean, scaler_scale, numeric_cols, text_dim, numeric_dim
    global numeric_weight, text_weight, tfidf_vectorizer, mode, model_name

    if not EMB_NPY.exists() or not META_JSON.exists():
        print(f"[service] WARNING: embeddings not found at {EMB_NPY}. Run: python ml/build_embeddings.py")
        # Allow service to start in degraded mode (health will report not_ready)
        return False

    print(f"[service] loading embeddings {EMB_NPY} ...")
    embeddings = np.load(EMB_NPY)
    with open(META_JSON, "r", encoding="utf-8") as f:
        meta = json.load(f)
    tracks = meta.get("tracks", [])
    text_dim = meta.get("text_dim", 0)
    numeric_dim = meta.get("numeric_dim", 6)
    numeric_cols = meta.get("numeric_cols", ["bpm","energy","valence","danceability","loudness","popularity"])
    mode = meta.get("mode", "tfidf")
    model_name = meta.get("model", "")
    numeric_weight = meta.get("numeric_weight", 0.4)
    text_weight = meta.get("text_weight", 0.6)

    for idx, t in enumerate(tracks):
        track_id_to_idx[str(t.get("id"))] = idx

    if SCALER_JSON.exists():
        with open(SCALER_JSON, "r") as f:
            s = json.load(f)
        scaler_mean = np.array(s["mean"], dtype=np.float32)
        scaler_scale = np.array(s["scale"], dtype=np.float32)
        numeric_cols = s.get("numeric_cols", numeric_cols)
        numeric_weight = s.get("numeric_weight", numeric_weight)
        text_weight = s.get("text_weight", text_weight)

    if mode == "tfidf" and TFIDF_PKL.exists():
        with open(TFIDF_PKL, "rb") as f:
            tfidf_vectorizer = pickle.load(f)
        print(f"[service] TF-IDF vocab {len(tfidf_vectorizer.vocabulary_)} loaded")

    print(f"[service] ready: {len(tracks)} tracks, dim={embeddings.shape[1]} (text {text_dim} + numeric {numeric_dim}), mode={mode}")
    return True

@app.on_event("startup")
def on_startup():
    ok = _load_artifacts()
    if not ok:
        print("[service] started in DEGRADED mode (no embeddings). /health will report not_ready.")

# ---- Helpers: same math as recommender.ts + build_embeddings.py ----

def recency_weight(timestamp_ms: int, now_ms: int) -> float:
    age_days = max(0, (now_ms - timestamp_ms) / 86_400_000)
    return math.exp(-(math.log(2) / HALF_LIFE_DAYS) * age_days)

def l2_normalize(vec: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(vec)
    if n < 1e-9:
        return vec
    return vec / n

def estimate_bpm(track_id: str) -> int:
    h = 0
    for ch in track_id:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return 90 + (h % 91)

def estimate_energy(track_id: str) -> float:
    h = 0
    for ch in track_id:
        h = (h * 33 + ord(ch)) & 0xFFFFFFFF
    return round((0.4 + ((h % 100) / 100) * 0.5) * 100) / 100

def estimate_valence(track_id: str) -> float:
    h = 0
    for ch in track_id:
        h = (h * 37 + ord(ch)) & 0xFFFFFFFF
    return round((0.2 + ((h % 100) / 100) * 0.7) * 100) / 100

def estimate_danceability(track_id: str) -> float:
    import hashlib
    h = int(hashlib.md5(track_id.encode()).hexdigest()[:8], 16)
    return round((0.3 + (h % 60) / 100) * 100) / 100

def estimate_loudness(track_id: str) -> float:
    h = 0
    for ch in track_id:
        h = (h * 29 + ord(ch)) & 0xFFFFFFFF
    return round(-15 + (h % 100) / 100 * 10, 2)

def get_text_for_track_meta(title: str, artist: str, genres: str, language: str) -> str:
    genres_spaced = genres.replace("|", " ")
    return f"{artist} {genres_spaced} {genres_spaced} {language}".strip()

def embed_text_single(text: str) -> np.ndarray:
    """Embed a single text string using the same vectorizer as the catalog."""
    if mode == "transformer":
        global transformer_model
        if transformer_model is None:
            try:
                from sentence_transformers import SentenceTransformer
                transformer_model = SentenceTransformer(model_name)
            except ImportError:
                raise HTTPException(status_code=500, detail="sentence-transformers not installed on server")
        vec = transformer_model.encode([text], normalize_embeddings=True)[0].astype(np.float32)
        return vec * text_weight
    else:
        if tfidf_vectorizer is None:
            raise HTTPException(status_code=500, detail="TF-IDF model not loaded (rebuild embeddings)")
        mat = tfidf_vectorizer.transform([text]).toarray().astype(np.float32)[0]
        # L2 normalize then weight
        n = np.linalg.norm(mat)
        if n > 1e-9:
            mat = mat / n
        return mat * text_weight

def embed_numeric_single(bpm: Optional[float], energy: Optional[float], valence: Optional[float],
                          danceability: Optional[float], loudness: Optional[float], popularity: Optional[float]) -> np.ndarray:
    if scaler_mean is None or scaler_scale is None:
        raise HTTPException(status_code=500, detail="Scaler not loaded")
    # pack in numeric_cols order
    vals = []
    lookup = {
        "bpm": bpm if bpm is not None else 120,
        "energy": energy if energy is not None else 0.6,
        "valence": valence if valence is not None else 0.5,
        "danceability": danceability if danceability is not None else 0.5,
        "loudness": loudness if loudness is not None else -8.0,
        "popularity": popularity if popularity is not None else 50,
    }
    for col in numeric_cols:
        vals.append(lookup.get(col, 0))
    arr = np.array(vals, dtype=np.float32)
    scaled = (arr - scaler_mean) / np.maximum(scaler_scale, 1e-9)
    return scaled.astype(np.float32) * numeric_weight

def build_query_vector(history: List[Dict[str, Any]], now_ms: int) -> Optional[np.ndarray]:
    """Build recency-weighted profile vector from history items."""
    if not history:
        return None
    vecs = []
    weights = []
    for item in history:
        tid = str(item.get("id") or item.get("title","") + "|" + item.get("artist","")).lower()
        # Try to find exact track in catalog
        idx = track_id_to_idx.get(str(item.get("id") or ""))
        if idx is not None and embeddings is not None:
            vec = embeddings[idx]
        else:
            # On-the-fly embedding for tracks not in catalog (e.g. live Spotify tracks)
            title = str(item.get("title") or "")
            artist = str(item.get("artist") or "")
            genres = ""
            # try to resolve genres from item or empty
            if item.get("genres"):
                g = item["genres"]
                genres = "|".join(g) if isinstance(g, list) else str(g)
            bpm = item.get("bpm")
            energy = item.get("energy")
            valence = item.get("valence", estimate_valence(str(item.get("id") or title)))
            danceability = item.get("danceability", estimate_danceability(str(item.get("id") or title)))
            loudness = item.get("loudness", estimate_loudness(str(item.get("id") or title)))
            popularity = item.get("popularity", 50)
            language = str(item.get("language", "english"))
            bpm_val = bpm if bpm is not None else estimate_bpm(str(item.get("id") or title))
            energy_val = energy if energy is not None else estimate_energy(str(item.get("id") or title))
            text = get_text_for_track_meta(title, artist, genres, language)
            t_vec = embed_text_single(text)
            n_vec = embed_numeric_single(bpm_val, energy_val, valence, danceability, loudness, popularity)
            combined = np.concatenate([t_vec, n_vec]).astype(np.float32)
            # L2 normalize single track vector to match catalog
            combined = l2_normalize(combined)
            vec = combined

        ts = item.get("timestamp")
        if ts is None:
            w = 1.0
        else:
            try:
                ts_int = int(ts)
                # support seconds vs ms: if < 1e12 treat as seconds
                if ts_int < 1_000_000_000_000:
                    ts_int *= 1000
                w = recency_weight(ts_int, now_ms)
            except:
                w = 1.0
        # optional playWeight
        pw = item.get("playWeight")
        if pw is not None:
            try:
                w *= float(pw)
            except:
                pass
        vecs.append(vec)
        weights.append(w)

    if not vecs:
        return None
    vecs_np = np.stack(vecs, axis=0)  # (H, D)
    weights_np = np.array(weights, dtype=np.float32)[:, None]  # (H, 1)
    # Weighted mean
    profile = np.sum(vecs_np * weights_np, axis=0) / max(np.sum(weights), 1e-9)
    profile = l2_normalize(profile)
    return profile

# ---- Pydantic models ----

class HistoryItem(BaseModel):
    id: Optional[str] = None
    title: str
    artist: str
    genres: Optional[List[str]] = None
    bpm: Optional[float] = None
    energy: Optional[float] = None
    valence: Optional[float] = None
    danceability: Optional[float] = None
    loudness: Optional[float] = None
    popularity: Optional[float] = None
    language: Optional[str] = None
    timestamp: Optional[int] = Field(None, description="Epoch ms (or seconds) when track was heard")
    playWeight: Optional[float] = Field(None, ge=0, le=1)

class RecommendRequest(BaseModel):
    history: List[HistoryItem] = Field(..., description="Workout listening history (songs heard during workouts)")
    limit: int = Field(12, ge=1, le=50, description="How many recommendations to return")
    exclude_heard: bool = Field(True, description="If true, exclude tracks already in history (exact title|artist match)")
    recently_heard_days: int = Field(14, ge=0, description="Novelty guard window")
    include_reasons: bool = Field(True, description="Include human-readable reasons")

class TrackOut(BaseModel):
    id: str
    title: str
    artist: str
    genres: List[str]
    bpm: float
    energy: float
    valence: Optional[float] = None
    danceability: Optional[float] = None
    loudness: Optional[float] = None
    popularity: Optional[int] = None
    language: Optional[str] = None
    spotify_url: Optional[str] = None

class RecommendationOut(BaseModel):
    song: TrackOut
    score: float = Field(..., description="0-100 cosine similarity scaled")
    genreSim: Optional[float] = None
    artistSim: Optional[float] = None
    reasons: List[str] = []

# ---- Endpoints ----

@app.get("/health")
def health():
    ready = embeddings is not None and len(tracks) > 0
    return {
        "status": "ready" if ready else "degraded",
        "ready": ready,
        "catalog_size": len(tracks) if tracks else 0,
        "embedding_dim": int(embeddings.shape[1]) if embeddings is not None else 0,
        "mode": mode,
        "model": model_name,
        "text_dim": text_dim,
        "numeric_dim": numeric_dim,
        "message": "ok" if ready else "Run: python ml/extract_dataset.py && python ml/build_embeddings.py",
    }

@app.get("/tracks")
def list_tracks(limit: int = 20, offset: int = 0, language: Optional[str] = None):
    if embeddings is None:
        raise HTTPException(status_code=503, detail="Embeddings not loaded")
    filtered = tracks
    if language:
        filtered = [t for t in tracks if t.get("language") == language]
    total = len(filtered)
    page = filtered[offset:offset+limit]
    return {"total": total, "limit": limit, "offset": offset, "tracks": page}

@app.post("/recommend", response_model=List[RecommendationOut])
def recommend(req: RecommendRequest):
    if embeddings is None or not tracks:
        raise HTTPException(status_code=503, detail="Embeddings not loaded. Build dataset first.")
    if not req.history:
        # Cold start: return popular diverse tracks
        # Use popularity + language diversity
        sorted_idx = sorted(range(len(tracks)), key=lambda i: tracks[i].get("popularity", 0), reverse=True)
        out = []
        for idx in sorted_idx[:req.limit]:
            t = tracks[idx]
            out.append(_track_to_recommendation(t, score=50.0, reasons=["Popular workout pick for fresh profiles"]))
        return out

    now_ms = int(time.time() * 1000)
    profile = build_query_vector([h.model_dump() for h in req.history], now_ms)
    if profile is None:
        raise HTTPException(status_code=400, detail="Could not build profile from history")

    # Cosine similarities = dot(profile, embeddings) since both L2 normalized
    sims = embeddings @ profile  # (N,)
    # Scale to 0-100
    scores = (sims * 100)

    # Build exclusion set: exact title|artist lowercased, within recently_heard_days
    exclude_keys = set()
    cutoff_ms = now_ms - req.recently_heard_days * 86400000 if req.recently_heard_days > 0 else 0
    for h in req.history:
        # only exclude if heard within cutoff (if timestamp present) OR always if no timestamp and exclude_heard
        ts = h.timestamp
        if ts is not None and req.recently_heard_days > 0:
            ts_ms = int(ts) * 1000 if int(ts) < 1_000_000_000_000 else int(ts)
            if ts_ms < cutoff_ms:
                continue
        key = f"{h.artist}|{h.title}".lower().strip()
        exclude_keys.add(key)
        if h.id:
            exclude_keys.add(str(h.id).lower())

    # Also exclude by exact id match regardless of timestamp if exclude_heard
    # (legacy behavior matches recommender.ts)
    ranked = np.argsort(sims)[::-1]  # descending
    results: List[RecommendationOut] = []
    for idx in ranked:
        if len(results) >= req.limit:
            break
        t = tracks[idx]
        key = f"{t.get('artist','')}|{t.get('title','')}".lower()
        tid = str(t.get("id","")).lower()
        if req.exclude_heard and (key in exclude_keys or tid in exclude_keys):
            continue
        score = float(scores[idx])
        if score <= 0:
            continue
        reasons = _build_reasons(t, req.history, score, sims[idx]) if req.include_reasons else []
        results.append(_track_to_recommendation(t, score=round(score, 1), reasons=reasons))

    return results

def _track_to_recommendation(t: dict, score: float, reasons: List[str]) -> RecommendationOut:
    genres_raw = t.get("genres", "")
    if isinstance(genres_raw, str):
        genres = [g for g in genres_raw.split("|") if g]
    else:
        genres = list(genres_raw or [])
    return RecommendationOut(
        song=TrackOut(
            id=str(t.get("id","")),
            title=str(t.get("title","")),
            artist=str(t.get("artist","")),
            genres=genres,
            bpm=float(t.get("bpm", 120)),
            energy=float(t.get("energy", 0.6)),
            valence=float(t.get("valence", 0.5)) if t.get("valence") is not None else None,
            danceability=float(t.get("danceability", 0.5)) if t.get("danceability") is not None else None,
            loudness=float(t.get("loudness", -8.0)) if t.get("loudness") is not None else None,
            popularity=int(t.get("popularity", 50)) if t.get("popularity") is not None else None,
            language=str(t.get("language","english")),
            spotify_url=str(t.get("spotify_url","")) if t.get("spotify_url") else None,
        ),
        score=score,
        reasons=reasons,
    )

def _build_reasons(candidate: dict, history: List[HistoryItem], score: float, sim: float) -> List[str]:
    """Human-readable explanations derived from profile overlap."""
    reasons = []
    cand_genres = set(g.strip().lower() for g in str(candidate.get("genres","")).split("|") if g.strip())
    cand_artist = str(candidate.get("artist","")).lower()
    cand_bpm = candidate.get("bpm")

    # Collect history genres/artists
    hist_genres = Counter()
    hist_artists = Counter()
    for h in history:
        if h.genres:
            for g in h.genres:
                hist_genres[g.lower()] += 1
        hist_artists[h.artist.lower()] += 1

    # Genre reason
    if cand_genres:
        overlap = [g for g in cand_genres if g in hist_genres]
        if overlap:
            top = ", ".join(list(overlap)[:2])
            reasons.append(f"Matches your taste in {top}")
        elif sim > 0.6:
            reasons.append("Close to your workout vibe")

    # Artist reason
    if cand_artist in hist_artists:
        reasons.append("You've enjoyed this artist during workouts")

    # Tempo reason
    if cand_bpm:
        try:
            bpm_f = float(cand_bpm)
            if 135 <= bpm_f <= 180:
                reasons.append("High-tempo - great for runs")
            elif 90 <= bpm_f <= 120:
                reasons.append("Steady tempo - ideal for power walks")
        except:
            pass

    # Language affinity
    cand_lang = str(candidate.get("language","")).lower()
    if cand_lang:
        lang_counts = Counter(h.language.lower() if h.language else "english" for h in history)
        if lang_counts.most_common(1) and lang_counts.most_common(1)[0][0] == cand_lang:
            if cand_lang == "hindi":
                reasons.append("Hindi workout energy you train well to")
            elif cand_lang == "english":
                reasons.append("English workout anthems in your zone")

    if not reasons:
        if score >= 70:
            reasons.append("Strong match to your Audio DNA")
        elif score >= 50:
            reasons.append("Explores a fresh sound close to your vibe")
        else:
            reasons.append("Discovery pick beyond your usual rotation")

    return reasons[:2]  # keep UI compact

# ---- Optional: profile debug endpoint ----
@app.post("/profile")
def profile(req: RecommendRequest):
    if embeddings is None:
        raise HTTPException(status_code=503, detail="Embeddings not loaded")
    now_ms = int(time.time() * 1000)
    history_dicts = [h.model_dump() for h in req.history]
    profile_vec = build_query_vector(history_dicts, now_ms)
    if profile_vec is None:
        raise HTTPException(status_code=400, detail="Empty history")
    # Return top genres/artists from history weighted by recency (mirrors recommender.ts buildProfile)
    from collections import Counter
    genre_counter = Counter()
    artist_counter = Counter()
    for h in req.history:
        ts = h.timestamp or now_ms
        ts_ms = int(ts) * 1000 if int(ts) < 1_000_000_000_000 else int(ts)
        w = recency_weight(ts_ms, now_ms) * (h.playWeight or 1)
        if h.genres:
            per = w / max(len(set(g.lower() for g in h.genres)), 1)
            for g in set(g.lower() for g in h.genres):
                genre_counter[g] += per
        artist_counter[h.artist] += w
    total = len(req.history)
    # L2-norm-like scaling to 0-1 (max = 1.0)
    max_g = max(genre_counter.values()) if genre_counter else 1
    max_a = max(artist_counter.values()) if artist_counter else 1
    top_genres = [{"label": k, "score": round(v/max_g, 3)} for k, v in genre_counter.most_common(8)]
    top_artists = [{"label": k, "score": round(v/max_a, 3)} for k, v in artist_counter.most_common(8)]
    # dominant BPM
    bpms = [h.bpm for h in req.history if h.bpm]
    dom_bpm = round(sum(bpms)/len(bpms)/5)*5 if bpms else None
    return {
        "topGenres": top_genres,
        "topArtists": top_artists,
        "totalListens": total,
        "dominantBpm": dom_bpm,
        "profile_norm": float(np.linalg.norm(profile_vec)),
    }
