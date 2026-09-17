/* Audio Library processing primitives. Browser-global by design so the static
 * site does not require a bundler. Transcript bodies live in IndexedDB. */
"use strict";
(() => {
  const DB_NAME = "audio-library-transcripts";
  const STORE = "transcripts";
  const MAX_IMPORT_BYTES = 12 * 1024 * 1024;

  function finiteTime(value) {
    return Number.isFinite(value) && value >= 0 ? Number(value) : null;
  }
  function cleanText(value, max = 2_000_000) {
    return String(value == null ? "" : value).replace(/\u0000/g, "").slice(0, max);
  }
  function transcriptIdentity(recording) {
    if (!recording || typeof recording !== "object") throw new Error("A recording identity is required.");
    if (recording.kind === "cloud" && recording.id && recording.apiBaseUrl) return `cloud:${recording.apiBaseUrl}:${recording.id}`;
    if (recording.kind === "local" && recording.name && Number.isFinite(recording.size)) return `local:${recording.name}:${recording.size}:${recording.lastModified || 0}`;
    throw new Error("The recording identity is incomplete.");
  }
  function normalizeSegments(items, duration = null) {
    if (!Array.isArray(items)) return [];
    let previous = -1;
    const result = [];
    for (const item of items.slice(0, 50_000)) {
      if (!item || typeof item !== "object") continue;
      const text = cleanText(item.text, 20_000).trim();
      if (!text) continue;
      let start = finiteTime(item.start), end = finiteTime(item.end);
      if (start === null || end === null) { start = null; end = null; }
      else {
        if (end < start) throw new Error("A transcript segment ends before it starts.");
        if (duration !== null && start > duration + 2) throw new Error("A transcript segment starts after the recording ends.");
        start = Math.max(previous, start); end = Math.max(start, end);
        if (duration !== null) { start = Math.min(start, duration); end = Math.min(end, duration); }
        previous = start;
      }
      result.push({ start, end, text });
    }
    return result;
  }
  function normalizeTranscript(input, expected = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid transcript data.");
    if (input.schemaVersion !== 1) throw new Error("Only transcript schema version 1 is supported.");
    const duration = finiteTime(input.duration ?? expected.duration);
    const recordingIdentity = cleanText(input.recordingIdentity || expected.recordingIdentity, 800);
    if (!recordingIdentity) throw new Error("Transcript recording identity is missing.");
    if (expected.recordingIdentity && recordingIdentity !== expected.recordingIdentity) throw new Error("This transcript belongs to a different recording.");
    const segments = normalizeSegments(input.segments, duration);
    const text = cleanText(input.text || segments.map(segment => segment.text).join(" ")).trim();
    if (!text) throw new Error("The transcript has no text.");
    return {
      schemaVersion: 1,
      recordingIdentity,
      sourceIdentity: cleanText(input.sourceIdentity || recordingIdentity, 800),
      language: cleanText(input.language || "en", 30),
      engine: cleanText(input.engine || "import", 100),
      model: cleanText(input.model || "manual", 300),
      modelRevision: cleanText(input.modelRevision || "", 100),
      generatedAt: Number.isFinite(Date.parse(input.generatedAt)) ? new Date(input.generatedAt).toISOString() : new Date().toISOString(),
      duration,
      text,
      segments
    };
  }
  function parseClock(value) {
    const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{3})$/.exec(String(value).trim());
    if (!match) return null;
    return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  }
  function parseTimedText(source, format) {
    const blocks = cleanText(source).replace(/^\uFEFF/, "").replace(/\r/g, "").split(/\n{2,}/);
    const segments = [];
    for (const block of blocks) {
      const lines = block.split("\n").filter(Boolean);
      if (!lines.length || (format === "vtt" && lines[0].startsWith("WEBVTT"))) continue;
      const timingIndex = lines.findIndex(line => line.includes("-->"));
      if (timingIndex < 0) continue;
      const [left, rightRaw] = lines[timingIndex].split("-->");
      const right = rightRaw.trim().split(/\s+/)[0];
      const start = parseClock(left), end = parseClock(right);
      const text = lines.slice(timingIndex + 1).join("\n").replace(/<[^>]*>/g, "").trim();
      if (start !== null && end !== null && text) segments.push({ start, end, text });
    }
    if (!segments.length) throw new Error(`No valid ${format.toUpperCase()} cues were found.`);
    return segments;
  }
  async function importTranscriptFile(file, expected) {
    if (!(file instanceof Blob) || !file.size) throw new Error("Choose a non-empty transcript file.");
    if (file.size > MAX_IMPORT_BYTES) throw new Error("Transcript imports are limited to 12 MiB.");
    const name = String(file.name || "").toLowerCase(), raw = await file.text();
    if (name.endsWith(".json") || file.type === "application/json") return normalizeTranscript(JSON.parse(raw), expected);
    const segments = name.endsWith(".srt") ? parseTimedText(raw, "srt") : name.endsWith(".vtt") ? parseTimedText(raw, "vtt") : [{ start: null, end: null, text: raw.trim() }];
    return normalizeTranscript({ schemaVersion: 1, recordingIdentity: expected.recordingIdentity, sourceIdentity: expected.recordingIdentity, language: "und", engine: "manual-import", model: "manual", generatedAt: new Date().toISOString(), duration: expected.duration, text: segments.map(item => item.text).join(" "), segments }, expected);
  }
  function cueTime(value, vtt = false) {
    const ms = Math.max(0, Math.round(Number(value) * 1000));
    const hours = Math.floor(ms / 3600000), minutes = Math.floor(ms % 3600000 / 60000), seconds = Math.floor(ms % 60000 / 1000), millis = ms % 1000;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${vtt ? "." : ","}${String(millis).padStart(3, "0")}`;
  }
  function exportTranscript(transcript, format) {
    const value = normalizeTranscript(transcript);
    if (format === "json") return { type: "application/json", extension: "json", body: JSON.stringify(value, null, 2) };
    if (format === "txt") return { type: "text/plain", extension: "txt", body: value.text + "\n" };
    const timed = value.segments.filter(item => item.start !== null && item.end !== null);
    if (!timed.length) throw new Error("This transcript has no timestamps to export in that format.");
    if (format === "srt") return { type: "application/x-subrip", extension: "srt", body: timed.map((item, index) => `${index + 1}\n${cueTime(item.start)} --> ${cueTime(item.end)}\n${item.text}`).join("\n\n") + "\n" };
    if (format === "vtt") return { type: "text/vtt", extension: "vtt", body: "WEBVTT\n\n" + timed.map(item => `${cueTime(item.start, true)} --> ${cueTime(item.end, true)}\n${item.text}`).join("\n\n") + "\n" };
    throw new Error("Unsupported transcript export format.");
  }
  function reconcileSegments(existing, incoming, offset, duration) {
    const result = Array.isArray(existing) ? existing.slice() : [];
    let lastEnd = result.length ? (result[result.length - 1].end ?? result[result.length - 1].start ?? 0) : 0;
    for (const item of normalizeSegments(incoming)) {
      if (item.start === null) continue;
      const segment = { start: item.start + offset, end: item.end + offset, text: item.text.trim() };
      if (duration) segment.end = Math.min(segment.end, duration);
      const normalized = segment.text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const duplicate = result.slice(-3).some(previous => previous.text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === normalized && Math.abs((previous.start || 0) - segment.start) < 8);
      if (duplicate || segment.end <= lastEnd - 0.25) continue;
      if (segment.start < lastEnd) segment.start = lastEnd;
      if (segment.end < segment.start) segment.end = segment.start;
      result.push(segment); lastEnd = segment.end;
    }
    return result;
  }
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error("IndexedDB is unavailable in this browser.")); return; }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open transcript storage."));
    });
  }
  async function transaction(mode, action) {
    const db = await openDB();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode), store = tx.objectStore(STORE), request = action(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Transcript storage failed."));
        tx.onabort = () => reject(tx.error || new Error("Transcript storage was interrupted."));
      });
    } finally { db.close(); }
  }
  const transcriptStore = {
    get: id => transaction("readonly", store => store.get(id)),
    put: async (transcript, id = crypto.randomUUID()) => { const value = normalizeTranscript(transcript); await transaction("readwrite", store => store.put({ id, transcript: value, updatedAt: Date.now() })); return id; },
    delete: id => transaction("readwrite", store => store.delete(id)),
    clear: () => transaction("readwrite", store => store.clear())
  };
  async function clearModelCache(cacheKey = "transformers-cache") {
    if (!globalThis.caches) return false;
    const names = await caches.keys(); let cleared = false;
    for (const name of names) if (name === cacheKey || name.startsWith(`${cacheKey}-`)) cleared = (await caches.delete(name)) || cleared;
    return cleared;
  }

  globalThis.AudioLibraryProcessing = Object.freeze({ transcriptIdentity, normalizeTranscript, normalizeSegments, parseTimedText, importTranscriptFile, exportTranscript, reconcileSegments, transcriptStore, clearModelCache });
})();
