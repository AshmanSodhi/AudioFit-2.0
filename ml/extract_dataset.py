#!/usr/bin/env python3
"""
AudioFit Dataset Extractor — Spotify Workout Playlists -> ~5k song dataset

Usage:
  1. Set env vars (or create ml/.env):
       SPOTIFY_CLIENT_ID=your_client_id
       SPOTIFY_CLIENT_SECRET=your_client_secret
     Get them at https://developer.spotify.com/dashboard -> Create App

  2. Run:
       python -m pip install -r ml/requirements.txt
       python ml/extract_dataset.py
       # or target size:
       python ml/extract_dataset.py --target 5000 --out ml/data/audiofit_dataset.csv

  3. Output: ml/data/audiofit_dataset.csv + .json (deduplicated, enriched)

What it does:
  - Authenticates via Client Credentials (no user login needed)
  - Iterates ENGLISH + HINDI workout playlists from config.py
  - Paginates every playlist (100 tracks/page), dedupes by track ID
  - Batch-fetches artist genres (50/batch) and audio features (100/batch)
  - Falls back to deterministic local estimates when audio-features is blocked
    (same hash as audiofit/src/constants/store.ts so results stay reproducible)
  - Writes CSV + JSON with stable schema, ready for build_embeddings.py

Rate limits: sleeps 50ms between batch calls + respects 429 Retry-After.
"""
import argparse
import csv
import json
import os
import time
import hashlib
from pathlib import Path
from collections import Counter

# Load .env if present
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

import sys
sys.path.insert(0, str(Path(__file__).parent))
import config
from spotify_client import SpotifyClient, extract_playlist_id

# ---- Deterministic fallbacks (must match store.ts exactly) ----
def estimate_bpm(track_id: str) -> int:
    h = 0
    for ch in track_id:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return 90 + (h % 91)  # 90-180

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
    h = int(hashlib.md5(track_id.encode()).hexdigest()[:8], 16)
    return round((0.3 + (h % 60) / 100) * 100) / 100  # 0.3-0.9

def estimate_loudness(track_id: str) -> float:
    h = 0
    for ch in track_id:
        h = (h * 29 + ord(ch)) & 0xFFFFFFFF
    return round(-15 + (h % 100) / 100 * 10, 2)  # -15 to -5 dB

# ---- Fallback track queries when playlist tracks are blocked (Client Credentials 403 as of 2025) ----
# Interleaved English/Hindi for language balance even on small targets
FALLBACK_TRACK_QUERIES = [
    "workout", "hindi workout",
    "gym workout", "punjabi workout",
    "cardio workout", "bollywood workout",
    "running workout", "hindi gym",
    "fitness workout", "punjabi gym",
    "beast mode", "bhangra workout",
]

