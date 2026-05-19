import type { Page } from "puppeteer";

/** Renew JWT via same-origin renewToken when TTL is low (mirrors manager.html). */
export async function renewTokenInPageIfNeeded(page: Page, thresholdSeconds = 300): Promise<void> {
  const result = await page.evaluate(async (threshold) => {
    const raw = sessionStorage.getItem("credentials");
    if (!raw) return { renewed: false, reason: "no credentials" };
    const cred = JSON.parse(raw) as { code?: string };
    const code = cred?.code ? String(cred.code) : "";
    if (!code) return { renewed: false, reason: "no jwt" };

    const token = code.replace(/^Bearer\s+/i, "").trim();
    const parts = token.split(".");
    let ttl = 3600;
    if (parts.length >= 2) {
      try {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
        const payload = JSON.parse(atob(padded)) as { exp?: number };
        if (payload.exp) ttl = payload.exp - Math.floor(Date.now() / 1000);
      } catch {
        ttl = 3600;
      }
    }
    if (ttl > threshold) return { renewed: false, reason: "ttl ok", ttl };

    const cookieParts: string[] = [];
    for (const part of document.cookie.split(";")) {
      const t = part.trim();
      if (t.startsWith("cf_clearance=") || t.startsWith("__cf_bm=")) cookieParts.push(t);
    }

    const res = await fetch("/cloud/api/System/renewToken", {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://fantasy402.com",
        Referer: location.href,
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cookieParts.join("; "),
        Authorization: code.startsWith("Bearer ") ? code : `Bearer ${code}`,
      },
      body: new URLSearchParams().toString(),
    });

    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { renewed: false, reason: `renew HTTP ${res.status} non-JSON` };
    }
    if (!res.ok) return { renewed: false, reason: `renew HTTP ${res.status}` };

    const tokenKeys = ["tokenauth", "tokenAuth", "token", "code", "authorization"];
    const stack: unknown[] = [data];
    let newJwt = "";
    while (stack.length && !newJwt) {
      const value = stack.pop();
      if (!value || typeof value !== "object") continue;
      const obj = value as Record<string, unknown>;
      for (const key of tokenKeys) {
        const v = obj[key];
        if (typeof v === "string" && v.split(".").length === 3) {
          newJwt = v;
          break;
        }
      }
      if (!newJwt) {
        for (const child of Object.values(obj)) {
          if (child && typeof child === "object") stack.push(child);
        }
      }
    }
    if (!newJwt) return { renewed: false, reason: "renew returned no jwt" };

    cred.code = newJwt.replace(/^Bearer\s+/i, "").trim();
    sessionStorage.setItem("credentials", JSON.stringify(cred));

    const renewedParts = cred.code.split(".");
    let renewedTtl = 3600;
    if (renewedParts.length >= 2) {
      try {
        const base64 = renewedParts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
        const payload = JSON.parse(atob(padded)) as { exp?: number };
        if (payload.exp) renewedTtl = payload.exp - Math.floor(Date.now() / 1000);
      } catch {
        renewedTtl = 3600;
      }
    }
    return { renewed: true, ttl: renewedTtl };
  }, thresholdSeconds);

  if (result.renewed) {
    console.log(`renewToken in-page OK (ttl ${result.ttl}s).`);
  } else if (result.reason !== "ttl ok") {
    console.log(`renewToken skipped: ${result.reason}${result.ttl != null ? ` (ttl ${result.ttl}s)` : ""}.`);
  }
}
