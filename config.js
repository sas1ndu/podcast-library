/* PUBLIC site configuration. Loaded before app.js. No build step required.
 * This is not a secret store: visitors can read every value in this file.
 * Do not add Cloudflare API tokens, R2 access keys, or AI provider secrets.
 */
window.PODCAST_CONFIG = Object.freeze({
  appName: "Audio Library",
  apiBaseUrl: "https://podcast-api.pradeepsasindu2001.workers.dev",
  maxUploadBytes: 80 * 1024 * 1024,
  uploadTimeoutMs: 20 * 60 * 1000,
  compression: {
    enabled: true,
    defaultPreset: "original",
    encoder: "ffmpeg.wasm",
    encoderVersion: "0.12.15",
    coreVersion: "0.12.10",
    moduleUrl: "./vendor/ffmpeg/index.js",
    coreUrl: "./vendor/ffmpeg-core/ffmpeg-core.js",
    wasmUrl: "./vendor/ffmpeg-core/ffmpeg-core.wasm",
    maxInputBytes: 300 * 1024 * 1024,
    maxDurationSeconds: 6 * 60 * 60,
    timeoutMs: 60 * 60 * 1000,
    decodeTimeoutMs: 5 * 60 * 1000,
    presets: [
      { id: "original", label: "Original", description: "No conversion", codec: "source", container: "source", mime: "", bitrateKbps: null },
      { id: "podcast", label: "Podcast", description: "Opus mono · about 48 kbps", codec: "opus", container: "webm", mime: "audio/webm;codecs=opus", bitrateKbps: 48 },
      { id: "small", label: "Small", description: "Opus mono · about 32 kbps", codec: "opus", container: "webm", mime: "audio/webm;codecs=opus", bitrateKbps: 32 },
      { id: "compatibility", label: "Compatibility", description: "AAC mono · about 64 kbps", codec: "aac", container: "m4a", mime: "audio/mp4", bitrateKbps: 64 }
    ]
  },
  transcription: {
    enabled: true,
    engine: "transformers.js",
    libraryVersion: "4.3.0",
    workerUrl: "./transcription-worker.js",
    moduleUrl: "./vendor/transformers/transformers.min.js",
    wasmPath: "./vendor/transformers/",
    cacheKey: "transformers-cache",
    modelHost: "https://huggingface.co/",
    modelId: "onnx-community/whisper-tiny.en",
    modelRevision: "2575352d61be1bf7225cf8f8b268a4678025fc58",
    dtype: "q4",
    language: "en",
    preferWebGPU: true,
    chunkSeconds: 29,
    overlapSeconds: 4,
    maxSourceBytes: 300 * 1024 * 1024,
    maxDurationSeconds: 6 * 60 * 60,
    downloadTimeoutMs: 20 * 60 * 1000
  },
  transcriptPublishing: { enabled: true, maxBytes: 8 * 1024 * 1024, timeoutMs: 60 * 1000 },
  defaultSubjects: [
    { id: "accounting", name: "Accounting", color: "#5e4ce6" },
    { id: "tax", name: "Tax", color: "#bd4e6d" },
    { id: "risk", name: "Risk", color: "#ad741c" },
    { id: "it", name: "IT", color: "#278166" }
  ]
});
