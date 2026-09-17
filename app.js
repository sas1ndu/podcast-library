/* Audio Library 1.0.0. No packages or build step. Public settings: config.js.
 * Audio lives in R2 after upload. The shelf and preferences are browser-local.
 * The browser never receives Cloudflare credentials.
 */
"use strict";
(() => {
  const config = window.PODCAST_CONFIG || {};
  const ids = ["audioFile", "fileLabel", "dropZone", "chosenFile", "podcastTitle", "podcastSubject", "uploadButton", "cancelUpload", "uploadStatus", "uploadProgress", "progressContainer", "fileError", "audioPlayer", "playerSection", "emptyState", "audioTitle", "fileType", "fileSize", "audioDuration", "backButton", "forwardButton", "speed", "clearButton", "playerState", "playbackError", "storageNotice", "appStatus", "rememberPosition", "resumeNotice", "resumeTime", "resumeButton", "restartButton", "trackSource", "saveNote", "shareSection", "shareLink", "copyButton", "directAudioLink", "saveSharedButton", "shareHint", "settingsButton", "settingsDialog", "settingsForm", "apiBaseInput", "settingsError", "testConnection", "resetConnection", "connectionResult", "connectionBadge", "connectionLabel", "uploadLimitHint", "subjectFilters", "librarySearch", "librarySort", "episodeList", "libraryEmpty", "libraryCount", "newSubjectButton", "newSubjectUpload", "subjectDialog", "subjectDialogTitle", "subjectForm", "subjectName", "subjectColor", "subjectError", "deleteSubject", "manageSubjects", "manageDialog", "manageSubjectList", "addLinkButton", "linkDialog", "linkForm", "existingAudioUrl", "existingAudioTitle", "existingAudioSubject", "linkError", "exportLibrary", "importLibraryButton", "importLibraryFile", "addBookmark", "bookmarkList", "sleepTimer", "sleepStatus", "toast", "globalError"];
  const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const missing = ids.filter(id => !ui[id]);
  if (missing.length) {
    console.error("Audio Library: mismatched HTML/JS files. Missing:", missing);
    document.body.append(document.createTextNode("These files are from different versions. Replace index.html, style.css, app.js, and config.js together."));
    return;
  }
  const STORAGE_KEY = "audio-library:cloud:v1";
  const CONNECTION_KEY = "audio-library:connection:v1";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const MIME_BY_EXT = { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", wav: "audio/wav", wave: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", webm: "audio/webm", flac: "audio/flac" };
  const appName = String(config.appName || "Audio Library").slice(0, 80);
  const maxBytes = Number.isSafeInteger(config.maxUploadBytes) && config.maxUploadBytes > 0 ? config.maxUploadBytes : 80 * 1024 * 1024;
  const timeoutMs = Number.isSafeInteger(config.uploadTimeoutMs) && config.uploadTimeoutMs > 0 ? config.uploadTimeoutMs : 1200000;
  let storageAvailable = true;
  let current = null;
  let draftFile = null;
  let uploadXHR = null;
  let uploadedDraft = null;
  let objectURL = null;
  let metadataReady = false;
  let resumePending = null;
  let loadOptions = null;
  let lastSaveAt = 0;
  let dragDepth = 0;
  let subjectFilter = "all";
  let editingSubjectId = null;
  let toastTimer = null;
  let sleepDeadline = 0;
  let sleepInterval = null;
  let apiOverride;
  let siteAPI = "";
  try { siteAPI = normalizeBase(config.apiBaseUrl || ""); }
  catch (_) { showError(ui.globalError, "The API address in config.js is invalid. Local playback still works. Correct it in Settings or config.js."); }
  try {
    const raw = localStorage.getItem(CONNECTION_KEY);
    if (raw !== null) apiOverride = normalizeBase(JSON.parse(raw));
  } catch (_) { /* Ignore an invalid/stale connection override. */ }
  let apiBase = apiOverride !== undefined ? apiOverride : siteAPI;
  let saved = loadState();

  function show(element, visible = true) { element.classList.toggle("hidden", !visible); }
  function text(tag, value, className) {
    const element = document.createElement(tag);
    if (value !== undefined) element.textContent = String(value);
    if (className) element.className = className;
    return element;
  }
  function button(label, className, handler) {
    const element = text("button", label, className);
    element.type = "button";
    element.addEventListener("click", handler);
    return element;
  }
  function notify(message) {
    ui.appStatus.textContent = message;
    ui.toast.textContent = message;
    show(ui.toast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => show(ui.toast, false), 4200);
  }
  function showError(element, message) { element.textContent = message; show(element, Boolean(message)); }
  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function normalizeBase(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const url = new URL(raw);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("Use an HTTPS Worker address (HTTP is allowed only for localhost).");
    if (url.username || url.password || url.search || url.hash) throw new Error("Use a base URL without passwords, query parameters, or a fragment.");
    if (url.pathname !== "/" && url.pathname !== "") throw new Error("Use only the Worker base address; remove paths such as /health, /upload, or /audio.");
    return url.origin;
  }
  function parseAudioURL(raw) {
    const url = new URL(String(raw).trim());
    if (url.username || url.password || url.search || url.hash) throw new Error("Use the direct /audio/ID URL without query parameters.");
    const base = normalizeBase(url.origin);
    const id = url.pathname.startsWith("/audio/") ? url.pathname.slice(7) : "";
    if (!UUID.test(id)) throw new Error("This is not a Worker audio link. It must end in /audio/ followed by its recording ID.");
    return { id: id.toLowerCase(), apiBaseUrl: base, audioUrl: `${base}/audio/${id.toLowerCase()}` };
  }
  function keyOf(entry) { return `cloud:${entry.apiBaseUrl}:${entry.id}`; }
  function extension(name) { return String(name).includes(".") ? String(name).split(".").pop().toLowerCase() : ""; }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
    const whole = Math.floor(seconds), hours = Math.floor(whole / 3600), minutes = Math.floor(whole % 3600 / 60), rest = String(whole % 60).padStart(2, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
  }
  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "Size unavailable";
    if (bytes < 1024) return `${bytes} B`;
    return bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1048576).toFixed(1)} MiB`;
  }
  function cleanTitle(value, fallback = "Untitled recording") { return String(value || "").trim().slice(0, 180) || fallback; }
  function disableStorage() {
    storageAvailable = false;
    ui.storageNotice.textContent = "Browser storage is unavailable or full. Listening still works, but this library may be lost on refresh. Export your library now; keep the downloaded backup.";
    show(ui.storageNotice);
  }
  function validSubject(subject) {
    return subject && typeof subject.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(subject.id) && !["all", "unsorted", "__proto__", "constructor"].includes(subject.id) && typeof subject.name === "string" && subject.name.trim() && /^#[0-9a-f]{6}$/i.test(subject.color || "");
  }
  function defaults() {
    return { version: 1, subjects: (Array.isArray(config.defaultSubjects) ? config.defaultSubjects : []).filter(validSubject).map(s => ({ id: s.id, name: s.name.trim().slice(0, 60), color: s.color })), episodes: [], speed: 1, remember: true, positions: Object.create(null), bookmarks: Object.create(null) };
  }
  function normalizeEpisode(entry) {
    if (!entry || typeof entry !== "object") throw new Error("Invalid recording.");
    const parsed = parseAudioURL(entry.audioUrl || `${entry.apiBaseUrl}/audio/${entry.id}`);
    return { ...parsed, title: cleanTitle(entry.title), fileName: String(entry.fileName || "").slice(0, 250), subjectId: typeof entry.subjectId === "string" ? entry.subjectId : "", size: Number.isFinite(entry.size) && entry.size >= 0 ? entry.size : null, duration: Number.isFinite(entry.duration) && entry.duration > 0 ? entry.duration : null, createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(), type: typeof entry.type === "string" && entry.type.startsWith("audio/") ? entry.type : "" };
  }
  function normalizeState(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid library data.");
    const state = defaults();
    if (Array.isArray(data.subjects)) state.subjects = Array.from(new Map(data.subjects.filter(validSubject).slice(0, 500).map(s => [s.id, { id: s.id, name: s.name.trim().slice(0, 60), color: s.color }])).values());
    const episodes = new Map();
    for (const item of (Array.isArray(data.episodes) ? data.episodes : []).slice(0, 5000)) {
      try { const entry = normalizeEpisode(item); if (!state.subjects.some(s => s.id === entry.subjectId)) entry.subjectId = ""; episodes.set(keyOf(entry), entry); }
      catch (_) { /* Ignore invalid entries; never insert imported HTML. */ }
    }
    state.episodes = Array.from(episodes.values());
    state.speed = SPEEDS.includes(data.speed) ? data.speed : 1;
    state.remember = typeof data.remember === "boolean" ? data.remember : true;
    if (data.positions && typeof data.positions === "object" && !Array.isArray(data.positions)) {
      for (const [key, item] of Object.entries(data.positions).slice(0, 5000)) {
        if (item && Number.isFinite(item.time) && item.time >= 0 && Number.isFinite(item.updatedAt)) state.positions[key] = { time: item.time, updatedAt: item.updatedAt };
      }
    }
    if (data.bookmarks && typeof data.bookmarks === "object" && !Array.isArray(data.bookmarks)) {
      for (const [key, list] of Object.entries(data.bookmarks).slice(0, 5000)) {
        if (Array.isArray(list)) state.bookmarks[key] = list.filter(b => b && Number.isFinite(b.time) && b.time >= 0).slice(0, 500).map(b => ({ id: uid(), time: b.time, label: cleanTitle(b.label, "Bookmark") }));
      }
    }
    return state;
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalizeState(JSON.parse(raw));
      // Preserve the original starter's speed, checkbox and local-file progress.
      const old = localStorage.getItem("audio-library:v1");
      return old ? normalizeState(JSON.parse(old)) : defaults();
    } catch (error) {
      if (!(error instanceof SyntaxError)) disableStorage();
      else showError(ui.globalError, "Saved browser data was damaged. The page opened with an empty library; import a backup to restore it.");
      return defaults();
    }
  }
  function persist() {
    if (!storageAvailable) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); }
    catch (_) { disableStorage(); }
  }
  function persistPosition(force = false) {
    if (!current || !metadataReady || !saved.remember || resumePending !== null) return;
    const time = ui.audioPlayer.currentTime, duration = ui.audioPlayer.duration;
    if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return;
    const now = Date.now();
    if (!force && now - lastSaveAt < 5000) return;
    lastSaveAt = now;
    if (ui.audioPlayer.ended || time < 1 || duration - time <= 1) delete saved.positions[current.key];
    else saved.positions[current.key] = { time: Math.floor(time), updatedAt: now };
    persist();
  }
  function subjectById(id) { return saved.subjects.find(s => s.id === id) || { id: "", name: "Unsorted", color: "#85899a" }; }
  function setState(label, playing = false) { ui.playerState.textContent = label; ui.playerState.classList.toggle("is-playing", playing); }
  function enableSeek(ready) { ui.backButton.disabled = !ready; ui.forwardButton.disabled = !ready; ui.addBookmark.disabled = !ready; }
  function restoreSpeed() { ui.audioPlayer.defaultPlaybackRate = saved.speed; ui.audioPlayer.playbackRate = saved.speed; }
  function releaseAudio() {
    metadataReady = false; current = null; resumePending = null; loadOptions = null;
    ui.audioPlayer.pause(); ui.audioPlayer.removeAttribute("src"); ui.audioPlayer.load();
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null; enableSeek(false);
    if ("mediaSession" in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = "none"; }
  }
  function openTrack(track, options = {}) {
    persistPosition(true); releaseAudio(); current = track; loadOptions = options;
    ui.audioTitle.textContent = track.title;
    ui.trackSource.textContent = track.kind === "cloud" ? "FROM YOUR CLOUD" : "ON YOUR DEVICE";
    ui.fileType.textContent = extension(track.fileName) ? extension(track.fileName).toUpperCase() : "AUDIO";
    ui.fileSize.textContent = formatSize(track.size);
    ui.audioDuration.textContent = "Reading duration...";
    ui.saveNote.textContent = track.kind === "cloud" ? "Resume from this browser's saved library. Your playback position is not shared with other listeners." : "For local audio, select the same file next time. The original file is not stored by this page.";
    showError(ui.playbackError, ""); show(ui.resumeNotice, false); show(ui.emptyState, false); show(ui.playerSection);
    setState("Loading..."); renderBookmarks(); renderShare(); renderLibrary();
    try {
      if (track.kind === "local") { objectURL = URL.createObjectURL(track.file); ui.audioPlayer.src = objectURL; }
      else ui.audioPlayer.src = track.entry.audioUrl;
      ui.audioPlayer.load();
    } catch (_) { showError(ui.playbackError, "This recording could not be opened. Try choosing it again."); setState("Cannot open"); }
  }
  function openCloud(entry, options) { openTrack({ kind: "cloud", key: keyOf(entry), title: entry.title, fileName: entry.fileName, size: entry.size, entry }, options); }
  function chooseFile(file) {
    if (uploadXHR) { notify("Finish or cancel the current upload before choosing another file."); return; }
    if (!(file instanceof File)) return;
    showError(ui.fileError, "");
    if (!file.size) { showError(ui.fileError, "This file is empty. Choose an audio recording with content."); return; }
    const ext = extension(file.name);
    if (!file.type.startsWith("audio/") && !MIME_BY_EXT[ext]) { showError(ui.fileError, "Choose an audio file, such as MP3, M4A, or WAV."); return; }
    draftFile = file; uploadedDraft = null;
    ui.chosenFile.textContent = `${file.name} / ${formatSize(file.size)}`;
    ui.fileLabel.textContent = "Choose another file";
    ui.podcastTitle.value = cleanTitle(file.name.replace(/\.[^.]+$/, "").replace(/_/g, " "));
    ui.uploadStatus.classList.remove("is-success");
    ui.uploadStatus.textContent = file.size > maxBytes ? `Local preview is ready. This file exceeds the cloud limit of ${formatSize(maxBytes)}; use a smaller recording to upload.` : "Local preview is ready. Click Upload to cloud to store and share it.";
    show(ui.progressContainer, false); ui.uploadProgress.value = 0;
    updateUploadButton();
    openTrack({ kind: "local", key: JSON.stringify([file.name, file.size, file.lastModified]), title: ui.podcastTitle.value, fileName: file.name, size: file.size, file });
  }
  function updateDuration() {
    if (!current) return;
    const duration = ui.audioPlayer.duration;
    const valid = Number.isFinite(duration) && duration > 0;
    ui.audioDuration.textContent = valid ? `${formatTime(duration)} duration` : "Duration unavailable";
    enableSeek(valid && !ui.audioPlayer.error);
    if (valid && current.kind === "cloud") {
      current.entry.duration = duration;
      const entry = saved.episodes.find(e => keyOf(e) === current.key);
      if (entry && entry.duration !== duration) { entry.duration = duration; persist(); }
    }
  }
  function seekTo(seconds) {
    if (!current || !metadataReady || !Number.isFinite(ui.audioPlayer.duration) || !Number.isFinite(seconds)) return;
    try { ui.audioPlayer.currentTime = Math.max(0, Math.min(ui.audioPlayer.duration, seconds)); resumePending = null; show(ui.resumeNotice, false); persistPosition(true); }
    catch (_) { notify("The recording is not ready to seek yet."); }
  }
  async function playSafely() {
    if (!current || ui.audioPlayer.error) return;
    try { await ui.audioPlayer.play(); showError(ui.playbackError, ""); }
    catch (error) { if (error.name !== "AbortError") showError(ui.playbackError, "Playback did not start. Press Play, or check this recording's browser codec support."); }
  }
  ui.audioPlayer.addEventListener("loadedmetadata", () => {
    if (!current) return;
    metadataReady = true; updateDuration(); restoreSpeed(); setState("Ready to play");
    const options = loadOptions || {}; loadOptions = null;
    if (Number.isFinite(options.position) && options.position >= 0) seekTo(options.position);
    else {
      const position = saved.positions[current.key];
      if (saved.remember && position && position.time > 0 && position.time < ui.audioPlayer.duration - 1) {
        resumePending = position.time; ui.resumeTime.textContent = formatTime(position.time); show(ui.resumeNotice);
      }
    }
    updateMediaSession();
    if (options.autoplay) playSafely();
  });
  ui.audioPlayer.addEventListener("durationchange", updateDuration);
  ui.audioPlayer.addEventListener("timeupdate", () => persistPosition());
  ui.audioPlayer.addEventListener("play", () => {
    if (!current) return;
    if (resumePending !== null) { resumePending = null; show(ui.resumeNotice, false); }
    setState("Playing", true);
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  });
  ui.audioPlayer.addEventListener("pause", () => {
    if (!current || !metadataReady || !ui.audioPlayer.paused) return;
    if (!ui.audioPlayer.ended) setState("Paused");
    persistPosition(true);
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  });
  ui.audioPlayer.addEventListener("ended", () => {
    if (!current) return;
    setState("Finished"); delete saved.positions[current.key]; persist();
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  });
  ui.audioPlayer.addEventListener("seeked", () => { resumePending = null; show(ui.resumeNotice, false); persistPosition(true); });
  ui.audioPlayer.addEventListener("error", () => {
    if (!current || !ui.audioPlayer.error) return;
    metadataReady = false; enableSeek(false); show(ui.resumeNotice, false); setState("Cannot play");
    showError(ui.playbackError, current.kind === "cloud" ? "The cloud recording could not be played. Check the Worker URL, whether the audio still exists, and your browser's codec support. Try the direct audio link below." : "This file could not be played. It may use an unsupported codec or be damaged. Try MP3, WAV, or a different browser.");
  });
  ui.backButton.addEventListener("click", () => seekTo(ui.audioPlayer.currentTime - 15));
  ui.forwardButton.addEventListener("click", () => seekTo(ui.audioPlayer.currentTime + 15));
  ui.speed.addEventListener("change", () => { const rate = Number(ui.speed.value); if (SPEEDS.includes(rate)) { saved.speed = rate; restoreSpeed(); persist(); } });
  ui.rememberPosition.addEventListener("change", () => {
    saved.remember = ui.rememberPosition.checked;
    if (!saved.remember) { saved.positions = Object.create(null); resumePending = null; show(ui.resumeNotice, false); }
    persist();
  });
  ui.resumeButton.addEventListener("click", () => { if (resumePending !== null) { const time = resumePending; seekTo(time); playSafely(); } });
  ui.restartButton.addEventListener("click", () => { if (!current) return; delete saved.positions[current.key]; seekTo(0); persist(); });
  ui.clearButton.addEventListener("click", () => {
    persistPosition(true); releaseAudio(); show(ui.playerSection, false); show(ui.emptyState); setSleep(0); renderLibrary(); clearListenHash();
  });
  ui.podcastTitle.addEventListener("input", () => {
    if (current && current.kind === "local" && current.file === draftFile) { current.title = cleanTitle(ui.podcastTitle.value, draftFile.name); ui.audioTitle.textContent = current.title; updateMediaSession(); }
  });
  ui.audioFile.addEventListener("change", () => { const file = ui.audioFile.files[0]; if (file) chooseFile(file); ui.audioFile.value = ""; });
  ui.dropZone.addEventListener("dragenter", event => { event.preventDefault(); dragDepth++; if (!uploadXHR) ui.dropZone.classList.add("drag-over"); });
  ui.dropZone.addEventListener("dragover", event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = uploadXHR ? "none" : "copy"; });
  ui.dropZone.addEventListener("dragleave", event => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) ui.dropZone.classList.remove("drag-over"); });
  ui.dropZone.addEventListener("drop", event => {
    event.preventDefault(); dragDepth = 0; ui.dropZone.classList.remove("drag-over");
    const files = event.dataTransfer && event.dataTransfer.files;
    if (!files || !files.length) return;
    if (files.length !== 1) { showError(ui.fileError, "Choose one recording at a time."); return; }
    chooseFile(files[0]);
  });
  for (const name of ["dragover", "drop"]) window.addEventListener(name, event => { if (event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault(); });

  function updateUploadButton() {
    ui.uploadButton.disabled = Boolean(uploadXHR) || !draftFile || draftFile.size > maxBytes || !apiBase || Boolean(uploadedDraft);
    ui.uploadButton.textContent = uploadedDraft ? "Uploaded to cloud" : "Upload to cloud";
  }
  function setUploading(active) {
    for (const input of [ui.audioFile, ui.podcastTitle, ui.podcastSubject, ui.settingsButton, ui.newSubjectUpload]) input.disabled = active;
    ui.dropZone.classList.toggle("is-disabled", active); show(ui.cancelUpload, active); updateUploadButton();
  }
  function uploadFailure(message) { ui.uploadStatus.classList.remove("is-success"); ui.uploadStatus.textContent = message; }
  function upload() {
    if (uploadXHR || !draftFile || uploadedDraft) return;
    if (!apiBase) { openSettings(); return; }
    if (draftFile.size > maxBytes) { showError(ui.fileError, `Cloud uploads are limited to ${formatSize(maxBytes)} in this configuration.`); return; }
    const file = draftFile, base = apiBase, title = cleanTitle(ui.podcastTitle.value, file.name), subjectId = ui.podcastSubject.value;
    const mime = MIME_BY_EXT[extension(file.name)] || (file.type.startsWith("audio/") ? file.type : "");
    if (!mime) { showError(ui.fileError, "This audio format could not be identified. Try MP3 or M4A."); return; }
    const xhr = new XMLHttpRequest(); uploadXHR = xhr; setUploading(true);
    showError(ui.fileError, ""); show(ui.progressContainer); ui.uploadProgress.value = 0;
    ui.uploadStatus.classList.remove("is-success"); ui.uploadStatus.textContent = "Starting upload...";
    xhr.open("POST", `${base}/upload`); xhr.timeout = timeoutMs;
    xhr.setRequestHeader("Content-Type", mime);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name.slice(0, 200)));
    xhr.upload.addEventListener("progress", event => {
      if (!event.lengthComputable) return;
      const percent = Math.round(event.loaded / event.total * 100);
      ui.uploadProgress.value = percent;
      ui.uploadStatus.textContent = percent < 100 ? `Uploading ${percent}%...` : "Audio sent. Waiting for cloud storage confirmation...";
    });
    xhr.onload = () => {
      let result;
      try { result = JSON.parse(xhr.responseText); } catch (_) { result = null; }
      if (xhr.status < 200 || xhr.status >= 300) {
        uploadFailure(result && result.error ? `${result.error} (HTTP ${xhr.status})` : `Upload failed (HTTP ${xhr.status}). ${xhr.status === 413 ? "The server rejected the file size." : "Check your Worker deployment and try again."}`);
        return;
      }
      if (!result || result.ok !== true || !UUID.test(result.id || "") || !result.audioUrl) { uploadFailure("The server did not return a valid upload result. The file may exist in R2; check before retrying."); return; }
      try {
        const link = parseAudioURL(result.audioUrl);
        if (link.apiBaseUrl !== base || link.id !== result.id.toLowerCase()) throw new Error("Unexpected audio address from server.");
        const entry = normalizeEpisode({ ...link, title, fileName: file.name, size: file.size, subjectId, type: mime, createdAt: Date.now() });
        const oldKey = JSON.stringify([file.name, file.size, file.lastModified]);
        if (saved.positions[oldKey]) saved.positions[keyOf(entry)] = { ...saved.positions[oldKey] };
        if (saved.bookmarks[oldKey]) saved.bookmarks[keyOf(entry)] = saved.bookmarks[oldKey].map(item => ({ ...item }));
        saved.episodes = saved.episodes.filter(e => keyOf(e) !== keyOf(entry)); saved.episodes.unshift(entry);
        uploadedDraft = entry; persist(); renderSubjects(); renderLibrary();
        ui.uploadProgress.value = 100; ui.uploadStatus.classList.add("is-success");
        ui.uploadStatus.textContent = storageAvailable ? "Uploaded to R2. Your link is saved in this browser's library." : "Uploaded to R2. Copy the link and export your library; browser storage is unavailable.";
        const localIsCurrent = current && current.kind === "local" && current.file === file;
        const position = localIsCurrent && metadataReady ? ui.audioPlayer.currentTime : undefined;
        const autoplay = Boolean(localIsCurrent && !ui.audioPlayer.paused);
        openCloud(entry, { position, autoplay });
      } catch (error) { uploadFailure(`Upload response could not be used: ${error.message} Check R2 before retrying.`); }
    };
    xhr.onerror = () => uploadFailure("Network or CORS error. Open Settings, test the Worker address, and check that the upload Worker code is deployed.");
    xhr.ontimeout = () => uploadFailure("The upload timed out. The file may already be in R2; check before uploading it again.");
    xhr.onabort = () => uploadFailure("Upload cancelled in this browser. A server-side copy may exist if the upload had already completed.");
    xhr.onloadend = () => { uploadXHR = null; setUploading(false); };
    try { xhr.send(file); }
    catch (error) { uploadXHR = null; setUploading(false); uploadFailure(`Could not start upload: ${error.message}`); }
  }
  ui.uploadButton.addEventListener("click", upload);
  ui.cancelUpload.addEventListener("click", () => { if (uploadXHR) uploadXHR.abort(); });

  function fillSubjects(select, selected) {
    const value = selected !== undefined ? selected : select.value;
    select.replaceChildren(new Option("Unsorted", ""), ...saved.subjects.map(s => new Option(s.name, s.id)));
    select.value = saved.subjects.some(s => s.id === value) ? value : "";
  }
  function renderSubjects() {
    fillSubjects(ui.podcastSubject); fillSubjects(ui.existingAudioSubject);
    if (subjectFilter !== "all" && subjectFilter !== "unsorted" && !saved.subjects.some(s => s.id === subjectFilter)) subjectFilter = "all";
    const all = [{ id: "all", name: "All recordings", color: "#5e4ce6" }, ...saved.subjects, { id: "unsorted", name: "Unsorted", color: "#85899a" }];
    const fragment = document.createDocumentFragment();
    for (const subject of all) {
      const count = saved.episodes.filter(e => subject.id === "all" || (subject.id === "unsorted" ? !e.subjectId : e.subjectId === subject.id)).length;
      const chip = button("", "subject-chip", () => { subjectFilter = subject.id; renderSubjects(); renderLibrary(); });
      chip.style.setProperty("--subject-color", subject.color); chip.setAttribute("aria-pressed", String(subjectFilter === subject.id));
      const dot = text("span", "", "subject-dot"); dot.setAttribute("aria-hidden", "true");
      chip.append(dot, text("span", subject.name, "chip-name"), text("span", count, "chip-count")); fragment.append(chip);
    }
    ui.subjectFilters.replaceChildren(fragment); ui.libraryCount.textContent = String(saved.episodes.length);
  }
  function renderLibrary() {
    const query = ui.librarySearch.value.trim().toLocaleLowerCase();
    const filtered = saved.episodes.filter(e => (subjectFilter === "all" || (subjectFilter === "unsorted" ? !e.subjectId : e.subjectId === subjectFilter)) && `${e.title} ${e.fileName} ${subjectById(e.subjectId).name}`.toLocaleLowerCase().includes(query));
    filtered.sort(ui.librarySort.value === "title" ? (a, b) => a.title.localeCompare(b.title) : (a, b) => b.createdAt - a.createdAt);
    const fragment = document.createDocumentFragment();
    for (const entry of filtered) {
      const key = keyOf(entry), subject = subjectById(entry.subjectId);
      const row = text("article", "", "episode-row"); row.style.setProperty("--subject-color", subject.color);
      row.classList.toggle("is-current", Boolean(current && current.key === key));
      const icon = text("div", "\u266b", "episode-icon"); icon.setAttribute("aria-hidden", "true");
      const copy = text("div", "", "episode-copy"); copy.append(text("h3", entry.title, "episode-title"));
      const meta = [entry.duration ? formatTime(entry.duration) : "Cloud audio", entry.size !== null ? formatSize(entry.size) : "", subject.name].filter(Boolean).join(" / ");
      copy.append(text("p", meta, "episode-meta"));
      const actions = text("div", "", "episode-actions");
      const choose = text("select", "", "episode-subject"); fillSubjects(choose, entry.subjectId); choose.setAttribute("aria-label", `Subject for ${entry.title}`);
      choose.addEventListener("change", () => { entry.subjectId = choose.value; persist(); renderSubjects(); renderLibrary(); });
      const play = button("Listen", "button button-secondary", () => { clearListenHash(); openCloud(entry); ui.playerSection.scrollIntoView({ behavior: "smooth", block: "start" }); });
      const share = button("Share", "text-button", () => copyText(makeShareLink(entry), "Player link copied."));
      const remove = button("Remove", "text-button text-muted", () => {
        if (!window.confirm(`Remove "${entry.title}" from this browser's library? The audio in R2 will NOT be deleted.`)) return;
        saved.episodes = saved.episodes.filter(e => keyOf(e) !== key); persist(); renderSubjects(); renderLibrary(); renderShare();
      });
      actions.append(choose, play, share, remove); row.append(icon, copy, actions); fragment.append(row);
    }
    ui.episodeList.replaceChildren(fragment); show(ui.libraryEmpty, filtered.length === 0);
    ui.libraryEmpty.querySelector("h3").textContent = saved.episodes.length ? "No recordings match this view." : "Your next idea belongs here.";
    ui.libraryEmpty.querySelector("p").textContent = saved.episodes.length ? "Try another subject or a different search." : "Upload a recording or add a cloud audio link. Your saved recordings will appear here.";
    ui.libraryCount.textContent = String(saved.episodes.length);
  }
  ui.librarySearch.addEventListener("input", renderLibrary); ui.librarySort.addEventListener("change", renderLibrary);
  function openSubject(id = null) {
    editingSubjectId = id;
    const subject = id ? saved.subjects.find(s => s.id === id) : null;
    ui.subjectDialogTitle.textContent = subject ? "Edit subject" : "New subject";
    ui.subjectName.value = subject ? subject.name : ""; ui.subjectColor.value = subject ? subject.color : "#5e4ce6";
    showError(ui.subjectError, ""); show(ui.deleteSubject, Boolean(subject)); ui.subjectDialog.showModal();
  }
  ui.newSubjectButton.addEventListener("click", () => openSubject()); ui.newSubjectUpload.addEventListener("click", () => openSubject());
  ui.subjectForm.addEventListener("submit", event => {
    event.preventDefault();
    const name = ui.subjectName.value.trim().slice(0, 60);
    if (!name) { showError(ui.subjectError, "Enter a subject name."); return; }
    if (saved.subjects.some(s => s.id !== editingSubjectId && s.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { showError(ui.subjectError, "A subject with this name already exists."); return; }
    const id = editingSubjectId || uid();
    const subject = { id, name, color: ui.subjectColor.value };
    if (editingSubjectId) saved.subjects = saved.subjects.map(s => s.id === id ? subject : s);
    else saved.subjects.push(subject);
    persist(); renderSubjects(); renderLibrary(); ui.podcastSubject.value = id; ui.subjectDialog.close();
    notify(editingSubjectId ? "Subject updated in this browser." : "Subject created in this browser.");
  });
  ui.deleteSubject.addEventListener("click", () => {
    if (!editingSubjectId || !window.confirm("Delete this subject? Its recordings will move to Unsorted; no audio will be deleted.")) return;
    saved.subjects = saved.subjects.filter(s => s.id !== editingSubjectId);
    saved.episodes.forEach(e => { if (e.subjectId === editingSubjectId) e.subjectId = ""; });
    persist(); renderSubjects(); renderLibrary(); ui.subjectDialog.close();
  });
  ui.manageSubjects.addEventListener("click", () => {
    ui.manageSubjectList.replaceChildren();
    if (!saved.subjects.length) ui.manageSubjectList.append(text("p", "No subjects yet. Use New subject to create one.", "small-copy"));
    saved.subjects.forEach(subject => {
      const row = text("div", "", "manage-subject-row"); row.style.setProperty("--subject-color", subject.color);
      row.append(text("span", "", "subject-dot"), text("span", subject.name), button("Edit", "text-button", () => { ui.manageDialog.close(); openSubject(subject.id); }));
      ui.manageSubjectList.append(row);
    });
    ui.manageDialog.showModal();
  });

  function makeShareLink(entry) {
    if (!/^https?:$/.test(location.protocol)) return entry.audioUrl;
    const url = new URL(location.href); url.search = ""; url.hash = "";
    const parameters = new URLSearchParams({ listen: entry.id, title: entry.title });
    if (entry.apiBaseUrl !== siteAPI) parameters.set("server", entry.apiBaseUrl);
    url.hash = parameters.toString(); return url.href;
  }
  function renderShare() {
    const isCloud = current && current.kind === "cloud"; show(ui.shareSection, Boolean(isCloud));
    if (!isCloud) return;
    const entry = current.entry;
    ui.shareLink.value = makeShareLink(entry); ui.directAudioLink.href = entry.audioUrl;
    const included = saved.episodes.some(e => keyOf(e) === current.key);
    show(ui.saveSharedButton, !included);
    ui.shareHint.textContent = /^https?:$/.test(location.protocol) ? "Recipients get the player. Subjects, bookmarks, and listening history stay in this browser." : "This page is running from a local file, so this is a direct audio link. Open your GitHub Pages site to share the styled player.";
  }
  async function copyText(value, success = "Link copied.") {
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value); notify(success);
    } catch (_) {
      const area = text("textarea", value); area.style.position = "fixed"; area.style.opacity = "0"; document.body.append(area); area.select();
      let copied = false; try { copied = document.execCommand("copy"); } catch (_) { /* Manual copy remains available. */ }
      area.remove();
      if (copied) notify(success);
      else { window.prompt("Copy this link:", value); }
    }
  }
  ui.copyButton.addEventListener("click", () => copyText(ui.shareLink.value));
  ui.saveSharedButton.addEventListener("click", () => {
    if (!current || current.kind !== "cloud") return;
    if (!saved.episodes.some(e => keyOf(e) === current.key)) { saved.episodes.unshift({ ...current.entry }); persist(); renderSubjects(); renderLibrary(); renderShare(); notify("Recording saved to this browser's library."); }
  });
  function clearListenHash() { if (location.hash) { try { history.replaceState(null, "", location.pathname + location.search); } catch (_) { /* file:// may disallow History API. */ } } }
  function loadSharedLink() {
    const parameters = new URLSearchParams(location.hash.slice(1)); const id = parameters.get("listen");
    if (!id) return;
    if (!UUID.test(id)) { showError(ui.globalError, "The shared recording ID is invalid. Ask for a new player link."); return; }
    try {
      const server = parameters.get("server"); const base = server ? normalizeBase(server) : apiBase;
      if (!base) { showError(ui.globalError, "Configure the Worker address in Settings to open this shared recording."); return; }
      // A shared link cannot silently reconfigure the upload destination.
      if (server && base !== apiBase && base !== siteAPI && !window.confirm(`This recording is hosted at ${base}. Load audio from that server? Your upload settings will NOT change.`)) return;
      const entry = normalizeEpisode({ id, apiBaseUrl: base, title: parameters.get("title") || "Shared recording", createdAt: Date.now() });
      const existing = saved.episodes.find(e => keyOf(e) === keyOf(entry)); openCloud(existing || entry);
    } catch (error) { showError(ui.globalError, `Could not open this player link: ${error.message}`); }
  }
  window.addEventListener("hashchange", loadSharedLink);
  ui.addLinkButton.addEventListener("click", () => { ui.linkForm.reset(); fillSubjects(ui.existingAudioSubject); showError(ui.linkError, ""); ui.linkDialog.showModal(); });
  ui.linkForm.addEventListener("submit", event => {
    event.preventDefault();
    try {
      const parsed = parseAudioURL(ui.existingAudioUrl.value); const existing = saved.episodes.find(e => keyOf(e) === keyOf(parsed));
      const entry = normalizeEpisode({ ...existing, ...parsed, title: ui.existingAudioTitle.value, subjectId: ui.existingAudioSubject.value, createdAt: existing ? existing.createdAt : Date.now() });
      saved.episodes = saved.episodes.filter(e => keyOf(e) !== keyOf(entry)); saved.episodes.unshift(entry); persist(); renderSubjects(); renderLibrary(); ui.linkDialog.close(); openCloud(entry);
      notify("Link saved. Audio has not been re-uploaded.");
    } catch (error) { showError(ui.linkError, error.message); }
  });

  function updateConnectionUI() {
    ui.connectionLabel.textContent = apiBase ? "Cloud configured" : "Local only";
    ui.connectionBadge.classList.remove("is-connected"); updateUploadButton();
    ui.uploadLimitHint.textContent = `Cloud upload limit: ${formatSize(maxBytes)} per file.`;
    if (!apiBase && !draftFile) ui.uploadStatus.textContent = "Local playback is ready. Add your Worker base URL in Settings to enable uploads.";
  }
  function openSettings() {
    ui.apiBaseInput.value = apiBase; showError(ui.settingsError, ""); ui.connectionResult.textContent = ""; ui.settingsDialog.showModal();
  }
  ui.settingsButton.addEventListener("click", openSettings);
  ui.settingsForm.addEventListener("submit", event => {
    event.preventDefault();
    try {
      const base = normalizeBase(ui.apiBaseInput.value);
      apiBase = base; apiOverride = base;
      try { localStorage.setItem(CONNECTION_KEY, JSON.stringify(base)); } catch (_) { disableStorage(); }
      updateConnectionUI(); ui.settingsDialog.close(); notify("Connection changed for this browser only. Edit config.js to change the site default.");
      if (location.hash) loadSharedLink();
    } catch (error) { showError(ui.settingsError, error.message); }
  });
  ui.resetConnection.addEventListener("click", () => {
    try { localStorage.removeItem(CONNECTION_KEY); } catch (_) { /* A session-only reset is still useful. */ }
    apiOverride = undefined; apiBase = siteAPI; ui.apiBaseInput.value = siteAPI; updateConnectionUI();
    ui.connectionResult.textContent = "Using the default in config.js. This change is applied now.";
  });
  ui.testConnection.addEventListener("click", async () => {
    showError(ui.settingsError, ""); let base;
    try { base = normalizeBase(ui.apiBaseInput.value); if (!base) throw new Error("Enter a Worker URL to test."); }
    catch (error) { showError(ui.settingsError, error.message); return; }
    ui.testConnection.disabled = true; ui.connectionResult.textContent = "Testing /health...";
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${base}/health`, { signal: controller.signal, cache: "no-store", credentials: "omit" });
      const data = await response.json();
      if (!response.ok || data.ok !== true || data.r2Connected !== true) throw new Error("The Worker did not confirm an R2 connection.");
      ui.connectionResult.textContent = "Connected to the Worker and R2. This checks /health only; your first upload also tests /upload and streaming.";
      if (base === apiBase) { ui.connectionLabel.textContent = "Cloud connected"; ui.connectionBadge.classList.add("is-connected"); }
    } catch (error) {
      showError(ui.settingsError, error.name === "AbortError" ? "Connection test timed out. Check the Worker address." : "Could not verify the connection. Check the base URL, /health response, and the Worker's CORS headers.");
      ui.connectionResult.textContent = "";
    } finally { clearTimeout(timer); ui.testConnection.disabled = false; }
  });
  document.querySelectorAll("[data-close]").forEach(element => element.addEventListener("click", () => document.getElementById(element.dataset.close).close()));

  function downloadJSON(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob);
    const anchor = text("a", ""); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  ui.exportLibrary.addEventListener("click", () => {
    persistPosition(true); downloadJSON(`audio-library-${new Date().toISOString().slice(0, 10)}.json`, { schema: "audio-library-backup", version: 1, exportedAt: new Date().toISOString(), data: saved });
    notify("Library backup exported. It contains links and metadata, not the audio files.");
  });
  ui.importLibraryButton.addEventListener("click", () => ui.importLibraryFile.click());
  ui.importLibraryFile.addEventListener("change", async () => {
    const file = ui.importLibraryFile.files[0]; ui.importLibraryFile.value = ""; if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("This backup is too large. Import an Audio Library JSON backup smaller than 8 MiB.");
      const backup = JSON.parse(await file.text());
      if (backup.schema !== "audio-library-backup" || backup.version !== 1 || !backup.data) throw new Error("This is not a supported Audio Library backup.");
      const incoming = normalizeState(backup.data);
      if (!window.confirm(`Merge ${incoming.episodes.length} cloud recording(s) and ${incoming.subjects.length} subject(s) into this browser? No audio will be uploaded.`)) return;
      saved.subjects = Array.from(new Map([...saved.subjects, ...incoming.subjects].map(s => [s.id, s])).values());
      saved.episodes = Array.from(new Map([...saved.episodes, ...incoming.episodes].map(e => [keyOf(e), e])).values());
      Object.assign(saved.positions, incoming.positions); Object.assign(saved.bookmarks, incoming.bookmarks);
      persist(); renderSubjects(); renderLibrary(); renderBookmarks(); renderShare(); notify("Library merged. Audio files remain at their original cloud addresses.");
    } catch (error) { showError(ui.globalError, `Import failed: ${error.message}`); }
  });
  function renderBookmarks() {
    ui.bookmarkList.replaceChildren(); if (!current) return;
    const list = saved.bookmarks[current.key] || [];
    for (const item of [...list].sort((a, b) => a.time - b.time)) {
      const li = text("li", "");
      li.append(button(`${formatTime(item.time)} / ${item.label}`, "text-button", () => seekTo(item.time)), button("Remove", "text-button text-muted", () => {
        saved.bookmarks[current.key] = (saved.bookmarks[current.key] || []).filter(b => b.id !== item.id); persist(); renderBookmarks();
      })); ui.bookmarkList.append(li);
    }
  }
  ui.addBookmark.addEventListener("click", () => {
    if (!current || !metadataReady) return;
    const time = Math.floor(ui.audioPlayer.currentTime);
    const label = window.prompt("Name this bookmark:", `Note at ${formatTime(time)}`); if (label === null) return;
    if (!saved.bookmarks[current.key]) saved.bookmarks[current.key] = [];
    saved.bookmarks[current.key].push({ id: uid(), time, label: cleanTitle(label, "Bookmark") }); persist(); renderBookmarks();
  });
  function setSleep(minutes) {
    clearInterval(sleepInterval); sleepInterval = null; sleepDeadline = minutes > 0 ? Date.now() + minutes * 60000 : 0;
    ui.sleepTimer.value = String(minutes); show(ui.sleepStatus, minutes > 0);
    if (minutes <= 0) return;
    const tick = () => {
      const remaining = Math.max(0, sleepDeadline - Date.now());
      ui.sleepStatus.textContent = `Sleep timer: ${formatTime(Math.ceil(remaining / 1000))} remaining`;
      if (remaining === 0) { ui.audioPlayer.pause(); setSleep(0); notify("Sleep timer ended. Playback paused."); }
    };
    tick(); sleepInterval = setInterval(tick, 1000);
  }
  ui.sleepTimer.addEventListener("change", () => setSleep(Number(ui.sleepTimer.value)));
  document.addEventListener("keydown", event => {
    if (!current || event.altKey || event.ctrlKey || event.metaKey || document.querySelector("dialog[open]")) return;
    if (event.target instanceof Element && event.target.closest("input, select, textarea, button, a, audio, [contenteditable]")) return;
    if (event.code === "Space") { event.preventDefault(); if (ui.audioPlayer.paused) playSafely(); else ui.audioPlayer.pause(); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); seekTo(ui.audioPlayer.currentTime - 15); }
    else if (event.key === "ArrowRight") { event.preventDefault(); seekTo(ui.audioPlayer.currentTime + 15); }
  });
  function updateMediaSession() {
    if (!current || !("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: appName, album: current.kind === "cloud" ? "Cloud recording" : "Local recording" }); } catch (_) { /* Optional enhancement. */ }
  }
  if ("mediaSession" in navigator) {
    const handlers = { play: playSafely, pause: () => ui.audioPlayer.pause(), seekbackward: data => seekTo(ui.audioPlayer.currentTime - (data.seekOffset || 15)), seekforward: data => seekTo(ui.audioPlayer.currentTime + (data.seekOffset || 15)), seekto: data => seekTo(data.seekTime) };
    for (const [action, handler] of Object.entries(handlers)) { try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) { /* Browser may not support this action. */ } }
  }
  window.addEventListener("pagehide", () => persistPosition(true));
  window.addEventListener("beforeunload", event => { if (uploadXHR) { event.preventDefault(); event.returnValue = ""; } });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistPosition(true);
    if (sleepDeadline && Date.now() >= sleepDeadline) { ui.audioPlayer.pause(); setSleep(0); }
  });
  document.querySelectorAll("[data-app-name]").forEach(element => { element.textContent = appName; });
  document.title = `${appName} - Your podcasts, your pace`;
  ui.speed.value = String(saved.speed); ui.rememberPosition.checked = saved.remember; restoreSpeed();
  updateConnectionUI(); renderSubjects(); renderLibrary(); loadSharedLink();
})();
