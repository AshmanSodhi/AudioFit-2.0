#!/usr/bin/env python3
"""
AudioFit Playlist Auto-Discovery — find top Hindi & English workout playlists via Spotify Search

Problem it solves:
  `ml/config.py` previously required you to manually paste 10-40 playlist IDs.
  This script automates that: it searches Spotify for workout playlists in each
  language, ranks them by followers + track count, dedupes, and outputs the
  top N for your dataset.

Uses only Client Credentials (no user login) — same as `ml/extract_dataset.py`.

Search strategy:
  - English queries target gym/fitness/run semantics: "workout", "gym workout", "beast mode", "cardio", etc.
  - Hindi queries target Bollywood/Punjabi/bhangra: "hindi workout", "punjabi gym", "bollywood workout", etc.
  - Each query calls GET /v1/search?type=playlist (limit 50) — we aggregate across queries per language.
  - Every candidate playlist is then enriched via GET /v1/playlists/{id} to get authoritative
    followers.total and tracks.total for ranking (search results are simplified and lack followers).
  - Filter by min_tracks (default 30) and optional min_followers, then sort by followers desc.
  - Output per language is deterministic and reproducible.

Usage:
  # 1. Setup (once)
  python -m pip install -r ml/requirements.txt
  copy ml\.env.example ml\.env
  # edit ml/.env -> SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET from https://developer.spotify.com/dashboard

  # 2. Discover (default: 20 English + 15 Hindi)
  python ml/discover_playlists.py
  python ml/discover_playlists.py --english-limit 25 --hindi-limit 15 --min-tracks 40

  # 3. Inspect outputs
  type ml\data\discovered_playlists.json
  type ml\data\discovered_playlists_config_snippet.py

  # 4. Use results:
  #    - Option A: manually copy IDs from the snippet into ml/config.py
  #    - Option B: auto-patch config with --update-config (backs up original to config.py.bak)
  python ml/discover_playlists.py --update-config

  # 5. Then build the real dataset from discovered playlists:
  python ml/extract_dataset.py --playlists $(python -c "import json; d=json.load(open('ml/data/discovered_playlists.json')); print(' '.join(d['english_ids']+d['hindi_ids']))")

Outputs:
  ml/data/discovered_playlists.json            — full metadata {english:[...], hindi:[...], english_ids:[...], hindi_ids:[...]}
  ml/data/discovered_playlists_config_snippet.py — copy-paste Python for ml/config.py

Spotify API notes:
  - Search is market-aware: we use market=IN for India (Hindi results rank higher).
  - Some workout playlists are editorial (37i9dQZF1...) and some are user-curated; both are valid.
  - Rate limit 429 is handled via SpotifyClient._get (Retry-After).
  - If a playlist 404s during meta fetch, it's skipped (private/deleted/region-blocked).

Tuning:
  - Add/remove queries in ENGLISH_QUERIES / HINDI_QUERIES below to bias results.
  - Lower --min-tracks to include shorter playlists; lower --min-followers to include niche Hindi lists.
"""

import argparse
import json
import os
import re
import time
from collections import defaultdict
from pathlib import Path

# Load .env if present (same as extract_dataset.py)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

import sys
sys.path.insert(0, str(Path(__file__).parent))
from spotify_client import SpotifyClient

# ---- Default queries (edit to bias discovery) ----
ENGLISH_QUERIES = [
    "workout",                 # broad — Spotify editorial + top curators
    "gym workout",             # gym-specific
    "beast mode workout",      # high-energy (links to Beast Mode editorial)
    "cardio workout",          # cardio/running
    "running workout",         # running
    "fitness workout",         # fitness
    "gym motivation",          # motivation / pump
]

HINDI_QUERIES = [
    "hindi workout",           # broad Hindi
    "punjabi workout",         # Punjabi
    "bollywood workout",       # Bollywood
    "hindi gym",               # Hindi gym
    "punjabi gym",             # Punjabi gym
    "bhangra workout",         # Bhangra
    "desi workout",            # Desi
]

