# Error Codes

All JSON error responses use:

```json
{
  "success": false,
  "error": {
    "code": "AUTH_001",
    "message": "Unauthorized",
    "details": {}
  }
}
```

| Code | HTTP | Description | Frontend Handling |
| --- | ---: | --- | --- |
| `AUTH_001` | 401 | Bearer token is missing or invalid. | Prompt for a valid operator token and retry. |
| `VALIDATION_001` | 400 | Request body or query parameters failed schema validation. | Show field-level validation details when available. |
| `NOT_FOUND_001` | 404 | Requested route or archive object does not exist. | Show a not-found state and link back to a valid tab. |
| `RATE_LIMIT_002` | 429 | Request rate exceeded the Worker guardrail. | Back off and retry after cooldown. |
| `UPSTREAM_001` | 502 | Fantasy402 or Cloudflare URL Scanner returned an upstream error. | Show retry affordance and preserve operator context. |
| `LLM_TIMEOUT` | 504 | LLM agent did not complete within the configured timeout. | Allow retry; no downstream state was committed. |
| `LLM_INVALID_RESPONSE` | 502 | LLM output failed the declared response schema. | Show agent failure state and log request id. |
