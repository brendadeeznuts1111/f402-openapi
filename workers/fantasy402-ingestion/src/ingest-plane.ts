/**
 * Ingest plane: where an endpoint must be fetched to succeed.
 * - browser: fantasy402.com from operator browser IP (cf_clearance-bound)
 * - edge: may succeed from Cloudflare Worker egress (rare for Manager API)
 */
export type IngestPlane = "browser" | "edge";

/** Keys observed to succeed from Worker egress without browser IP (extend as you confirm). */
const EDGE_ELIGIBLE_KEYS = new Set<string>([
  // Empty by default — Manager routes typically 403 from Worker IP.
]);

export function ingestPlaneForKey(key: string): IngestPlane {
  return EDGE_ELIGIBLE_KEYS.has(key) ? "edge" : "browser";
}

export function partitionKeysByPlane(keys: string[]): { browser: string[]; edge: string[] } {
  const browser: string[] = [];
  const edge: string[] = [];
  for (const key of keys) {
    if (ingestPlaneForKey(key) === "edge") edge.push(key);
    else browser.push(key);
  }
  return { browser, edge };
}

export function workerTriggerMode(env: { FANTASY402_WORKER_TRIGGER_MODE?: string }): "attempt" | "skip" {
  const raw = (env.FANTASY402_WORKER_TRIGGER_MODE ?? "attempt").trim().toLowerCase();
  return raw === "skip" || raw === "off" || raw === "false" ? "skip" : "attempt";
}

export function ingestPlaneSummary(keys: string[]) {
  const parts = partitionKeysByPlane(keys);
  return {
    browserPlaneCount: parts.browser.length,
    edgeEligibleCount: parts.edge.length,
    browserPlaneKeys: parts.browser,
    edgeEligibleKeys: parts.edge,
    workerTriggerRecommendation:
      parts.edge.length === 0
        ? "Set FANTASY402_WORKER_TRIGGER_MODE=skip and use local/browser ingest for full catalog"
        : "Worker /trigger can attempt edge-eligible routes only",
  };
}
