# Public API

The copyable OpenAPI 3.1 contract is [`../openapi.worker.json`](../openapi.worker.json). Public route inventory is [`../public-routes.json`](../public-routes.json).

Use `/api/v1/*` routes for new integrations. Root routes remain available for compatibility during the current Worker version.

## Routes

| Method | Route | Auth | Schema |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | No | `HealthResponse` |
| POST | `/api/v1/trigger` | Bearer | `TriggerResponse` |
| GET | `/api/v1/archive` | Bearer | `ArchiveListResponse` |
| GET | `/api/v1/archive/object` | Bearer | archived JSON body |
| GET | `/api/v1/archive/viewer` | No | HTML |
| GET | `/api/v1/scans` | Bearer | `ScanListResponse` |
| POST | `/api/v1/scans/trigger` | Bearer | `ScanTriggerRequest` -> `ScanTriggerResponse` |
| GET | `/api/v1/settings` | Bearer | `SettingsSchema` |
| GET | `/api/v1/settings/schema` | Bearer | settings schema metadata |
| POST | `/api/v1/settings/validate` | Bearer | `SettingsSchema` -> `SettingsSchema` |
| GET | `/api/v1/agents` | Bearer | `AgentRegistryResponse` |
| GET | `/api/v1/agents/health` | Bearer | `AgentHealthResponse` |

## Errors

Errors use:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_001",
    "message": "Invalid request",
    "details": []
  }
}
```

See [`error-codes.md`](./error-codes.md) and [`../error-codes.json`](../error-codes.json).
