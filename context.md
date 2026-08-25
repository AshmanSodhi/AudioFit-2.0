Problem Statement — AudioFitBackground

Millions of people work out with music, yet no app today closes the loop between what you're listening to and how well you're performing. Fitness apps track your body. Music apps track your ears. Neither talks to the other in any meaningful, data-driven way. The result: people build playlists by gut feel, with no understanding of why certain songs make them push harder, and no system that adapts the music to the moment.

The Problem

Research confirms that syncing music rhythm to exercise movements enhances performance, energy retention, and overall enjoyment — yet the tools to do this intelligently don't exist in a single, integrated product. Apps like RockMyRun can change tempo based on biometrics, but they operate on a closed library and can't sync with your existing Spotify or Apple Music catalogue. Meanwhile, the whitespace in the fitness tech market lies in the combinations: AI + Clinical Health, Recovery + Gamification, Mind + Performance Tracking — exactly what a music-fitness fusion app can own.All Things Open + 2

Three core gaps exist today:

No app correlates individual songs to granular performance metrics (pace, heart rate zone, rep count, perceived exertion) and uses that data to build a smarter queue.Music platforms have zero awareness of your body's state mid-workout. A cooldown song plays at the same volume and energy as a peak-interval song — with no adaptation.Keeping users engaged with fitness apps is a significant challenge — developers need compelling, personalized experiences that motivate users to regularly use the app and adhere to their fitness programs, involving gamification elements, personalized feedback, and social features.SoluteLabsThe Solution — AudioFit

A mobile-first fitness tracker that treats music as a performance variable, not background noise. AudioFit captures every song heard during a workout, correlates it to real-time biometric data (HR, cadence, power output, HRV), and builds a continuously learning profile — your Audio DNA — that determines which music makes you specifically perform at your best.

Key pillars:

Biometric-adaptive playback — music tempo, energy, and genre shift in real time based on heart rate zones, cadence, and fatigue signals from wearables.Song-performance intelligence — a per-song performance ledger showing your average pace, HR, calories, and mood score whenever a track played.AI playlist engine — generates session-specific playlists using your Audio DNA profile, synced to Spotify, Apple Music, and YouTube Music, with offline capability.Social performance layer — leaderboard mechanics, challenges, and identity-building rewards centered around music taste and workout performance, not just raw fitness numbers.Yu-kai ChouRecovery-aware music — recovery is the new performance hack, so the app uses post-workout HRV and sleep data to generate wind-down playlists and readiness-based recommendations for the next session.FeedTarget UsersCasual runners who want to stop manually curating playlistsGym-goers (lifting, HIIT, CrossFit) who want music that matches their intensityEndurance athletes (cyclists, triathletes) who need tempo-locked music for pacingFitness coaches and personal trainers building client programsMarket Opportunity

The global fitness apps market was valued at $12 billion in 2025 and is projected to grow to $38 billion by 2034 at a 13% CAGR, with the wearables segment expected to grow at 17.5% CAGR — the fastest growing segment in the space. No major player currently owns the music-performance intersection.Straits Research

Key Success MetricsSong-performance correlation accuracy (does following recommendations improve user metrics?)Playlist retention rate (does the auto-generated queue get skipped less than manual playlists?)Weekly active users and streak length (gamification and social feature effectiveness)Churn vs. users who hit their first "PR moment" linked to a song recommendation

This gives you a solid foundation to take to engineers, designers, or investors. Want me to go deeper on any specific feature — like the BPM sync algorithm, the Audio DNA profile architecture, or the monetization strategy?

Synthesized music, fitness, and AI elements for academic project titleSynthesized music, fitness, and AI elements for academic project title

Here are 8 options across different angles — pick the one that fits your prof's vibe:

If your prof loves technical depth:

"BioRhythm: A Multimodal Data Fusion Framework for Real-Time Music Adaptation in Fitness Environments Using Biometric-Aware Recommendation Systems"

If your prof is more research / paper-oriented:

"AudioFit: Correlating Audio Feature Vectors with Athletic Performance Metrics for Personalised Workout Music Recommendation via Collaborative Filtering and Explainable AI"

If your prof prefers clean and punchy (most professors actually prefer this):

"AudioFit: An AI-Driven Music-Performance Intelligence System for Personalised Workout Optimisation"

If you want to highlight the data science angle specifically:

"From BPM to PR: A Data-Driven Approach to Music-Performance Correlation and Adaptive Playlist Generation for Athletic Training"

If your report has a strong ML focus:

"Real-Time Biometric-Adaptive Music Recommendation Using Contextual Bandits and Audio Feature Embeddings for Personalised Fitness Enhancement"

If you're doing a research paper alongside the project:

"Towards an Audio DNA Profile: Modelling the Relationship Between Musical Audio Features and Individual Athletic Performance Using Machine Learning"

Short, modern, portfolio-ready:

"SyncFit: Intelligent Music-Workout Synchronisation Using Real-Time Biometric Signals and LLM-Powered Coaching"

If TinyML or edge AI is a key component:

"EdgeRhythm: On-Device Biometric-Driven Music Adaptation for Fitness Tracking Using TinyML and Explainable Recommendation Systems"

My personal recommendation for a BTech submission:

