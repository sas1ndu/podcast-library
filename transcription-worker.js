/* Dedicated local-ASR worker. Audio samples and model inference never leave the
 * browser; only model assets are downloaded from the configured model host. */
let transcriber = null;
let activeJob = null;
let engine = null;

function send(type, detail = {}) { postMessage({ type, ...detail }); }

async function createPipeline(config, jobId) {
  const moduleUrl = new URL(config.moduleUrl, self.location.href).href;
  const { env, pipeline } = await import(moduleUrl);
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  env.cacheKey = config.cacheKey || "transformers-cache";
  env.backends.onnx.wasm.wasmPaths = new URL(config.wasmPath, self.location.href).href;
  if (config.modelHost) env.remoteHost = config.modelHost;
  const progress_callback = data => {
    if (activeJob !== jobId) return;
    send("model-progress", { jobId, status: data.status || "loading", file: data.file || "", loaded: data.loaded || 0, total: data.total || 0, progress: Number(data.progress_total ?? data.progress) || 0 });
  };
  const common = { revision: config.modelRevision, dtype: config.dtype || "q4", progress_callback };
  if (config.preferWebGPU && self.navigator?.gpu) {
    try {
      send("engine", { jobId, state: "trying-webgpu" });
      const value = await pipeline("automatic-speech-recognition", config.modelId, { ...common, device: "webgpu" });
      engine = "webgpu"; return value;
    } catch (error) {
      send("engine", { jobId, state: "webgpu-fallback", message: error?.message || "WebGPU initialisation failed." });
    }
  }
  send("engine", { jobId, state: "loading-wasm" });
  const value = await pipeline("automatic-speech-recognition", config.modelId, { ...common, device: "wasm" });
  engine = "wasm"; return value;
}

self.onmessage = async event => {
  const message = event.data || {};
  try {
    if (message.type === "init") {
      activeJob = message.jobId;
      transcriber = await createPipeline(message.config, message.jobId);
      if (activeJob === message.jobId) send("ready", { jobId: message.jobId, engine });
      return;
    }
    if (message.type === "chunk") {
      if (message.jobId !== activeJob || !transcriber) return;
      const audio = new Float32Array(message.audio);
      // whisper-tiny.en is English-only; Transformers.js rejects explicit
      // multilingual language/task tokens for this model.
      const result = await transcriber(audio, { return_timestamps: true });
      if (message.jobId !== activeJob) return;
      const segments = Array.isArray(result.chunks) ? result.chunks.map(item => ({ start: Number.isFinite(item.timestamp?.[0]) ? item.timestamp[0] : null, end: Number.isFinite(item.timestamp?.[1]) ? item.timestamp[1] : null, text: String(item.text || "").trim() })).filter(item => item.text) : [];
      send("chunk-result", { jobId: message.jobId, chunkId: message.chunkId, text: String(result.text || "").trim(), segments });
    }
  } catch (error) {
    send("error", { jobId: message.jobId, chunkId: message.chunkId, message: error?.message || "Local transcription failed." });
  }
};
