type CustomerProfileEnv = { ANALYTICS_DB: D1Database };

export const CUSTOMER_PROFILE_FACET_KEYS = [
  "getInfoPlayer",
  "getCryptoInfo",
  "getMail",
  "getTeaserProfile",
] as const;

export type CustomerProfileFacetKey = (typeof CUSTOMER_PROFILE_FACET_KEYS)[number];

export interface CustomerProfileFacetRecord {
  customerId: string;
  facet: CustomerProfileFacetKey;
  rawSnapshotId: string;
  capturedAt: string;
  payloadJson: string;
}

export interface CustomerAccountRecord {
  customerId: string;
  agentId: string;
  rawSnapshotId: string;
  capturedAt: string;
  payloadJson: string;
}

function firstObject(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object") return undefined;
  const root = data as Record<string, unknown>;
  if (root.INFO && typeof root.INFO === "object") return root.INFO as Record<string, unknown>;
  return root;
}

export function mapCustomerAccountInfo(data: unknown, rawSnapshotId: string, customerIdHint?: string): CustomerAccountRecord | null {
  const info = firstObject(data);
  if (!info) return null;
  const customerId =
    String(info.customerID ?? info.CustomerID ?? customerIdHint ?? "").trim();
  if (!customerId) return null;
  return {
    customerId,
    agentId: String(info.AgentID ?? info.agentID ?? "").trim(),
    rawSnapshotId,
    capturedAt: new Date().toISOString(),
    payloadJson: JSON.stringify(info),
  };
}

export function mapCustomerProfileFacet(
  facet: CustomerProfileFacetKey,
  data: unknown,
  rawSnapshotId: string,
  customerIdHint?: string,
): CustomerProfileFacetRecord | null {
  const info = firstObject(data);
  if (!info) return null;
  const customerId = String(info.customerID ?? info.CustomerID ?? customerIdHint ?? "").trim();
  if (!customerId) return null;
  return {
    customerId,
    facet,
    rawSnapshotId,
    capturedAt: new Date().toISOString(),
    payloadJson: JSON.stringify(data),
  };
}

export async function storeCustomerAccountInfo(env: CustomerProfileEnv, record: CustomerAccountRecord | null): Promise<void> {
  if (!record) return;
  await env.ANALYTICS_DB.prepare(
    `INSERT OR REPLACE INTO customer_accounts (customer_id, agent_id, raw_snapshot_id, captured_at, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(record.customerId, record.agentId, record.rawSnapshotId, record.capturedAt, record.payloadJson)
    .run();
}

export async function storeCustomerProfileFacet(env: CustomerProfileEnv, record: CustomerProfileFacetRecord | null): Promise<void> {
  if (!record) return;
  await env.ANALYTICS_DB.prepare(
    `INSERT OR REPLACE INTO customer_profile_facets (customer_id, facet, raw_snapshot_id, captured_at, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(record.customerId, record.facet, record.rawSnapshotId, record.capturedAt, record.payloadJson)
    .run();
}

export async function loadCustomerProfile(env: CustomerProfileEnv, customerId: string) {
  const player = await env.ANALYTICS_DB.prepare(
    `SELECT customer_id, login, name_first, agent_id, captured_at FROM player_agents WHERE customer_id = ?`,
  )
    .bind(customerId)
    .first<{ customer_id: string; login: string; name_first: string; agent_id: string; captured_at: string }>();

  const account = await env.ANALYTICS_DB.prepare(
    `SELECT customer_id, agent_id, raw_snapshot_id, captured_at, payload_json FROM customer_accounts WHERE customer_id = ?`,
  )
    .bind(customerId)
    .first<{ customer_id: string; agent_id: string; raw_snapshot_id: string; captured_at: string; payload_json: string }>();

  const facets = await env.ANALYTICS_DB.prepare(
    `SELECT facet, raw_snapshot_id, captured_at, payload_json FROM customer_profile_facets WHERE customer_id = ?`,
  )
    .bind(customerId)
    .all<{ facet: string; raw_snapshot_id: string; captured_at: string; payload_json: string }>();

  const facetMap: Record<string, unknown> = {};
  const seededFacets: Record<string, { capturedAt: string; snapshotId: string }> = {};
  for (const row of facets.results ?? []) {
    seededFacets[row.facet] = { capturedAt: row.captured_at, snapshotId: row.raw_snapshot_id };
    try {
      facetMap[row.facet] = JSON.parse(row.payload_json);
    } catch {
      facetMap[row.facet] = row.payload_json;
    }
  }

  let accountPayload: unknown = null;
  if (account?.payload_json) {
    try {
      accountPayload = JSON.parse(account.payload_json);
    } catch {
      accountPayload = account.payload_json;
    }
  }

  let webLogs: { lastCapturedAt: string | null; count24h: number } | null = null;
  let recentWebLogs: Array<{
    operation: string | null;
    ip_address: string | null;
    access_date_time: string;
  }> = [];
  const login = player?.login?.trim();
  if (login) {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const row = await env.ANALYTICS_DB.prepare(
      `SELECT MAX(captured_at) AS last_captured, COUNT(*) AS cnt
       FROM web_logs WHERE login = ? AND access_date_time >= ?`,
    )
      .bind(login, since24h)
      .first<{ last_captured: string | null; cnt: number }>();
    webLogs = {
      lastCapturedAt: row?.last_captured ?? null,
      count24h: Number(row?.cnt ?? 0),
    };
    const recent = await env.ANALYTICS_DB.prepare(
      `SELECT operation, ip_address, access_date_time
       FROM web_logs WHERE login = ? AND access_date_time >= ?
       ORDER BY access_date_time DESC LIMIT 5`,
    )
      .bind(login, since24h)
      .all<{ operation: string | null; ip_address: string | null; access_date_time: string }>();
    recentWebLogs = recent.results ?? [];
  }

  return {
    customerId,
    player: player ?? null,
    account: account
      ? { snapshotId: account.raw_snapshot_id, capturedAt: account.captured_at, data: accountPayload }
      : null,
    facets: facetMap,
    seededFacets,
    webLogs,
    recentWebLogs,
  };
}

export async function ingestCustomerProfileSnapshot(
  env: CustomerProfileEnv,
  endpointKey: string,
  data: unknown,
  snapshotId: string,
  customerIdHint?: string,
): Promise<void> {
  const hint = (customerIdHint ?? "").trim();
  if (endpointKey === "getAccountInfoOwner") {
    if (!hint) return;
    await storeCustomerAccountInfo(env, mapCustomerAccountInfo(data, snapshotId, hint));
    return;
  }
  if ((CUSTOMER_PROFILE_FACET_KEYS as readonly string[]).includes(endpointKey)) {
    await storeCustomerProfileFacet(
      env,
      mapCustomerProfileFacet(endpointKey as CustomerProfileFacetKey, data, snapshotId, hint),
    );
  }
}
