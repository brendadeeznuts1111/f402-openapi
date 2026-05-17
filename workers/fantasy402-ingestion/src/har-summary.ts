export interface HarRequestSummary {
  method: string;
  url: string;
  host: string;
  status: number;
  statusText: string;
  timeMs: number;
  bodySize: number;
}

export interface HarNetworkSummary {
  totalRequests: number;
  byMethod: Record<string, number>;
  byStatus: Record<string, number>;
  byHost: Record<string, number>;
  byMimeType: Record<string, number>;
  failedRequests: HarRequestSummary[];
  slowestRequests: HarRequestSummary[];
  largestResponses: HarRequestSummary[];
}

export function summarizeHar(har: unknown): HarNetworkSummary {
  const entries = harEntries(har);
  const byMethod = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const byHost = new Map<string, number>();
  const byMimeType = new Map<string, number>();
  const failedRequests: HarRequestSummary[] = [];
  const timedRequests: HarRequestSummary[] = [];
  const sizedResponses: HarRequestSummary[] = [];

  for (const entry of entries) {
    const request = asRecord(entry.request);
    const response = asRecord(entry.response);
    const content = asRecord(response.content);
    const method = stringValue(request.method, "UNKNOWN");
    const url = stringValue(request.url, "");
    const host = hostFromUrl(url) ?? "unknown";
    const status = numberValue(response.status, 0);
    const statusText = stringValue(response.statusText, "");
    const mimeType = stringValue(content.mimeType, "unknown");
    const timeMs = numberValue(entry.time, 0);
    const bodySize = Math.max(numberValue(response.bodySize, 0), numberValue(content.size, 0));

    increment(byMethod, method);
    increment(byStatus, String(status));
    increment(byHost, host);
    increment(byMimeType, mimeType || "unknown");

    const requestSummary = { method, url, host, status, statusText, timeMs, bodySize };
    if (status === 0 || status >= 400) failedRequests.push(requestSummary);
    timedRequests.push(requestSummary);
    sizedResponses.push(requestSummary);
  }

  return {
    totalRequests: entries.length,
    byMethod: objectFromCountMap(byMethod),
    byStatus: objectFromCountMap(byStatus),
    byHost: objectFromCountMap(byHost),
    byMimeType: objectFromCountMap(byMimeType),
    failedRequests: failedRequests.slice(0, 20),
    slowestRequests: timedRequests.sort((a, b) => b.timeMs - a.timeMs).slice(0, 10),
    largestResponses: sizedResponses.sort((a, b) => b.bodySize - a.bodySize).slice(0, 10),
  };
}

function harEntries(har: unknown): Array<Record<string, unknown>> {
  const root = asRecord(har);
  const log = asRecord(root.log);
  return Array.isArray(log.entries) ? log.entries.map(asRecord) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hostFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function objectFromCountMap(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}
