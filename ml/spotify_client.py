"""
Spotify client helpers — Client Credentials flow + batched API calls.

Uses only requests + stdlib. Handles 429 rate-limit, 401 refresh, and
audio-features deprecation gracefully.
"""
import base64
import time
import re
import requests
from typing import List, Dict, Optional


def extract_playlist_id(url_or_id: str) -> str:
    """Accept raw ID or full Spotify URL, return just the ID."""
    if not url_or_id:
        return ""
    # if it's a URL like https://open.spotify.com/playlist/<id>?si=...
    m = re.search(r"playlist[/:]([a-zA-Z0-9]+)", url_or_id)
    if m:
        return m.group(1)
    # raw ID (22 chars) or track/artist ID — just return stripped
    return url_or_id.strip().split("?")[0].split("/")[-1]


class SpotifyClient:
    def __init__(self, client_id: str, client_secret: str):
        if not client_id or not client_secret:
            raise ValueError("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required (Client Credentials). "
                             "Create an app at https://developer.spotify.com/dashboard")
        self.client_id = client_id
        self.client_secret = client_secret
        self._token: Optional[str] = None
        self._token_expires_at: float = 0

    def _fetch_token(self):
        auth = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        resp = requests.post(
            "https://accounts.spotify.com/api/token",
            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
            data={"grant_type": "client_credentials"},
            timeout=15,
        )
        if not resp.ok:
            raise RuntimeError(f"Spotify token fetch failed {resp.status_code}: {resp.text}")
        data = resp.json()
        self._token = data["access_token"]
        self._token_expires_at = time.time() + data.get("expires_in", 3600) - 60

    def token(self) -> str:
        if not self._token or time.time() >= self._token_expires_at:
            self._fetch_token()
        assert self._token is not None
        return self._token

    def _get(self, url: str, params: Optional[dict] = None, retries: int = 3) -> requests.Response:
        for attempt in range(retries):
            headers = {"Authorization": f"Bearer {self.token()}"}
            resp = requests.get(url, headers=headers, params=params, timeout=15)
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "2"))
                time.sleep(retry_after + 1)
                continue
            if resp.status_code in (502, 503) and attempt < retries - 1:
                time.sleep(1 + attempt)
                continue
            if resp.status_code == 401 and attempt < retries - 1:
                self._fetch_token()
                continue
            return resp
        return resp

    def get_playlist_tracks(self, playlist_id: str) -> List[dict]:
        """Fetch all tracks in a playlist (handles pagination, 100 per page)."""
        pid = extract_playlist_id(playlist_id)
        tracks = []
        url = f"https://api.spotify.com/v1/playlists/{pid}/tracks"
        params = {"limit": 100, "offset": 0, "market": "IN"}
        # fields to reduce payload
        params["fields"] = "items(track(id,name,artists(id,name),album(name),popularity,duration_ms,preview_url,external_urls)),next,total"
        while True:
            resp = self._get(url, params=params)
            if not resp.ok:
                print(f"  [warn] playlist {pid} fetch failed {resp.status_code}: {resp.text[:300]}")
                break
            data = resp.json()
            items = data.get("items") or []
            for item in items:
                t = (item or {}).get("track")
                if t and t.get("id"):
                    tracks.append(t)
            nxt = data.get("next")
            if not nxt:
                break
            # next is a full URL with offset already encoded
            url = nxt
            params = None  # next URL already has params
            time.sleep(0.05)  # be nice to API
        return tracks

    def get_artists_batch(self, artist_ids: List[str]) -> Dict[str, dict]:
        """Fetch artist objects in batches of 50. Returns map id -> artist."""
        out: Dict[str, dict] = {}
        # dedupe and filter empty
        ids = [a for a in dict.fromkeys(artist_ids) if a]
        for i in range(0, len(ids), 50):
            chunk = ids[i:i+50]
            resp = self._get("https://api.spotify.com/v1/artists", params={"ids": ",".join(chunk)})
            if not resp.ok:
                print(f"  [warn] artists batch failed {resp.status_code}")
                continue
            for art in (resp.json().get("artists") or []):
                if art and art.get("id"):
                    out[art["id"]] = art
            time.sleep(0.05)
        return out

    def get_audio_features_batch(self, track_ids: List[str]) -> Dict[str, dict]:
        """Fetch audio features in batches of 100. Returns map track_id -> features.
        Returns empty map gracefully if endpoint is deprecated (403)."""
        out: Dict[str, dict] = {}
        ids = [t for t in dict.fromkeys(track_ids) if t]
        for i in range(0, len(ids), 100):
            chunk = ids[i:i+100]
            resp = self._get("https://api.spotify.com/v1/audio-features", params={"ids": ",".join(chunk)})
            if resp.status_code == 403:
                print("  [info] /v1/audio-features returned 403 — endpoint deprecated for this app. Using local estimates.")
                return {}
            if not resp.ok:
                print(f"  [warn] audio-features batch failed {resp.status_code}: {resp.text[:300]}")
                continue
            for feat in (resp.json().get("audio_features") or []):
                if feat and feat.get("id"):
                    out[feat["id"]] = feat
            time.sleep(0.05)
        return out

    # ---- Playlist search & metadata (for auto-discovery) ----

    def search_playlists(self, query: str, limit: int = 20, offset: int = 0, market: str = "IN") -> List[dict]:
        """
        Search for playlists by keyword.
        Uses GET /v1/search?type=playlist. Returns list of simplified playlist objects.
        Handles 429/401 via _get.

        Spotify now caps playlist search limit at 10 (400 Invalid limit if higher).
        This method enforces the cap and supports auto-pagination if you need more
        than 10 results: pass max_results and it will page via offset.
        """
        # Spotify enforces 10 max for playlist search as of 2025 (previously 50)
        limit = max(1, min(limit, 10))
        params = {"q": query, "type": "playlist", "limit": limit, "offset": offset, "market": market}
        resp = self._get("https://api.spotify.com/v1/search", params=params)
        if not resp.ok:
            print(f"  [warn] search playlists '{query}' failed {resp.status_code}: {resp.text[:300]}")
            return []
        data = resp.json()
        items = ((data.get("playlists") or {}).get("items") or [])
        # Filter out nulls (Spotify occasionally returns null for unavailable playlists)
        return [p for p in items if p and p.get("id")]

    def search_playlists_paginated(self, query: str, total: int = 20, market: str = "IN") -> List[dict]:
        """
        Fetch up to `total` playlists for a query via pagination (10 per page).
        Returns aggregated unique list up to total.
        """
        results: List[dict] = []
        per_page = 10
        offset = 0
        while len(results) < total:
            want = min(per_page, total - len(results))
            chunk = self.search_playlists(query, limit=want, offset=offset, market=market)
            if not chunk:
                break
            results.extend(chunk)
            if len(chunk) < want:
                break  # no more pages
            offset += len(chunk)
            time.sleep(0.12)
            # Stop if offset beyond Spotify's 1000 result limit
            if offset >= 900:
                break
        return results[:total]

    def get_playlist_meta(self, playlist_id: str, market: str = "IN") -> Optional[dict]:
        """
        Fetch full playlist metadata (followers, track count, owner, description).
        Uses GET /v1/playlists/{id} with field filtering to reduce payload.
        Returns None on failure.
        """
        pid = extract_playlist_id(playlist_id)
        if not pid:
            return None
        # Field filter keeps response small but includes what we need for ranking
        fields = "id,name,description,owner(display_name,id),followers(total),tracks(total),images,external_urls"
        resp = self._get(f"https://api.spotify.com/v1/playlists/{pid}", params={"fields": fields, "market": market})
        if not resp.ok:
            # 404 often means playlist deleted/private or region-blocked
            if resp.status_code not in (404, 400):
                print(f"  [warn] get playlist meta {pid} failed {resp.status_code}: {resp.text[:200]}")
            return None
        return resp.json()

    def get_playlists_meta_batch(self, playlist_ids: List[str], market: str = "IN") -> Dict[str, dict]:
        """Fetch metadata for multiple playlists sequentially (no batch endpoint). Returns map id -> meta."""
        out: Dict[str, dict] = {}
        # Dedupe preserve order
        ids = [p for p in dict.fromkeys(playlist_ids) if p]
        for pid in ids:
            meta = self.get_playlist_meta(pid, market=market)
            if meta and meta.get("id"):
                out[meta["id"]] = meta
            elif meta is None:
                # Already warned
                pass
            time.sleep(0.08)  # be gentle vs search+playlist burst
        return out

    # ---- Track search (fallback when playlist tracks are blocked for Client Credentials) ----

    def search_tracks(self, query: str, limit: int = 20, offset: int = 0, market: str = "IN") -> List[dict]:
        """
        Search for tracks by keyword.
        Uses GET /v1/search?type=track. Works with Client Credentials (no user token needed).
        Spotify now caps limit at 10 for search (400 if higher) — enforced here.
        Use search_tracks_paginated for larger totals (it pages 10 at a time).
        """
        limit = max(1, min(limit, 10))
        params = {"q": query, "type": "track", "limit": limit, "offset": offset, "market": market}
        resp = self._get("https://api.spotify.com/v1/search", params=params)
        if not resp.ok:
            print(f"  [warn] search tracks '{query}' failed {resp.status_code}: {resp.text[:300]}")
            return []
        data = resp.json()
        items = ((data.get("tracks") or {}).get("items") or [])
        return [t for t in items if t and t.get("id")]

    def search_tracks_paginated(self, query: str, total: int = 50, market: str = "IN") -> List[dict]:
        """Fetch up to `total` tracks for a query via pagination (10 per page)."""
        results: List[dict] = []
        per_page = 10
        offset = 0
        while len(results) < total:
            want = min(per_page, total - len(results))
            chunk = self.search_tracks(query, limit=want, offset=offset, market=market)
            if not chunk:
                break
            results.extend(chunk)
            if len(chunk) < want:
                break
            offset += len(chunk)
            time.sleep(0.12)
            if offset >= 900:
                break
        return results[:total]
