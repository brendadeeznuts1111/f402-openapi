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
  function cookiePair(name: string) {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(";")) {
      const t = part.trim();
      if (t.startsWith(prefix)) return t;
    }
    return "";
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
    cfClearance: cookiePair("cf_clearance"),
    cfBm: cookiePair("__cf_bm"),
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

  const browserHeaders: Record<string, string> = {
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    origin: "https://fantasy402.com",
    referer: harvest.referer || "https://fantasy402.com/manager.html",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": harvest.userAgent,
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
  return {
    customerId: payload.customerId,
    agentId: payload.customerId,
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
