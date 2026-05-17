# Report Call Repair Notes

## Coverage State

- Latest first-party read-shaped gap against `fantasy402-max`: `0`.
- Remaining bad report calls: `2`.
- Repairable calls: `1`.
- Manual-review calls: `1`.

## `POST /cloud/api/Report/Pending`

Disposition: `repairable`

The failing sample returned:

```json
{
  "status": "Failed",
  "msg": "Invalid CustomerID"
}
```

The later repaired live probe returned `200` when `customerID` was sourced from a player record discovered through one of these read-only calls:

- `POST /cloud/api/Manager/searchCustomerAdmin`
- `POST /cloud/api/Manager/getPlayers`

Corrected request shape:

```json
{
  "RRO": "1",
  "agentID": "<authenticated-agent-id>",
  "agentOwner": "<authenticated-agent-id>",
  "customerID": "<player-customer-id-from-searchCustomerAdmin-or-getPlayers>",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "start": "YYYY-MM-DD",
  "end": "YYYY-MM-DD",
  "operation": "Pending"
}
```

Repair rule:

```json
{
  "operation": "Pending",
  "endpoint": "/cloud/api/Report/Pending",
  "paramMap": {
    "customerID": "player.CustomerID || player.customerID"
  }
}
```

Do not use the agent account ID as `customerID` for this endpoint. It validates against player/customer records.

## `POST /cloud/api/Report/getTicketDetailPrint`

Disposition: `manual-review`

The backend returned:

```json
{
  "status": "Failed",
  "msg": "Invalid Method: Model:Report,Func:getTicketDetailPrint"
}
```

This is a router/method-resolution failure, not a parameter validation failure. The current trace does not prove a valid `Report/getTicketDetailPrint` API method exists.

Safe read replacement candidates observed in the latest spec:

- `POST /cloud/api/Report/getPendingByTicket`
- `POST /cloud/api/Report/getWagerDetailTransaction`
- `POST /cloud/api/Manager/getWagaerDetailShort`

Recommended repair strategy:

```json
{
  "oldOperation": "getTicketDetailPrint",
  "status": "manual-review",
  "replacementCandidates": [
    {
      "operation": "getPendingByTicket",
      "endpoint": "/cloud/api/Report/getPendingByTicket"
    },
    {
      "operation": "getWagerDetailTransaction",
      "endpoint": "/cloud/api/Report/getWagerDetailTransaction"
    },
    {
      "operation": "getWagaerDetailShort",
      "endpoint": "/cloud/api/Manager/getWagaerDetailShort"
    }
  ]
}
```

Use one of the replacement candidates for read-only ticket/wager data. Keep print-specific behavior out of the automated repair until backend code or a valid browser-observed print request confirms the correct endpoint.
