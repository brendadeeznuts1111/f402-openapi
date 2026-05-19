/**
 * Optional webhook alerts when unattended cycles fail repeatedly.
 * Supports generic JSON POST webhooks (Slack-compatible text field, Discord content, or raw body).
 */
import fs from "node:fs";

export function readAlertConfig(env = process.env) {
  return {
    webhookUrl: env.F402_ALERT_WEBHOOK_URL?.trim() || "",
    failureThreshold: Number(env.F402_ALERT_FAILURE_THRESHOLD ?? 3),
    cooldownMs: Number(env.F402_ALERT_COOLDOWN_MS ?? 3_600_000),
  };
}

export function shouldSendCycleAlert(state, config = readAlertConfig()) {
  if (!config.webhookUrl) return { send: false, reason: "no-webhook" };
  const failures = state?.consecutiveFailures ?? 0;
  if (failures < config.failureThreshold) {
    return { send: false, reason: "below-threshold", failures, threshold: config.failureThreshold };
  }
  const lastAlertAt = state?.lastAlertAt ? Date.parse(state.lastAlertAt) : 0;
  if (Number.isFinite(lastAlertAt) && Date.now() - lastAlertAt < config.cooldownMs) {
    return { send: false, reason: "cooldown", lastAlertAt: state.lastAlertAt };
  }
  return { send: true, reason: "threshold-met", failures, threshold: config.failureThreshold };
}

export function formatCycleAlertMessage(state) {
  const lines = [
    "Fantasy402 unattended ingest cycle alert",
    `status: ${state?.lastStatus ?? "unknown"}`,
    `consecutiveFailures: ${state?.consecutiveFailures ?? 0}`,
    `lastRunAt: ${state?.lastRunAt ?? "—"}`,
    `nextEligibleAt: ${state?.nextEligibleAt ?? "—"}`,
  ];
  if (state?.message) lines.push(`message: ${state.message}`);
  if (state?.summary) lines.push(`summary: ${JSON.stringify(state.summary)}`);
  return lines.join("\n");
}

export function buildWebhookBody(state, text) {
  const style = (process.env.F402_ALERT_WEBHOOK_STYLE ?? "slack").toLowerCase();
  if (style === "discord") {
    return JSON.stringify({ content: text.slice(0, 1900) });
  }
  if (style === "raw") {
    return JSON.stringify({
      event: "fantasy402.cycle.failure",
      state,
      text,
    });
  }
  return JSON.stringify({ text });
}

export async function maybeSendCycleAlert(state, options = {}) {
  const config = { ...readAlertConfig(), ...options.config };
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const decision = shouldSendCycleAlert(state, config);
  if (!decision.send) return { sent: false, ...decision };

  const text = formatCycleAlertMessage(state);
  const body = buildWebhookBody(state, text);
  const res = await fetchImpl(config.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });

  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200);
    return {
      sent: false,
      reason: "webhook-http-error",
      httpStatus: res.status,
      detail: snippet,
    };
  }

  return { sent: true, reason: "delivered", httpStatus: res.status };
}

export function markCycleAlertSent(stateFile, state) {
  const next = {
    ...state,
    lastAlertAt: new Date().toISOString(),
  };
  fs.writeFileSync(stateFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
