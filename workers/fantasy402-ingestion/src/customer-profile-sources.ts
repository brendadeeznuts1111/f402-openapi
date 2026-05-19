import { CUSTOMER_PROFILE_FACET_KEYS } from "./customer-profile";

/** How a customer-profile block is populated. */
export type ProfileBlockKind = "seeded" | "live" | "hybrid";

export type ProfileActiveSource = "live" | "seeded" | "failed" | "none";

export interface ProfileBlockCatalogEntry {
  id: string;
  label: string;
  kind: ProfileBlockKind;
  ingestKey: string;
  d1Table?: string;
  schedule: string;
  dashboardRefreshMs?: number;
}

export const CUSTOMER_PROFILE_BLOCK_CATALOG: ProfileBlockCatalogEntry[] = [
  {
    id: "player",
    label: "Player identity",
    kind: "seeded",
    ingestKey: "getPlayers",
    d1Table: "player_agents",
    schedule: "Worker */15 cron, daily 06:00 UTC warmup, or browser ingest",
  },
  {
    id: "account",
    label: "Account limits & status",
    kind: "hybrid",
    ingestKey: "getAccountInfoOwner",
    d1Table: "customer_accounts",
    schedule: "Seeded per customer during browser ingest; live getInfoPlayer preferred on profile load",
  },
  {
    id: "getInfoPlayer",
    label: "Account & balance (info)",
    kind: "hybrid",
    ingestKey: "getInfoPlayer",
    d1Table: "customer_profile_facets",
    schedule: "Seed via POST /customer-profile/seed or browser ingest; live on profile load",
    dashboardRefreshMs: 30_000,
  },
  {
    id: "getCryptoInfo",
    label: "Crypto",
    kind: "seeded",
    ingestKey: "getCryptoInfo",
    d1Table: "customer_profile_facets",
    schedule: "POST /customer-profile/seed or browser ingest",
  },
  {
    id: "getMail",
    label: "Mail",
    kind: "seeded",
    ingestKey: "getMail",
    d1Table: "customer_profile_facets",
    schedule: "POST /customer-profile/seed or browser ingest",
  },
  {
    id: "getTeaserProfile",
    label: "Teaser profile",
    kind: "seeded",
    ingestKey: "getTeaserProfile",
    d1Table: "customer_profile_facets",
    schedule: "POST /customer-profile/seed or browser ingest",
  },
  {
    id: "web_logs",
    label: "Web activity (logins)",
    kind: "seeded",
    ingestKey: "getWebLog",
    d1Table: "web_logs",
    schedule: "Ingest getWebLog (agent-scoped); shown for login in last 24h",
  },
  {
    id: "getPerformancePlayer",
    label: "Performance by sport",
    kind: "live",
    ingestKey: "getPerformancePlayer",
    schedule: "Live on profile load (~45s KV cache)",
    dashboardRefreshMs: 30_000,
  },
  {
    id: "getReportPlayerAnalysis",
    label: "Wager analysis",
    kind: "live",
    ingestKey: "getReportPlayerAnalysis",
    schedule: "Live on profile load (~45s KV cache); date range from dashboard",
    dashboardRefreshMs: 30_000,
  },
];

export interface SeededBlockMeta {
  present: boolean;
  capturedAt: string | null;
  snapshotId: string | null;
  ingestKey: string;
  d1Table: string;
  /** Extra context (e.g. web log count in window). */
  detail?: string;
}

export interface LiveBlockMeta {
  ok: boolean;
  fetchedAt: string;
  error?: string;
  upstreamStatus?: number;
  cached?: boolean;
}

export interface ProfileBlockStatus {
  id: string;
  label: string;
  activeSource: ProfileActiveSource;
  kind: ProfileBlockKind;
  ingestKey: string;
  schedule: string;
  dashboardRefreshMs?: number;
  seeded: SeededBlockMeta | null;
  live: LiveBlockMeta | null;
}

export interface CustomerProfileSources {
  blocks: ProfileBlockStatus[];
  schedules: {
    workerIngestion: string;
    authRefresh: string;
    alertEvaluation: string;
    urlScan: string;
    dashboardProfile: string;
    dailyProfileWarmup: string;
  };
  facetKeys: readonly string[];
}

export type ProfileWebLogsMeta = {
  lastCapturedAt: string | null;
  count24h: number;
};

type ProfileRow = {
  player: { captured_at: string } | null;
  account: { capturedAt: string; snapshotId: string } | null;
  seededFacets: Record<string, { capturedAt: string; snapshotId: string }>;
  webLogs?: ProfileWebLogsMeta | null;
};

type LivePayload = Record<string, unknown> & {
  fetched_at?: string;
  getInfoPlayer?: { ok?: boolean; error?: string; upstreamStatus?: number };
  getPerformancePlayer?: { ok?: boolean; error?: string; upstreamStatus?: number; cached?: boolean };
  getReportPlayerAnalysis?: { ok?: boolean; error?: string; upstreamStatus?: number; cached?: boolean };
};

export function resolveActiveSource(
  liveBlock: LiveBlockMeta | null,
  seeded: SeededBlockMeta | null | undefined,
): ProfileActiveSource {
  if (liveBlock?.ok) return "live";
  if (liveBlock && !liveBlock.ok) return "failed";
  if (seeded?.present) return "seeded";
  return "none";
}

