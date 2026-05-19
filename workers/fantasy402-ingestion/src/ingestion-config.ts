import { UPSTREAM_MANIFEST } from "./upstream-manifest";

export const INGESTION_CURSOR_KEY = "fantasy402:ingestion-cursor";
export const INGESTION_ALL = "all";

export interface IngestionBatchPlan {
  keys: string[];
  cursor: number;
  nextCursor: number;
  batchSize: number;
  catalogSize: number;
}

/** Resolve configured ingestion keys. `all` expands to the full upstream manifest. */
export function resolveIngestionEndpointKeys(
  configured: string,
  options: {
    hasCustomerId: boolean;
    isKnownKey(key: string): boolean;
    requiresCustomerId(key: string): boolean;
  },
): string[] {
  const raw = configured.trim();
  if (!raw) return [];

  if (raw.toLowerCase() === INGESTION_ALL) {
    return UPSTREAM_MANIFEST.endpoints
      .map((entry) => entry.key)
      .filter((key) => options.isKnownKey(key))
      .filter((key) => !options.requiresCustomerId(key) || options.hasCustomerId);
  }

  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function ingestionBatchSize(value: string | undefined, fallback = 12): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(86, parsed));
}

/** Rotate through the catalog so each cron processes a bounded batch. */
export function planIngestionBatch(
  catalogKeys: string[],
  cursor: number,
  batchSize: number,
): IngestionBatchPlan {
  if (!catalogKeys.length) {
    return { keys: [], cursor: 0, nextCursor: 0, batchSize, catalogSize: 0 };
  }

  const size = Math.min(batchSize, catalogKeys.length);
  const start = ((cursor % catalogKeys.length) + catalogKeys.length) % catalogKeys.length;
  const keys: string[] = [];
  for (let i = 0; i < size; i += 1) {
    keys.push(catalogKeys[(start + i) % catalogKeys.length]!);
  }

  return {
    keys,
    cursor: start,
    nextCursor: (start + size) % catalogKeys.length,
    batchSize: size,
    catalogSize: catalogKeys.length,
  };
}
