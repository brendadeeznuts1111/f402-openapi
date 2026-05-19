/** In-page harvest helpers (mirrors dashboard/js/live-session-auth.js). */

export interface HarvestedSession {
  jwt: string;
  customerId: string;
  cfClearance: string;
  cfBm: string;
  userAgent: string;
  referer: string;
}

/** Runs inside the browser via page.evaluate. */
export function harvestInPage(): HarvestedSession {
  let cfClearance = "";
  let cfBm = "";
  for (const part of document.cookie.split(";")) {
    const t = part.trim();
    if (!cfClearance && t.startsWith("cf_clearance=")) cfClearance = t;
    if (!cfBm && t.startsWith("__cf_bm=")) cfBm = t;
  }
  let jwt = "";
  try {
    const raw = sessionStorage.getItem("credentials");
    if (raw) {
      const cred = JSON.parse(raw) as { code?: string };
      if (cred?.code) jwt = String(cred.code).trim();
    }
  } catch {
    /* ignore */
  }
  let customerId = "";
  try {
    customerId = (sessionStorage.getItem("customerID") || "").trim();
  } catch {
    /* ignore */
  }
  return {
    jwt,
    customerId,
    cfClearance,
    cfBm,
    userAgent: navigator.userAgent || "",
    referer: location.href || "https://fantasy402.com/manager.html",
  };
}

export function buildRefreshPayload(harvest: HarvestedSession) {
  const jwt = harvest.jwt.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) throw new Error("No JWT in sessionStorage.credentials.code after login");

  const authorization = jwt.startsWith("Bearer ") ? jwt : `Bearer ${jwt}`;
  const cfClearance = harvest.cfClearance.includes("=")
    ? harvest.cfClearance.split("=")[1]
    : harvest.cfClearance;
  const cfBm = harvest.cfBm.includes("=") ? harvest.cfBm.split("=")[1] : harvest.cfBm;

  if (!cfClearance || !cfBm) {
    throw new Error("Missing cf_clearance or __cf_bm after login");
  }

  const base = "https://fantasy402.com";
  const browserHeaders: Record<string, string> = {
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    origin: base,
    priority: "u=1, i",
    referer: harvest.referer || `${base}/manager.html`,
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": harvest.userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "x-requested-with": "XMLHttpRequest",
  };

  return {
    authorization,
    cfClearance,
    cfBm,
    customerId: harvest.customerId,
    userAgent: harvest.userAgent,
    referer: browserHeaders.referer,
    browserHeaders,
    expiresInSeconds: jwtTtlSeconds(authorization),
  };
}

export function buildBrowserAuthJson(payload: ReturnType<typeof buildRefreshPayload>) {
  const agentId = payload.customerId || process.env.FANTASY402_AGENT_ID || "";
  return {
    customerId: payload.customerId,
    agentId,
    authorization: payload.authorization,
    sessionCookie: "",
    cfClearance: payload.cfClearance,
    cfBm: payload.cfBm,
    browserHeaders: payload.browserHeaders,
    expiresInSeconds: payload.expiresInSeconds,
  };
}

function jwtTtlSeconds(authorization: string): number {
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const parts = token.split(".");
  if (parts.length < 2) return 3600;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { exp?: number };
    if (!payload.exp) return 3600;
    return Math.max(60, Math.min(28800, payload.exp - Math.floor(Date.now() / 1000)));
  } catch {
    return 3600;
  }
}