# Market for search ranking (IN boosts Hindi relevance)
DEFAULT_MARKET = "IN"


def discover_for_language(
    client: SpotifyClient,
    queries: list,
    language_label: str,
    per_query_limit: int = 30,
    market: str = DEFAULT_MARKET,
) -> dict:
    """
    Run each query via paginated search and aggregate unique playlists.
    Spotify now caps limit at 10 per request (400 if higher), so we paginate
    via search_playlists_paginated when per_query_limit > 10.

    Returns dict id -> {playlist: simplified_obj, first_query: str, all_queries: set}
    """
    aggregated: dict = {}  # id -> {playlist, first_query, all_queries}
    print(f"\n[discover] {language_label}: {len(queries)} queries x {per_query_limit} results (market={market})")
    for q in queries:
        print(f"  search '{q}' ...", end=" ", flush=True)
        # Use paginated helper (handles 10-per-page limit automatically)
        if per_query_limit <= 10:
            results = client.search_playlists(q, limit=per_query_limit, offset=0, market=market)
        else:
            results = client.search_playlists_paginated(q, total=per_query_limit, market=market)
        print(f"-> {len(results)} playlists")
        for pl in results:
            pid = pl.get("id")
            if not pid:
                continue
            if pid not in aggregated:
                aggregated[pid] = {"playlist": pl, "first_query": q, "all_queries": {q}}
            else:
                aggregated[pid]["all_queries"].add(q)
        time.sleep(0.15)  # be nice vs search burst

    print(f"  aggregated {len(aggregated)} unique playlists for {language_label}")
    return aggregated


def enrich_and_rank(
    client: SpotifyClient,
    aggregated: dict,
    min_tracks: int = 30,
    min_followers: int = 0,
    top_n: int = 20,
    market: str = DEFAULT_MARKET,
) -> list:
    """
    Fetch full metadata for each candidate, filter, and rank by followers.
    Returns sorted list of enriched playlist dicts (up to top_n).

    Note on 2025 Spotify API change: GET /v1/playlists/{id}/tracks with
    Client Credentials now returns 403 Forbidden for many playlists, and
    GET /v1/playlists/{id} often omits the `tracks` field entirely for
    Client Credentials (even though followers is present). When tracks is
    unavailable we treat it as unknown (0) and skip the min_tracks filter
    rather than discarding everything.
    """
    ids = list(aggregated.keys())
    if not ids:
        return []

    print(f"  enriching {len(ids)} playlist(s) via GET /v1/playlists/... (sequential, ~0.08s each)")
    meta_map = client.get_playlists_meta_batch(ids, market=market)
    print(f"  got metadata for {len(meta_map)} / {len(ids)}")

    enriched = []
    skipped_small = 0
    skipped_no_followers = 0
    unknown_tracks = 0
    for pid, info in aggregated.items():
        meta = meta_map.get(pid)
        # Fallback to simplified object if meta fetch failed (use search stub)
        if not meta:
            pl = info["playlist"]
            # Try to salvage: search stub has tracks.total sometimes (often None now)
            tracks_total = (pl.get("tracks") or {}).get("total", 0) or 0
            followers_total = 0
            name = pl.get("name", "Unknown")
            owner = (pl.get("owner") or {}).get("display_name", "")
            description = pl.get("description", "")
            images = pl.get("images", [])
            external_urls = pl.get("external_urls", {})
        else:
            # tracks may be missing (None) when using Client Credentials as of 2025 — treat as unknown
            tracks_field = meta.get("tracks")
            if isinstance(tracks_field, dict) and "total" in tracks_field:
                tracks_total = tracks_field.get("total", 0) or 0
            else:
                tracks_total = 0
                unknown_tracks += 1
            followers_total = (meta.get("followers") or {}).get("total", 0) or 0
            name = meta.get("name", "")
            owner = (meta.get("owner") or {}).get("display_name", "") or (meta.get("owner") or {}).get("id", "")
            description = meta.get("description", "") or ""
            images = meta.get("images", [])
            external_urls = meta.get("external_urls", {})

        # Filters — only apply min_tracks when we actually know the count
        if tracks_total > 0 and tracks_total < min_tracks:
            skipped_small += 1
            continue
        if followers_total < min_followers:
            skipped_no_followers += 1
            continue

        # Score: primary followers, secondary tracks (log dampened for tracks to avoid mega 500-track lists dominating)
        # Using simple weighted: followers + tracks*100 captures both popularity and workout-length usefulness
        # No need for ML here — ranking is heuristic but reproducible
        import math
        score = followers_total + math.log1p(tracks_total) * 500

        enriched.append({
            "id": pid,
            "name": name,
            "description": (description or "")[:200],  # trim HTML
            "owner": owner,
            "followers": followers_total,
            "tracks_total": tracks_total,
            "url": f"https://open.spotify.com/playlist/{pid}",
            "external_url": (external_urls.get("spotify") if isinstance(external_urls, dict) else f"https://open.spotify.com/playlist/{pid}"),
            "images": images[:1] if images else [],
            "first_query": info["first_query"],
            "all_queries": sorted(info["all_queries"]),
            "score": int(score),
        })

    if skipped_small:
        print(f"  filtered {skipped_small} playlist(s) with < {min_tracks} tracks (known count)")
    if skipped_no_followers:
        print(f"  filtered {skipped_no_followers} playlist(s) with < {min_followers} followers")
    if unknown_tracks:
        print(f"  note: {unknown_tracks} playlist(s) had unknown track count (Spotify omits tracks for Client Credentials) — kept via followers rank")

    enriched.sort(key=lambda x: x["score"], reverse=True)
    # Secondary sort by followers then tracks for stable ordering when scores tie
    # (already covered by score, but explicit)
    enriched = sorted(enriched, key=lambda x: (x["followers"], x["tracks_total"]), reverse=True)

    return enriched[:top_n]


