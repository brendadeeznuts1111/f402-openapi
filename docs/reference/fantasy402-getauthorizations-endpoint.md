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

- `Authorization: Bearer <browser-jwt>` from the authenticated browser session.
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

## Worker Integration

The Worker defines this endpoint as:

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
list with `getAccountInfoOwner`.

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
