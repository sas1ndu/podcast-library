# Audio Library - starter v0.1

A local, single-file audio player. No Node.js, package installation, API key,
account, or build command is required.

## Start on Windows

1. Right-click `podcast-library-starter.zip` and choose **Extract All**.
2. Open the extracted `podcast-library` folder.
3. Double-click `index.html` to open it in your browser.
4. Click **Choose audio file** and select one recording, or drop one onto the box.
5. Use the native player, the 15-second skip buttons, and the speed selector.

Keep `index.html`, `style.css`, and `app.js` together. Do not open the HTML from
inside the unextracted ZIP. The `assets` folder is reserved for future additions;
the current app does not load external images or fonts.

## Included

- Native audio playback, volume, and scrubbing.
- Rewind and forward 15 seconds, clamped to valid timestamps.
- Playback speed: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 1.75x, and 2x.
- File selection and single-file drag-and-drop.
- File size, extension, duration, and player state.
- Local speed preference and optional saved playback position.
- A Resume prompt after reselecting the same file.
- Keyboard shortcuts: Space to play/pause, Left/Right to skip 15 seconds.
  These shortcuts apply when focus is not inside a native control.
- Basic system media controls on browsers that support the Media Session API.
- Responsive layout, accessible controls, and clear error messages.
- Safe cleanup of temporary object URLs when files are replaced or closed.

## Important boundaries

This starter does **not** upload, copy, compress, transcribe, share, or permanently
store your audio. It does not have subject collections or a cloud backend yet.
It makes no application network requests. Your original audio is unchanged.

The file picker allows common formats, but the browser must support the actual
codec inside a file. An extension alone cannot guarantee playback. A damaged
file or unsupported codec will show an error.

Position and speed use this browser's localStorage, when available. On your next
visit, reselect the same original file to see Resume. A renamed, edited, moved,
or re-downloaded copy may not be recognized, depending on its name, size, and
last-modified time. No audio bytes are stored in localStorage. File identifiers
and timestamps stay in this browser. Up to 50 file positions are kept.

Clearing site/browser data removes these preferences. Private browsing and
opening the page as a local file can affect persistence, depending on the
browser. The app continues to work when saving is unavailable. Unchecking
**Remember my position** deletes this app's saved positions. It does not delete
any audio files.

Saved progress is tied to the page's browser storage. Moving from a local file
to a hosted site does not automatically transfer progress. Closing a recording
keeps its position if saving is enabled. Finishing it clears its saved position.

A Resume choice is explicit: pressing the native Play button instead starts
from the currently displayed position, normally the beginning.

## Files

- `index.html`: page structure and player controls.
- `style.css`: layout, colors, and mobile styles.
- `app.js`: local playback, validation, skips, speed, and progress.
- `assets/`: reserved for future images or other local assets.

## Basic test

1. Open an audio file that is longer than one minute.
2. Press Play, then Pause.
3. Change speed to 1.5x and press Play again.
4. Try both skip buttons and drag the native timeline.
5. Pause after at least 15 seconds, then reload the page.
6. Choose the same file again and click Resume here.
7. Choose another file and verify the title changes.
8. Choose a text file or an empty file to see validation.

## Later stages

Subject collections, cloud storage and share links, owner management,
browser-side compression, and optional transcripts can be added after this
local player is working. There are no fake or partially connected controls for
those features in this version.
