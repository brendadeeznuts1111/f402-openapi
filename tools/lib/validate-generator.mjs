#!/usr/bin/env node
/**
 * Validate generator inputs/outputs with worker Zod schemas.
 */
import { localIngestSchema, parseJsonValue, parseSearchParams, validationErrorBody } from './f402-schemas.mjs';

export function validateQuery(schema, searchParams, label = 'query') {
  const params =
    searchParams instanceof URLSearchParams
      ? searchParams
      : new URLSearchParams(
          typeof searchParams === 'string'
            ? searchParams.replace(/^\?/, '')
            : Object.entries(searchParams ?? {}).map(([k, v]) => [k, String(v)]),
        );
  const result = parseSearchParams(schema, params);
  if (!result.ok) {
    const body = validationErrorBody(result.error);
    throw new Error(`${label}: ${body.message}`);
  }
  return result.data;
}

export function validateBody(schema, value, label = 'body') {
  const result = parseJsonValue(schema, value);
  if (!result.ok) {
    const body = validationErrorBody(result.error);
    throw new Error(`${label}: ${body.message}`);
  }
  return result.data;
}

/** Validate local-ingest console script endpoint spec shape. */
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
  return validateBody(localIngestSchema, payload, 'ingest/local upload');
}
