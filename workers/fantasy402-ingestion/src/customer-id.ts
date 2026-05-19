import { UPSTREAM_MANIFEST } from "./upstream-manifest";

export const PLAYER_CUSTOMER_ID_CACHE_KEY = "fantasy402:player-customer-id";
export const GET_PLAYERS_CUSTOMER_ID_SOURCE = "Manager/getPlayers";

export function customerIdSourceForKey(key: string): string | undefined {
  const entry = UPSTREAM_MANIFEST.endpoints.find((endpoint) => endpoint.key === key);
  return entry?.customerIdSource;
}

/** Player customer IDs can be derived from getPlayers when FANTASY402_CUSTOMER_ID is unset. */
export function canDeriveCustomerId(): boolean {
  return UPSTREAM_MANIFEST.endpoints.some((endpoint) => endpoint.key === "getPlayers");
}

export function extractPlayerCustomerId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const list = (data as Record<string, unknown>).LIST;
  if (!Array.isArray(list) || list.length === 0) return null;

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    for (const field of ["customerID", "CustomerID"]) {
      const value = record[field];
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed && trimmed !== "__REDACTED__") return trimmed;
      }
    }
  }
  return null;
}

export async function readCachedPlayerCustomerId(env: { AUTH_CACHE: KVNamespace }): Promise<string | null> {
  try {
    const raw = await env.AUTH_CACHE.get(PLAYER_CUSTOMER_ID_CACHE_KEY);
    const trimmed = raw?.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

export async function cachePlayerCustomerId(env: { AUTH_CACHE: KVNamespace }, customerId: string): Promise<void> {
  const trimmed = customerId.trim();
  if (!trimmed) return;
  try {
    await env.AUTH_CACHE.put(PLAYER_CUSTOMER_ID_CACHE_KEY, trimmed);
  } catch {
    /* best-effort */
  }
}
