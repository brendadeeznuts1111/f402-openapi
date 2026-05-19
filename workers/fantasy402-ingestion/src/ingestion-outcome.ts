export type IngestionOutcome = "skipped" | "failed";

/** Permission or missing-resource responses are not actionable ingestion failures. */
export function classifyIngestionOutcome(upstreamStatus: number | null | undefined): IngestionOutcome {
  if (upstreamStatus === 403 || upstreamStatus === 404) return "skipped";
  return "failed";
}

export function skipNoteForRun(endpointsSucceeded: number, endpointsFailed: number, endpointsSkipped: number): string | undefined {
  if (endpointsFailed > 0) return "One or more endpoints failed";
  if (endpointsSkipped > 0 && endpointsSucceeded === 0) {
    return "All endpoints skipped (upstream 403/404 from Worker IP — use local/browser ingest on fantasy402.com)";
  }
  if (endpointsSkipped > 0) {
    return `${endpointsSkipped} endpoint(s) skipped (upstream 403/404 — permission or IP-bound cookies)`;
  }
  return undefined;
}

export function formatRunMeta(endpointsSkipped: number, note?: string): string | undefined {
  if (endpointsSkipped > 0) {
    return JSON.stringify({
      skipped: endpointsSkipped,
      ...(note ? { note } : {}),
    });
  }
  return note;
}

export function parseRunMeta(errorMessage: string | null | undefined): { skipped: number; note?: string } {
  if (!errorMessage) return { skipped: 0 };
  try {
    const parsed = JSON.parse(errorMessage) as { skipped?: unknown; note?: unknown };
    if (parsed && typeof parsed === "object" && "skipped" in parsed) {
      return {
        skipped: Number(parsed.skipped) || 0,
        note: typeof parsed.note === "string" ? parsed.note : undefined,
      };
    }
  } catch {
    /* legacy plain-text error_message */
  }
  return { skipped: 0, note: errorMessage };
}

export function deriveRunStatus(
  endpointsSucceeded: number,
  endpointsFailed: number,
): "success" | "partial" | "failed" {
  if (endpointsFailed === 0) return "success";
  if (endpointsSucceeded > 0) return "partial";
  return "failed";
}