def build_outputs(english_ranked: list, hindi_ranked: list, out_json: Path, out_snippet: Path):
    """Write discovered_playlists.json and a copy-paste Python snippet for ml/config.py"""
    out_json.parent.mkdir(parents=True, exist_ok=True)

    english_ids = [p["id"] for p in english_ranked]
    hindi_ids = [p["id"] for p in hindi_ranked]

    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "market": DEFAULT_MARKET,
        "english_queries": ENGLISH_QUERIES,
        "hindi_queries": HINDI_QUERIES,
        "english": english_ranked,
        "hindi": hindi_ranked,
        "english_ids": english_ids,
        "hindi_ids": hindi_ids,
        "all_ids": english_ids + hindi_ids,
    }

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"\n[save] discovered playlists -> {out_json.resolve()}")
    print(f"  english: {len(english_ranked)} | hindi: {len(hindi_ranked)} | total: {len(english_ids+hindi_ids)}")

    # Config snippet
    snippet_lines = [
        "# Auto-generated by ml/discover_playlists.py — copy into ml/config.py",
        f"# Generated {payload['generated_at']} | market={DEFAULT_MARKET}",
        "#",
        "ENGLISH_WORKOUT_PLAYLISTS = [",
    ]
    for p in english_ranked:
        # Escape single quotes in name
        name = p["name"].replace("'", "\\'")
        snippet_lines.append(f"    \"{p['id']}\",  # {name} — {p['followers']} followers, {p['tracks_total']} tracks (via '{p['first_query']}')")
    snippet_lines.append("]")
    snippet_lines.append("")
    snippet_lines.append("HINDI_WORKOUT_PLAYLISTS = [")
    for p in hindi_ranked:
        name = p["name"].replace("'", "\\'")
        snippet_lines.append(f"    \"{p['id']}\",  # {name} — {p['followers']} followers, {p['tracks_total']} tracks (via '{p['first_query']}')")
    snippet_lines.append("]")
    snippet_lines.append("")
    snippet_lines.append("ALL_PLAYLISTS = ENGLISH_WORKOUT_PLAYLISTS + HINDI_WORKOUT_PLAYLISTS")
    snippet_text = "\n".join(snippet_lines)

    out_snippet.parent.mkdir(parents=True, exist_ok=True)
    with open(out_snippet, "w", encoding="utf-8") as f:
        f.write(snippet_text + "\n")
    print(f"[save] config snippet -> {out_snippet.resolve()}")

    # Also print top 5 per language for quick inspection (ascii-safe for Windows cp1252)
    def safe_name(s: str) -> str:
        return s.encode("ascii", errors="replace").decode()

    print("\n[top English]")
    for p in english_ranked[:5]:
        print(f"  {p['followers']:>8} followers | {p['tracks_total']:>3} tracks | {safe_name(p['name'][:45]):<45} | {p['id']} | q='{p['first_query']}'")
    print("\n[top Hindi]")
    for p in hindi_ranked[:5]:
        print(f"  {p['followers']:>8} followers | {p['tracks_total']:>3} tracks | {safe_name(p['name'][:45]):<45} | {p['id']} | q='{p['first_query']}'")

    return payload