export function workerIngestionScheduleLabel(triggerMode: string | undefined): string {
  const mode = (triggerMode ?? "attempt").trim().toLowerCase();
  if (mode === "skip") {
    return "Disabled on worker (FANTASY402_WORKER_TRIGGER_MODE=skip) — use browser ingest or daily warmup";
  }
  return "Worker */15 cron (ingestion catalog rotation)";
}

export function buildCustomerProfileSources(
  profile: ProfileRow,
  live: LivePayload | null | undefined,
  options?: { workerTriggerMode?: string },
): CustomerProfileSources {
  const fetchedAt = typeof live?.fetched_at === "string" ? live.fetched_at : new Date().toISOString();

  const liveMeta = (
    block: LivePayload["getInfoPlayer"],
    cached?: boolean,
  ): LiveBlockMeta | null => {
    if (!live || !block) return null;
    return {
      ok: Boolean(block.ok),
      fetchedAt,
      error: typeof block.error === "string" ? block.error : undefined,
      upstreamStatus: typeof block.upstreamStatus === "number" ? block.upstreamStatus : undefined,
      cached: cached === true,
    };
  };

  const seededPlayer: SeededBlockMeta | null = profile.player
    ? {
        present: true,
        capturedAt: profile.player.captured_at,
        snapshotId: null,
        ingestKey: "getPlayers",
        d1Table: "player_agents",
      }
    : null;

  const seededAccount: SeededBlockMeta | null = profile.account
    ? {
        present: true,
        capturedAt: profile.account.capturedAt,
        snapshotId: profile.account.snapshotId,
        ingestKey: "getAccountInfoOwner",
        d1Table: "customer_accounts",
      }
    : null;

  const webLogsSeeded: SeededBlockMeta | null =
    profile.webLogs && (profile.webLogs.lastCapturedAt || profile.webLogs.count24h > 0)
      ? {
          present: true,
          capturedAt: profile.webLogs.lastCapturedAt,
          snapshotId: null,
          ingestKey: "getWebLog",
          d1Table: "web_logs",
          detail: `${profile.webLogs.count24h} events (24h)`,
        }
      : null;

  const blocks: ProfileBlockStatus[] = [];

  for (const entry of CUSTOMER_PROFILE_BLOCK_CATALOG) {
    let seeded: SeededBlockMeta | null = null;
    let liveBlock: LiveBlockMeta | null = null;

    if (entry.id === "player") {
      seeded = seededPlayer;
    } else if (entry.id === "account") {
      seeded = seededAccount;
      const infoFacet = profile.seededFacets.getInfoPlayer;
      if (live?.getInfoPlayer) liveBlock = liveMeta(live.getInfoPlayer);
      else if (!seeded?.present && infoFacet) {
        seeded = {
          present: true,
          capturedAt: infoFacet.capturedAt,
          snapshotId: infoFacet.snapshotId,
          ingestKey: "getInfoPlayer",
          d1Table: "customer_profile_facets",
        };
      }
    } else if (entry.id === "getInfoPlayer") {
      const facet = profile.seededFacets.getInfoPlayer;
      if (facet) {
        seeded = {
          present: true,
          capturedAt: facet.capturedAt,
          snapshotId: facet.snapshotId,
          ingestKey: "getInfoPlayer",
          d1Table: "customer_profile_facets",
        };
      }
      if (live?.getInfoPlayer) liveBlock = liveMeta(live.getInfoPlayer);
    } else if ((CUSTOMER_PROFILE_FACET_KEYS as readonly string[]).includes(entry.id) && entry.id !== "getInfoPlayer") {
      const facet = profile.seededFacets[entry.id];
      if (facet) {
        seeded = {
          present: true,
          capturedAt: facet.capturedAt,
          snapshotId: facet.snapshotId,
          ingestKey: entry.ingestKey,
          d1Table: "customer_profile_facets",
        };
      }
    } else if (entry.id === "web_logs") {
      seeded = webLogsSeeded;
    } else if (entry.id === "getPerformancePlayer") {
      const raw = live?.getPerformancePlayer;
      if (raw) liveBlock = liveMeta(raw, raw.cached);
    } else if (entry.id === "getReportPlayerAnalysis") {
      const raw = live?.getReportPlayerAnalysis;
      if (raw) liveBlock = liveMeta(raw, raw.cached);
    }

    const activeSource = resolveActiveSource(liveBlock, seeded);

    blocks.push({
      id: entry.id,
      label: entry.label,
      activeSource,
      kind: entry.kind,
      ingestKey: entry.ingestKey,
      schedule: entry.schedule,
      dashboardRefreshMs: entry.dashboardRefreshMs,
      seeded,
      live: liveBlock,
    });
  }

  return {
    blocks,
    schedules: {
      workerIngestion: workerIngestionScheduleLabel(options?.workerTriggerMode),
      authRefresh: "Worker */5 cron",
      alertEvaluation: "Worker */2 cron",
      urlScan: "Worker every 6 hours",
      dashboardProfile: "30s while Customers profile open (live blocks)",
      dailyProfileWarmup: "Worker 06:00 UTC — getPlayers + seed facets for recently active logins (max 25)",
    },
    facetKeys: CUSTOMER_PROFILE_FACET_KEYS,
  };
}
