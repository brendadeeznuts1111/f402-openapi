# Fantasy402 Login Session Data — Master Agent

**Captured**: 2026-05-17
**Account**: Master Agent (`<customerID>`)
**Agent Type**: `M`
**Office**: `<office>`

## Raw Captured Session String

Do not commit raw Fantasy402 session strings. The browser session dump contains a live bearer JWT and the plaintext login password from `sessionStorage.credentials`.

Sanitized shape showing exact concatenation format:

```text
AgentSkinOverride
MASTER_ID
<customerID>
agentTypeM
credentials{<json>}
customerID<customerID>
token0
```

This string is a concatenated dump of several `sessionStorage` keys that the legacy Fantasy402 frontend creates immediately after a successful login. The keys are appended without delimiters in a fixed order.

## Breakdown

| Part | Value | Meaning |
|------|-------|---------|
| `AgentSkinOverride` | empty | No custom skin override for this master agent |
| `MASTER_ID` | empty or not set | Master agent ID, often blank for top-level masters |
| `<customerID>` | account identifier | Logged-in customer ID, forced uppercase |
| `agentType` | `M` | Master Agent (`M` = Master, `A` = Sub-Agent) |
| `credentials` | JSON object | Main session payload (see below) |
| `customerID` | `<customerID>` | Repeated customer identifier |
| `token` | `0` | Legacy token flag; not the active JWT |

## Credentials JSON

Sanitized shape showing all observed fields:

```json
{
  "code": "<jwt>",
  "redirect_uri": "fantasy402.com",
  "password": "<redacted-password>",
  "customerID": "<customerID>"
}
```

The `code` field is the JWT used as the API bearer token. It is included in the `Authorization: Bearer` header of all subsequent API calls. The Worker's `extractAuthToken` function searches the login response for fields named `tokenauth`, `tokenAuth`, `token`, `access_token`, or `authorization` (in that order) to extract the bearer JWT.

### Decoded JWT Payload

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

**Field reference:**

| Field | Value | Meaning |
|-------|-------|---------|
| `sub` | `<customerID>` | Subject: the logged-in user |
| `type` | `0` | Account type indicator; `0` corresponds to the agent login role |
| `ag` | `""` | Agent context — observed as empty for master agents |
| `imp` | `""` | Impersonator — populated during sub-agent delegation |
| `off` | `<office>` | Office code |
| `rb` | `null` | Reserved field, likely rebate or referral |
| `nbf` | Unix timestamp | Not Before — token validity start |
| `exp` | Unix timestamp | Expiration — token validity end |

**Token lifetime**: The JWT's own `exp` - `nbf` delta was ~21 minutes in the captured sample. The Worker independently caches the session with a 4-hour TTL (`DEFAULT_SESSION_TTL_SECONDS` = 14400) and does not decode the JWT to check its `exp`. The `renewToken` endpoint is called before upstream API calls when cached auth exists, not on a fixed timer. On the browser side, the frontend calls `renewToken` every ~5 minutes to keep the JWT fresh.

## How the Site Uses This Data

- The frontend stores the JSON payload in `sessionStorage.credentials`.
- Subsequent API calls include `Authorization: Bearer <jwt>`.
- Browser API requests also include Cloudflare cookies such as `cf_clearance` and `__cf_bm`.
- The frontend request helpers inject operation-specific fields such as `agentID`, `agentOwner`, and `customerID`.
- Master agents with `agentType: "M"` are redirected to the manager dashboard (`manager.html`).

## Token Refresh

- The JWT is refreshed via `/cloud/api/System/renewToken`.
- The frontend calls this endpoint every ~5 minutes on an interval, not at the moment of expiry.
- The Worker also runs a proactive `*/5 * * * *` scheduled cron that calls `tryRenewFantasy402Token` via `refreshAuthSchedule()`, matching the frontend refresh cadence.
- The refresh response returns a new `code` (JWT) that replaces the current `sessionStorage.credentials.code`.
- The associated `customerID` and `agentType` remain unchanged across refreshes.

## Implications for Our Systems

- The ingestion Worker must send the JWT in the `Authorization` header when browser-derived auth is available.
- The Worker should preserve observed browser headers by name and value, while diagnostics and failure archives must only expose sanitized header names.
- The local browser-ingest path should be preferred when Cloudflare rejects Worker egress to Fantasy402.
- Token refresh should use the observed browser auth flow when possible, but expired browser captures must be replaced with a fresh successful `/cloud/api/*` request.
- **Security**: Passwords are stored in plaintext in `sessionStorage` on the client side (legacy behavior). Passwords, JWTs, and cookie values must never be committed, logged, returned in summaries, or embedded in OpenAPI examples.