def patch_config_py(config_path: Path, english_ids: list, hindi_ids: list):
    """Optionally patch ml/config.py in place (backs up to config.py.bak)"""
    if not config_path.exists():
        print(f"[patch] config not found: {config_path}")
        return
    text = config_path.read_text(encoding="utf-8")
    backup = config_path.with_suffix(".py.bak")
    if not backup.exists():
        backup.write_text(text, encoding="utf-8")
        print(f"[patch] backup -> {backup}")

    # Replace ENGLISH_WORKOUT_PLAYLISTS = [...] block
    def replace_list(block_name, new_ids, new_ranked_meta=None):
        # new_ranked_meta is used for comments; if not supplied, just IDs
        # Build replacement block
        lines = [f"{block_name} = ["]
        # Try to include comments if payload available
        for pid in new_ids:
            lines.append(f'    "{pid}",')
        lines.append("]")
        new_block = "\n".join(lines)
        # Regex to find existing block (non-greedy)
        pattern = re.compile(rf"{re.escape(block_name)}\s*=\s*\[.*?^\]", re.MULTILINE | re.DOTALL)
        if pattern.search(text):
            return pattern.sub(new_block, text)
        else:
            print(f"[patch] could not find block {block_name} to replace")
            return text

    # We have no meta here, just IDs — caller should pass ranked to get comments;
    # for simplicity, we patch with IDs only when using this helper directly
    new_text = replace_list("ENGLISH_WORKOUT_PLAYLISTS", english_ids)
    new_text = replace_list("HINDI_WORKOUT_PLAYLISTS", hindi_ids) if "HINDI_WORKOUT_PLAYLISTS" in new_text else new_text.replace(
        "HINDI_WORKOUT_PLAYLISTS = [", "HINDI_WORKOUT_PLAYLISTS = ["
    )  # fallback handled above

    # Actually re-apply both on original text to avoid double-sub issues — do it cleanly:
    # Read again and do both subs in one pass
    # Simpler: just write new config with discovered IDs and keep header comments
    # We'll do a safe rewrite: keep everything up to the first ENGLISH block, then inject new lists, then keep tail after ALL_PLAYLISTS
    try:
        # Find ALL_PLAYLISTS line to preserve tail
        all_line_match = re.search(r"ALL_PLAYLISTS\s*=.*", text)
        tail = text[all_line_match.end():] if all_line_match else ""

        header_end = text.find("ENGLISH_WORKOUT_PLAYLISTS")
        header = text[:header_end] if header_end != -1 else text[:500]

        # Build new middle
        new_middle = []
        new_middle.append("ENGLISH_WORKOUT_PLAYLISTS = [")
        for pid in english_ids:
            new_middle.append(f'    "{pid}",')
        new_middle.append("]")
        new_middle.append("")
        new_middle.append("HINDI_WORKOUT_PLAYLISTS = [")
        for pid in hindi_ids:
            new_middle.append(f'    "{pid}",')
        new_middle.append("]")
        new_middle.append("")
        new_middle.append("ALL_PLAYLISTS = ENGLISH_WORKOUT_PLAYLISTS + HINDI_WORKOUT_PLAYLISTS")
        new_middle_text = "\n".join(new_middle)

        final = header.rstrip() + "\n\n" + new_middle_text + tail
        config_path.write_text(final, encoding="utf-8")
        print(f"[patch] updated {config_path} with discovered IDs")
    except Exception as e:
        print(f"[patch] failed: {e}")


