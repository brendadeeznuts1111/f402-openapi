# Fantasy402 getAuthorizations Endpoint

**Captured pattern**: 2026-05-18
**Endpoint**: `POST /cloud/api/Manager/getAuthorizations`
**Request encoding**: `application/x-www-form-urlencoded; charset=UTF-8`

This endpoint returns manager authorization and permission flags for the active
agent context. The examples below use placeholders only; do not store live
bearer tokens, cookies, account IDs, or response bodies in this repository.

## Request Shape

```bash
curl 'https://fantasy402.com/cloud/api/Manager/getAuthorizations' \
  -H 'authorization: Bearer <browser-jwt>' \
  -H 'content-type: application/x-www-form-urlencoded; charset=UTF-8' \
  -H 'origin: https://fantasy402.com' \
  -H 'referer: https://fantasy402.com/manager.html?v=<cache-bust>' \
  -H 'x-requested-with: XMLHttpRequest' \
  -b 'cf_clearance=<cf-clearance>; __cf_bm=<cf-bm>' \
  --data-raw 'agentID=<agent-id>&agentOwner=<agent-id>&operation=getAuthorizations&RRO=1'
```

Key requirements:

- `Authorization: Bearer <browser-jwt>` from the authenticated browser session (`credentials.code` — see [§3 Credentials JSON](fantasy402-login-session-deep-dive.md#3-credentials-json) in the deep-dive doc).
- Cloudflare cookies `cf_clearance` and `__cf_bm`.
- Browser-shaped headers, especially `Origin`, `Referer`, `User-Agent`, and
  `X-Requested-With`.
- Exact case-sensitive body parameters: `agentID`, `agentOwner`, `operation`,
  and `RRO`.

## Response Shape

The response contains an `INFO` object plus a top-level distribution marker.
Observed `INFO` fields include account identity, master hierarchy, commission
type, sportsbook/casino controls, deny flags, notification flags, and product
rate settings.

```json
{
  "INFO": {
    "CustomerID": "<agent-id>",
    "AgentID": "<agent-id>",
    "MasterAgentID": "<master-agent-id>",
    "CommissionType": "S",
    "PermitDeleteBets": "Y",
    "SuspendSportsbook": "N",
    "SuspendAccount": "N",
    "Freeplaymanager": "Y",
    "AllowRoundRobin": "Y",
    "AllowPropBuilder": "Y",
    "AllowUltraLive": "N",
    "AllowCrash": "N",
    "FantasyRate": 0
  },
  "DISTRIBUTION": 0
}
```

### Distribution Marker

`DISTRIBUTION` is an integer at the top level of the response. Observed values are `0` or `1`. A value of `1` indicates the agent is operating under a downstream distribution hierarchy rather than a direct master-agent relationship.

### Commission Type

`INFO.CommissionType` is a single-character string. The observed value `"S"` represents standard commission (head-count rate split). Other possible values observed elsewhere in the Fantasy402 API include `"L"` (loss-based) and `"F"` (flat-fee), though these have not been confirmed for this specific endpoint.

## Permission Flags

The `INFO` object contains boolean-like flags (`"Y"` / `"N"`) controlling agent permissions:

| Field | Type | Description |
|-------|------|-------------|
| `CustomerID` | string | Agent account identifier (same as request `agentID`) |
| `AgentID` | string | Agent identifier (typically matches `CustomerID`) |
| `MasterAgentID` | string | Parent master-agent identifier |
| `CommissionType` | string | Commission model (`"S"` = standard) |
| `PermitDeleteBets` | `"Y"` or `"N"` | Agent may delete settled bets |
| `SuspendSportsbook` | `"Y"` or `"N"` | Sportsbook access is suspended |
| `SuspendAccount` | `"Y"` or `"N"` | Account is suspended |
| `Freeplaymanager` | `"Y"` or `"N"` | Agent may issue freeplay credits |
| `AllowRoundRobin` | `"Y"` or `"N"` | Round-robin betting is permitted |
| `AllowPropBuilder` | `"Y"` or `"N"` | Proposition-builder is permitted |
| `AllowUltraLive` | `"Y"` or `"N"` | Ultra-live betting is permitted |
| `AllowCrash` | `"Y"` or `"N"` | Crash-game betting is permitted |
| `FantasyRate` | integer | Fantasy-product commission override (0 = use default) |

Additional flags may appear in `raw_json` that are not yet modeled as queryable columns (see Storage Pipeline below).

## Worker Integration

The endpoint definition is at `src/index.ts:210-218`:

```ts
getAuthorizations: {
  key: "getAuthorizations",
  path: "/cloud/api/Manager/getAuthorizations",
  buildBody: (env) => ({
    agentID: env.FANTASY402_AGENT_ID,
    agentOwner: env.FANTASY402_AGENT_ID,
    operation: "getAuthorizations",
    RRO: 1,
  }),
}
```

The endpoint is part of the production default `FANTASY402_INGESTION_ENDPOINTS`
list alongside `getAccountInfoOwner`.

### Ingestion Wiring

Successful `getAuthorizations` responses are processed through two pipeline
stages in the ingestion Worker:

1. **`mapAuthorizations`** at `src/index.ts:1802-1815` — extracts `INFO.AgentID`,
   `INFO.MasterAgentID`, `INFO.CommissionType`, and the full `INFO` object from
   the API response into an `AuthorizationPermissionRecord`.

2. **`storeAuthorizations`** at `src/index.ts:1792-1800` — inserts the mapped
   record into the D1 `authorization_permissions` table.

Both stages are called from two ingestion paths:
- **`runIngestion`** at `src/index.ts:626-628` (scheduled/all-endpoints path).
- **`ingestLocalResponses`** at `src/index.ts:708-710` (local browser-archive
  path).

### D1 Schema

The `authorization_permissions` table is created by migration
`0009_authorization_permissions.sql`:

## Storage Pipeline

Each successful response is archived in R2 and recorded in `api_snapshots`.
In addition, the Worker extracts a small queryable projection into
`authorization_permissions`:

| Column | Source path | Notes |
|--------|-------------|-------|
| `agent_id` | `INFO.AgentID`, `INFO.agentID`, `INFO.CustomerID`, `INFO.customerID` | Trimmed before indexing |
| `master_agent_id` | `INFO.MasterAgentID`, `INFO.masterAgentID` | Trimmed; nullable |
| `commission_type` | `INFO.CommissionType`, `INFO.commissionType` | Trimmed; nullable |
| `raw_json` | Full `INFO` object | Preserves remaining permission flags |

Migration:

```sql
CREATE TABLE authorization_permissions (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES api_snapshots(id),
  run_id TEXT NOT NULL REFERENCES ingestion_runs(id),
  captured_at TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  master_agent_id TEXT,
  commission_type TEXT,
  raw_json TEXT NOT NULL
);
```

The `raw_json` field is intentionally retained so newly discovered permission
flags can be queried before they are modeled as dedicated columns.
