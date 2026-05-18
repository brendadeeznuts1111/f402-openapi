# Fantasy402 Login Session Deep Dive

**Captured**: 2026-05-17
**Account shape**: Master Agent (`<customerID>`)
**Agent Type**: `M`
**Office**: `<office>`

This document expands the sanitized login-session reference in
[fantasy402-login-session-analysis.md](fantasy402-login-session-analysis.md).
It intentionally does not include raw JWTs, passwords, cookie values, or
account-specific identifiers.

## 1. Raw Session Storage Shape

Do not commit raw `sessionStorage` dumps. A successful Fantasy402 login stores a
bearer JWT and the plaintext login password inside `sessionStorage.credentials`.

Sanitized concatenated dump shape:

```text
AgentSkinOverride
MASTER_ID
<customerID>
agentTypeM
credentials{"code":"<jwt>","redirect_uri":"fantasy402.com","password":"<redacted-password>","customerID":"<customerID>"}
customerID<customerID>
token0
```

This is not one browser storage key. It is a delimiter-free concatenation of
multiple legacy frontend values created immediately after login.

## 2. Parsed Session Storage Values

| Key | Sanitized value | Purpose |
|-----|-----------------|---------|
| `AgentSkinOverride` | empty | Optional custom skin override |
| `MASTER_ID` | empty or not set | Master hierarchy root |
| customer ID alias | `<customerID>` | Uppercase customer identifier |
| `agentType` | `M` | Master Agent (`M`), contrasted with sub-agent (`A`) |
| `credentials` | JSON object | Core session payload |
| `customerID` | `<customerID>` | Repeated customer identifier |
| `token` | `0` | Legacy flag; the active bearer token is `credentials.code` |

## 3. Credentials JSON

Sanitized shape:

```json
{
  "code": "<jwt>",
  "redirect_uri": "fantasy402.com",
  "password": "<redacted-password>",
  "customerID": "<customerID>"
}
```

The `code` field is the JWT used in subsequent API calls as
`Authorization: Bearer <jwt>`. The password field is a legacy client-side
anti-pattern and must not be persisted in our systems.

## 4. Decoded JWT Payload Shape

```json
{
  "sub": "<customerID>",
  "type": 0,
  "ag": "",
  "imp": "",
  "off": "<office>",
  "rb": null,
  "nbf": <unix-timestamp>,
  "exp": <unix-timestamp>
}
```

| Claim | Meaning |
|-------|---------|
| `sub` | Logged-in user identifier |
| `type` | Account type indicator observed in the Fantasy402 token |
| `ag` | Agent context; observed empty for master-agent captures |
| `imp` | Impersonation context; empty when not impersonating |
| `off` | Office identifier |
| `rb` | Reserved field observed as `null` |
| `nbf` | Token validity start timestamp |
| `exp` | Token expiration timestamp |

The JWT is signed by Fantasy402. Our code should decode it only for local expiry
diagnostics, never for authorization decisions.

## 5. Observed Login Flow

1. The user submits the login form.
2. The legacy frontend normalizes relevant identifiers to uppercase before
   building the login request.
3. The browser posts to `/cloud/api/System/authenticateCustomer` for the normal
   customer login path.
4. If the page is already operating with an agent token, the legacy flow may use
   `/cloud/api/System/authenticateCustomerforAgent` instead.
5. The response provides the bearer JWT used as `credentials.code`, account
   metadata consumed by the frontend, and login flags such as `tokenauth`.
6. The frontend stores the session payload in `sessionStorage.credentials`.
7. The frontend redirects based on account metadata such as `DefaultSiteSkin`
   and agent type. Master agents are redirected to `manager.html`.

Keep the agent-token login path documented separately if a fresh trace captures
its exact request and response shape.

## 6. Subsequent API Behavior

After login, browser API calls pass through the legacy request helper layer
observed around `$.ajaxPrefilter` / `presetParam`. That layer prepares the
request before it reaches the `/cloud/api/*` endpoint.

Browser API calls use:

- `Authorization: Bearer <jwt>`
- Cloudflare cookies such as `cf_clearance` and `__cf_bm`
- Browser headers from the original request, including `user-agent`,
  `x-requested-with`, `sec-fetch-*`, and `sec-ch-ua*`
- Operation-specific POST bodies
- Automatically injected routing fields where required, especially:

```js
{
  agentID: "<master-id-or-customerID>",
  agentOwner: "<master-id-or-customerID>"
}
```

The effective agent value comes from the active master context when present and
falls back to the logged-in customer ID for top-level master-agent sessions.

Observed manager API examples:

```text
POST /cloud/api/Manager/getAccountInfoOwner
Content-Type: application/json
Body: {"operation":"getAccountInfoOwner","agentOwner":"<customerID>"}
```

```text
POST /cloud/api/Manager/getAuthorizations
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
Body: agentID=<customerID>&agentOwner=<customerID>&operation=getAuthorizations&RRO=1
```

See [fantasy402-getauthorizations-endpoint.md](fantasy402-getauthorizations-endpoint.md) for the full request/response shape and permission flag reference.

The frontend request helpers can also inject fields such as `customerID`
depending on the operation. Keep endpoint request shapes tied to observed
browser traffic instead of assuming every route uses the same body encoding or
the same routing tuple.

## 7. Token Refresh

- The frontend refreshes the JWT through `/cloud/api/System/renewToken`.
- The observed browser behavior refreshes periodically, roughly every five
  minutes, while the page remains active.
- The Worker mirrors this cadence with a `*/5 * * * *` scheduled cron that
  proactively calls `tryRenewFantasy402Token` via `refreshAuthSchedule()` every
  5 minutes when cached auth exists.
- The refresh response provides a replacement JWT.
- Expired browser captures must be replaced with a fresh successful
  `/cloud/api/*` Network request.

The ingestion tooling now reports JWT expiry locally without printing the token.
Expired captures fail before Worker auth refresh or Fantasy402 upstream calls.

## 8. Login Sequence Diagram

The following Mermaid diagram shows the end-to-end login flow, including the
optional CAPTCHA and OTP branches observed in the legacy frontend code:

```mermaid
sequenceDiagram
    participant User
    participant Frontend as Frontend<br/>(RequireJS + jQuery)
    participant Backend as Fantasy402 Backend<br/>(/cloud/api/System/)
    participant Storage as sessionStorage
    participant Redirect as Skin/Dashboard

    %% 1. Login Initiation
    User->>Frontend: Submit form<br/>(customer ID / password)
    Note right of Frontend: Force uppercase<br/>customerID -> &lt;CUSTOMER_ID&gt;<br/>password -> &lt;PASSWORD&gt;

    %% 2. Main Auth Call
    Frontend->>Backend: POST /authenticateCustomer<br/>form-urlencoded<br/>(customerID, password, RRO=1, operation=authenticateCustomer, ...)
    Backend-->>Frontend: 200 OK + JSON<br/>{ code: "&lt;jwt&gt;", accountInfo: {...}, tokenauth? }

    %% 3. Session Storage
    Frontend->>Storage: sessionStorage.credentials = JSON<br/>{ code: "&lt;jwt&gt;", password: "&lt;redacted&gt;", customerID, ... }
    Frontend->>Storage: sessionStorage.customerID = "&lt;CUSTOMER_ID&gt;"
    Frontend->>Storage: sessionStorage.agentType = "M"
    Frontend->>Storage: sessionStorage.token = 0 (legacy)

    %% 4. Optional Branches
    alt CAPTCHA Required
        Backend-->>Frontend: accountInfo.UseCaptcha = "Y"
        Frontend->>User: Show CAPTCHA iframe (SweetAlert2)
        User->>Frontend: Complete CAPTCHA
        Frontend->>Backend: POST /validCaptcha
        Backend-->>Frontend: Success
    end

    alt OTP / 2FA Required
        Backend-->>Frontend: tokenauth = true OR setup QR
        Frontend->>User: SweetAlert2 OTP modal (or QR setup)
        User->>Frontend: Enter 6-digit code
        Frontend->>Backend: POST /OTPLoginWithCode OR /OTPConfirmSetup
        Backend-->>Frontend: Success
    end

    %% 5. Master Agent Redirect
    Frontend->>Frontend: Check accountInfo.AgentType === "M"
    Frontend->>Redirect: Redirect to manager.html<br/>or skin-specific page<br/>(Gotham, Toronto, etc.)
    Note right of Redirect: Uses DefaultSiteSkin + AgentSkinOverride

    %% 6. Ongoing Behavior
    loop Every 5 minutes
        Frontend->>Backend: POST /renewToken<br/>(Authorization: Bearer &lt;JWT&gt;)
        Backend-->>Frontend: New JWT
        Frontend->>Storage: Update credentials.code
    end

    %% 7. Idle Timeout
    Note over Frontend,Storage: IdleTimer (30 min) -> sessionDestroy() + redirect to /
```