# ---- Main extraction ----
def extract(target: int, out_csv: str, out_json: str, playlists: list, use_search_fallback: bool = True, user_token: str = None):
    client_id = os.getenv("SPOTIFY_CLIENT_ID", "").strip()
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET", "").strip()
    # User token for playlist tracks (if Client Credentials is blocked for playlists)
    # Provide via env SPOTIFY_USER_TOKEN / SPOTIFY_ACCESS_TOKEN or --user-token
    if not user_token:
        user_token = os.getenv("SPOTIFY_USER_TOKEN", "") or os.getenv("SPOTIFY_ACCESS_TOKEN", "")
        user_token = user_token.strip()

    if not client_id or not client_secret:
        print("ERROR: SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set.")
        print("  Create an app at https://developer.spotify.com/dashboard")
        print("  Then: set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET env vars or put them in ml/.env")
        sys.exit(1)

    client = SpotifyClient(client_id, client_secret)
    print(f"Target: {target} unique tracks from {len(playlists)} playlists")
    print(f"Playlists: {', '.join(playlists[:3])} ... +{len(playlists)-3} more" if len(playlists) > 3 else f"Playlists: {playlists}")
    if user_token:
        print("[info] Using SPOTIFY_USER_TOKEN for playlist track fetching (bypasses Client Credentials 403)")

    # 1. Collect tracks via playlists
    seen = {}  # track_id -> track obj (first occurrence)
    playlist_stats = []
    playlist_blocked_count = 0
    for pid in playlists:
        pid_clean = extract_playlist_id(pid)
        print(f"\n[playlist] {pid_clean} ...", end=" ", flush=True)
        tracks = []
        # If user token supplied, try it first for this playlist
        if user_token:
            try:
                import requests
                headers = {"Authorization": f"Bearer {user_token}"}
                # Try up to 2 pages (200 tracks) to respect target
                url = f"https://api.spotify.com/v1/playlists/{pid_clean}/tracks"
                params = {"limit": 100, "offset": 0, "market": "IN", "fields": "items(track(id,name,artists(id,name),album(name),popularity,duration_ms)),next,total"}
                resp = requests.get(url, headers=headers, params=params, timeout=15)
                if resp.status_code == 200:
                    data = resp.json()
                    for item in (data.get("items") or []):
                        t = (item or {}).get("track")
                        if t and t.get("id"):
                            tracks.append(t)
                    # paginate once more if needed
                    if data.get("next") and len(tracks) < 100:
                        resp2 = requests.get(data["next"], headers=headers, timeout=15)
                        if resp2.ok:
                            for item in (resp2.json().get("items") or []):
                                t = (item or {}).get("track")
                                if t and t.get("id"):
                                    tracks.append(t)
                elif resp.status_code == 403:
                    print(f" (user token also 403)", end="")
                else:
                    print(f" (user token {resp.status_code})", end="")
            except Exception as e:
                print(f" (user token error {e})", end="")

        if not tracks:
            tracks = client.get_playlist_tracks(pid_clean)
        if len(tracks) == 0:
            playlist_blocked_count += 1
        print(f"fetched {len(tracks)} tracks", end="")
        new = 0
        for t in tracks:
            tid = t.get("id")
            if tid and tid not in seen:
                seen[tid] = t
                new += 1
        print(f" (+{new} new, total unique {len(seen)})")
        playlist_stats.append((pid_clean, len(tracks), new))
        if len(seen) >= target:
            print(f"  -> reached target {target}, stopping playlist sweep")
            break
        time.sleep(0.1)

    # Fallback: if playlist route is blocked (403) for Client Credentials as of 2025, use track search
    if len(seen) < max(100, target // 5) and use_search_fallback:
        if playlist_blocked_count >= 2:
            print(f"\n[fallback] Playlist tracks blocked (403) for {playlist_blocked_count}/{len(playlist_stats)} playlists — Spotify now requires user auth for playlist tracks.")
            print("[fallback] Switching to track-search fallback: searching for workout tracks directly (works with Client Credentials).")
        else:
            print(f"\n[fallback] Only {len(seen)} tracks from playlists — supplementing via track search to reach {target}.")
        # Use FALLBACK_TRACK_QUERIES via search_tracks_paginated
        for q in FALLBACK_TRACK_QUERIES:
            if len(seen) >= target:
                break
            print(f"  search tracks '{q}' ...", end=" ", flush=True)
            try:
                found = client.search_tracks_paginated(q, total=min(200, target - len(seen)), market="IN")
            except Exception as e:
                print(f" failed {e}")
                continue
            added = 0
            for t in found:
                tid = t.get("id")
                if tid and tid not in seen:
                    # Tag with fallback query so we can infer language when artist genres are blocked (403)
                    t["_fallback_query"] = q
                    t["_fallback_language"] = "hindi" if any(kw in q for kw in ["hindi", "punjabi", "bollywood", "bhangra", "desi"]) else "english"
                    seen[tid] = t
                    added += 1
            print(f" {len(found)} fetched (+{added} new, total {len(seen)})")
            time.sleep(0.1)

    if len(seen) < 100:
        print(f"\n[warn] Only {len(seen)} unique tracks collected — check playlist IDs (some may be 404/private).")
        if len(seen) == 0:
            sys.exit(1)

    all_ids = list(seen.keys())
    # Trim to target if overshoot (keep most popular first)
    if len(all_ids) > target:
        # sort by popularity desc before trimming so we keep hits
        all_ids.sort(key=lambda tid: (seen[tid].get("popularity") or 0), reverse=True)
        all_ids = all_ids[:target]
        seen = {tid: seen[tid] for tid in all_ids}

    print(f"\n[collected] {len(seen)} unique tracks (trimmed to {len(all_ids)})")

    # 2. Enrich: artist genres
    print("\n[enrich] fetching artist genres (batches of 50) ...")
    all_artist_ids = []
    for tid in all_ids:
        for a in (seen[tid].get("artists") or []):
            if a.get("id"):
                all_artist_ids.append(a["id"])
    artist_map = client.get_artists_batch(all_artist_ids)
    print(f"  fetched {len(artist_map)} artist objects")
    if len(artist_map) == 0 and len(all_artist_ids) > 0:
        print("  [info] Artist genres unavailable (403 for Client Credentials as of 2025) — using title/artist text + fallback language for embeddings. Genres will be sparse.")

    # 3. Enrich: audio features (with graceful fallback)
    print("[enrich] fetching audio features (batches of 100) ...")
    feat_map = client.get_audio_features_batch(all_ids)
    if feat_map:
        print(f"  fetched {len(feat_map)} audio-feature objects")
    else:
        print("  using deterministic local estimates for BPM/energy/valence (audio-features unavailable)")

    # Optional: Reccobeats fallback
    if not feat_map and config.USE_RECCOBEATS_FALLBACK:
        print("[enrich] trying Reccobeats fallback ...")
        try:
            import requests
            for i in range(0, len(all_ids), 40):
                chunk = all_ids[i:i+40]
                # Reccobeats expects Spotify track IDs, returns audio features compatible shape
                resp = requests.get("https://api.reccobeats.com/v1/track/audio-features",
                                    params={"ids": ",".join(chunk)}, timeout=15)
                if resp.ok:
                    for f in resp.json().get("audioFeatures") or resp.json().get("data") or []:
                        if f and f.get("id"):
                            feat_map[f["id"]] = f
                time.sleep(0.1)
            print(f"  Reccobeats filled {len(feat_map)} features")
        except Exception as e:
            print(f"  Reccobeats fallback failed: {e} — continuing with estimates")

    # 4. Build rows
    rows = []
    genre_counter = Counter()
    lang_counter = Counter()
    for tid in all_ids:
        t = seen[tid]
        artists = t.get("artists") or []
        artist_names = ", ".join(a.get("name", "") for a in artists)
        artist_ids = [a.get("id") for a in artists if a.get("id")]

        # genres: union across all artists of this track
        genres_set = set()
        for aid in artist_ids:
            art = artist_map.get(aid)
            if art and art.get("genres"):
                for g in art["genres"]:
                    genres_set.add(g.lower())
                    genre_counter[g.lower()] += 1
        genres = sorted(genres_set)

        # language heuristic: hindi/punjabi genre or artist name hint
        is_hindi = any("hindi" in g or "punjabi" in g or "desi" in g or "bollywood" in g or "bhangra" in g for g in genres)
        # Fallback when genres are empty due to artists 403: use the search query that found the track,
        # plus lightweight title check for Devanagari / common Hindi words
        if not is_hindi and not genres:
            fallback_lang = t.get("_fallback_language")
            if fallback_lang == "hindi":
                is_hindi = True
            else:
                # title check: Devanagari range or common Hindi tokens
                title_lower = (t.get("name") or "").lower()
                # Devanagari unicode block
                has_devanagari = any(0x0900 <= ord(ch) <= 0x097F for ch in title_lower)
                hindi_tokens = ["dil", "pyaar", "ishq", "sultan", "zinda", "bhaag", "diljit", "arijit", "shreya", "sonu"]
                if has_devanagari or any(tok in title_lower for tok in hindi_tokens):
                    is_hindi = True
        lang = "hindi" if is_hindi else "english"
        lang_counter[lang] += 1

        feat = feat_map.get(tid)
        has_feat = feat is not None and feat.get("tempo") is not None
        bpm = round(feat["tempo"]) if has_feat and feat.get("tempo") else estimate_bpm(tid)
        energy = feat["energy"] if has_feat and feat.get("energy") is not None else estimate_energy(tid)
        valence = feat["valence"] if has_feat and feat.get("valence") is not None else estimate_valence(tid)
        danceability = feat.get("danceability") if has_feat and feat.get("danceability") is not None else estimate_danceability(tid)
        loudness = feat.get("loudness") if has_feat and feat.get("loudness") is not None else estimate_loudness(tid)

        rows.append({
            "id": tid,
            "title": t.get("name", ""),
            "artist": artist_names,
            "artist_ids": "|".join(artist_ids),
            "album": (t.get("album") or {}).get("name", ""),
            "popularity": t.get("popularity", 50),
            "duration_ms": t.get("duration_ms", 0),
            "genres": "|".join(genres) if genres else "",
            "genres_list": genres,  # for JSON
            "bpm": bpm,
            "energy": energy,
            "valence": valence,
            "danceability": danceability,
            "loudness": loudness,
            "bpm_estimated": not has_feat,
            "language": lang,
            "spotify_url": f"https://open.spotify.com/track/{tid}",
        })

    # Sort rows: Hindi vs English interleaved, popularity desc within each
    rows.sort(key=lambda r: (-r["popularity"], r["title"]))

    # 5. Write outputs
    out_csv_path = Path(out_csv)
    out_json_path = Path(out_json)
    out_csv_path.parent.mkdir(parents=True, exist_ok=True)
    out_json_path.parent.mkdir(parents=True, exist_ok=True)

    # CSV (flat, genres as | separated)
    with open(out_csv_path, "w", newline="", encoding="utf-8") as f:
        fieldnames = ["id","title","artist","artist_ids","album","popularity","duration_ms",
                      "genres","bpm","energy","valence","danceability","loudness","bpm_estimated","language","spotify_url"]
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r[k] for k in fieldnames})

    # JSON (full, genres as array)
    with open(out_json_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    print(f"\n[done] wrote {len(rows)} tracks")
    print(f"  CSV  -> {out_csv_path.resolve()}")
    print(f"  JSON -> {out_json_path.resolve()}")
    print(f"\n[stats] language: {dict(lang_counter)}")
    print(f"[stats] top genres: {genre_counter.most_common(12)}")
    print(f"[stats] estimated BPM/energy: {sum(1 for r in rows if r['bpm_estimated'])} / {len(rows)}")
    print(f"[stats] BPM range: {min(r['bpm'] for r in rows)}–{max(r['bpm'] for r in rows)}, "
          f"energy {min(r['energy'] for r in rows):.2f}–{max(r['energy'] for r in rows):.2f}")
    # Playlist contribution
    print(f"\n[playlists]")
    for pid, fetched, new in playlist_stats:
        print(f"  {pid}: {fetched} fetched, {new} new")
    return rows


def main():
    p = argparse.ArgumentParser(description="Extract AudioFit dataset from Spotify playlists (with Client Credentials 403 fallback to track search)")
    p.add_argument("--target", type=int, default=config.TARGET_UNIQUE_TRACKS, help="Target unique track count (default 5000)")
    p.add_argument("--out", type=str, default=config.DATASET_CSV, help="Output CSV path")
    p.add_argument("--out-json", type=str, default=None, help="Output JSON path (default alongside CSV)")
    p.add_argument("--playlists", type=str, nargs="*", default=None, help="Override playlist IDs (space-separated)")
    p.add_argument("--user-token", type=str, default=None, help="Spotify user access token (from Authorization Code flow) to bypass Client Credentials 403 for playlist tracks. Or set SPOTIFY_USER_TOKEN env var.")
    p.add_argument("--no-search-fallback", action="store_true", help="Disable fallback to track search when playlist tracks are blocked (403)")
    p.add_argument("--search-only", action="store_true", help="Skip playlists entirely and build dataset purely via track search (guaranteed to work with Client Credentials)")
    args = p.parse_args()

    out_csv = args.out
    out_json = args.out_json or str(Path(out_csv).with_suffix(".json"))
    playlists = args.playlists if args.playlists else config.ALL_PLAYLISTS
    if args.search_only:
        playlists = []  # force search fallback

    # Resolve relative paths against ml/ folder
    base = Path(__file__).parent
    if not Path(out_csv).is_absolute():
        out_csv = str(base / out_csv if not out_csv.startswith("data/") else base / out_csv)
        # handle case where out_csv already includes ml/ prefix when run from root
        out_csv = out_csv.replace("ml/ml/", "ml/")
    if not Path(out_json).is_absolute():
        out_json = str(base / out_json if not out_json.startswith("data/") else base / out_json)
        out_json = out_json.replace("ml/ml/", "ml/")

    extract(args.target, out_csv, out_json, playlists, use_search_fallback=not args.no_search_fallback, user_token=args.user_token)


if __name__ == "__main__":
    main()
