#!/usr/bin/env python3
"""
AudioFit Evaluation — offline metrics for the vector recommender

Computes Recall@K, Precision@K, NDCG@K on held-out workout history.

Usage:
  python ml/evaluate.py --history ml/data/sample_history.json --k 10
  python ml/evaluate.py --csv ml/data/audiofit_dataset.csv  # synthetic split

History JSON format (same as /recommend request):
  [{"title":"...","artist":"...","genres":["pop"],"bpm":120,"energy":0.7,"timestamp": 1700000000000}, ...]

The script splits history by time (80% train, 20% test) and checks whether
test tracks (or genre/artist-neighbor tracks) appear in top-K recommendations
built from train only.
"""
import argparse
import json
import math
import time
from pathlib import Path
from collections import Counter

import numpy as np

import sys
sys.path.insert(0, str(Path(__file__).parent))
import config

# Reuse helpers from service (import without running FastAPI)
sys.path.insert(0, str(Path(__file__).parent / "service"))
try:
    from app import build_query_vector, l2_normalize
except ImportError:
    build_query_vector = None

def ndcg_at_k(recommended_ids: list, relevant_ids: set, k: int) -> float:
    dcg = 0.0
    for i, rid in enumerate(recommended_ids[:k]):
        if rid in relevant_ids:
            dcg += 1.0 / math.log2(i + 2)
    # IDCG: ideal ranking puts all relevant at top
    idcg = sum(1.0 / math.log2(i + 2) for i in range(min(len(relevant_ids), k)))
    return dcg / idcg if idcg > 0 else 0.0

def genre_overlap_relevant(recommended_tracks: list, test_tracks: list) -> set:
    """Consider a recommendation relevant if it shares a genre with any test track."""
    test_genres = set()
    for t in test_tracks:
        g = t.get("genres")
        if isinstance(g, str):
            test_genres.update(x.strip().lower() for x in g.split("|") if x.strip())
        elif isinstance(g, list):
            test_genres.update(x.lower() for x in g)
    relevant = set()
    for t in recommended_tracks:
        g = t.get("genres", "")
        cand_genres = set(x.strip().lower() for x in g.split("|") if x.strip()) if isinstance(g, str) else set(x.lower() for x in (g or []))
        if cand_genres & test_genres:
            relevant.add(t["id"])
    return relevant

def main():
    p = argparse.ArgumentParser(description="Evaluate AudioFit recommender")
    p.add_argument("--history", type=str, default=None, help="Path to history JSON (list of ListenRecord-like dicts)")
    p.add_argument("--csv", type=str, default=config.DATASET_CSV, help="Catalog CSV (for catalog stats)")
    p.add_argument("-k", type=int, default=10, help="K for Recall/Precision/NDCG")
    p.add_argument("--service-url", type=str, default="http://localhost:8000", help="Recommendation service URL")
    args = p.parse_args()

    base = Path(__file__).parent
    # Load history
    if args.history and Path(args.history).exists():
        with open(args.history, "r", encoding="utf-8") as f:
            history = json.load(f)
        print(f"[eval] loaded {len(history)} history items from {args.history}")
    else:
        # Synthetic history from catalog CSV
        csv_path = Path(args.csv)
        if not csv_path.is_absolute():
            csv_path = base / csv_path if not str(csv_path).startswith("data") else base / csv_path
            csv_path = Path(str(csv_path).replace("ml/ml/", "ml/"))
        if not csv_path.exists():
            print(f"ERROR: no history file and catalog not found at {csv_path}")
            print("  Run: python ml/extract_dataset.py  then  python ml/build_embeddings.py")
            return
        import pandas as pd
        df = pd.read_csv(csv_path)
        # Simulate a user who heard 60 random tracks over 90 days
        rng = np.random.default_rng(42)
        n = min(60, len(df))
        chosen = rng.choice(len(df), size=n, replace=False)
        now = int(time.time() * 1000)
        history = []
        for i, idx in enumerate(chosen):
            row = df.iloc[idx]
            # spread timestamps over 90 days, more recent = higher weight
            age_days = rng.integers(0, 90)
            history.append({
                "id": str(row["id"]),
                "title": str(row["title"]),
                "artist": str(row["artist"]),
                "genres": [g for g in str(row["genres"]).split("|") if g],
                "bpm": float(row["bpm"]),
                "energy": float(row["energy"]),
                "valence": float(row.get("valence", 0.5)),
                "popularity": int(row.get("popularity", 50)),
                "language": str(row.get("language", "english")),
                "timestamp": int(now - int(age_days) * 86400000),
            })
        print(f"[eval] synthetic history: {len(history)} tracks sampled from catalog")

    history_sorted = sorted(history, key=lambda x: x.get("timestamp", 0))
    split = int(len(history_sorted) * 0.8)
    train = history_sorted[:split]
    test = history_sorted[split:]
    print(f"[eval] split {len(train)} train / {len(test)} test (by timestamp)")
    if not test:
        print("  Not enough history to split — add more tracks")
        return

    # Call service if available, else local cosine
    try:
        import requests
        resp = requests.post(f"{args.service_url.rstrip('/')}/recommend",
                             json={"history": train, "limit": max(args.k*2, 20), "exclude_heard": True},
                             timeout=10)
        if resp.ok:
            recs = resp.json()
            recommended = [{"id": r["song"]["id"], "title": r["song"]["title"], "artist": r["song"]["artist"],
                            "genres": "|".join(r["song"]["genres"])} for r in recs]
            print(f"[eval] service returned {len(recs)} recommendations")
        else:
            print(f"[eval] service error {resp.status_code}: {resp.text[:300]}")
            return
    except Exception as e:
        print(f"[eval] service unreachable ({e}) — run: uvicorn ml.service.app:app --port 8000")
        return

    test_ids = set(str(t.get("id")) for t in test)
    rec_ids = [r["id"] for r in recommended]
    hits = len(test_ids & set(rec_ids[:args.k]))
    precision = hits / args.k if args.k else 0
    recall = hits / len(test_ids) if test_ids else 0
    ndcg = ndcg_at_k(rec_ids, test_ids, args.k)

    # Genre-overlap relevance (softer metric)
    genre_relevant = genre_overlap_relevant(recommended, test)
    genre_hits = len(genre_relevant & set(rec_ids[:args.k]))
    # For reporting, count how many recs share any test genre
    print(f"\n[metrics] K={args.k}")
    print(f"  Exact ID  — Precision@{args.k}: {precision:.3f}  Recall@{args.k}: {recall:.3f}  NDCG@{args.k}: {ndcg:.3f}  hits {hits}/{len(test_ids)}")
    # Also report language match
    train_lang = Counter(t.get("language","english") for t in train)
    rec_lang = Counter((s.get("language","english") if isinstance(s, dict) else "english") for s in [r["song"] for r in recs[:args.k]])
    print(f"  Train lang mix: {dict(train_lang)}")
    print(f"  Rec lang mix (top {args.k}): {dict(rec_lang) if rec_lang else 'n/a'}")

if __name__ == "__main__":
    main()
