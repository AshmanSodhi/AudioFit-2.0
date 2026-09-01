"""
AudioFit ML Config — playlist sources for the ~5k song dataset.

Edit this file to add/remove playlist IDs. Each entry is a Spotify playlist
ID or URL (we extract the ID automatically). Mix English + Hindi workout
playlists to hit ~5000 unique tracks.

Tips:
- Use public playlists with 75-150 tracks each; ~40 playlists ≈ 4k-5k unique after dedupe.
- Avoid duplicate-heavy mega playlists; diversity helps the recommender.
- Hindi / Punjabi workout playlists balance the catalogue for your dual-language target.

How to get a playlist ID:
  Open playlist in Spotify → Share → Copy link
  https://open.spotify.com/playlist/37i9dQZF1DX76Wlfdnj7AP  → ID is 37i9dQZF1DX76Wlfdnj7AP
"""

# ---- Target dataset size ----
TARGET_UNIQUE_TRACKS = 5000

# ---- English workout playlists (Spotify curated + community) ----
# Verified public playlist IDs as of 2025-26. Replace any that 404 — Spotify
# occasionally retires curated IDs; just swap in a similar workout playlist.

ENGLISH_WORKOUT_PLAYLISTS = [
    "0xF0eHm3eguBqBvgVyQ3UB",  # GYM PHONK 2026 😈 AGGRESSIVE WORKOUT PHONK MUSIC — 1804040 followers, 0 tracks
    "2SM6rniZl84fEyMCB5KMQB",  # WORKOUT PLAYLIST 2026 — 715949 followers, 0 tracks
    "3U7mEmGXnG3RJ1lrC2Jhvz",  # GYM SONGS🎀 (for girlies) 2026 — 462539 followers, 0 tracks
    "44imBReuLDHuIP0j4UmCtm",  # BEAST MODE - Motivation for sports GYM and bodybui — 330126 followers, 0 tracks
    "5MLyX3xiNllq052FsL47Ga",  # Jogging Music 2026🔥🍑  — 311886 followers, 0 tracks
    "7DD7riEgqIZVWzlsd3aNn0",  # GYM RATS 💪WORKOUT AGO 26 | TikTok Top 50 viral 100 — 294319 followers, 0 tracks
    "45oqmL3silSTKWTBPahpat",  # MOTIVATION SONGS OF 2026 | BEST SONGS TO PUSH YOUR — 260500 followers, 0 tracks
    "280hYAs0wM3CswUTZDVBif",  # No Excuses - Motivation Songs 2026 — 238574 followers, 0 tracks
    "2DgJ11Y3E9rOS97bgaUwLH",  # CARDIO MUSIC HITS 2026 🔥🍑 — 192257 followers, 0 tracks
    "2joAU7ngDpwRwH2YPJc4z9",  # EGO MODE ☠️  Scroll to latest 🗿 — 153989 followers, 0 tracks
    "1h3UACACM9GM9ju7ifeQpf",  # WORKOUT REMIX 2026  💪🏻 GYM WORKOUT 🍑 GYM MOTIVATIO — 144620 followers, 0 tracks
    "1VU91WcVhly4DClcCJB0AE",  # Gym workout Hindi songs — 98537 followers, 0 tracks
    "1LIowjORrNqFFyXYqK0JvE",  # PUNJABI GYM HITS 🔥 | WORKOUT PUMP SONGS | NEW PUNJ — 75399 followers, 0 tracks
    "3X393B14lthT2jdYmC4TZA",  # Top 100 Workout Songs In The World — 74048 followers, 0 tracks
    "6r2bgOL9MUnCDGabTnGGwv",  # GYM Hindi Playlist 🦍 — 65120 followers, 0 tracks
    "5ByeCHKf2JeN2lssfsXqwD",  # Best Gym Workout English Songs💪 — 55528 followers, 0 tracks
    "5DKd4inxaYKy18YSzNInny",  # Zumba Dance Workout 2026 | Latino Fitness Beats &  — 49582 followers, 0 tracks
    "4VWF0TcCYet7z1RpgLjAaY",  # Gym Motivation Songs tamil | Power Hits for Workou — 45416 followers, 0 tracks
    "1t4sF8NCuaELKkpXoSNYKu",  # Trending Mass BGMs 2026 🔥| Goosebumps & GYM Workou — 36654 followers, 0 tracks
    "2faxw54KX2Y6XvPHkSUcWo",  # Rap & Hip Hop for gym WORKOUT MOTIVATION 🔥 beast m — 25480 followers, 0 tracks
]