def main():
    parser = argparse.ArgumentParser(description="Auto-discover top Hindi & English workout playlists via Spotify Search")
    parser.add_argument("--english-limit", type=int, default=20, help="How many top English playlists to keep (default 20)")
    parser.add_argument("--hindi-limit", type=int, default=15, help="How many top Hindi playlists to keep (default 15)")
    parser.add_argument("--per-query-limit", type=int, default=30, help="Search results per query (paginated 10 per page, default 30 = 3 pages)")
    parser.add_argument("--min-tracks", type=int, default=30, help="Filter: minimum tracks per playlist (default 30)")
    parser.add_argument("--min-followers", type=int, default=0, help="Filter: minimum followers (default 0, set 1000 to skip niche)")
    parser.add_argument("--market", type=str, default=DEFAULT_MARKET, help="Spotify market (default IN)")
    parser.add_argument("--output", type=str, default="ml/data/discovered_playlists.json", help="Output JSON path")
    parser.add_argument("--snippet", type=str, default="ml/data/discovered_playlists_config_snippet.py", help="Output snippet path")
    parser.add_argument("--update-config", action="store_true", help="Auto-patch ml/config.py with discovered IDs (backs up to .bak)")
    parser.add_argument("--english-queries", type=str, nargs="*", default=None, help="Override English queries (space-separated, quote multi-word)")
    parser.add_argument("--hindi-queries", type=str, nargs="*", default=None, help="Override Hindi queries")
    args = parser.parse_args()

    # Resolve paths relative to project root
    base = Path(__file__).parent  # ml/
    project_root = base.parent  # React Only Project

    def resolve_path(p: str) -> Path:
        path = Path(p)
        if path.is_absolute():
            return path
        # Allow "ml/data/..." or "data/..." or plain
        if p.startswith("ml/"):
            return project_root / p
        if p.startswith("data/"):
            return base / p
        # Default: if contains "/", treat as relative to project root
        if "/" in p or "\\" in p:
            return project_root / p
        return base / p

    out_json = resolve_path(args.output)
    out_snippet = resolve_path(args.snippet)

    # Effective queries
    english_queries = args.english_queries if args.english_queries is not None else ENGLISH_QUERIES
    hindi_queries = args.hindi_queries if args.hindi_queries is not None else HINDI_QUERIES

    # Auth
    client_id = os.getenv("SPOTIFY_CLIENT_ID", "").strip()
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        print("ERROR: SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set.")
        print("  Create an app at https://developer.spotify.com/dashboard")
        print("  Then set them in ml/.env or env vars:")
        print("    SPOTIFY_CLIENT_ID=...")
        print("    SPOTIFY_CLIENT_SECRET=...")
        sys.exit(1)

    client = SpotifyClient(client_id, client_secret)

    print(f"Market: {args.market} | per_query_limit={args.per_query_limit} | min_tracks={args.min_tracks} | min_followers={args.min_followers}")
    print(f"English queries ({len(english_queries)}): {english_queries}")
    print(f"Hindi queries ({len(hindi_queries)}): {hindi_queries}")

    # Discover English
    eng_agg = discover_for_language(client, english_queries, "English", per_query_limit=args.per_query_limit, market=args.market)
    eng_ranked = enrich_and_rank(client, eng_agg, min_tracks=args.min_tracks, min_followers=args.min_followers, top_n=args.english_limit, market=args.market)
    print(f"\n[result] English top {len(eng_ranked)} (requested {args.english_limit})")

    # Discover Hindi
    hin_agg = discover_for_language(client, hindi_queries, "Hindi", per_query_limit=args.per_query_limit, market=args.market)
    hin_ranked = enrich_and_rank(client, hin_agg, min_tracks=args.min_tracks, min_followers=args.min_followers, top_n=args.hindi_limit, market=args.market)
    print(f"\n[result] Hindi top {len(hin_ranked)} (requested {args.hindi_limit})")

    # Deduplicate across languages: if same playlist appears in both (rare), keep it in the language where it ranked higher
    eng_ids_set = {p["id"] for p in eng_ranked}
    hin_ids_set = {p["id"] for p in hin_ranked}
    overlap = eng_ids_set & hin_ids_set
    if overlap:
        print(f"\n[dedupe] {len(overlap)} playlist(s) appear in both languages -> keeping in higher-ranked language")
        # For each overlapping id, drop from lower-ranked list (higher score wins)
        def safe(s: str) -> str:
            return s.encode("ascii", errors="replace").decode()
        eng_map = {p["id"]: p for p in eng_ranked}
        hin_map = {p["id"]: p for p in hin_ranked}
        for pid in overlap:
            e_score = eng_map[pid]["score"]
            h_score = hin_map[pid]["score"]
            if e_score >= h_score:
                hin_ranked = [p for p in hin_ranked if p["id"] != pid]
                print(f"  kept {pid} in English ({safe(eng_map[pid]['name'][:30])}) score {e_score} > {h_score}")
            else:
                eng_ranked = [p for p in eng_ranked if p["id"] != pid]
                print(f"  kept {pid} in Hindi ({safe(hin_map[pid]['name'][:30])}) score {h_score} > {e_score}")

    payload = build_outputs(eng_ranked, hin_ranked, out_json, out_snippet)

    # Auto-patch config if requested
    if args.update_config:
        config_path = base / "config.py"
        # Use enriched versions with comments: rebuild snippet with full meta for patch
        # For patch we want commented version, so rebuild from payload
        # We'll write a commented patch to preserve readability
        backup = config_path.with_suffix(".py.bak")
        orig = config_path.read_text(encoding="utf-8")
        if not backup.exists():
            backup.write_text(orig, encoding="utf-8")
            print(f"[patch] backup -> {backup}")

        # Build commented blocks
        def build_block(name, ranked):
            lines = [f"{name} = ["]
            for p in ranked:
                safe_name = p["name"].replace("\"", "'")[:50]
                lines.append(f'    "{p["id"]}",  # {safe_name} — {p["followers"]} followers, {p["tracks_total"]} tracks')
            lines.append("]")
            return "\n".join(lines)

        header_end = orig.find("ENGLISH_WORKOUT_PLAYLISTS")
        header = orig[:header_end].rstrip() if header_end != -1 else orig[:600].rstrip()
        tail_match = re.search(r"ALL_PLAYLISTS\s*=.*", orig)
        tail = orig[tail_match.end():] if tail_match else ""

        new_middle = build_block("ENGLISH_WORKOUT_PLAYLISTS", eng_ranked) + "\n\n" + build_block("HINDI_WORKOUT_PLAYLISTS", hin_ranked) + "\n\nALL_PLAYLISTS = ENGLISH_WORKOUT_PLAYLISTS + HINDI_WORKOUT_PLAYLISTS"
        final = header + "\n\n" + new_middle + tail
        config_path.write_text(final, encoding="utf-8")
        print(f"[patch] updated {config_path} with discovered playlists (commented)")

    print("\n[done] Discovery complete.")
    print(f"  Next: python ml/extract_dataset.py --playlists {' '.join(payload['all_ids'][:3])} ... (or) python ml/extract_dataset.py  # if you used --update-config")
    print(f"  Use --min-tracks / --min-followers to tune. Re-run anytime to refresh.")

if __name__ == "__main__":
    main()
