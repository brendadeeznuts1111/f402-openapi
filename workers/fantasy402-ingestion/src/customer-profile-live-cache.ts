/** Short-lived KV cache for expensive live profile upstream calls. */

export const PROFILE_LIVE_CACHE_TTL_SECONDS = 45;
const CACHE_PREFIX = "fantasy402:profile-live:";

type CacheEnv = { AUTH_CACHE: KVNamespace };

export function profileLiveCacheKeyPerf(agentId: string, acc: string, period: number): string {
  return `${CACHE_PREFIX}perf:${agentId}:${acc}:${period}`;
}

export function profileLiveCacheKeyAnalysis(
  agentId: string,
  customerKey: string,
  startDate: string,
  endDate: string,
  reportType: number,
  lineType: number,
): string {
  return `${CACHE_PREFIX}analysis:${agentId}:${customerKey}:${startDate}:${endDate}:${reportType}:${lineType}`;
}

export async function getProfileLiveCache<T>(env: CacheEnv, key: string): Promise<T | null> {
  try {
    const raw = await env.AUTH_CACHE.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function putProfileLiveCache(env: CacheEnv, key: string, value: unknown): Promise<void> {
  try {
    await env.AUTH_CACHE.put(key, JSON.stringify(value), {
      expirationTtl: PROFILE_LIVE_CACHE_TTL_SECONDS,
    });
  } catch {
    /* best-effort */
  }
}
