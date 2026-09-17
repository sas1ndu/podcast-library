/* Lazy single-thread ffmpeg.wasm orchestration. No SharedArrayBuffer required. */
"use strict";
(() => {
  class AudioProcessor {
    constructor(settings = {}) {
      this.settings = settings;
      this.ffmpeg = null;
      this.loaded = false;
      this.busy = false;
      this.job = 0;
      this.progressHandler = null;
    }
    resolve(path) { return new URL(path, document.baseURI).href; }
    async load(onEvent = () => {}) {
      if (this.loaded && this.ffmpeg) return;
      onEvent({ state: "loading-engine", message: "Loading the audio engine (about 32 MiB)…" });
      const module = await import(this.resolve(this.settings.moduleUrl));
      this.ffmpeg = new module.FFmpeg();
      this.ffmpeg.on("progress", event => this.progressHandler?.(Math.max(0, Math.min(1, event.progress || 0))));
      await this.ffmpeg.load({ coreURL: this.resolve(this.settings.coreUrl), wasmURL: this.resolve(this.settings.wasmUrl) });
      this.loaded = true;
      onEvent({ state: "engine-ready", message: "Audio engine ready." });
    }
    cancel() {
      this.job++;
      if (this.ffmpeg) this.ffmpeg.terminate();
      this.ffmpeg = null; this.loaded = false; this.busy = false; this.progressHandler = null;
    }
    async withInput(file, onEvent, task) {
      if (this.busy) throw new Error("Another audio processing job is already running.");
      if (!(file instanceof Blob) || !file.size) throw new Error("The audio source is empty.");
      const max = Number(this.settings.maxInputBytes) || 300 * 1024 * 1024;
      if (file.size > max) throw new Error(`This device-processing build limits source files to ${(max / 1048576).toFixed(0)} MiB to reduce memory pressure.`);
      this.busy = true; const job = ++this.job; let input = "";
      try {
        await this.load(onEvent);
        if (job !== this.job) throw new DOMException("Cancelled", "AbortError");
        input = `input-${job}.${String(file.name || "audio.bin").split(".").pop().replace(/[^a-z0-9]/gi, "") || "bin"}`;
        await this.ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));
        return await task({ ffmpeg: this.ffmpeg, input, job, assertActive: () => { if (job !== this.job) throw new DOMException("Cancelled", "AbortError"); } });
      } finally {
        if (this.ffmpeg && input) { try { await this.ffmpeg.deleteFile(input); } catch (_) { /* terminated or already removed */ } }
        if (job === this.job) { this.busy = false; this.progressHandler = null; }
      }
    }
    async optimize(file, preset, onEvent = () => {}) {
      if (!preset || preset.id === "original") throw new Error("Choose an optimisation preset first.");
      return this.withInput(file, onEvent, async ({ ffmpeg, input, job, assertActive }) => {
        const extension = preset.container === "m4a" ? "m4a" : "webm";
        const output = `output-${job}.${extension}`;
        const codec = preset.codec === "aac" ? "aac" : "libopus";
        const args = ["-i", input, "-vn", "-map_metadata", "-1", "-ac", "1", "-c:a", codec, "-b:a", `${preset.bitrateKbps}k`];
        if (codec === "libopus") args.push("-application", "audio", "-f", "webm");
        else args.push("-movflags", "+faststart");
        args.push(output);
        this.progressHandler = progress => onEvent({ state: "compressing", progress, message: `Optimising… ${Math.round(progress * 100)}%` });
        onEvent({ state: "compressing", progress: 0, message: "Optimising locally…" });
        try {
          const exit = await ffmpeg.exec(args, Number(this.settings.timeoutMs) || 3600000);
          assertActive();
          if (exit !== 0) throw new Error(`The encoder stopped with status ${exit}.`);
          const bytes = await ffmpeg.readFile(output);
          if (!bytes || !bytes.byteLength) throw new Error("The encoder produced an empty file.");
          const base = String(file.name || "recording").replace(/\.[^.]+$/, "");
          return new File([bytes], `${base}-${preset.id}.${extension}`, { type: preset.mime });
        } finally { try { await ffmpeg.deleteFile(output); } catch (_) { /* best effort */ } }
      });
    }
    async decodeChunks(file, options, onChunk, onEvent = () => {}) {
      const chunkSeconds = Math.max(10, Number(options.chunkSeconds) || 25), overlapSeconds = Math.max(0, Math.min(chunkSeconds / 3, Number(options.overlapSeconds) || 3));
      const duration = Number(options.duration);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("A valid audio duration is required for bounded transcription.");
      return this.withInput(file, onEvent, async ({ ffmpeg, input, job, assertActive }) => {
        const step = chunkSeconds - overlapSeconds, total = Math.max(1, Math.ceil(Math.max(0, duration - overlapSeconds) / step));
        for (let index = 0; index < total; index++) {
          assertActive();
          const start = index * step, length = Math.min(chunkSeconds, duration - start), output = `pcm-${job}-${index}.f32`;
          onEvent({ state: "decoding", progress: index / total, message: `Preparing audio part ${index + 1} of ${total}…` });
          try {
            const exit = await ffmpeg.exec(["-ss", String(start), "-i", input, "-t", String(length), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", output], Number(this.settings.decodeTimeoutMs) || 300000);
            assertActive();
            if (exit !== 0) throw new Error(`Audio decoding stopped with status ${exit}.`);
            const bytes = await ffmpeg.readFile(output);
            const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            await onChunk(new Float32Array(copy), { index, total, start, length });
          } finally { try { await ffmpeg.deleteFile(output); } catch (_) { /* best effort */ } }
        }
      });
    }
  }
  globalThis.AudioLibraryCompression = Object.freeze({ AudioProcessor });
})();
