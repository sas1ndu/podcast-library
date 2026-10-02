# Changelog

## Unreleased

- Renamed the default subject to **Audiobooks | APIIT** and added a one-time migration for existing browser libraries.
- Saved public recording subject assignments in R2 so category changes are shared across visitors and devices.
- Added R2 multipart uploads for recordings above 95 MiB, allowing large audiobooks to upload in 64 MiB parts up to the app's 625 GiB part-count limit.

## 2.1.1 - 2026-09-17

- Reduced the interface to the primary upload, library, and listening path while retaining advanced processing features.
- Replaced gradients, glow, and explanatory sections with flat charcoal surfaces, compact spacing, and one violet accent.
- Corrected contrast across playlist rows, player/share controls, transcript surfaces, dialogs, filters, and mobile states.

## 2.1.0 - 2026-09-17

- Added a public, paginated `GET /library` catalogue backed directly by R2 object listing, so uploaded recordings appear across devices without a separate database.
- Added safe public title, subject, duration, filename, size, type, and upload-time metadata for new recordings; older R2 objects fall back to their stored filenames.
- Merged the public catalogue with browser-local saved metadata while keeping bookmarks, playback progress, personal subject changes, and unpublished transcripts local.
- Added explicit upload/public-discovery notices and public-library configuration/deployment tests.

## 2.0.0 - 2026-09-17

- Added opt-in ffmpeg.wasm single-thread compression presets: original, Opus/WebM 48 kbps, Opus/WebM 32 kbps, and AAC/M4A 64 kbps.
- Added measured output comparison, preview, download, candidate selection, cancellation, and new-copy optimisation for cloud recordings.
- Added opt-in local English transcription with Transformers.js and pinned Whisper Tiny English weights, WebGPU attempt, CPU/WASM fallback, model progress/cache clearing, and bounded 29-second audio windows.
- Added versioned IndexedDB transcripts, timestamp seeking/highlighting, search, copy, TXT/JSON/SRT/VTT export, and JSON/SRT/VTT/TXT import.
- Added immutable R2 transcript sidecars and backward-compatible `transcript=` share-fragment references.
- Added explicit v1-to-v2 library migration and v2 backups containing locally stored transcript bodies.
- Restyled the app as a dark, responsive streaming library with upload and processing in an off-canvas utility panel.
- Extended optional Pages builds to include new modules and pinned runtime assets.
- Preserved raw-body audio uploads and all existing audio range/ETag/HEAD semantics.

## 1.0.0

- Merged local preview/player, R2 uploads, share links, browser-local subjects/library, bookmarks, progress, settings, and backups.