HINDI_WORKOUT_PLAYLISTS = [
    "7zNvXEjgmE1110slXAuZie",  # Best Motivational Hindi songs — 259372 followers, 0 tracks
    "7bPv5uVjGF1oZ6YQAqvEvM",  # BEST WORKOUT SONGS FOR 2024 💪😎 (English & Hindi) — 73081 followers, 0 tracks
    "5aIBPqncw4027KuElibWRv",  # GYM Hindi x ENGLISH — 55930 followers, 0 tracks
    "7oVarqwTiJ75pMjsYKDCFl",  # HINDI WORKOUT SONGS — 27759 followers, 0 tracks
    "6wji2e4EATQ18zfujiuhPZ",  # BOLLYWOOD (GYM VERSION) — 26869 followers, 0 tracks
    "71kFbq1Co2aw1ujCQHdeTg",  # 💪🇮🇳INDIAN WORKOUT SONGS🏋️ — 24218 followers, 0 tracks
    "1RY4hHMzlWRqNVyGm0kW7H",  # The Best Bhangra Mix 2026! — 23717 followers, 0 tracks
    "3fe6tXjp8x87sMLffEie2Q",  # Powerful Gym Workout Motivation - Hindi x English  — 21161 followers, 0 tracks
    "3LEBr6x1S9hiNo8Ggk26JW",  # MOTIVATIONAL PUNJABI SONGS — 18210 followers, 0 tracks
    "1YJ3Wk21B7vZrSuO3jo5ij",  # GYM MOTIVATIONAL HINDI SONGS — 17035 followers, 0 tracks
    "60VTe7XgOb4EWmlhTtU9IQ",  # Punjabi Bhangra Songs 🔥 — 16287 followers, 0 tracks
    "2uoWuSk4K6YXhCEyKDNuKl",  # Punjabi Gym Songs – Workout Hits — 16248 followers, 0 tracks
]

ALL_PLAYLISTS = ENGLISH_WORKOUT_PLAYLISTS + HINDI_WORKOUT_PLAYLISTS

# ---- Spotify audio-features fallback ----
# Spotify deprecated /v1/audio-features for new apps (403 for many clients).
# The extractor tries audio-features first; on failure it falls back to
# deterministic local estimates (same hash as audiofit/src/constants/store.ts)
# so the dataset is still usable. For *real* audio features consider:
#   - Reccobeats API (https://api.reccobeats.com) as drop-in replacement
#   - Essentia / librosa local analysis (heavy, needs audio files)
USE_RECCOBEATS_FALLBACK = False  # set True to try api.reccobeats.com/v1/track/audio-features?ids=

# ---- Embedding pipeline knobs (mirrors recommender.ts but for vectors) ----
HALF_LIFE_DAYS = 30           # recency decay for profile building
GENRE_WEIGHT = 0.65           # kept for reference; vector model blends differently
ARTIST_WEIGHT = 0.35
RECENTLY_HEARD_DAYS = 14

# Numeric audio feature weights in the combined embedding
NUMERIC_FEATURE_WEIGHT = 0.4  # 0.4 numeric + 0.6 text = 1.0 before L2 norm
TEXT_FEATURE_WEIGHT = 0.6

# TF-IDF vs transformer
EMBEDDING_MODE = "tfidf"  # "tfidf" | "transformer"
# TF-IDF params
TFIDF_MAX_FEATURES = 256
TFIDF_NGRAM_RANGE = (1, 2)
# Transformer model (only if EMBEDDING_MODE == "transformer")
TRANSFORMER_MODEL = "sentence-transformers/all-MiniLM-L6-v2"  # 384-dim, fast, good for genre text

# Output paths (relative to ml/ folder)
DATASET_CSV = "data/audiofit_dataset.csv"
DATASET_JSON = "data/audiofit_dataset.json"
EMBEDDINGS_NPY = "data/embeddings.npy"
EMBEDDINGS_META = "data/embeddings_meta.json"
SCALER_JSON = "data/scaler.json"
TFIDF_MODEL = "data/tfidf_model.pkl"
