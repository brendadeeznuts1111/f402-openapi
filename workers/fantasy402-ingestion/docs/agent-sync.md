# LLM Agent Sync

The Worker exposes typed agent configuration and health routes. Agent execution remains internal; external systems should use these schemas and webhooks to synchronize state.

## Agents

| Agent | Capability | Invocation |
| --- | --- | --- |
| `Summarizer` | Summarizes ingestion runs, archive objects, and scanner verdicts. | Internal call or webhook consumer |
| `Router` | Classifies operator intent and routes to ingestion, archive, scanner, or settings workflows. | Internal call or webhook consumer |
| `CodeGen` | Generates typed integration examples from OpenAPI and Zod bundles. | Internal call or webhook consumer |

## Health

```bash
curl -H "Authorization: Bearer $INGESTION_TRIGGER_TOKEN" \
  "$WORKER_URL/api/v1/agents/health"
```

## Webhook Input

```json
{
  "agentId": "Summarizer",
  "requestId": "req_123",
  "prompt": "Summarize the latest scan verdicts",
  "context": {
    "runId": "00000000-0000-4000-8000-000000000000"
  }
}
```

## Webhook Output

```json
{
  "agentId": "Summarizer",
  "requestId": "req_123",
  "success": true,
  "content": "No malicious verdicts were found.",
  "usage": {
    "inputTokens": 120,
    "outputTokens": 32
  }
}
```

Agent failures use `LLM_TIMEOUT` or `LLM_INVALID_RESPONSE` from `error-codes.json`.
