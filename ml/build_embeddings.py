#!/usr/bin/env python3
"""
AudioFit Embedding Builder — content-based vector model

Input:  ml/data/audiofit_dataset.csv  (from extract_dataset.py)
Outputs:
  ml/data/embeddings.npy        — L2-normalized combined vectors (N x D)
  ml/data/embeddings_meta.json  — track metadata + scaler + model info
  ml/data/scaler.json           — numeric scaler params (for live inference)
  ml/data/tfidf_model.pkl       — TF-IDF vectorizer (if mode=tfidf)

Vector construction (per track):
  text_part  = TF-IDF or Transformer embedding of "artist + genres + language"
               -> L2 normalized, weighted by TEXT_FEATURE_WEIGHT (0.6)
  numeric_part = StandardScaled [bpm, energy, valence, danceability, loudness, popularity]
               -> weighted by NUMERIC_FEATURE_WEIGHT (0.4)
  combined = concat(text_part, numeric_part) -> L2 normalized to unit sphere
  -> cosine similarity = dot(combined_a, combined_b)

Why this split:
  - Text captures taste (genre affinity — same signal as recommender.ts but dense)
  - Numeric captures workout suitability (tempo/energy alignment for Run vs Walk)
  - 0.4/0.6 weighting keeps taste dominant while letting tempo nudge ranking.
  - L2 norm makes cosine = dot product, and maps to phone-friendly numpy only.

Run:
  python ml/build_embeddings.py
  python ml/build_embeddings.py --mode transformer   # needs sentence-transformers
  python ml/build_embeddings.py --in ml/data/audiofit_dataset.csv --out ml/data/embeddings.npy

No Spotify credentials needed — operates purely on the extracted CSV.
"""
import argparse
import json
import pickle
from pathlib import Path
import hashlib

import numpy as np
import pandas as pd

import sys
sys.path.insert(0, str(Path(__file__).parent))
import config

# Optional transformer import (lazy)
_transformer_model = None

def l2_normalize(mat: np.ndarray, eps: float = 1e-9) -> np.ndarray:
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms = np.maximum(norms, eps)
    return mat / norms

def get_text_for_track(row) -> str:
    """Build a text string that encodes taste — artist + genres + language."""
    artist = str(row.get("artist", "")).strip()
    genres = str(row.get("genres", "")).strip().replace("|", " ")
    # genres are already lowercased; keep them
    lang = str(row.get("language", "")).strip()
    # Boost genres by repeating (so TF-IDF gives them more weight than artist name tokens)
    # This mimics GENRE_WEIGHT=0.65 vs ARTIST_WEIGHT=0.35 in recommender.ts
    text = f"{artist} {genres} {genres} {lang}".strip()
    return text if text else artist or genres or "unknown"

def build_tfidf_embeddings(texts: list, max_features: int, ngram_range: tuple):
    from sklearn.feature_extraction.text import TfidfVectorizer
    vec = TfidfVectorizer(
        max_features=max_features,
        ngram_range=ngram_range,
        stop_words="english",
        lowercase=True,
        token_pattern=r"(?u)\b[\w\-]+\b",
        min_df=1,
        max_df=0.9,
    )
    mat = vec.fit_transform(texts).toarray().astype(np.float32)
    # L2 normalize per row (TF-IDF already does, but re-norm after weighting)
    mat = l2_normalize(mat)
    return mat, vec

def build_transformer_embeddings(texts: list, model_name: str):
    global _transformer_model
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        raise ImportError("sentence-transformers not installed. Run: python -m pip install sentence-transformers torch")
    if _transformer_model is None:
        print(f"[embed] loading transformer {model_name} ...")
        _transformer_model = SentenceTransformer(model_name)
    print(f"[embed] encoding {len(texts)} texts with {model_name} ...")
    # batch encode, normalize_embeddings=True gives unit vectors
    embs = _transformer_model.encode(texts, batch_size=64, show_progress_bar=True, normalize_embeddings=True)
    return np.asarray(embs, dtype=np.float32)

