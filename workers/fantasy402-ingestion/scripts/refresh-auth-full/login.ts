import type { Page } from "puppeteer";

const FANTASY_ORIGIN = "https://fantasy402.com";

/** Wait until we are on fantasy402.com with challenge cookies (best-effort). */
async function waitForFantasySessionCookies(page: Page, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (!url.startsWith(FANTASY_ORIGIN)) {
      await page.goto(FANTASY_ORIGIN, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    const cookies = await page.cookies(FANTASY_ORIGIN);
    const names = new Set(cookies.map((c) => c.name));
    if (names.has("cf_clearance") || names.has("__cf_bm")) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.warn("Timed out waiting for cf_clearance/__cf_bm; login may still work via DOM form.");
}

export async function waitForCloudflare(page: Page, maxRetries = 1): Promise<void> {
  console.log(`Navigating to ${FANTASY_ORIGIN}...`);
  await page.goto(FANTASY_ORIGIN, { waitUntil: "networkidle2", timeout: 60_000 });

  let resolved = false;
  try {
    await page.waitForFunction(
      () => !document.querySelector(".cf-browser-verification"),
      { timeout: 30_000 },
    );
    resolved = true;
    console.log("Cloudflare challenge resolved.");
  } catch {
    console.log("No Cloudflare challenge detected or timed out; proceeding...");
  }

  if (!resolved && maxRetries > 0) {
    await new Promise((r) => setTimeout(r, 2000));
    await page.goto(FANTASY_ORIGIN, { waitUntil: "networkidle2", timeout: 60_000 });
    try {
      await page.waitForFunction(
        () => !document.querySelector(".cf-browser-verification"),
        { timeout: 30_000 },
      );
      console.log("Cloudflare challenge resolved on retry.");
    } catch {
      console.log("Challenge still not resolved on retry; proceeding...");
    }
  }
}

/** Build authenticateCustomer body (mirrors Worker authenticateFantasy402). */
function buildAuthenticateForm(customerId: string, password: string): URLSearchParams {
  const upper = customerId.toLocaleUpperCase();
  const form = new URLSearchParams();
  form.set("customerID", upper);
  form.set("state", "true");
  form.set("password", password);
  form.set("sufix", "");
  form.set("prefix", "");
  form.set("multiaccount", "1");
  form.set("response_type", "code");
  form.set("client_id", upper);
  form.set("domain", "fantasy402.com");
  form.set("redirect_uri", "fantasy402.com");
  form.set("operation", "authenticateCustomer");
  form.set("RRO", "1");
  return form;
}

/** Login via same-origin authenticateCustomer (matches Worker + upstream contract). */
export async function loginFantasy402(page: Page, customerId: string, password: string): Promise<void> {
  const upper = customerId.toLocaleUpperCase();
  await waitForFantasySessionCookies(page);
  await page.goto(FANTASY_ORIGIN, { waitUntil: "networkidle2", timeout: 60_000 }).catch(() => undefined);

  const formBody = buildAuthenticateForm(customerId, password).toString();
  const runApiLogin = () =>
    page.evaluate(
    async (body, cid) => {
      const res = await fetch("/cloud/api/System/authenticateCustomer", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Accept": "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
        },
        body,
        credentials: "include",
      });

      const text = await res.text();
      const contentType = res.headers.get("content-type") ?? "";
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        const preview = text.trim() ? text.slice(0, 200) : "(empty body)";
        return {
          ok: false,
          status: res.status,
          contentType,
          pageUrl: location.href,
          message: `Non-JSON response (HTTP ${res.status}, ${contentType || "no content-type"}): ${preview}`,
        };
      }

      if (!res.ok) {
        return { ok: false, status: res.status, message: JSON.stringify(data).slice(0, 300) };
      }

      const tokenKeys = ["tokenauth", "tokenAuth", "token", "access_token", "authorization", "code"];
      const stack: unknown[] = [data];
      let jwt = "";
      while (stack.length && !jwt) {
        const value = stack.pop();
        if (!value || typeof value !== "object") continue;
        const obj = value as Record<string, unknown>;
        for (const key of tokenKeys) {
          const v = obj[key];
          if (typeof v === "string" && v.split(".").length === 3) {
            jwt = v;
            break;
          }
        }
        if (!jwt) {
          for (const child of Object.values(obj)) {
            if (child && typeof child === "object") stack.push(child);
          }
        }
      }
      if (!jwt) {
        return { ok: false, status: res.status, message: "authenticateCustomer did not return a JWT" };
      }

      sessionStorage.setItem(
        "credentials",
        JSON.stringify({
          code: jwt,
          redirect_uri: "fantasy402.com",
          customerID: cid,
        }),
      );
      sessionStorage.setItem("customerID", cid);
      return { ok: true, status: res.status, jwt: jwt.slice(0, 12) + "…" };
    },
    formBody,
    upper,
  );

  let result = await runApiLogin().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!/execution context|navigation/i.test(message)) throw error;
    console.warn("API login evaluate interrupted by navigation; retrying once…");
    await page.goto(FANTASY_ORIGIN, { waitUntil: "networkidle2", timeout: 60_000 });
    await waitForFantasySessionCookies(page, 20_000);
    return runApiLogin();
  });

  if (!result.ok) {
    const detail =
      "pageUrl" in result && result.pageUrl
        ? `${result.message} @ ${result.pageUrl}`
        : result.message;
    console.warn(`API login failed (${detail}); trying DOM login form…`);
    if (process.env.PUPPETEER_HEADLESS !== "false") {
      console.warn("Tip: Cloudflare often blocks headless login — retry with PUPPETEER_HEADLESS=false");
    }
    await loginViaDomForm(page, upper, password);
    return;
  }
  console.log(`Login OK (JWT prefix ${result.jwt}).`);
  await ensureMasterAgentSession(page, upper);
}

