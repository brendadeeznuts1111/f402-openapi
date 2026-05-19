import type { Page } from "puppeteer";

const FANTASY_ORIGIN = "https://fantasy402.com";

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

/** Login via same-origin authenticateCustomer (matches Worker + upstream contract). */
export async function loginFantasy402(page: Page, customerId: string, password: string): Promise<void> {
  const upper = customerId.toLocaleUpperCase();
  const result = await page.evaluate(
    async (cid, pwd) => {
      const form = new URLSearchParams();
      form.set("customerID", cid);
      form.set("password", pwd);
      form.set("operation", "authenticateCustomer");
      form.set("RRO", "1");

      const res = await fetch("/cloud/api/System/authenticateCustomer", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: form.toString(),
      });

      const text = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return { ok: false, status: res.status, message: `Non-JSON response: ${text.slice(0, 200)}` };
      }

      if (!res.ok) {
        return { ok: false, status: res.status, message: JSON.stringify(data).slice(0, 300) };
      }

      function extractToken(value: unknown): string {
        if (!value || typeof value !== "object") return "";
        const obj = value as Record<string, unknown>;
        for (const key of ["tokenauth", "tokenAuth", "token", "access_token", "authorization", "code"]) {
          const v = obj[key];
          if (typeof v === "string" && v.split(".").length === 3) return v;
        }
        const accountInfo = obj.accountInfo;
        if (accountInfo && typeof accountInfo === "object") {
          const nested = extractToken(accountInfo);
          if (nested) return nested;
        }
        for (const child of Object.values(obj)) {
          if (child && typeof child === "object") {
            const nested = extractToken(child);
            if (nested) return nested;
          }
        }
        return "";
      }

      const jwt = extractToken(data);
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
    upper,
    password,
  );

  if (!result.ok) {
    console.warn(`API login failed (${result.message}); trying DOM login form…`);
    await loginViaDomForm(page, upper, password);
    return;
  }
  console.log(`Login OK (JWT prefix ${result.jwt}).`);

  await page.goto(`${FANTASY_ORIGIN}/manager.html`, { waitUntil: "networkidle2", timeout: 60_000 });
  await page.waitForFunction(
    () => {
      try {
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
}

/** Fallback when in-page fetch login fails (e.g. challenge page, CORS edge cases). */
async function loginViaDomForm(page: Page, customerId: string, password: string): Promise<void> {
  const loginUrl = `${FANTASY_ORIGIN}/`;
  await page.goto(loginUrl, { waitUntil: "networkidle2", timeout: 60_000 });

  const selectors = {
    customerId: ['input[name="customerID"]', "#customerID", 'input[id*="customer" i]', 'input[type="text"]'],
    password: ['input[name="password"]', "#password", 'input[type="password"]'],
    submit: ['button[type="submit"]', 'input[type="submit"]', "#loginButton", ".login-button"],
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
      try {
        const raw = sessionStorage.getItem("credentials");
        if (!raw) return false;
        const cred = JSON.parse(raw);
        return Boolean(cred?.code);
      } catch {
        return location.href.includes("manager");
      }
    },
    { timeout: 60_000 },
  );
  console.log("DOM login OK.");
  await page.goto(`${FANTASY_ORIGIN}/manager.html`, { waitUntil: "networkidle2", timeout: 60_000 });
}
