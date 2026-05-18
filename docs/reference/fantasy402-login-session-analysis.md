# Fantasy402 Login Session Data - Master Agent

**Captured**: 2026-05-17
**Account shape**: Master Agent
**Agent Type**: `M`

## Raw Captured Session String

Do not commit raw Fantasy402 session strings. The browser session dump contains a live bearer JWT and the plaintext login password from `sessionStorage.credentials`.

Sanitized shape:

```text
AgentSkinOverride
MASTER_ID
<customerID>
agentTypeM
credentials{
  "code":"<jwt>",
  "redirect_uri":"fantasy402.com",
  "password":"<redacted-password>",
  "customerID":"<customerID>"
}
customerID<customerID>
token0
```

This string is a concatenated dump of several `sessionStorage` keys that the legacy Fantasy402 frontend creates immediately after a successful login.

## Breakdown

| Part | Value | Meaning |
|------|-------|---------|
| `AgentSkinOverride` | empty | No custom skin override for this master agent |
| `MASTER_ID` | empty or not set | Master agent ID, often blank for top-level masters |
| customer ID value | `<customerID>` | Logged-in customer ID, forced uppercase |
| `agentType` | `M` | Master Agent. `M` = Master, `A` = Sub-Agent |
| `credentials` | JSON object | Main session payload |
| `customerID` | `<customerID>` | Repeated customer identifier |
| `token` | `0` | Legacy token flag; not the active JWT |

## Credentials JSON

Sanitized shape:

```json
{
  "code": "<jwt>",
  "redirect_uri": "fantasy402.com",
  "password": "<redacted-password>",
  "customerID": "<customerID>"
}
```

The `code` field is the JWT used as the API bearer token.

Decoded JWT payload shape:

```json
{
  "sub": "<customerID>",
  "type": 0,
  "ag": "",
  "imp": "",
  "off": "<office>",
  "rb": null,
  "nbf": 0,
  "exp": 0
}
```

- `sub` is the logged-in user.
- `type` is the account type indicator observed in the Fantasy402 token.
- `off` is the office code.
- `nbf` and `exp` are numeric Unix timestamps for token validity.

## How The Site Uses This Data

- The frontend stores the JSON payload in `sessionStorage.credentials`.
- Subsequent API calls include `Authorization: Bearer <jwt>`.
- Browser API requests also include Cloudflare cookies such as `cf_clearance` and `__cf_bm`.
- The frontend request helpers inject operation-specific fields such as `agentID`, `agentOwner`, and `customerID`.
- Master agents with `agentType: "M"` are redirected to the manager dashboard.

## Implications For Our Systems

- The ingestion Worker must send the JWT in the `Authorization` header when browser-derived auth is available.
- The Worker should preserve observed browser headers by name and value, while diagnostics and failure archives must only expose sanitized header names.
- The local browser-ingest path should be preferred when Cloudflare rejects Worker egress to Fantasy402.
- Token refresh should use the observed browser auth flow when possible, but expired browser captures must be replaced with a fresh successful `/cloud/api/*` request.
- Passwords, JWTs, and cookie values must never be committed, logged, returned in summaries, or embedded in OpenAPI examples.