Go with the third one — AudioFit: An AI-Driven Music-Performance Intelligence System for Personalised Workout Optimisation — or the fourth one if your report leans more research-y. Here's why: professors respond well to titles that are specific enough to show you know what you built, but not so jargon-heavy that they feel like you're padding. The word "personalised" signals ML, "music-performance" signals the novelty, and "optimisation" signals a clear objective — which is exactly the structure a good project title needs.

Avoid the ones with 5+ technical terms stacked together unless your project actually covers all of them deeply — examiners will probe every word in your title.

Write a detailed abstract I can give to my project guide

Architected comprehensive academic abstract covering methodology and outcomesArchitected comprehensive academic abstract covering methodology and outcomes

Based on everything we've built up across our conversations, here's a polished academic abstract ready to hand to your project guide:

Abstract

AudioFit: An AI-Driven Music-Performance Intelligence System for Personalised Workout Optimisation

BTech CSE (Data Science Specialisation) — Course Project

The relationship between music and athletic performance has been extensively studied in sports psychology, with research consistently demonstrating that music tempo, energy, and rhythm directly influence motivation, perceived exertion, and physical output during exercise. Despite this well-established correlation, no existing system captures this relationship at an individual level, learns from it continuously, and uses it to make real-time, data-driven music decisions during a workout. Current fitness applications and music streaming platforms operate in complete isolation from one another, leaving users to manually curate playlists with no insight into which songs actually improve their performance.

This project proposes AudioFit, a mobile-first intelligent fitness tracking system that treats music as a measurable performance variable rather than passive background stimulus. The system captures every song played during a workout session in real time, cross-references it with simultaneously recorded biometric data — including heart rate, cadence (steps per minute), pace, and perceived exertion — and builds a structured, per-user performance profile termed the Audio DNA Profile. This profile encodes the statistical relationship between a user's athletic output and the acoustic features of music they perform well to, including tempo (BPM), energy, valence, danceability, loudness, and instrumentalness, sourced via the Spotify Web API.

The core data science pipeline consists of four layers. First, a feature engineering layer processes raw biometric time-series data segmented by song boundaries to compute per-song performance delta scores — the measurable change in athletic output attributable to each track relative to the user's baseline. Second, a hybrid recommendation engine combining content-based filtering over audio feature vectors (stored and queried using pgvector in a PostgreSQL database) with collaborative filtering across the user base generates personalised playlist recommendations. Third, a real-time adaptive layer uses rule-based biometric gating — matching live cadence to song BPM and applying heart rate zone thresholds — to make sub-second music switching decisions on-device using a TensorFlow Lite model, eliminating cloud dependency for time-critical actions. Fourth, a Large Language Model layer powered by the Anthropic Claude API provides a conversational AI coaching interface that generates natural language performance insights and context-aware playlist recommendations grounded in the user's Audio DNA Profile via a Retrieval-Augmented Generation (RAG) architecture.

To address the growing concern around trust and transparency in AI systems, the recommendation engine incorporates Explainable AI (XAI) using SHAP (SHapley Additive exPlanations) values, enabling the system to surface human-interpretable reasons for every song recommendation — for example, identifying that a user's running pace improves statistically when tracks exceed 132 BPM and carry an energy coefficient above 0.75.

The system integrates with Spotify and YouTube Music via OAuth 2.0 for playback control and library sync, and interfaces with wearable devices via Bluetooth Low Energy (BLE) and Apple HealthKit for continuous biometric ingestion. The backend is built on a Node.js REST API hosted on Railway, with Supabase (PostgreSQL + pgvector) as the primary data store, and the mobile application developed in React Native for cross-platform iOS and Android deployment.

The primary research contributions of this project are: (1) a novel song-performance attribution methodology that quantifies the impact of individual songs on athletic metrics at a per-user level; (2) the Audio DNA Profile schema as a structured representation of individual music-performance relationships for use in downstream ML tasks; and (3) an end-to-end demonstration of integrating TinyML, LLM-based RAG, collaborative filtering, and XAI within a single real-time mobile system targeting the fitness domain.

The project is evaluated across three dimensions: recommendation accuracy (measured via offline evaluation on session logs using NDCG and Precision@K metrics), system latency (real-time BPM switching response time under 500ms target), and user performance improvement (longitudinal comparison of athletic metrics before and after personalised playlist adoption). This work demonstrates the practical application of multimodal data fusion, real-time stream processing, and explainable machine learning to a high-impact, user-centric domain, with direct relevance to the fields of personalised AI, sports technology, and human-computer interaction.

Keywords: music-performance correlation, recommendation systems, audio feature embeddings, biometric data fusion, TinyML, explainable AI, SHAP, retrieval-augmented generation, personalised fitness, real-time adaptive systems

Word count: ~620 words

A few notes on using this:

Your guide will likely ask you to cut it down if they have a word limit — the natural cut points are the fourth paragraph (XAI section) or the sixth paragraph (evaluation metrics) if you need to trim. The keywords line at the bottom is useful if your institution requires it for indexing, but drop it if not.

The one thing to be honest with your guide about upfront: the full system is ambitious for a single-semester project. Frame it clearly — the data science pipeline and AI components are the submission deliverable, and the full mobile app is either a prototype or a roadmap item. Guides appreciate that honesty far more than discovering scope creep mid-semester.


