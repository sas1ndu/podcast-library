# Third-party notices

This deployed site includes pinned runtime files copied by `npm run build:assets`.

| Component | Version/revision | Licence |
| --- | --- | --- |
| ffmpeg.wasm JavaScript wrapper | 0.12.15 | MIT |
| ffmpeg.wasm single-thread core | 0.12.10 | FFmpeg and linked-library LGPL/GPL/codec terms |
| Transformers.js | 4.3.0 | Apache-2.0 |
| ONNX Runtime Web | dependency pinned in `package-lock.json` | MIT |
| `onnx-community/whisper-tiny.en` | `2575352d61be1bf7225cf8f8b268a4678025fc58` | Derived from OpenAI Whisper; MIT model/code terms |

Copyright notices and licence references:

- ffmpeg.wasm MIT: https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/LICENSE
- FFmpeg licence: https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md
- Transformers.js Apache-2.0: https://github.com/huggingface/transformers.js/blob/main/LICENSE
- ONNX Runtime MIT: https://github.com/microsoft/onnxruntime/blob/main/LICENSE
- OpenAI Whisper MIT: https://github.com/openai/whisper/blob/main/LICENSE
- Pinned converted model: https://huggingface.co/onnx-community/whisper-tiny.en/tree/2575352d61be1bf7225cf8f8b268a4678025fc58

ffmpeg.wasm's compiled core contains FFmpeg and external codec code whose terms are separate from the wrapper's MIT licence. Review the linked upstream notices before redistribution. This notice is not legal advice.

The vendored Transformers.js browser bundle changes one error-message documentation URL from an upstream GitHub Gist to the official Transformers.js documentation. This avoids a GitHub push-protection false positive; runtime and inference logic are unchanged.