## 9. Session Lifecycle (Idle Timeout)

The frontend includes an idle-timer mechanism observed in the legacy code:

- **Timeout**: 30 minutes of inactivity.
- **Trigger**: No user interaction (click, keypress, touch) within the window.
- **Action**: Calls `sessionDestroy()` which clears `sessionStorage` and redirects to `/`.
- **Workaround**: The timer resets on any user interaction. A `mousemove` listener
  on the document body keeps the session alive in active browser tabs.
- **Observed implementation**: A `setInterval` check every 10 seconds comparing
  `Date.now()` against the last interaction timestamp.

No corresponding Worker-side idle timeout exists — the Worker relies entirely on
its 4-hour session cache TTL (`DEFAULT_SESSION_TTL_SECONDS`) and the proactive
5-minute `renewToken` cron to maintain upstream access.

## 10. authenticateCustomer Request Parameter Catalog

The following table catalogs every observed parameter sent to
`POST https://fantasy402.com/cloud/api/System/authenticateCustomer`. The Worker
reproduces these exactly at `src/index.ts:1132-1144`.

| Parameter | Value | Source | Sensitivity |
|-----------|-------|--------|-------------|
| `customerID` | Uppercase username | User input | **High** — PII |
| `password` | Plaintext credential | User input | **High** — credential |
| `state` | `true` | Static constant | Low |
| `sufix` | `""` | Static constant | Low |
| `prefix` | `""` | Static constant | Low |
| `multiaccount` | `1` | Static constant | Low |
| `response_type` | `code` | Static constant | Low |
| `client_id` | Same as `customerID` | Derived | **High** — PII |
| `domain` | `fantasy402.com` | Static constant | Low |
| `redirect_uri` | `fantasy402.com` | Static constant | Low |
| `operation` | `authenticateCustomer` | Static constant | Low |
| `RRO` | `1` | Static constant | Low |

### Worker Implementation (src/index.ts:1132-1144)

```typescript
const customerId = env.FANTASY402_USERNAME.toLocaleUpperCase();
form.set("customerID", customerId);
form.set("state", "true");
form.set("password", env.FANTASY402_PASSWORD);
form.set("sufix", "");
form.set("prefix", "");
form.set("multiaccount", "1");
form.set("response_type", "code");
form.set("client_id", customerId);
form.set("domain", "fantasy402.com");
form.set("redirect_uri", "fantasy402.com");
form.set("operation", "authenticateCustomer");
form.set("RRO", "1");
```

### Alternative Endpoint: authenticateCustomerforAgent

- **Trigger**: Used when the page already has an `agToken` (agent token) from a
  prior sub-agent or delegated session.
- **Difference**: Includes additional agent-context parameters such as the
  active `agToken` as a bearer-like header or body field.
- **Not yet captured**: A full browser trace of this path is needed to document
  its exact request and response shape.

## 11. Login Response: accountInfo Fields

The `authenticateCustomer` response includes an `accountInfo` object containing
profile and authorization fields consumed by the frontend for redirect and UI
decisions. Fields relevant to the login flow:

| Field | Type | Login Flow Role |
|-------|------|----------------|
| `AgentType` | string | Determines **M** (master) vs **A** (sub-agent) redirect |
| `DefaultSiteSkin` | string | Selects themed dashboard (Gotham, Toronto, etc.) |
| `Office` | string | Multi-tenant routing identifier |
| `AgentID` | string | Account owner identifier for API request bodies |
| `UseCaptcha` | `"Y"` or `""` | If `"Y"`, triggers CAPTCHA modal before redirect |
| `OTPEnabled` | integer | If `1`, OTP/2FA is configured for this account |
| `OTP` | string | OTP secret or status indicator |
| `SuspectedBot` | (present) | Observed flag; triggers bot verification |
| `DomainRedirect` | string | Override redirect target if set |
| `SkinOverride` | string | Per-account skin override |
| `AgentSkinOverride` | string | Agent-forced skin override |

