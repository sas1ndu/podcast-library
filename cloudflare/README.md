# Cloudflare Worker 2.2

Deploy `worker.js` to the existing `podcast-api` Worker and retain the binding:

`PODCAST_BUCKET` → private R2 bucket `podcast-audio`

Optional text variables:

- `MAX_UPLOAD_BYTES=99614720` (95 MiB; limit for the legacy single-request route)
- `MAX_TRANSCRIPT_BYTES=8388608` (8 MiB; accepted configuration range 1 KiB–16 MiB)

Audio files larger than the single-request limit use the Worker's R2 multipart API in 64 MiB parts. The app accepts files up to 625 GiB (10,000 parts); each part stays below Cloudflare's 100 MB Free/Pro request-body ceiling.

No database, public bucket, token, AI binding, or paid provider is needed.

## Routes

- `GET /health`
- `GET /library` — paginated public catalogue of `audio/` objects and safe display metadata
- `POST /upload` — unchanged raw audio body; not multipart
- `POST /upload/multipart?action=create` — start an R2 multipart upload
- `PUT /upload/multipart/:id?action=part` — stream one part
- `POST /upload/multipart/:id?action=complete` — finish the recording
- `DELETE /upload/multipart/:id?action=abort` — discard an incomplete upload
- `GET|HEAD /audio/:id`
- `GET /audio/:id/info`
- `POST /transcripts` — `{ audioId, transcript }` JSON; server creates a fresh ID
- `GET /transcripts/:id`

Audio behavior preserves full/ranged/conditional responses: 200, 206, 304, 416, HEAD metadata, ETag, and byte ranges. Existing `audio/<UUID>` keys and old player links continue working.

Published transcript objects use `transcripts/<UUID>.json`. The server verifies the associated `audio/<UUID>` exists, validates schema/timestamps/size and the exact cloud recording identity, then generates a new unpredictable ID. There is no update/delete route and visitors cannot choose a target key, so anonymous replacement is not exposed. Corrections publish another object.

## Deploy

Dashboard: edit the existing Worker, replace its code with `worker.js`, keep the R2 binding, add the optional variables if desired, and deploy. Check `/health` reports version `2.2.0` and `r2Connected: true`, then check `/library` returns a JSON catalogue.

Wrangler users can review `wrangler.jsonc` and run their normal deployment command. This source package does not deploy automatically.

## Open-upload risk

The API and recording catalogue intentionally remain anonymous as requested. MIME/length/schema validation limits individual requests but does not provide ownership, confidentiality, Turnstile, rate limiting, total quotas, or malware scanning. Anyone may upload; every visitor can list and play uploaded audio. Monitor R2/Worker use and disable or protect the routes if that risk is unacceptable.

Do not add Cloudflare tokens or R2 credentials to frontend `config.js`; R2 access stays in this server-side binding.