def main():
    p = argparse.ArgumentParser(description="Build AudioFit content-based embeddings")
    p.add_argument("--in", dest="inp", type=str, default=config.DATASET_CSV, help="Input CSV path")
    p.add_argument("--out", type=str, default=config.EMBEDDINGS_NPY, help="Output .npy path")
    p.add_argument("--meta", type=str, default=config.EMBEDDINGS_META, help="Output meta JSON path")
    p.add_argument("--mode", type=str, choices=["tfidf", "transformer"], default=config.EMBEDDING_MODE,
                   help="Embedding mode for text (default from config)")
    p.add_argument("--model", type=str, default=config.TRANSFORMER_MODEL, help="Transformer model name")
    args = p.parse_args()

    base = Path(__file__).parent
    inp = Path(args.inp)
    if not inp.is_absolute():
        inp = base / inp if not str(inp).startswith("data") else base / inp
        inp = Path(str(inp).replace("ml/ml/", "ml/"))
    out_npy = Path(args.out)
    if not out_npy.is_absolute():
        out_npy = base / out_npy if not str(out_npy).startswith("data") else base / out_npy
        out_npy = Path(str(out_npy).replace("ml/ml/", "ml/"))
    out_meta = Path(args.meta)
    if not out_meta.is_absolute():
        out_meta = base / out_meta if not str(out_meta).startswith("data") else base / out_meta
        out_meta = Path(str(out_meta).replace("ml/ml/", "ml/"))

    if not inp.exists():
        print(f"ERROR: input CSV not found: {inp}")
        print("  Run first: python ml/extract_dataset.py")
        # For demo, create a tiny synthetic dataset so the pipeline is verifiable
        print("  Creating synthetic demo dataset for verification...")
        inp.parent.mkdir(parents=True, exist_ok=True)
        demo_rows = [
            {"id": f"demo{i:03d}", "title": f"Demo Track {i}", "artist": f"Artist {i%5}", "artist_ids": "", "album": "Demo",
             "popularity": 70+i%20, "duration_ms": 180000, "genres": "pop|dance" if i%2==0 else "hip hop|rap",
             "bpm": 90 + (i*7)%90, "energy": 0.5 + (i%5)/10, "valence": 0.4 + (i%4)/10,
             "danceability": 0.5 + (i%3)/10, "loudness": -8.0, "bpm_estimated": True, "language": "english" if i<10 else "hindi",
             "spotify_url": ""}
            for i in range(20)
        ]
        pd.DataFrame(demo_rows).to_csv(inp, index=False)
        print(f"  Wrote demo CSV with {len(demo_rows)} rows -> {inp}")

    print(f"[load] {inp} ...")
    df = pd.read_csv(inp)
    print(f"  {len(df)} tracks, columns: {list(df.columns)}")

    required = ["id", "title", "artist", "genres", "bpm", "energy", "valence"]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Missing required column: {col}")

    # Fill NaNs
    df["genres"] = df["genres"].fillna("")
    df["artist"] = df["artist"].fillna("")
    df["language"] = df["language"].fillna("english") if "language" in df.columns else "english"
    df["popularity"] = df["popularity"].fillna(50)
    df["danceability"] = df["danceability"].fillna(0.5) if "danceability" in df.columns else 0.5
    df["loudness"] = df["loudness"].fillna(-8.0) if "loudness" in df.columns else -8.0
    df["bpm"] = df["bpm"].fillna(120)
    df["energy"] = df["energy"].fillna(0.6)
    df["valence"] = df["valence"].fillna(0.5)

    # ---- Text embeddings ----
    texts = [get_text_for_track(row) for _, row in df.iterrows()]
    if args.mode == "transformer":
        text_mat = build_transformer_embeddings(texts, args.model)
        text_weight = config.TEXT_FEATURE_WEIGHT
        vec_model = None
        text_dim = text_mat.shape[1]
    else:
        print(f"[embed] TF-IDF max_features={config.TFIDF_MAX_FEATURES}, ngram={config.TFIDF_NGRAM_RANGE} ...")
        text_mat, vec_model = build_tfidf_embeddings(texts, config.TFIDF_MAX_FEATURES, config.TFIDF_NGRAM_RANGE)
        text_weight = config.TEXT_FEATURE_WEIGHT
        text_dim = text_mat.shape[1]
        print(f"  TF-IDF vocab size: {text_dim}")

    # Weight text part
    text_mat = text_mat * text_weight

    # ---- Numeric embeddings ----
    # Keep BPM in a workout-relevant scale: normalize BPM / 200, but use StandardScaler for full suite
    from sklearn.preprocessing import StandardScaler
    numeric_cols = ["bpm", "energy", "valence", "danceability", "loudness", "popularity"]
    # Ensure columns exist
    for col in numeric_cols:
        if col not in df.columns:
            df[col] = 0.0
    numeric_raw = df[numeric_cols].astype(float).values
    scaler = StandardScaler()
    numeric_scaled = scaler.fit_transform(numeric_raw).astype(np.float32)
    # Weight numeric part
    numeric_mat = numeric_scaled * config.NUMERIC_FEATURE_WEIGHT
    print(f"[numeric] scaler means: {dict(zip(numeric_cols, scaler.mean_.round(2)))}")
    print(f"[numeric] scaler scales: {dict(zip(numeric_cols, scaler.scale_.round(2)))}")

    # ---- Combine + L2 normalize ----
    combined = np.concatenate([text_mat, numeric_mat], axis=1).astype(np.float32)
    combined = l2_normalize(combined)
    print(f"[combined] shape {combined.shape} (text {text_dim} + numeric {len(numeric_cols)}), L2 normalized")

    # ---- Save ----
    out_npy.parent.mkdir(parents=True, exist_ok=True)
    np.save(out_npy, combined)
    print(f"[save] embeddings -> {out_npy} ({combined.nbytes/1024/1024:.2f} MB)")

    # Scaler JSON (for live inference on new tracks / user profile)
    scaler_path = base / config.SCALER_JSON if not str(config.SCALER_JSON).startswith("data") else base / config.SCALER_JSON
    scaler_path = Path(str(scaler_path).replace("ml/ml/", "ml/"))
    scaler_path.parent.mkdir(parents=True, exist_ok=True)
    with open(scaler_path, "w") as f:
        json.dump({
            "numeric_cols": numeric_cols,
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
            "numeric_weight": config.NUMERIC_FEATURE_WEIGHT,
            "text_weight": config.TEXT_FEATURE_WEIGHT,
        }, f, indent=2)
    print(f"[save] scaler -> {scaler_path}")

    # TF-IDF model pickle (only for tfidf mode)
    if args.mode == "tfidf" and vec_model is not None:
        tfidf_path = base / config.TFIDF_MODEL if not str(config.TFIDF_MODEL).startswith("data") else base / config.TFIDF_MODEL
        tfidf_path = Path(str(tfidf_path).replace("ml/ml/", "ml/"))
        tfidf_path.parent.mkdir(parents=True, exist_ok=True)
        with open(tfidf_path, "wb") as f:
            pickle.dump(vec_model, f)
        print(f"[save] tfidf model -> {tfidf_path}")

    # Meta JSON
    meta = {
        "created_at": pd.Timestamp.now().isoformat(),
        "mode": args.mode,
        "model": args.model if args.mode == "transformer" else f"tfidf-{text_dim}",
        "num_tracks": int(len(df)),
        "embedding_dim": int(combined.shape[1]),
        "text_dim": int(text_dim),
        "numeric_dim": len(numeric_cols),
        "numeric_cols": numeric_cols,
        "text_weight": config.TEXT_FEATURE_WEIGHT,
        "numeric_weight": config.NUMERIC_FEATURE_WEIGHT,
        "half_life_days": config.HALF_LIFE_DAYS,
        "tracks": [
            {
                "id": str(row["id"]),
                "title": str(row["title"]),
                "artist": str(row["artist"]),
                "genres": str(row["genres"]),
                "bpm": float(row["bpm"]),
                "energy": float(row["energy"]),
                "valence": float(row["valence"]),
                "danceability": float(row.get("danceability", 0.5)),
                "loudness": float(row.get("loudness", -8.0)),
                "popularity": int(row.get("popularity", 50)),
                "language": str(row.get("language", "english")),
                "spotify_url": str(row.get("spotify_url", "")),
            }
            for _, row in df.iterrows()
        ],
    }
    with open(out_meta, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"[save] meta -> {out_meta}")

    # Quick sanity: self-similarity should be 1.0, and a random pair should be < 0.95
    sim_self = float(np.dot(combined[0], combined[0]))
    sim_rand = float(np.dot(combined[0], combined[min(1, len(combined)-1)]))
    print(f"[sanity] self-dot {sim_self:.4f} (expect 1.0), neighbor-dot {sim_rand:.4f}")

    # Show top-3 nearest for first track as smoke test
    from sklearn.metrics.pairwise import cosine_similarity
    sims = cosine_similarity(combined[0:1], combined)[0]
    top_idx = np.argsort(sims)[::-1][1:4]  # skip self
    print(f"[smoke] nearest to '{df.iloc[0]['title']}' by {df.iloc[0]['artist']}:")
    for idx in top_idx:
        print(f"  {sims[idx]:.3f} — {df.iloc[idx]['title']} — {df.iloc[idx]['artist']} — genres:{df.iloc[idx]['genres']} bpm:{df.iloc[idx]['bpm']}")

if __name__ == "__main__":
    main()
