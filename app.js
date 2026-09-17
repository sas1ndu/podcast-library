/* Audio Library v0.1 - no packages, build step, or network requests. */
"use strict";

(() => {
  const ui = {
    file: document.getElementById("audioFile"),
    fileLabel: document.getElementById("fileLabel"),
    dropZone: document.getElementById("dropZone"),
    audio: document.getElementById("audioPlayer"),
    player: document.getElementById("playerSection"),
    empty: document.getElementById("emptyState"),
    title: document.getElementById("audioTitle"),
    fileType: document.getElementById("fileType"),
    fileSize: document.getElementById("fileSize"),
    duration: document.getElementById("audioDuration"),
    back: document.getElementById("backButton"),
    forward: document.getElementById("forwardButton"),
    speed: document.getElementById("speed"),
    clear: document.getElementById("clearButton"),
    state: document.getElementById("playerState"),
    fileError: document.getElementById("fileError"),
    playbackError: document.getElementById("playbackError"),
    storageNotice: document.getElementById("storageNotice"),
    status: document.getElementById("appStatus"),
    remember: document.getElementById("rememberPosition"),
    resumeNotice: document.getElementById("resumeNotice"),
    resumeTime: document.getElementById("resumeTime"),
    resume: document.getElementById("resumeButton"),
    restart: document.getElementById("restartButton")
  };

  const STORAGE_KEY = "audio-library:v1";
  const ALLOWED_EXTENSIONS = new Set(["mp3", "m4a", "aac", "wav", "wave", "ogg", "oga", "opus", "webm", "flac", "mp4"]);
  const ALLOWED_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const MAX_SAVED_FILES = 50;
  let currentFile = null;
  let currentKey = "";
  let objectURL = null;
  let metadataReady = false;
  let resumePending = null;
  let lastSaveAt = 0;
  let dragDepth = 0;
  let storageAvailable = true;
  const saved = loadSavedState();

  ui.speed.value = String(saved.speed);
  ui.remember.checked = saved.remember;
  ui.audio.playbackRate = saved.speed;

  function show(element, visible = true) {
    element.classList.toggle("hidden", !visible);
  }

  function notify(message) {
    ui.status.textContent = message;
  }

  function setState(label, playing = false) {
    ui.state.textContent = label;
    ui.state.classList.toggle("is-playing", playing);
  }

  function showStorageNotice() {
    storageAvailable = false;
    ui.storageNotice.textContent = "Your browser is not allowing saved preferences here. Playback still works, but speed and position may not survive closing the page.";
    show(ui.storageNotice);
  }

  function loadSavedState() {
    const defaults = { speed: 1, remember: true, positions: {} };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return defaults;
      const positions = {};
      if (parsed.positions && typeof parsed.positions === "object" && !Array.isArray(parsed.positions)) {
        for (const [key, value] of Object.entries(parsed.positions).slice(0, MAX_SAVED_FILES)) {
          if (value && Number.isFinite(value.time) && value.time >= 0 && Number.isFinite(value.updatedAt)) {
            positions[key] = { time: value.time, updatedAt: value.updatedAt };
          }
        }
      }
      return {
        speed: ALLOWED_SPEEDS.includes(parsed.speed) ? parsed.speed : 1,
        remember: typeof parsed.remember === "boolean" ? parsed.remember : true,
        positions
      };
    } catch (error) {
      // Invalid JSON is recoverable. Storage/security exceptions disable persistence.
      if (!(error instanceof SyntaxError)) showStorageNotice();
      return defaults;
    }
  }

  function writeSavedState() {
    if (!storageAvailable) return;
    try {
      const latest = Object.entries(saved.positions)
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .slice(0, MAX_SAVED_FILES);
      saved.positions = Object.fromEntries(latest);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch (_) {
      showStorageNotice();
    }
  }

  function forgetCurrentPosition() {
    if (!currentKey) return;
    delete saved.positions[currentKey];
    writeSavedState();
  }

  function persistPosition(force = false) {
    if (!currentFile || !metadataReady || !saved.remember || resumePending !== null) return;
    const time = ui.audio.currentTime;
    const duration = ui.audio.duration;
    if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return;
    const now = Date.now();
    if (!force && now - lastSaveAt < 5000) return;
    lastSaveAt = now;
    if (ui.audio.ended || time < 1 || duration - time <= 1) {
      forgetCurrentPosition();
    } else {
      saved.positions[currentKey] = { time: Math.floor(time), updatedAt: now };
      writeSavedState();
    }
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
    const whole = Math.floor(seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const rest = String(whole % 60).padStart(2, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }

  function extensionOf(name) {
    return name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  }

  function enableSeek(ready) {
    ui.back.disabled = !ready;
    ui.forward.disabled = !ready;
  }

  function releaseAudio() {
    // Disable persistence before resetting the media element. Old media events
    // must not overwrite a newly selected file's saved position.
    metadataReady = false;
    currentFile = null;
    currentKey = "";
    resumePending = null;
    ui.audio.pause();
    ui.audio.removeAttribute("src");
    ui.audio.load();
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
    enableSeek(false);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }
  }

  /** Open a local File without reading the entire audio into JavaScript memory. */
  function openFile(file) {
    if (!(file instanceof File)) return;
    show(ui.fileError, false);
    const ext = extensionOf(file.name);
    if (file.size === 0) {
      ui.fileError.textContent = "This file is empty. Please choose an audio recording with some content.";
      show(ui.fileError);
      return;
    }
    if (!file.type.startsWith("audio/") && !ALLOWED_EXTENSIONS.has(ext)) {
      ui.fileError.textContent = "Please choose an audio file, such as MP3, M4A, or WAV. Renaming a non-audio file will not make it playable.";
      show(ui.fileError);
      return;
    }

    persistPosition(true);
    releaseAudio();
    currentFile = file;
    // Identity is local only; this is not a cryptographic content fingerprint.
    currentKey = JSON.stringify([file.name, file.size, file.lastModified]);
    ui.title.textContent = file.name.replace(/\.[^.]+$/, "") || file.name;
    ui.fileType.textContent = ext ? ext.toUpperCase() : "AUDIO";
    ui.fileSize.textContent = formatSize(file.size);
    ui.duration.textContent = "Reading duration...";
    ui.fileLabel.textContent = "Choose another file";
    show(ui.playbackError, false);
    show(ui.resumeNotice, false);
    show(ui.empty, false);
    show(ui.player);
    setState("Loading...");

    try {
      objectURL = URL.createObjectURL(file);
      ui.audio.src = objectURL;
      ui.audio.load();
      notify(`Opened ${file.name}. Your recording stays on this device.`);
    } catch (_) {
      ui.playbackError.textContent = "This file could not be opened. Try selecting it again.";
      show(ui.playbackError);
      setState("Cannot open");
    }
  }

  function updateDuration() {
    if (!currentFile) return;
    const valid = Number.isFinite(ui.audio.duration) && ui.audio.duration > 0;
    ui.duration.textContent = valid ? `${formatTime(ui.audio.duration)} duration` : "Duration unavailable";
    enableSeek(valid && !ui.audio.error);
  }

  function restoreSpeed() {
    ui.audio.defaultPlaybackRate = saved.speed;
    ui.audio.playbackRate = saved.speed;
  }

  ui.audio.addEventListener("loadedmetadata", () => {
    if (!currentFile) return;
    metadataReady = true;
    updateDuration();
    restoreSpeed();
    setState("Ready to play");
    const position = saved.positions[currentKey];
    if (saved.remember && position && position.time > 0 && Number.isFinite(ui.audio.duration) && position.time < ui.audio.duration - 1) {
      resumePending = position.time;
      ui.resumeTime.textContent = formatTime(position.time);
      show(ui.resumeNotice);
      notify(`Ready. A saved position at ${formatTime(position.time)} is available.`);
    }
    setMediaSessionMetadata();
  });

  ui.audio.addEventListener("durationchange", updateDuration);
  ui.audio.addEventListener("timeupdate", () => persistPosition());
  ui.audio.addEventListener("play", () => {
    if (!currentFile) return;
    // Pressing native Play without choosing Resume deliberately starts over.
    if (resumePending !== null) {
      resumePending = null;
      show(ui.resumeNotice, false);
      persistPosition(true);
    }
    setState("Playing", true);
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  });
  ui.audio.addEventListener("pause", () => {
    if (!currentFile || !metadataReady || !ui.audio.paused) return;
    if (!ui.audio.ended) setState("Paused");
    persistPosition(true);
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  });
  ui.audio.addEventListener("ended", () => {
    if (!currentFile) return;
    setState("Finished");
    forgetCurrentPosition();
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  });
  ui.audio.addEventListener("seeked", () => {
    // A manual seek is an explicit new listening position.
    if (resumePending !== null) {
      resumePending = null;
      show(ui.resumeNotice, false);
    }
    persistPosition(true);
  });
  ui.audio.addEventListener("error", () => {
    if (!currentFile || !ui.audio.error) return;
    metadataReady = false;
    enableSeek(false);
    show(ui.resumeNotice, false);
    const errorCode = ui.audio.error.code;
    ui.playbackError.textContent = errorCode === 2
      ? "The audio could not be read. Check that the file is still available, then select it again."
      : "This file cannot be played in this browser. It may use an unsupported codec or be damaged. Try an MP3 or WAV file, or a different browser.";
    show(ui.playbackError);
    setState("Cannot play");
  });

  async function playSafely() {
    if (!currentFile || ui.audio.error) return;
    try {
      await ui.audio.play();
      show(ui.playbackError, false);
    } catch (error) {
      if (error.name === "AbortError") return;
      ui.playbackError.textContent = "Playback did not start. Try the player's Play button, or select another audio file.";
      show(ui.playbackError);
    }
  }

  function seekTo(seconds) {
    if (!metadataReady || !Number.isFinite(ui.audio.duration) || !Number.isFinite(seconds)) return;
    try {
      ui.audio.currentTime = Math.max(0, Math.min(ui.audio.duration, seconds));
      resumePending = null;
      show(ui.resumeNotice, false);
      persistPosition(true);
    } catch (_) {
      notify("This file is not ready to seek yet.");
    }
  }

  ui.back.addEventListener("click", () => seekTo(ui.audio.currentTime - 15));
  ui.forward.addEventListener("click", () => seekTo(ui.audio.currentTime + 15));
  ui.speed.addEventListener("change", () => {
    const rate = Number(ui.speed.value);
    if (!ALLOWED_SPEEDS.includes(rate)) return;
    saved.speed = rate;
    restoreSpeed();
    writeSavedState();
    notify(`Playback speed set to ${rate} times.`);
  });
  ui.remember.addEventListener("change", () => {
    saved.remember = ui.remember.checked;
    if (!saved.remember) {
      saved.positions = {};
      resumePending = null;
      show(ui.resumeNotice, false);
    }
    writeSavedState();
    if (saved.remember) persistPosition(true);
  });
  ui.resume.addEventListener("click", async () => {
    if (resumePending === null) return;
    const time = resumePending;
    resumePending = null;
    seekTo(time);
    await playSafely();
  });
  ui.restart.addEventListener("click", () => {
    resumePending = null;
    forgetCurrentPosition();
    seekTo(0);
    show(ui.resumeNotice, false);
    notify("Ready to play from the beginning.");
  });
  ui.clear.addEventListener("click", () => {
    persistPosition(true);
    releaseAudio();
    ui.file.value = "";
    ui.fileLabel.textContent = "Choose audio file";
    show(ui.player, false);
    show(ui.empty);
    show(ui.fileError, false);
    notify("Recording closed. The original file has not been changed.");
    ui.file.focus();
  });
  ui.file.addEventListener("change", () => {
    const file = ui.file.files && ui.file.files[0];
    if (file) openFile(file);
    // Permit selecting the same file again, including after a playback error.
    ui.file.value = "";
  });

  // Drag and drop never uploads. It calls the same local file opener.
  ui.dropZone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth += 1;
    ui.dropZone.classList.add("drag-over");
  });
  ui.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  ui.dropZone.addEventListener("dragleave", (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) ui.dropZone.classList.remove("drag-over");
  });
  ui.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    ui.dropZone.classList.remove("drag-over");
    const files = event.dataTransfer && event.dataTransfer.files;
    if (!files || !files.length) return;
    if (files.length !== 1) {
      ui.fileError.textContent = "Please open one recording at a time. Choose a single audio file.";
      show(ui.fileError);
      return;
    }
    openFile(files[0]);
  });
  // Prevent dropping a file elsewhere from navigating away from the app.
  for (const eventName of ["dragover", "drop"]) {
    window.addEventListener(eventName, (event) => {
      if (event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (!currentFile || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    // Preserve native shortcuts and interactions on all focused controls.
    if (target instanceof Element && target.closest("input, select, textarea, button, a, audio, [contenteditable]")) return;
    if (event.code === "Space") {
      event.preventDefault();
      if (ui.audio.paused) playSafely(); else ui.audio.pause();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekTo(ui.audio.currentTime - 15);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      seekTo(ui.audio.currentTime + 15);
    }
  });

  function setMediaSessionMetadata() {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: ui.title.textContent, artist: "Audio Library", album: "Local recording" });
    } catch (_) { /* Media controls are an optional browser enhancement. */ }
  }

  if ("mediaSession" in navigator) {
    const handlers = {
      play: () => playSafely(),
      pause: () => ui.audio.pause(),
      seekbackward: (details) => seekTo(ui.audio.currentTime - (details.seekOffset || 15)),
      seekforward: (details) => seekTo(ui.audio.currentTime + (details.seekOffset || 15)),
      seekto: (details) => seekTo(details.seekTime)
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) { /* Unsupported action. */ }
    }
  }

  window.addEventListener("pagehide", () => persistPosition(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistPosition(true);
  });
})();
