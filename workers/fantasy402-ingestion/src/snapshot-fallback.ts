/** Load last successful ingest payload from D1 `api_snapshots` + R2 archive. */

export type ArchiveSnapshotHit = {
  data: unknown;
  capturedAt: string;
  snapshotId: string;
  r2Key: string;
};

type ArchiveEnv = {
  ANALYTICS_DB: D1Database;
  RAW_ARCHIVE: R2Bucket;
};

export async function loadLatestEndpointArchive(
  env: ArchiveEnv,
  endpointKey: string,
): Promise<ArchiveSnapshotHit | null> {
  const row = await env.ANALYTICS_DB.prepare(
    `SELECT id, r2_key, captured_at
     FROM api_snapshots
     WHERE endpoint_key = ?
       AND http_status >= 200
       AND http_status < 300
       AND r2_key IS NOT NULL
       AND TRIM(r2_key) != ''
     ORDER BY captured_at DESC
     LIMIT 1`,
  )
    .bind(endpointKey)
    .first<{ id: string; r2_key: string; captured_at: string }>();

  if (!row?.r2_key) return null;

  const object = await env.RAW_ARCHIVE.get(row.r2_key);
  if (!object) return null;

  const text = await object.text();
  try {
    return {
      data: JSON.parse(text) as unknown,
      capturedAt: row.captured_at,
      snapshotId: row.id,
      r2Key: row.r2_key,
    };
  } catch {
    return null;
  }
}

/** Map ingested `graded_wagers` rows to agent-performance type `G` table shape. */
export function mapGradedWagersToPerfRows(
  wagers: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return wagers.map((w) => ({
    login: w.login,
    customer_id: w.customer_id,
    agent_id: w.agent_id,
    sport_type: String(w.short_desc ?? "").slice(0, 80) || "-",
    wager_type: w.wager_type,
    risk: w.amount_wagered,
    won_lost: w.net_amount,
    won: String(w.result ?? "").toUpperCase() === "W" ? w.net_amount : null,
    lost: String(w.result ?? "").toUpperCase() === "L" ? w.net_amount : null,
    bets: 1,
    captured_at: w.captured_at,
  }));
}
