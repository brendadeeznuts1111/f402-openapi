/**
 * Persist unattended-cycle outcomes for backoff and operator visibility.
 */
import fs from "node:fs";
import path from "node:path";
import { computeCycleBackoffMs, readAutomationPolicy } from "./automation-policy.mjs";

export function defaultCycleStatePath(workerRoot) {
  return (
    process.env.F402_CYCLE_STATE_FILE ??
    path.join(workerRoot, "fantasy402", ".unattended-cycle-state.json")
  );
}

export function readCycleState(stateFile) {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

export function isCycleInBackoff(state, nowMs = Date.now()) {
  if (!state?.nextEligibleAt) return false;
  const at = Date.parse(state.nextEligibleAt);
  return Number.isFinite(at) && at > nowMs;
}

export function recordCycleOutcome(stateFile, outcome) {
  const policy = readAutomationPolicy();
  const previous = readCycleState(stateFile);
  const failed = outcome.status !== "ok";
  const consecutiveFailures = failed ? (previous?.consecutiveFailures ?? 0) + 1 : 0;
  const backoffMs = computeCycleBackoffMs(consecutiveFailures, policy);
  const nextEligibleAt =
    backoffMs > 0 ? new Date(Date.now() + backoffMs).toISOString() : null;

  const next = {
    lastRunAt: new Date().toISOString(),
    lastStatus: outcome.status,
    consecutiveFailures,
    nextEligibleAt,
    steps: outcome.steps ?? {},
    summary: outcome.summary ?? null,
    message: outcome.message ?? null,
  };

  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

/** Persist outcome and optionally POST alert webhook (see cycle-alerts.mjs). */
export async function recordCycleOutcomeWithAlerts(stateFile, outcome, options = {}) {
  const next = recordCycleOutcome(stateFile, outcome);
  if (options.alerts === false) return { state: next, alert: { sent: false, reason: "disabled" } };

  const { maybeSendCycleAlert, markCycleAlertSent } = await import("./cycle-alerts.mjs");
  const alert = await maybeSendCycleAlert(next, options);
  if (alert.sent) {
    const updated = markCycleAlertSent(stateFile, next);
    return { state: updated, alert };
  }
  return { state: next, alert };
}