These fields are catalogued in the OpenAPI spec at
`.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.slim.yaml`
under `components.schemas.AccountInfo` (line 7267).

## 12. Security and Operational Implications

| Issue | Severity | Operational response |
|-------|----------|----------------------|
| Plaintext password in `sessionStorage.credentials` | High | Never commit, log, archive, or store the password after capture |
| Bearer JWT in browser storage | High | Treat copied sessions as secrets and redact output |
| Cloudflare cookies required for browser parity | Medium | Require fresh `cf_clearance` and `__cf_bm` from a successful request |
| JWT expiry is independent of Worker cache TTL | Medium | Reject expired captures locally and request a fresh browser capture |
| Master-agent access has broad scope | High | Keep endpoint set explicit and avoid speculative ingestion expansion |

## 13. Worker Implementation Cross-Reference

Every login flow step is mapped to the Ingestion Worker source code:

| Flow Step | Endpoint | Worker Source | Mechanism |
|-----------|----------|---------------|-----------|
| Login auth | `POST /cloud/api/System/authenticateCustomer` | `src/index.ts:1156` | `fetchWithTimeout` with form-urlencoded body |
| Login params | 12 fields (customerID, password, RRO, etc.) | `src/index.ts:1140-1154` | `URLSearchParams` form assembly inside `authenticateFantasy402()` |
| Password handling | Read from secret, used once, not stored | `src/index.ts:1145` | `env.FANTASY402_PASSWORD` — never in session cache |
| Token extraction | Response field `tokenauth` / `token` / `authorization` | `src/index.ts:2132-2144` | `extractAuthToken()` recursively searches object values |
| Session cookie extraction | `Set-Cookie` header → `app_session` | `src/index.ts:1158`, `:2146-2152` | `optionalFirstSetCookie()` filters Cloudflare cookies |
| Session cache | KV store (`SESSION_KV`) | `src/index.ts:1129-1132` | `SESSION_KV.get<SessionRecord>()` with TTL check |
| Auth overlay | KV store (`AUTH_CACHE`) | `src/index.ts:989-1004` | `AuthCacheRecord` built by browser-auth endpoint handler |
| Cookie assembly | 3-layer merge (session, cf_clearance, __cf_bm) | `src/index.ts:1442-1449` | `fantasy402CookieHeader()` deduplicates by `cookieName()` |
| Auth header | `Authorization: Bearer <JWT>` | `src/index.ts:1387-1388` | `normalizeAuthorization(env.FANTASY402_AUTHORIZATION)` |
| Token refresh | `POST /cloud/api/System/renewToken` | `src/index.ts:1197-1212` | Empty body via `URLSearchParams`, `Auth: Bearer <existing JWT>` |
| Scheduled renewal | `*/5 * * * *` cron trigger | `src/index.ts:378`, `:1248-1259` | `refreshAuthSchedule()` reads `AUTH_CACHE`, calls `tryRenewFantasy402Token()` |
| Session TTL | 4-hour cache expiry | `src/index.ts:153` | `DEFAULT_SESSION_TTL_SECONDS = 14400` |
| Agent type in bodies | `agentType: "M"` sent per-endpoint | `src/index.ts:290` | `getListAgenstByAgent` request body |
| Agent ID/owner | `agentID` + `agentOwner` in every endpoint body | `src/index.ts:200-372` | All `buildBody()` functions include both fields (or `withDateRange` wrapper) |

## 14. Ingestion Worker Guidance

- Store and send the browser JWT as `Authorization: Bearer <jwt>`.
- Preserve observed browser header names and values for upstream requests, but
  expose only sanitized header names in diagnostics and failure archives.
- Require the Cloudflare cookies plus a non-Cloudflare app session cookie when
  using the production unblock command.
- Prefer the local browser-ingest path when Fantasy402/Cloudflare rejects Worker
  egress.
- Keep request body encoding per endpoint. For example, `getAccountInfoOwner`
  has been observed as JSON, while `getAuthorizations` has been observed as form
  data.
- The Worker runs a `*/5 * * * *` scheduled cron via `refreshAuthSchedule()`
  that proactively calls `tryRenewFantasy402Token` every 5 minutes, matching
  the frontend refresh cadence.
- Never embed raw credentials, JWTs, cookie values, or account identifiers in
  OpenAPI examples.
