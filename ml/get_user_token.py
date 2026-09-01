#!/usr/bin/env python3
"""
Get a Spotify User Access Token via Authorization Code flow (PKCE not needed for this CLI).

Use this when playlist track fetching via Client Credentials returns 403 Forbidden
(as of 2025 Spotify now requires user auth for /v1/playlists/{id}/tracks and /v1/artists).

This script opens your browser for Spotify login, then captures the code and
exchanges it for a user token that can read any public playlist.

Steps:
  1. Create an app at https://developer.spotify.com/dashboard
     - Set Redirect URI to: http://127.0.0.1:8888/callback  (must match exactly)
     - Copy Client ID and Client Secret into ml/.env
  2. Run:  python ml/get_user_token.py
  3. Browser opens -> log in -> Approve -> token printed and saved to ml/.user_token.json
  4. Then run:  python ml/extract_dataset.py --user-token $(cat ml/.user_token.json | python -c "import json;print(json.load(open('ml/.user_token.json'))['access_token'])")
     Or just set env:  set SPOTIFY_USER_TOKEN=<token>  (Windows) / export SPOTIFY_USER_TOKEN=<token>
     Or the extractor will auto-detect ml/.user_token.json

Scopes requested: playlist-read-private, playlist-read-collaborative, user-library-read, user-read-private
Token expires in 3600s — re-run this script when it expires (or use refresh_token in the json).

If you just want to build a dataset quickly without any login, use the fallback that
works with Client Credentials alone:
  python ml/extract_dataset.py --search-only --target 5000
This bypasses playlists entirely and searches for tracks directly (still Hindi/English balanced).
"""
import os
import sys
import time
import json
import hashlib
import base64
import secrets
import webbrowser
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

import requests

REDIRECT_URI = "http://127.0.0.1:8888/callback"
SCOPES = "playlist-read-private playlist-read-collaborative user-library-read user-read-private user-read-email"
TOKEN_FILE = Path(__file__).parent / ".user_token.json"

# Simple in-memory to capture code
auth_code = None
auth_state = None
auth_error = None

class CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code, auth_error
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/callback":
            if "error" in qs:
                auth_error = qs.get("error", ["unknown"])[0]
                self.send_response(400)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                self.wfile.write(f"<h1>Spotify auth failed: {auth_error}</h1><p>Check your Redirect URI in dashboard matches {REDIRECT_URI}</p>".encode())
                return
            code = qs.get("code", [None])[0]
            state = qs.get("state", [None])[0]
            if code:
                auth_code = code
                # Verify state
                if state != auth_state:
                    print(f"[warn] state mismatch: {state} != {auth_state}")
                self.send_response(200)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                self.wfile.write(b"<h1>Success!</h1><p>You can close this tab and return to the terminal. Token will be saved to ml/.user_token.json</p>")
                return
        self.send_response(404)
        self.end_headers()
        self.wfile.write(b"Not found")

    def log_message(self, format, *args):
        # Suppress default logging
        pass

def main():
    client_id = os.getenv("SPOTIFY_CLIENT_ID", "").strip()
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        print("ERROR: SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set in ml/.env")
        print("  Create app at https://developer.spotify.com/dashboard")
        print(f"  Set Redirect URI to {REDIRECT_URI} exactly (including http:// and no trailing slash)")
        sys.exit(1)

    # Generate state for CSRF
    global auth_state
    auth_state = secrets.token_urlsafe(16)

    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "state": auth_state,
        "show_dialog": "true",
    }
    auth_url = "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode(params)
    print(f"Opening browser for Spotify login...")
    print(f"  {auth_url}")
    print(f"\nIf browser doesn't open, copy the URL above into your browser.")
    print(f"Redirect URI must be exactly: {REDIRECT_URI}")
    print(f"Waiting for callback on {REDIRECT_URI} ...")
    webbrowser.open(auth_url)

    # Start local server to catch callback
    server = HTTPServer(("127.0.0.1", 8888), CallbackHandler)
    # Timeout after 120s
    server.timeout = 120
    start = time.time()
    while auth_code is None and auth_error is None:
        server.handle_request()
        if time.time() - start > 120:
            print("\n[error] Timed out waiting for callback (120s). Did you approve in browser?")
            sys.exit(1)

    if auth_error:
        print(f"\n[error] Spotify returned error: {auth_error}")
        sys.exit(1)

    print(f"\nGot auth code: {auth_code[:20]}...")
    # Exchange code for token
    print("Exchanging code for access token...")
    data = {
        "grant_type": "authorization_code",
        "code": auth_code,
        "redirect_uri": REDIRECT_URI,
        "client_id": client_id,
        "client_secret": client_secret,
    }
    resp = requests.post("https://accounts.spotify.com/api/token", data=data, timeout=15)
    if not resp.ok:
        print(f"[error] Token exchange failed {resp.status_code}: {resp.text}")
        sys.exit(1)
    token_data = resp.json()
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in", 3600)
    print(f"\nSuccess! Access token (first 30 chars): {access_token[:30]}...")
    print(f"Expires in {expires_in}s, refresh token present: {bool(refresh_token)}")

    # Save
    out = {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": expires_in,
        "obtained_at": int(time.time()),
        "scope": token_data.get("scope", SCOPES),
        "token_type": token_data.get("token_type", "Bearer"),
    }
    TOKEN_FILE.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\nSaved to {TOKEN_FILE.resolve()}")
    print(f"\nUse it:")
    print(f"  set SPOTIFY_USER_TOKEN={access_token[:20]}...  (Windows)")
    print(f"  python ml/extract_dataset.py --user-token {access_token[:20]}...  --target 5000")
    print(f"  Or extractor will auto-detect {TOKEN_FILE.name} if present")
    print(f"\nToken expires in ~1 hour. Re-run this script to refresh, or use refresh_token to get a new one:")
    print(f"  curl -X POST https://accounts.spotify.com/api/token -d grant_type=refresh_token -d refresh_token={refresh_token[:20]}... -d client_id={client_id[:10]}...")

if __name__ == "__main__":
    main()
