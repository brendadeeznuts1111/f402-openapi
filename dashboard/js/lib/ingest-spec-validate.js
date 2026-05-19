/** Validate ingest endpoint specs (console runner + local upload). */
import { parseSafe } from './schemas.js';
import { z } from 'zod';

export const localIngestItemSchema = z.object({
  endpointKey: z.string().min(1),
  httpStatus: z.number().int().min(100).max(599).default(200),
  data: z.unknown(),
  capturedAt: z.string().optional(),
});

export const localIngestPayloadSchema = z.object({
  results: z.array(localIngestItemSchema).min(1).max(25),
  advanceCursor: z.boolean().optional(),
});

export function validateIngestSpec(spec, index = 0) {
  if (!spec || typeof spec !== 'object') {
    throw new Error(`ingest spec[${index}]: must be an object`);
  }
  const key = String(spec.key ?? '').trim();
  if (!key) throw new Error(`ingest spec[${index}]: key is required`);
  const path = String(spec.path ?? '').trim();
  if (!path.startsWith('/')) throw new Error(`ingest spec[${index}].path must start with /`);
  const method = String(spec.method ?? 'POST').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw new Error(`ingest spec[${index}].method invalid: ${method}`);
  }
  if (spec.body != null && typeof spec.body !== 'object') {
    throw new Error(`ingest spec[${index}].body must be an object when set`);
  }
  return { key, path, method, body: spec.body ?? {}, contentType: spec.contentType };
}

export function validateLocalIngestPayload(payload) {
  const parsed = parseSafe(localIngestPayloadSchema, payload);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'invalid ingest payload';
    throw new Error(msg);
  }
  return parsed.data;
}
