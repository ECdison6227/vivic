# Optional local speech models

Only the pinned manifest and this explanation belong in `public/models/`.
Do not commit ONNX weights, WASM files, `preload.data`, or recordings here.

Vivic downloads a model only after an explicit user action. Downloads go into
the browser's `vivic-local-speech-v1` IndexedDB database, not this directory.
The full byte count and SHA-256 are checked before caching and again before
inference. Cancelled or failed downloads are not usable models. Clear the
cache from Control; downloads may require temporary space exceeding their
final asset size. Browser eviction/private mode/quota can prevent caching.

`asr-zh`: X-ASR Chinese/English 480 ms INT8, 169,227,953 bytes, Apache-2.0.
`kws-zh-en`: Zipformer Chinese/English KWS, 13,076,183 bytes, Apache-2.0.
`vad`: Silero VAD v5, 2,313,101 bytes, MIT.
These sizes exclude npm WASM runtimes and inference memory. Revision, exact
URL, digest, model metadata, and license links are in `sherpaw-manifest.json`.
VAD uses the Sherpa maintainer's fixed Hugging Face revision with the identical
SHA-256 as the original GitHub release asset. The original GitHub URL lacks
browser CORS headers. Module code imports only its colocated `manifest.json`;
this public copy is for URL-based access and must stay byte-identical.

The Sherpaw wrapper code is Apache-2.0. Preserve its upstream notices and each
model's own license/attribution when redistributing. TTS is not supplied by
Sherpaw here. Any browser `speechSynthesis` adapter is separate, disabled by
default, and does not guarantee offline voices.

For an explicitly requested development download, from the repository root:

```sh
node scripts/speech-models/download.mjs --all
```

This writes verified development weights only under `.cache/sherpaw-poc/`.
It does not start the app, record a microphone, or play sound.
