/* Audio Library Worker 2.3.0
 * Required R2 binding: PODCAST_BUCKET -> podcast-audio
 * Optional text variable: MAX_UPLOAD_BYTES (single-request uploads, default 95 MiB)
 * This is deliberately an OPEN upload API: no login, CAPTCHA or rate limiter.
 * The size/type checks below are transport checks, not malware scanning.
 * Do not put API tokens in this file. R2 is accessed via its Worker binding.
 */
const DEFAULT_MAX_BYTES = 95 * 1024 * 1024;
const MULTIPART_PART_BYTES = 64 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 10000;
const MAX_MULTIPART_UPLOAD_BYTES = MULTIPART_PART_BYTES * MAX_MULTIPART_PARTS;
const MAX_SHARED_SUBJECT_SHARD_BYTES = 4 * 1024 * 1024;
const MAX_SHARED_SUBJECTS_PER_SHARD = 10000;
const DEFAULT_MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-File-Name, X-Title, X-Subject-Id, X-Subject-Name, X-Subject-Color, X-Duration, Range, If-Range, If-None-Match",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
  "Access-Control-Max-Age": "3600",
  "X-Content-Type-Options": "nosniff"
};
function json(data, status = 200, extra = {}) {
  return Response.json(data, { status, headers: { ...CORS, "Cache-Control": "no-store", ...extra } });
}
function methodNotAllowed(allow) { return json({ ok: false, error: "Method not allowed." }, 405, { Allow: allow }); }
function maxUploadBytes(env) {
  if (env.MAX_UPLOAD_BYTES === undefined || env.MAX_UPLOAD_BYTES === "") return DEFAULT_MAX_BYTES;
  const bytes = Number(env.MAX_UPLOAD_BYTES);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 95 * 1024 * 1024) throw new Error("MAX_UPLOAD_BYTES must be a positive integer no greater than 95 MiB for this single-request implementation.");
  return bytes;
}
function maxTranscriptBytes(env) {
  if (env.MAX_TRANSCRIPT_BYTES === undefined || env.MAX_TRANSCRIPT_BYTES === "") return DEFAULT_MAX_TRANSCRIPT_BYTES;
  const bytes = Number(env.MAX_TRANSCRIPT_BYTES);
  if (!Number.isSafeInteger(bytes) || bytes < 1024 || bytes > 16 * 1024 * 1024) throw new Error("MAX_TRANSCRIPT_BYTES must be between 1 KiB and 16 MiB.");
  return bytes;
}
function decodedHeader(request, name, max) {
  let value = request.headers.get(name) || "";
  try { value = decodeURIComponent(value); } catch (_) { /* Accept older unencoded clients. */ }
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}
async function readJsonBody(request, maxBytes) {
  const header = request.headers.get("content-length");
  if (header === null || !/^\d+$/.test(header)) throw new Error("A Content-Length header is required.");
  const length = Number(header);
  if (!Number.isSafeInteger(length) || length < 2) throw new Error("The JSON request body is empty or invalid.");
  if (length > maxBytes) throw new Error("The JSON request body is too large.");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== length || bytes.byteLength > maxBytes) throw new Error("The received JSON size did not match the request.");
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch (_) { throw new Error("The JSON request body is malformed."); }
}
function cleanJsonText(value, max) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "";
}
function normalizeSharedSubject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.subjectId !== "string" || value.subjectId.length > 80) return null;
  const subjectId = cleanJsonText(value.subjectId, 80);
  if (!subjectId) return { subjectId: "", subjectName: "", subjectColor: "" };
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(subjectId) || ["all", "unsorted", "__proto__", "constructor"].includes(subjectId)) return null;
  const subjectName = cleanJsonText(value.subjectName, 60), subjectColor = typeof value.subjectColor === "string" ? value.subjectColor : "";
  if (!subjectName || !/^#[0-9a-f]{6}$/i.test(subjectColor)) return null;
  return { subjectId, subjectName, subjectColor };
}
function sharedSubjectShardKey(shard) { return `metadata/subject-assignments/${shard}.json`; }
async function readSharedSubjectShard(bucket, shard) {
  const object = await bucket.get(sharedSubjectShardKey(shard));
  if (!object) return { assignments: Object.create(null), etag: null };
  if (object.size > MAX_SHARED_SUBJECT_SHARD_BYTES) throw new Error("The shared subject assignment data is too large.");
  let data;
  try { data = await object.json(); } catch (_) { throw new Error("The shared subject assignment data is malformed."); }
  if (!data || data.schemaVersion !== 1 || !data.assignments || typeof data.assignments !== "object" || Array.isArray(data.assignments)) throw new Error("The shared subject assignment data is invalid.");
  const entries = Object.entries(data.assignments);
  if (entries.length > MAX_SHARED_SUBJECTS_PER_SHARD) throw new Error("The shared subject assignment data has too many entries.");
  const assignments = Object.create(null);
  for (const [id, value] of entries) {
    const audioId = id.toLowerCase();
    if (!UUID.test(audioId) || audioId[0] !== shard) continue;
    const subject = normalizeSharedSubject(value);
    if (subject) assignments[audioId] = subject;
  }
  return { assignments, etag: object.etag };
}
async function writeSharedSubjectAssignment(bucket, audioId, subject) {
  const shard = audioId[0], key = sharedSubjectShardKey(shard);
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await readSharedSubjectShard(bucket, shard);
    if (!Object.hasOwn(current.assignments, audioId) && Object.keys(current.assignments).length >= MAX_SHARED_SUBJECTS_PER_SHARD) return null;
    current.assignments[audioId] = subject;
    const body = JSON.stringify({ schemaVersion: 1, assignments: current.assignments });
    if (new TextEncoder().encode(body).byteLength > MAX_SHARED_SUBJECT_SHARD_BYTES) return null;
    const onlyIf = current.etag ? { etagMatches: current.etag } : { etagDoesNotMatch: "*" };
    const result = await bucket.put(key, body, { onlyIf, httpMetadata: { contentType: "application/json; charset=utf-8" } });
    if (result) return true;
  }
  return false;
}
function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}
function validateTranscript(value, origin, audioId) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1) throw new Error("Transcript schemaVersion 1 is required.");
  const expected = `cloud:${origin}:${audioId}`;
  if (value.recordingIdentity !== expected) throw new Error("Transcript recording identity does not match the audio recording.");
  if (typeof value.text !== "string" || !value.text.trim() || value.text.length > 2_000_000) throw new Error("Transcript text is missing or too large.");
  if (!Array.isArray(value.segments) || value.segments.length > 50_000) throw new Error("Transcript segments are invalid or too numerous.");
  const duration = value.duration === null ? null : Number(value.duration);
  if (duration !== null && (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60 * 60)) throw new Error("Transcript duration is invalid.");
  let previous = -1;
  const segments = value.segments.map(segment => {
    if (!segment || typeof segment.text !== "string" || !segment.text.trim() || segment.text.length > 20_000) throw new Error("A transcript segment is invalid.");
    const untimed = segment.start === null && segment.end === null;
    if (untimed) return { start: null, end: null, text: segment.text.trim() };
    const start = Number(segment.start), end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start < previous || (duration !== null && end > duration + 2)) throw new Error("Transcript timestamps are invalid or out of order.");
    previous = start; return { start, end, text: segment.text.trim() };
  });
  const string = (input, max) => typeof input === "string" ? input.slice(0, max) : "";
  return { schemaVersion: 1, recordingIdentity: expected, sourceIdentity: string(value.sourceIdentity, 800) || expected, language: string(value.language, 30) || "und", engine: string(value.engine, 100) || "unknown", model: string(value.model, 300) || "unknown", modelRevision: string(value.modelRevision, 100), generatedAt: Number.isFinite(Date.parse(value.generatedAt)) ? new Date(value.generatedAt).toISOString() : new Date().toISOString(), duration, text: value.text.trim(), segments };
}
// null = ignore unsupported/malformed Range and send 200; false = unsatisfiable.
export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!size) return false;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return false;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false;
    end = Math.min(end, size - 1);
  }
  return { offset: start, length: end - start + 1 };
}
function audioHeaders(object) {
  const headers = new Headers(CORS);
  object.writeHttpMetadata(headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream");
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "public, max-age=3600, no-transform");
  headers.set("Content-Disposition", "inline");
  return headers;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      if (url.pathname === "/") {
        if (!["GET", "HEAD"].includes(request.method)) return methodNotAllowed("GET, HEAD");
        return new Response(request.method === "HEAD" ? null : "Podcast API is running", { headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
      }
      if (!env.PODCAST_BUCKET) return json({ ok: false, error: "R2 binding PODCAST_BUCKET is missing." }, 503);
      if (url.pathname === "/health") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        const result = await env.PODCAST_BUCKET.list({ limit: 1 });
        return json({ ok: true, r2Connected: true, objectsFound: result.objects.length, version: "2.3.0", maxUploadBytes: MAX_MULTIPART_UPLOAD_BYTES, singleRequestMaxUploadBytes: maxUploadBytes(env), uploadPartBytes: MULTIPART_PART_BYTES, maxTranscriptBytes: maxTranscriptBytes(env) });
      }
      if (url.pathname === "/library") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        const requested = Number(url.searchParams.get("limit") || 100);
        const limit = Number.isSafeInteger(requested) ? Math.max(1, Math.min(200, requested)) : 100;
        const cursor = url.searchParams.get("cursor") || undefined;
        if (cursor && cursor.length > 2048) return json({ ok: false, error: "The library cursor is invalid." }, 400);
        const listed = await env.PODCAST_BUCKET.list({ prefix: "audio/", limit, cursor, include: ["customMetadata", "httpMetadata"] });
        const shards = Array.from(new Set(listed.objects.map(object => object.key.slice(6).toLowerCase()).filter(id => UUID.test(id)).map(id => id[0])));
        const assignmentsByShard = new Map();
        for (const shard of shards) assignmentsByShard.set(shard, (await readSharedSubjectShard(env.PODCAST_BUCKET, shard)).assignments);
        const recordings = listed.objects.map(object => {
          const id = object.key.slice(6).toLowerCase(), metadata = object.customMetadata || {};
          if (!UUID.test(id)) return null;
          const duration = Number(metadata.duration);
          const assignment = assignmentsByShard.get(id[0])?.[id];
          return {
            id,
            title: String(metadata.title || metadata.originalFileName || "Shared recording").slice(0, 180),
            fileName: String(metadata.originalFileName || "Recording").slice(0, 250),
            size: object.size,
            type: object.httpMetadata?.contentType || "",
            duration: Number.isFinite(duration) && duration > 0 ? duration : null,
            subjectId: assignment ? assignment.subjectId : /^[a-zA-Z0-9_-]{1,80}$/.test(metadata.subjectId || "") ? metadata.subjectId : "",
            subjectName: assignment ? assignment.subjectName : String(metadata.subjectName || "").slice(0, 60),
            subjectColor: assignment ? assignment.subjectColor : /^#[0-9a-f]{6}$/i.test(metadata.subjectColor || "") ? metadata.subjectColor : "",
            createdAt: object.uploaded instanceof Date ? object.uploaded.getTime() : Date.parse(object.uploaded) || 0,
            audioUrl: `${url.origin}/audio/${id}`
          };
        }).filter(Boolean);
        return json({ ok: true, recordings, truncated: Boolean(listed.truncated), cursor: listed.truncated ? listed.cursor : undefined }, 200, { "Cache-Control": "no-store" });
      }
      if (url.pathname === "/upload/multipart") {
        if (request.method !== "POST" || url.searchParams.get("action") !== "create") return methodNotAllowed("POST");
        if ((request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json") return json({ ok: false, error: "An application/json Content-Type is required." }, 415);
        let input;
        try { input = await readJsonBody(request, 32 * 1024); }
        catch (error) { return json({ ok: false, error: error.message }, 400); }
        if (!input || typeof input !== "object" || Array.isArray(input)) return json({ ok: false, error: "The upload metadata is invalid." }, 400);
        const size = Number(input.size);
        if (!Number.isSafeInteger(size) || size <= maxUploadBytes(env) || size > MAX_MULTIPART_UPLOAD_BYTES) return json({ ok: false, error: `Multipart uploads must be larger than ${formatBytes(maxUploadBytes(env))} and no larger than ${formatBytes(MAX_MULTIPART_UPLOAD_BYTES)}.` }, 413);
        const contentType = String(input.contentType || "").split(";")[0].trim().toLowerCase();
        if (!/^audio\/[a-z0-9.+-]+$/.test(contentType)) return json({ ok: false, error: "An audio Content-Type is required." }, 415);
        const fileName = cleanJsonText(input.fileName, 200) || "podcast";
        const title = cleanJsonText(input.title, 180) || fileName.replace(/\.[^.]+$/, "") || "Shared recording";
        const subjectIdValue = cleanJsonText(input.subjectId, 80);
        const durationValue = Number(input.duration);
        const id = crypto.randomUUID(), key = `audio/${id}`;
        const customMetadata = {
          originalFileName: fileName,
          title,
          subjectId: /^[a-zA-Z0-9_-]{1,80}$/.test(subjectIdValue) ? subjectIdValue : "",
          subjectName: cleanJsonText(input.subjectName, 60),
          subjectColor: /^#[0-9a-f]{6}$/i.test(input.subjectColor || "") ? input.subjectColor : "",
          duration: Number.isFinite(durationValue) && durationValue > 0 && durationValue <= 24 * 60 * 60 ? String(durationValue) : "",
          uploadSize: String(size),
          uploadPartSize: String(MULTIPART_PART_BYTES)
        };
        const multipart = await env.PODCAST_BUCKET.createMultipartUpload(key, { httpMetadata: { contentType }, customMetadata });
        return json({ ok: true, id, uploadId: multipart.uploadId, partSize: MULTIPART_PART_BYTES, audioUrl: `${url.origin}/audio/${id}` }, 201);
      }
      const multipartRoute = /^\/upload\/multipart\/([^/]+)$/.exec(url.pathname);
      if (multipartRoute) {
        const id = multipartRoute[1].toLowerCase();
        if (!UUID.test(id)) return json({ ok: false, error: "Invalid multipart upload ID." }, 400);
        const key = `audio/${id}`, action = url.searchParams.get("action"), uploadId = url.searchParams.get("uploadId") || "";
        if (!uploadId || uploadId.length > 1024 || /[\u0000-\u001f\u007f]/.test(uploadId)) return json({ ok: false, error: "A valid multipart upload ID is required." }, 400);
        if (request.method === "PUT" && action === "part") {
          const partHeader = request.headers.get("content-length"), partNumber = Number(url.searchParams.get("partNumber"));
          if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > MAX_MULTIPART_PARTS) return json({ ok: false, error: "The multipart part number is invalid." }, 400);
          if (partHeader === null || !/^\d+$/.test(partHeader)) return json({ ok: false, error: "A Content-Length header is required for each part." }, 411);
          const partSize = Number(partHeader);
          if (!Number.isSafeInteger(partSize) || partSize < 1 || partSize > MULTIPART_PART_BYTES || !request.body) return json({ ok: false, error: "The multipart part is empty or too large." }, 413);
          const multipart = env.PODCAST_BUCKET.resumeMultipartUpload(key, uploadId);
          const uploadedPart = await multipart.uploadPart(partNumber, request.body);
          return json({ ok: true, partNumber: uploadedPart.partNumber, etag: uploadedPart.etag });
        }
        if (request.method === "POST" && action === "complete") {
          let input;
          try { input = await readJsonBody(request, 2 * 1024 * 1024); }
          catch (error) { return json({ ok: false, error: error.message }, 400); }
          if (!input || typeof input !== "object" || Array.isArray(input)) return json({ ok: false, error: "The multipart completion data is invalid." }, 400);
          if (!Array.isArray(input.parts) || !Number.isSafeInteger(Number(input.size)) || Number(input.size) < 1 || Number(input.size) > MAX_MULTIPART_UPLOAD_BYTES) return json({ ok: false, error: "The multipart completion data is invalid." }, 400);
          const expectedSize = Number(input.size), expectedCount = Math.ceil(expectedSize / MULTIPART_PART_BYTES);
          if (input.parts.length !== expectedCount || input.parts.length > MAX_MULTIPART_PARTS) return json({ ok: false, error: "The multipart upload is missing one or more parts." }, 400);
          const parts = [];
          for (let i = 0; i < input.parts.length; i++) {
            const part = input.parts[i], partNumber = Number(part?.partNumber), etag = typeof part?.etag === "string" ? part.etag : "";
            if (partNumber !== i + 1 || !etag || etag.length > 256) return json({ ok: false, error: "Multipart parts must be complete, ordered, and valid." }, 400);
            parts.push({ partNumber, etag });
          }
          let result;
          try { result = await env.PODCAST_BUCKET.resumeMultipartUpload(key, uploadId).complete(parts); }
          catch (_) { return json({ ok: false, error: "R2 could not complete the multipart upload. Retry the missing part or cancel the upload." }, 400); }
          const recordedSize = Number(result.customMetadata?.uploadSize);
          if (result.size !== expectedSize || (Number.isSafeInteger(recordedSize) && recordedSize !== expectedSize)) {
            await env.PODCAST_BUCKET.delete(key);
            return json({ ok: false, error: "The completed recording size did not match the selected file." }, 400);
          }
          return json({ ok: true, id, fileName: result.customMetadata?.originalFileName || "podcast", size: result.size, audioUrl: `${url.origin}/audio/${id}` }, 201);
        }
        if (request.method === "DELETE" && action === "abort") {
          await env.PODCAST_BUCKET.resumeMultipartUpload(key, uploadId).abort();
          return json({ ok: true });
        }
        return methodNotAllowed("PUT, POST, DELETE");
      }
      if (url.pathname === "/upload") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!/^audio\/[a-z0-9.+-]+$/.test(contentType)) return json({ ok: false, error: "An audio Content-Type is required." }, 415);
        const lengthHeader = request.headers.get("content-length");
        if (lengthHeader === null || !/^\d+$/.test(lengthHeader)) return json({ ok: false, error: "A Content-Length header is required. Use the website's file uploader." }, 411);
        const length = Number(lengthHeader), limit = maxUploadBytes(env);
        if (!Number.isSafeInteger(length) || length < 1 || !request.body) return json({ ok: false, error: "The file is empty or has an invalid length." }, 400);
        if (length > limit) return json({ ok: false, error: `Maximum upload size is ${(limit / 1048576).toFixed(1)} MiB.` }, 413);
        const fileName = decodedHeader(request, "x-file-name", 200) || "podcast";
        const title = decodedHeader(request, "x-title", 180) || fileName.replace(/\.[^.]+$/, "") || "Shared recording";
        const subjectIdValue = decodedHeader(request, "x-subject-id", 80);
        const subjectName = decodedHeader(request, "x-subject-name", 60);
        const subjectColorValue = decodedHeader(request, "x-subject-color", 7);
        const durationValue = Number(request.headers.get("x-duration"));
        const customMetadata = {
          originalFileName: fileName,
          title,
          subjectId: /^[a-zA-Z0-9_-]{1,80}$/.test(subjectIdValue) ? subjectIdValue : "",
          subjectName,
          subjectColor: /^#[0-9a-f]{6}$/i.test(subjectColorValue) ? subjectColorValue : "",
          duration: Number.isFinite(durationValue) && durationValue > 0 && durationValue <= 24 * 60 * 60 ? String(durationValue) : ""
        };
        const id = crypto.randomUUID(), key = `audio/${id}`;
        // Stream directly: no formData(), arrayBuffer(), or full-file buffer.
        const result = await env.PODCAST_BUCKET.put(key, request.body, {
          httpMetadata: { contentType }, customMetadata
        });
        if (!result || result.size !== length || result.size > limit) {
          await env.PODCAST_BUCKET.delete(key);
          return json({ ok: false, error: "The received file size did not match the upload." }, 400);
        }
        return json({ ok: true, id, fileName, size: result.size, audioUrl: `${url.origin}/audio/${id}` }, 201);
      }
      if (url.pathname === "/transcripts") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        if ((request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json") return json({ ok: false, error: "An application/json Content-Type is required." }, 415);
        const lengthHeader = request.headers.get("content-length"), limit = maxTranscriptBytes(env);
        if (lengthHeader === null || !/^\d+$/.test(lengthHeader)) return json({ ok: false, error: "A Content-Length header is required." }, 411);
        const length = Number(lengthHeader);
        if (!Number.isSafeInteger(length) || length < 2) return json({ ok: false, error: "The transcript payload is empty or invalid." }, 400);
        if (length > limit) return json({ ok: false, error: `Maximum transcript payload is ${(limit / 1048576).toFixed(1)} MiB.` }, 413);
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength !== length || bytes.byteLength > limit) return json({ ok: false, error: "The received transcript size did not match the request." }, 400);
        let payload;
        try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch (_) { return json({ ok: false, error: "The transcript JSON is malformed." }, 400); }
        const audioId = String(payload.audioId || "").toLowerCase();
        if (!UUID.test(audioId)) return json({ ok: false, error: "A valid associated audio ID is required." }, 400);
        if (!await env.PODCAST_BUCKET.head(`audio/${audioId}`)) return json({ ok: false, error: "The associated audio recording does not exist." }, 404);
        let transcript;
        try { transcript = validateTranscript(payload.transcript, url.origin, audioId); }
        catch (error) { return json({ ok: false, error: error.message }, 400); }
        const id = crypto.randomUUID(), key = `transcripts/${id}.json`;
        // The server chooses a fresh ID and exposes no update route, so callers
        // cannot select or overwrite another transcript object.
        const stored = JSON.stringify({ schemaVersion: 1, audioId, transcript, publishedAt: new Date().toISOString() });
        await env.PODCAST_BUCKET.put(key, stored, { httpMetadata: { contentType: "application/json; charset=utf-8" }, customMetadata: { audioId } });
        return json({ ok: true, id, audioId, transcriptUrl: `${url.origin}/transcripts/${id}` }, 201);
      }
      const transcriptRoute = /^\/transcripts\/([^/]+)$/.exec(url.pathname);
      if (transcriptRoute) {
        if (request.method !== "GET") return methodNotAllowed("GET");
        const id = transcriptRoute[1].toLowerCase();
        if (!UUID.test(id)) return json({ ok: false, error: "Invalid transcript ID." }, 400);
        const object = await env.PODCAST_BUCKET.get(`transcripts/${id}.json`);
        if (!object || !("body" in object)) return json({ ok: false, error: "Transcript not found." }, 404);
        const headers = new Headers(CORS); headers.set("Content-Type", "application/json; charset=utf-8"); headers.set("Content-Length", String(object.size)); headers.set("ETag", object.httpEtag); headers.set("Cache-Control", "public, max-age=31536000, immutable, no-transform");
        return new Response(object.body, { status: 200, headers });
      }
      const subjectRoute = /^\/audio\/([^/]+)\/subject$/.exec(url.pathname);
      if (subjectRoute) {
        if (request.method !== "PUT") return methodNotAllowed("PUT");
        const id = subjectRoute[1].toLowerCase();
        if (!UUID.test(id)) return json({ ok: false, error: "Invalid audio ID." }, 400);
        if ((request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json") return json({ ok: false, error: "An application/json Content-Type is required." }, 415);
        let input;
        try { input = await readJsonBody(request, 16 * 1024); }
        catch (error) { return json({ ok: false, error: error.message }, 400); }
        const subject = normalizeSharedSubject(input);
        if (!subject) return json({ ok: false, error: "The shared subject assignment is invalid." }, 400);
        if (!await env.PODCAST_BUCKET.head(`audio/${id}`)) return json({ ok: false, error: "Audio not found." }, 404);
        const stored = await writeSharedSubjectAssignment(env.PODCAST_BUCKET, id, subject);
        if (stored === null) return json({ ok: false, error: "The shared subject assignment limit was reached." }, 413);
        if (!stored) return json({ ok: false, error: "Another subject update happened at the same time. Retry the assignment." }, 409);
        return json({ ok: true, id, ...subject });
      }
      const route = /^\/audio\/([^/]+)(\/info)?$/.exec(url.pathname);
      if (route) {
        const id = route[1];
        if (!UUID.test(id)) return json({ ok: false, error: "Invalid audio ID." }, 400);
        if (!["GET", "HEAD"].includes(request.method)) return methodNotAllowed("GET, HEAD");
        const key = `audio/${id.toLowerCase()}`, head = await env.PODCAST_BUCKET.head(key);
        if (!head) return json({ ok: false, error: "Audio not found." }, 404);
        if (route[2]) {
          if (request.method !== "GET") return methodNotAllowed("GET");
          return json({ ok: true, id, fileName: head.customMetadata?.originalFileName || "Recording", size: head.size, contentType: head.httpMetadata?.contentType || "", audioUrl: `${url.origin}/audio/${id}` });
        }
        const headers = audioHeaders(head);
        // HEAD describes the complete object. Range applies only to GET.
        if (request.method === "HEAD") { headers.set("Content-Length", String(head.size)); return new Response(null, { status: 200, headers }); }
        const condition = request.headers.get("if-none-match");
        if (condition && (condition === "*" || condition.split(",").some(tag => tag.trim().replace(/^W\//, "") === head.httpEtag))) return new Response(null, { status: 304, headers });
        const ifRange = request.headers.get("if-range");
        const range = !ifRange || ifRange === head.httpEtag ? parseRange(request.headers.get("range"), head.size) : null;
        if (range === false) {
          headers.set("Content-Range", `bytes */${head.size}`);
          headers.set("Content-Length", "0");
          return new Response(null, { status: 416, headers });
        }
        const object = range ? await env.PODCAST_BUCKET.get(key, { range }) : await env.PODCAST_BUCKET.get(key);
        if (!object || !("body" in object)) return json({ ok: false, error: "Audio not found." }, 404);
        const length = range ? range.length : object.size;
        headers.set("Content-Length", String(length));
        if (range) headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
        // Explicit status: do not infer partial responses from object.range.
        return new Response(object.body, { status: range ? 206 : 200, headers });
      }
      return json({ ok: false, error: "Not found." }, 404);
    } catch (error) {
      console.error("Podcast API error:", error.name, error.message);
      return json({ ok: false, error: "The server could not complete this request. Check Worker logs and the PODCAST_BUCKET binding." }, 500);
    }
  }
};
