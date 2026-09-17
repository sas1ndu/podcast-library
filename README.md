# Audio Library frontend 2.0

This folder is a complete static GitHub Pages site. Upload **its contents**, including `vendor/`, to the publishing root. Do not upload `node_modules`, tests, `.env`, Cloudflare source, or the outer folder.

## What lives where

- R2: uploaded audio and transcripts the user explicitly publishes.
- IndexedDB in this browser: full local transcript bodies.
- localStorage in this browser: subjects, episode links, transcript references/status, bookmarks, progress, settings.
- URL fragment: a shared recording ID/title/server and optional published transcript ID.

This is not a cloud-synchronised public collection. “Your Library” shows the current browser's saved links. Anyone who has an unlisted audio/share link can listen, and anyone with a link containing a published transcript reference can read that transcript.

## Use

1. Choose **Add audio** to open the right-side upload panel.
2. Choose/drop MP3, M4A, WAV, or another browser-supported audio file. Local preview remains available even if the source is above the 80 MiB cloud limit.
3. Keep **Original**, or select Podcast (Opus/WebM mono ~48 kbps), Small (Opus/WebM mono ~32 kbps), or Compatibility (AAC/M4A mono ~64 kbps), then choose **Optimise**.
4. Compare measured sizes, preview/download the result, and select the actual upload candidate. The original file is never modified. If the result is larger, the UI recommends the original.
5. Upload. The outgoing file—not the source—is checked against the configured cloud limit.
6. In the player, choose **Generate transcript** only when wanted. First use downloads the English Whisper model and uses local device resources. WebGPU is tried when available; CPU/WASM is the fallback. No audio is silently sent to an AI service.
7. Search or click timestamped segments, copy, export TXT/JSON/SRT/VTT, or import JSON/SRT/VTT/TXT. Plain TXT remains untimed.
8. A generated/imported transcript is local only. **Publish with recording** creates a new immutable R2 JSON sidecar after a clear warning; it never overwrites an older sidecar.

Machine transcription can be wrong, especially for technical terms, numbers, names, and accounting-standard references. No LLM correction, speaker identity, translation, summary, or diarisation is implied.

## Downloads and device limits

- ffmpeg.wasm core: 32.2 MB, downloaded lazily only for optimisation or bounded audio decoding.
- Transformers.js browser bundle: about 0.43 MB.
- ONNX runtime: about 12.9 MB for the CPU/WASM binary or 26.1 MB for the WebGPU-capable JSEP binary.
- Pinned q4 Whisper Tiny English weights: 9.0 MB encoder + 86.7 MB merged decoder, plus tokenizer/config files (roughly 100 MB total first-use model traffic).

Browsers may cache model assets, but storage pressure or private browsing can evict them. **Clear AI download** removes the known app cache when permitted. Transcription is English-first because the configured model is English-only; Sinhala/Tamil are not routed to it. Long recordings are decoded into 29-second 16 kHz mono windows with four seconds of overlap. The compressed source is still held in the ffmpeg virtual filesystem, so the default device safeguard rejects sources above 300 MiB. Phones with limited memory may still fail or be slow.

ffmpeg.wasm single-thread mode does not require `SharedArrayBuffer`, cross-origin isolation, or special response headers. Do not treat HTML meta tags as substitutes for COOP/COEP if you later choose a multithread build.

## Public configuration

Edit `config.js`, not `app.js`. The default Worker URL and all processing settings are public. Important groups:

- `compression`: enable/default preset, pinned module/core asset URLs, presets, memory/time safeguards.
- `transcription`: worker/runtime URLs, model ID and immutable revision, English language, q4 dtype, chunk/overlap values, model cache, WebGPU preference.
- `transcriptPublishing`: enable flag, JSON size and request timeout.

Never add tokens, R2 credentials, provider keys, or secrets. The future Cloudflare Workers AI extension point is intentionally disabled/not implemented; adding it requires explicit provider code and server-side secrets, never silent fallback.

## GitHub Pages deployment

Normal route: copy every file/folder in `github/` to the repository publishing root, commit, wait for Pages, then hard refresh. Relative URLs (`./...`) work at a project path such as `/podcast-library/`.

Reproducible route from the complete source:

```sh
npm ci
npm run build:assets
PODCAST_API_BASE_URL=https://your-worker.workers.dev node optional-env/build-config.mjs github _site
```

Publish `_site/`. The optional workflow copies only static frontend files and vendor assets.

## Browser storage and backups

Version-1 local libraries migrate in place. Version-1 JSON backups still import. Version-2 backups include available local transcript bodies plus metadata/links, but never audio or model assets. Import validates recording identities before a transcript is shown. If an audio source changes incompatibly, its old transcript reference is not silently reused.

## Troubleshooting

- **Old interface:** replace all frontend files together, including `processing.js`, `compression.js`, `transcription-worker.js`, and `vendor/`; hard refresh after Pages finishes.
- **Encoder fails to load:** confirm `vendor/ffmpeg/`, `vendor/ffmpeg-core/ffmpeg-core.js`, and `.wasm` are published with JavaScript/WASM MIME types. Avoid `file://`; use HTTPS or localhost.
- **Optimisation fails:** use Original, try a smaller/correct file, or retry after closing memory-heavy tabs. Cancellation terminates the worker and the next job creates a clean engine.
- **Model download fails:** check network/content blockers and Hugging Face availability; retry or manually import a transcript. Model cache may have been evicted.
- **WebGPU fails/lost:** the app attempts CPU/WASM fallback. If a failure occurs after device loss, cancel/retry; do not enable unsafe browser flags.
- **Transcript import rejected:** ensure JSON uses schema version 1 and the correct recording identity, or use valid SRT/VTT timestamps. TXT is accepted without timestamps.
- **Publish fails:** audio and the local transcript are retained; retry publishing only. Do not upload the audio again.
- **Shared audio works but transcript does not:** deploy Worker 2.0 and verify the transcript reference belongs to the opened audio. Playback intentionally remains independent.
- **Library differs on another device:** expected; export/import a backup or open a share link.

## Security and privacy limits

The Worker upload endpoint remains anonymous and open. File-size/MIME/schema checks are resource/transport safeguards, not authentication, quotas, malware scanning, Turnstile, or rate limiting. A discovered endpoint can be abused and may incur storage/egress costs. Unlisted links are not private authentication. Do not use this deployment for confidential recordings.

See `THIRD_PARTY_NOTICES.md` for deployed licence attribution. The complete source package's `TEST_REPORT.md` records what was genuinely tested versus mocked/unverified.