/** Open manager.html and set Master-agent session keys the SPA expects. */
export async function ensureMasterAgentSession(page: Page, customerId: string): Promise<void> {
  const upper = customerId.toLocaleUpperCase();
  const managerUrl = `${FANTASY_ORIGIN}/manager.html?v=${Date.now()}`;
  console.log(`Navigating to manager (agentType M): ${managerUrl}`);
  await page.goto(managerUrl, { waitUntil: "networkidle2", timeout: 60_000 });

  await page.evaluate((cid) => {
    sessionStorage.setItem("customerID", cid);
    sessionStorage.setItem("agentTypeM", "M");
    sessionStorage.setItem("agentType", "M");
    sessionStorage.setItem("MASTER_ID", cid);
    const raw = sessionStorage.getItem("credentials");
    if (raw) {
      try {
        const cred = JSON.parse(raw) as Record<string, unknown>;
        cred.customerID = cid;
        sessionStorage.setItem("credentials", JSON.stringify(cred));
      } catch {
        /* ignore */
      }
    }
  }, upper);

  await page.waitForFunction(
    () => {
      try {
        if (sessionStorage.getItem("agentTypeM") !== "M") return false;
        const raw = sessionStorage.getItem("credentials");
        if (!raw) return false;
        const cred = JSON.parse(raw);
        return Boolean(cred?.code);
      } catch {
        return false;
      }
    },
    { timeout: 30_000 },
  );
  console.log("Manager session ready (agentTypeM=M, credentials present).");
}

/** Fallback when in-page fetch login fails (e.g. challenge page, CORS edge cases). */
async function loginViaDomForm(page: Page, customerId: string, password: string): Promise<void> {
  const loginUrl = `${FANTASY_ORIGIN}/`;
  await page.goto(loginUrl, { waitUntil: "networkidle2", timeout: 60_000 });
  await waitForFantasySessionCookies(page, 30_000);

  const selectors = {
    customerId: [
      'input[name="customerID"]',
      "#customerID",
      "#txtCustomerID",
      'input[id*="customer" i]',
      'input[placeholder*="customer" i]',
      'input[type="text"]',
    ],
    password: ['input[name="password"]', "#password", "#txtPassword", 'input[type="password"]'],
    submit: [
      'button[type="submit"]',
      'input[type="submit"]',
      "#loginButton",
      "#btnLogin",
      ".login-button",
      'button[id*="login" i]',
    ],
  };

  async function typeFirst(matchers: string[], value: string) {
    for (const sel of matchers) {
      const el = await page.$(sel);
      if (el) {
        await el.click({ clickCount: 3 });
        await el.type(value, { delay: 20 });
        return true;
      }
    }
    return false;
  }

  const typedId = await typeFirst(selectors.customerId, customerId);
  const typedPwd = await typeFirst(selectors.password, password);
  if (!typedId || !typedPwd) {
    throw new Error("DOM login: could not find customer ID or password fields");
  }

  for (const sel of selectors.submit) {
    const btn = await page.$(sel);
    if (btn) {
      await btn.click();
      break;
    }
  }

  await page.waitForFunction(
    () => {
      if (/manager\.html/i.test(location.href)) return true;
      try {
        const raw = sessionStorage.getItem("credentials");
        if (!raw) return false;
        const cred = JSON.parse(raw) as { code?: string };
        return Boolean(cred?.code);
      } catch {
        return false;
      }
    },
    { timeout: 90_000 },
  );
  console.log("DOM login OK.");
  await ensureMasterAgentSession(page, customerId);
}
