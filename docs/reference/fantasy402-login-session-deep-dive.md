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

The frontend request helpers can also inject fields such as `customerID`
depending on the operation. Keep endpoint request shapes tied to observed
browser traffic instead of assuming every route uses the same body encoding or
the same routing tuple.

## 7. Token Refresh

- The frontend refreshes the JWT through `/cloud/api/System/renewToken`.
- The observed browser behavior refreshes periodically, roughly every five
  minutes, while the page remains active.
- The refresh response provides a replacement JWT.
- Expired browser captures must be replaced with a fresh successful
  `/cloud/api/*` Network request.

The ingestion tooling now reports JWT expiry locally without printing the token.
Expired captures fail before Worker auth refresh or Fantasy402 upstream calls.

## 8. Security and Operational Implications

| Issue | Severity | Operational response |
|-------|----------|----------------------|
| Plaintext password in `sessionStorage.credentials` | High | Never commit, log, archive, or store the password after capture |
| Bearer JWT in browser storage | High | Treat copied sessions as secrets and redact output |
| Cloudflare cookies required for browser parity | Medium | Require fresh `cf_clearance` and `__cf_bm` from a successful request |
| JWT expiry is independent of Worker cache TTL | Medium | Reject expired captures locally and request a fresh browser capture |
| Master-agent access has broad scope | High | Keep endpoint set explicit and avoid speculative ingestion expansion |

## 9. Ingestion Worker Guidance

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
- Never embed raw credentials, JWTs, cookie values, or account identifiers in
  OpenAPI examples.
