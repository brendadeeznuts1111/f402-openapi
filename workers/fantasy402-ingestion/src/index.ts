import { diagnoseUrlScanner, submitAndWait, UrlScannerApiError } from "./url-scanner";
import { UPSTREAM_MANIFEST } from "./upstream-manifest";
import {
  INGESTION_ALL,
  INGESTION_CURSOR_KEY,
  ingestionBatchSize,
  planIngestionBatch,
  resolveIngestionEndpointKeys,
} from "./ingestion-config";
import {
  classifyIngestionOutcome,
  deriveRunStatus,
  formatRunMeta,
  parseRunMeta,
  skipNoteForRun,
} from "./ingestion-outcome";
import {
  GET_PLAYERS_CUSTOMER_ID_SOURCE,
  cachePlayerCustomerId,
  canDeriveCustomerId,
  customerIdSourceForKey,
  extractPlayerCustomerId,
  readCachedPlayerCustomerId,
} from "./customer-id";
import { ingestPlaneSummary, workerTriggerMode } from "./ingest-plane";
import { summarizeHar, type HarNetworkSummary, type HarRequestSummary } from "./har-summary";
import {
  localIngestSchema,
  refreshAuthSchema,
  wagerQuerySchema,
  performanceQuerySchema,
  authorizationsQuerySchema,
  updateCookiesSchema,
  chartAggregatesSchema,
  pendingWagersQuerySchema,
  customerProfileQuerySchema,
  customerProfileSeedSchema,
  agentPerformanceLiveQuerySchema,
  searchCustomersQuerySchema,
  customerActivityQuerySchema,
  customerActivitySearchBodySchema,
  playersQuerySchema,
  positionDataQuerySchema,
  weeklyFiguresQuerySchema,
  dashboardSummaryQuerySchema,
  ingestionRunsQuerySchema,
  runIdQuerySchema,
  alertEventsQuerySchema,
  alertEventsSummaryQuerySchema,
  alertRulesListQuerySchema,
  uuidQuerySchema,
  alertLogQuerySchema,
  archiveListQuerySchema,
  archiveKeyQuerySchema,
  scanListQuerySchema,
  scanSummaryQuerySchema,
  scanIdQuerySchema,
  scanCompareQuerySchema,
  scanDetailQuerySchema,
  createAlertRuleBodySchema,
  patchAlertRuleBodySchema,
  syntheticAlertBodySchema,
} from "./schemas";
import { parseBody, parseQuery } from "./validate";
import {
  AGENT_PERFORMANCE_TYPES,
  buildGetAgentPerformanceBody,
  normalizeAgentPerformanceRows,
} from "./agent-performance-live";
import { ingestCustomerProfileSnapshot, loadCustomerProfile, CUSTOMER_PROFILE_FACET_KEYS } from "./customer-profile";
import { buildCustomerProfileSources } from "./customer-profile-sources";
import {
  getProfileLiveCache,
  profileLiveCacheKeyAnalysis,
  profileLiveCacheKeyPerf,
  putProfileLiveCache,
} from "./customer-profile-live-cache";
import {
  buildCustomerFacetBody,
  CUSTOMER_FACET_PATHS,
  CUSTOMER_PROFILE_SEED_FACETS,
} from "./customer-profile-seed";
import {
  buildGetInfoPlayerBody,
  buildGetPerformancePlayerBody,
  buildGetReportPlayerAnalysisBody,
  defaultAnalysisDateRange,
  extractInfoPlayerPayload,
  formatPerformanceAcc,
  normalizePerformanceRows,
  normalizePlayerAnalysisRows,
} from "./customer-profile-live";
export { LiveWagerBroadcaster } from "./live-wager-broadcaster";

export interface Env {
  SESSION_KV: KVNamespace;
  AUTH_CACHE: KVNamespace;
  ANALYTICS_DB: D1Database;
  RAW_ARCHIVE: R2Bucket;
  ENVIRONMENT: string;
  WORKER_NAME: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_ZONE_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  FANTASY402_BASE_URL: string;
  FANTASY402_INGESTION_ENDPOINTS: string;
  /** attempt | skip — skip disables 15-min cron Worker /trigger for browser-plane catalog */
  FANTASY402_WORKER_TRIGGER_MODE?: string;
  FANTASY402_INGESTION_BATCH_SIZE?: string;
  FANTASY402_USERNAME: string;
  FANTASY402_PASSWORD: string;
  FANTASY402_SESSION_COOKIE?: string;
  FANTASY402_CF_CLEARANCE?: string;
  FANTASY402_CF_BM?: string;
  FANTASY402_AUTHORIZATION?: string;
  FANTASY402_USER_AGENT?: string;
  FANTASY402_REFERER?: string;
  FANTASY402_BROWSER_HEADERS_JSON?: string;
  FANTASY402_AGENT_ID: string;
  FANTASY402_CUSTOMER_ID?: string;
  LIVE_WAGER_BROADCASTER: DurableObjectNamespace;
  FANTASY402_ALLOWED_SCAN_HOSTS?: string;
  FANTASY402_DASHBOARD_URL?: string;
  UPSTREAM_TOKEN?: string;
  INGESTION_TRIGGER_TOKEN?: string;
  ARCHIVE_AUTH_TOKEN?: string;
  ALERT_WEBHOOK_URL?: string;
}

interface SecretsStoreBinding {
  get(): Promise<string>;
}

type EndpointKey =
  | "getAccountInfoOwner" | "getAuthorizations" | "getAgentPerformance" | "getAgentBilling"
  | "getEnterTransactions" | "getPending" | "Pending" | "getPlayers" | "getAddedInfo"
  | "getCommunicationMessages" | "getListAgenstByAgent" | "getInfoPlayer" | "getCryptoInfo" | "getMail" | "getTeaserProfile"
  | "getLineTypes" | "getHeriarchy"
  | "getConfigWebReports" | "getConfigWebReportsPending" | "getSportsType" | "getMessage"
  | "getNewEmailsCount" | "getWeeklyFigureByAgentLite" | "getBetTicker" | "getBetTickerConfig"
  | "getAgentPositionData" | "getAgentPositionList" | "getSubSportByReport" | "getPropWagers"
  | "getGraded" | "getWagaerDetailShort" | "getAgentPermissionSetting" | "getTransactionHistory"
  | "getTransactionList" | "getGradedWagerByCustomer" | "getWagersByFigureDate"
  | "getWagerDetailTransaction" | "getPendingByTicket"
  | "customerGetHeriarchy" | "leagueGet_SportsLeagues"
  | "crashGetLimits" | "getAgentAccountingDetailed" | "getAgentAccountingDetailedPlayerCount"
  | "getAgentAccountingDetailedRules" | "getAgentAccountingDetailedTransactions"
  | "getAgentManagement" | "getAgentPrefix" | "getCircleLimits" | "getColorsSelections"
  | "getConfigWebReportsCustomerAdmin" | "getCryptoAvailable" | "getDynamicLive"
  | "getDynamicLiveLeagues" | "getExtendedProps" | "getGameVolume" | "getGames" | "getGamesCustom"
  | "getGamesPosition" | "getGetSubAgentByMaster" | "getHeriarchyRates" | "getLastIDPlayer"
  | "getLinesProps" | "getListVip" | "getMasterSheet" | "getMessagesByParent" | "getPeriodsBySport"
  | "getPlayerCount" | "getProps" | "getReportDeletedTransactions" | "getReportPlayerAnalysis"
  | "getSettleBalance" | "getSportsTypesLive" | "getStores" | "getTotalActiveCustomer"
  | "getTransactionDetail" | "getWebLog" | "getWeeklyFigureByAgent" | "liveCasinoGetLimits"
  | "primaryAgents" | "primaryAgentsGetAgents" | "primaryAgentsGetTransactions"
  | "searchCustomerAdmin"
  | "providerGetAppsCashierURL" | "providerGetCryptoWalletURL"
  | "reportGetDailyFiguresByCustomer" | "reportGetGrading" | "reportGetLeaderBoard"
  | "reportGetScoresLiveDynamic" | "reportGetTicketDetailPrint" | "reportGetTransactions";

interface SessionRecord {
  cookie: string;
  authorization?: string;
  expiresAt: number;
}

interface AuthCacheRecord {
  authorization?: string;
  sessionCookie?: string;
  cfClearance?: string;
  cfBm?: string;
  browserHeadersJson?: string;
  userAgent?: string;
  referer?: string;
  customerId?: string;
  updatedAt: string;
  expiresAt: number;
}

interface AuthMaterial {
  sessionCookie: string;
  authorization?: string;
  cfClearance?: string;
  cfBm?: string;
}

// In-memory cache for D1 cookies (60-second TTL per Worker isolate)
let d1CookiesCache: { value: string; expiresAt: number } | null = null;
const D1_COOKIES_CACHE_TTL_MS = 60_000;

interface EndpointConfig {
  key: EndpointKey;
  path: string;
  contentType?: "form" | "json";
  requiresCustomerId?: boolean;
  buildBody: (env: IngestionEnv, now: Date) => Record<string, string | number>;
}

type IngestionEnv = Env & { __ingestionCustomerId?: string };

function ingestionHasCustomerId(env: Env): boolean {
  return hasEnvValue(env.FANTASY402_CUSTOMER_ID) || canDeriveCustomerId();
}

function customerIdForEndpoint(env: IngestionEnv): string {
  return required(
    env.FANTASY402_CUSTOMER_ID ?? env.__ingestionCustomerId,
    "customerID (FANTASY402_CUSTOMER_ID or Manager/getPlayers)",
  );
}

function customerIdHint(env: IngestionEnv): string | undefined {
  const id = (env.FANTASY402_CUSTOMER_ID ?? env.__ingestionCustomerId ?? "").trim();
  return id || undefined;
}

interface UpstreamRequestDiagnostics {
  contentType: string;
  bodyKeys: string[];
  hasAuthorization: boolean;
  hasCookie: boolean;
  hasSessionCookie: boolean;
  hasCfClearance: boolean;
  hasCfBm: boolean;
  cookieNames: string[];
  origin: string;
  referer: string;
  userAgent: string;
  browserHeaders: HeaderPresenceDiagnostics;
}

interface HeaderPresenceDiagnostics {
  present: string[];
  missing: string[];
  count: number;
  complete: boolean;
}

interface ApiResult {
  endpoint: EndpointConfig;
  capturedAt: string;
  traceId: string;
  durationMs: number;
  status: number;
  attempts: number;
  data: unknown;
  r2Key: string;
  r2Etag: string;
  r2Size: number;
  r2StorageClass: string;
  responseHash: string;
  snapshotId: string;
}

interface RunResult {
  runId: string;
  status: "success" | "partial" | "failed";
  endpointsSucceeded: number;
  endpointsFailed: number;
  endpointsSkipped: number;
}

interface LocalIngestItem {
  endpointKey: EndpointKey;
  httpStatus: number;
  data: unknown;
  capturedAt?: string;
}

interface AlertEventInput {
  severity: "info" | "warning" | "critical";
  type: string;
  message: string;
  context?: Record<string, unknown>;
}

const SESSION_KEY = "fantasy402:session";
const AUTH_CACHE_KEY = "fantasy402:auth-overlay";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 4;
const DEFAULT_AUTH_CACHE_TTL_SECONDS = 60 * 60;
const MAX_AUTH_CACHE_TTL_SECONDS = 60 * 60 * 8;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ENDPOINT_ATTEMPTS = 3;
const R2_ARCHIVE_PREFIX = "fantasy402";
const R2_ARCHIVE_STORAGE_CLASS = "InfrequentAccess";

class UpstreamHttpError extends Error {
  readonly retryable: boolean;
  readonly endpoint: EndpointConfig;
  readonly status: number;
  readonly statusText: string;
  readonly responseBody: string;
  readonly responseHeaders: Record<string, string>;
  readonly request: UpstreamRequestDiagnostics;

  constructor(
    endpoint: EndpointConfig,
    status: number,
    statusText: string,
    responseBody: string,
    responseHeaders: Record<string, string>,
    request: UpstreamRequestDiagnostics,
  ) {
    super(`Fantasy402 API error HTTP ${status} on ${endpoint.key}`);
    this.endpoint = endpoint;
    this.status = status;
    this.statusText = statusText;
    this.responseBody = responseBody;
    this.responseHeaders = responseHeaders;
    this.request = request;
    this.retryable = status === 429 || status >= 500;
  }
}

class EndpointAttemptError extends Error {
  readonly attempts: number;
  readonly originalError: unknown;

  constructor(error: unknown, attempts: number) {
    super(errorMessage(error));
    this.attempts = attempts;
    this.originalError = error;
  }
}

/** Matches browser Manager/getPending JSON body (see dashboard Pending view). */
function buildGetPendingBody(
  env: Env,
  now: Date,
  overrides: Partial<Record<string, string | number>> = {},
): Record<string, string | number> {
  const agentId = String(overrides.agentID ?? env.FANTASY402_AGENT_ID ?? "").trim().toUpperCase();
  const customerRaw = overrides.customerID;
  const customerID =
    customerRaw != null
      ? String(customerRaw).trim()
      : hasEnvValue(env.FANTASY402_CUSTOMER_ID)
        ? customerIdForEndpoint(env)
        : "0";
  return {
    agentID: agentId,
    agentOwner: String(overrides.agentOwner ?? agentId),
    path: String(overrides.path ?? "/qubic/api/Manager/getPending"),
    RRO: 1,
    date: String(overrides.date ?? now.toISOString().slice(0, 10)),
    wagerType: String(overrides.wagerType ?? ""),
    sort: String(overrides.sort ?? "1"),
    typeSort: String(overrides.typeSort ?? "2"),
    week: Number(overrides.week ?? 0),
    customerID,
  };
}

function normalizePendingWagerRows(data: unknown): Array<Record<string, unknown>> {
  let rows: unknown[] = [];
  if (Array.isArray(data)) rows = data;
  else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.LIST)) rows = obj.LIST;
    else if (Array.isArray(obj.list)) rows = obj.list;
    else if (Array.isArray(obj.data)) rows = obj.data;
  }
  return rows
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        ticket_number: r.TicketNumber ?? r.ticketNumber ?? null,
        play_number: r.PlayNumber ?? r.playNumber ?? null,
        login: String(r.Login ?? r.login ?? "").trim(),
        agent_id: String(r.agentID ?? r.agentId ?? "").trim(),
        agent_login: String(r.AgentLogin ?? r.agentLogin ?? "").trim(),
        customer_id: String(r.customerID ?? r.customerId ?? "").trim(),
        wager_type: String(r.WagerType ?? r.wagerType ?? "").trim(),
        wager_status: String(r.WagerStatus ?? r.wagerStatus ?? "").trim(),
        amount_wagered: r.AmountWagered ?? r.amountWagered ?? null,
        to_win_amount: r.ToWinAmount ?? r.toWinAmount ?? null,
        description: String(r.Description ?? r.description ?? "").trim(),
        accepted_at: r.AcceptedDateTime ?? r.acceptedDateTime ?? null,
        sport_type: String(r.SportType ?? r.sportType ?? "").trim(),
        sport_sub_type: String(r.SportSubType ?? r.sportSubType ?? "").trim(),
        game_date_time: r.GameDateTime ?? r.gameDateTime ?? null,
        team1: String(r.Team1ID ?? r.team1 ?? "").trim(),
        team2: String(r.Team2ID ?? r.team2 ?? "").trim(),
        short_name1: String(r.ShortName1 ?? r.shortName1 ?? "").trim(),
        short_name2: String(r.ShortName2 ?? r.shortName2 ?? "").trim(),
        parlay_name: String(r.ParlayName ?? r.parlayName ?? "").trim(),
        placed_on: String(r.PlacedOn ?? r.placedOn ?? "").trim(),
        wager_count: r.WagerCount ?? r.wagerCount ?? null,
        total_picks: r.totalPicks ?? r.total_picks ?? null,
        chosen_team: String(r.ChosenTeamID ?? r.chosenTeam ?? "").trim(),
        period_description: String(r.PeriodDescription ?? r.periodDescription ?? "").trim(),
      };
    });
}

const ENDPOINTS: Record<EndpointKey, EndpointConfig> = {
  getAccountInfoOwner: {
    key: "getAccountInfoOwner",
    path: "/cloud/api/Manager/getAccountInfoOwner",
    contentType: "json",
    buildBody: (env) => ({
      operation: "getAccountInfoOwner",
      agentOwner: env.FANTASY402_AGENT_ID,
    }),
  },
  getAuthorizations: {
    key: "getAuthorizations",
    path: "/cloud/api/Manager/getAuthorizations",
    buildBody: (env) => ({
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getAuthorizations",
      RRO: 1,
    }),
  },
  getBetTicker: {
    key: "getBetTicker",
    path: "/cloud/api/Manager/getBetTicker",
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getBetTicker",
      wagerNumber: 1,
    }),
  },
  getBetTickerConfig: {
    key: "getBetTickerConfig",
    path: "/cloud/api/Manager/getBetTickerConfig",
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getBetTickerConfig",
    }),
  },
  getAgentPositionData: {
    key: "getAgentPositionData",
    path: "/cloud/api/Manager/getAgentPositionData",
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getAgentPositionData",
    }),
  },
  getAgentPositionList: {
    key: "getAgentPositionList",
    path: "/cloud/api/Manager/getAgentPositionList",
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getAgentPositionList",
    }),
  },
  getSubSportByReport: {
    key: "getSubSportByReport",
    path: "/cloud/api/Manager/getSubSportByReport",
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getSubSportByReport",
    }),
  },
  getPropWagers: {
    key: "getPropWagers",
    path: "/cloud/api/Manager/getPropWagers",
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getPropWagers",
    }),
  },
  getGraded: {
    key: "getGraded",
    path: "/cloud/api/Manager/getGraded",
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getGraded",
    }),
  },
  getWagaerDetailShort: {
    key: "getWagaerDetailShort",
    path: "/cloud/api/Manager/getWagaerDetailShort",
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getWagaerDetailShort",
    }),
  },
  getAgentPermissionSetting: {
    key: "getAgentPermissionSetting",
    path: "/cloud/api/Manager/getAgentPermissionSetting",
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getAgentPermissionSetting",
    }),
  },
  getTransactionHistory: {
    key: "getTransactionHistory",
    path: "/cloud/api/Manager/getTransactionHistory",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getTransactionHistory" }),
  },
  getTransactionList: {
    key: "getTransactionList",
    path: "/cloud/api/Manager/getTransactionList",
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getTransactionList",
    }),
  },
  getGradedWagerByCustomer: {
    key: "getGradedWagerByCustomer",
    path: "/cloud/api/Report/getGradedWagerByCustomer",
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getGradedWagerByCustomer",
    }),
  },
  getWagersByFigureDate: {
    key: "getWagersByFigureDate",
    path: "/cloud/api/Report/getWagersByFigureDate",
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getWagersByFigureDate",
    }),
  },
  getWagerDetailTransaction: {
    key: "getWagerDetailTransaction",
    path: "/cloud/api/Report/getWagerDetailTransaction",
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getWagerDetailTransaction",
    }),
  },
  getPendingByTicket: {
    key: "getPendingByTicket",
    path: "/cloud/api/Report/getPendingByTicket",
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getPendingByTicket",
    }),
  },
  getAgentPerformance: {
    key: "getAgentPerformance",
    path: "/cloud/api/Manager/getAgentPerformance",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getAgentPerformance" }),
  },
  getAgentBilling: {
    key: "getAgentBilling",
    path: "/cloud/api/Manager/getAgentBilling",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getAgentBilling" }),
  },
  getEnterTransactions: {
    key: "getEnterTransactions",
    path: "/cloud/api/Manager/getEnterTransactions",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getEnterTransactions" }),
  },
  getPending: {
    key: "getPending",
    path: "/cloud/api/Manager/getPending",
    contentType: "json",
    buildBody: (env, now) => buildGetPendingBody(env, now),
  },
  Pending: {
    key: "Pending",
    path: "/cloud/api/Report/Pending",
    requiresCustomerId: true,
    buildBody: (env, now) =>
      withDateRange(env, now, {
        agentID: env.FANTASY402_AGENT_ID,
        customerID: customerIdForEndpoint(env),
        operation: "Pending",
      }),
  },
  getPlayers: {
    key: "getPlayers",
    path: "/cloud/api/Manager/getPlayers",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getPlayers" }),
  },
  getAddedInfo: {
    key: "getAddedInfo",
    path: "/cloud/api/Manager/getAddedInfo",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getAddedInfo" }),
  },
  getCommunicationMessages: {
    key: "getCommunicationMessages",
    path: "/cloud/api/Customer/getCommunicationMessages",
    requiresCustomerId: true,
    buildBody: (env, now) =>
      withDateRange(env, now, {
        agentID: env.FANTASY402_AGENT_ID,
        customerID: customerIdForEndpoint(env),
        operation: "getCommunicationMessages",
      }),
  },
  getListAgenstByAgent: {
    key: "getListAgenstByAgent",
    path: "/cloud/api/Manager/getListAgenstByAgent",
    buildBody: (env) => ({
      agentID: env.FANTASY402_AGENT_ID,
      agentType: "M",
      operation: "getListAgenstByAgent",
      RRO: "1",
      agentOwner: env.FANTASY402_AGENT_ID,
    }),
  },
  getInfoPlayer: {
    key: "getInfoPlayer",
    path: "/cloud/api/Manager/getInfoPlayer",
    requiresCustomerId: true,
    buildBody: (env) => ({
      RRO: 0,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      customerID: customerIdForEndpoint(env),
      operation: "getInfoPlayer",
    }),
  },
  getCryptoInfo: {
    key: "getCryptoInfo",
    path: "/cloud/api/Manager/getCryptoInfo",
    requiresCustomerId: true,
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      customerID: customerIdForEndpoint(env),
      operation: "getCryptoInfo",
    }),
  },
  getMail: {
    key: "getMail",
    path: "/cloud/api/Manager/getMail",
    requiresCustomerId: true,
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      customerID: customerIdForEndpoint(env),
      operation: "getMail",
    }),
  },
  getTeaserProfile: {
    key: "getTeaserProfile",
    path: "/cloud/api/Manager/getTeaserProfile",
    requiresCustomerId: true,
    buildBody: (env) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      customerID: customerIdForEndpoint(env),
      operation: "getTeaserProfile",
    }),
  },
  getLineTypes: {
    key: "getLineTypes",
    path: "/cloud/api/Manager/getLineTypes",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getLineTypes" }),
  },
  getConfigWebReports: {
    key: "getConfigWebReports",
    path: "/cloud/api/Manager/getConfigWebReports",
    buildBody: (env) => ({
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getConfigWebReports",
      RRO: 1,
    }),
  },
  getConfigWebReportsPending: {
    key: "getConfigWebReportsPending",
    path: "/cloud/api/Manager/getConfigWebReportsPending",
    buildBody: (env) => ({
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getConfigWebReportsPending",
      RRO: 1,
    }),
  },
  getSportsType: {
    key: "getSportsType",
    path: "/cloud/api/Manager/getSportsType",
    buildBody: (env) => ({
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getSportsType",
      RRO: 1,
    }),
  },
  getMessage: {
    key: "getMessage",
    path: "/cloud/api/Manager/getMessage",
    buildBody: (env) => ({
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getMessage",
      RRO: 1,
      acc: env.FANTASY402_AGENT_ID,
      type: 0,
    }),
  },
  getNewEmailsCount: {
    key: "getNewEmailsCount",
    path: "/cloud/api/Manager/getNewEmailsCount",
    buildBody: (env) => ({
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getNewEmailsCount",
      RRO: 1,
      acc: env.FANTASY402_AGENT_ID,
    }),
  },
  getWeeklyFigureByAgentLite: {
    key: "getWeeklyFigureByAgentLite",
    path: "/cloud/api/Manager/getWeeklyFigureByAgentLite",
    buildBody: (env) => ({
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      operation: "getWeeklyFigureByAgentLite",
      RRO: 1,
      week: 0,
      type: "A",
      layout: "byDay",
    }),
  },
  getHeriarchy: {
    key: "getHeriarchy",
    path: "/cloud/api/Manager/getHeriarchy",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getHeriarchy" }),
  },
  customerGetHeriarchy: {
    key: "customerGetHeriarchy",
    path: "/cloud/api/Customer/getHeriarchy",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getHeriarchy" }),
  },
  leagueGet_SportsLeagues: {
    key: "leagueGet_SportsLeagues",
    path: "/cloud/api/League/Get_SportsLeagues",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "Get_SportsLeagues",
    }),
  },
  crashGetLimits: {
    key: "crashGetLimits",
    path: "/cloud/api/Manager/crashGetLimits",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "crashGetLimits",
    }),
  },
  getAgentAccountingDetailed: {
    key: "getAgentAccountingDetailed",
    path: "/cloud/api/Manager/getAgentAccountingDetailed",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getAgentAccountingDetailed",
    }),
  },
  getAgentAccountingDetailedPlayerCount: {
    key: "getAgentAccountingDetailedPlayerCount",
    path: "/cloud/api/Manager/getAgentAccountingDetailedPlayerCount",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getAgentAccountingDetailedPlayerCount",
    }),
  },
  getAgentAccountingDetailedRules: {
    key: "getAgentAccountingDetailedRules",
    path: "/cloud/api/Manager/getAgentAccountingDetailedRules",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getAgentAccountingDetailedRules",
    }),
  },
  getAgentAccountingDetailedTransactions: {
    key: "getAgentAccountingDetailedTransactions",
    path: "/cloud/api/Manager/getAgentAccountingDetailedTransactions",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getAgentAccountingDetailedTransactions",
    }),
  },
  getAgentManagement: {
    key: "getAgentManagement",
    path: "/cloud/api/Manager/getAgentManagement",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getAgentManagement",
    }),
  },
  getAgentPrefix: {
    key: "getAgentPrefix",
    path: "/cloud/api/Manager/getAgentPrefix",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getAgentPrefix",
    }),
  },
  getCircleLimits: {
    key: "getCircleLimits",
    path: "/cloud/api/Manager/getCircleLimits",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getCircleLimits",
    }),
  },
  getColorsSelections: {
    key: "getColorsSelections",
    path: "/cloud/api/Manager/getColorsSelections",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getColorsSelections",
    }),
  },
  getConfigWebReportsCustomerAdmin: {
    key: "getConfigWebReportsCustomerAdmin",
    path: "/cloud/api/Manager/getConfigWebReportsCustomerAdmin",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getConfigWebReportsCustomerAdmin",
    }),
  },
  getCryptoAvailable: {
    key: "getCryptoAvailable",
    path: "/cloud/api/Manager/getCryptoAvailable",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getCryptoAvailable",
    }),
  },
  getDynamicLive: {
    key: "getDynamicLive",
    path: "/cloud/api/Manager/getDynamicLive",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getDynamicLive",
    }),
  },
  getDynamicLiveLeagues: {
    key: "getDynamicLiveLeagues",
    path: "/cloud/api/Manager/getDynamicLiveLeagues",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getDynamicLiveLeagues",
    }),
  },
  getExtendedProps: {
    key: "getExtendedProps",
    path: "/cloud/api/Manager/getExtendedProps",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getExtendedProps",
    }),
  },
  getGameVolume: {
    key: "getGameVolume",
    path: "/cloud/api/Manager/getGameVolume",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getGameVolume",
    }),
  },
  getGames: {
    key: "getGames",
    path: "/cloud/api/Manager/getGames",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getGames",
    }),
  },
  getGamesCustom: {
    key: "getGamesCustom",
    path: "/cloud/api/Manager/getGamesCustom",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getGamesCustom",
    }),
  },
  getGamesPosition: {
    key: "getGamesPosition",
    path: "/cloud/api/Manager/getGamesPosition",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getGamesPosition",
    }),
  },
  getGetSubAgentByMaster: {
    key: "getGetSubAgentByMaster",
    path: "/cloud/api/Manager/getGetSubAgentByMaster",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getGetSubAgentByMaster",
    }),
  },
  getHeriarchyRates: {
    key: "getHeriarchyRates",
    path: "/cloud/api/Manager/getHeriarchyRates",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getHeriarchyRates" }),
  },
  getLastIDPlayer: {
    key: "getLastIDPlayer",
    path: "/cloud/api/Manager/getLastIDPlayer",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getLastIDPlayer",
    }),
  },
  getLinesProps: {
    key: "getLinesProps",
    path: "/cloud/api/Manager/getLinesProps",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getLinesProps",
    }),
  },
  getListVip: {
    key: "getListVip",
    path: "/cloud/api/Manager/getListVip",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getListVip",
    }),
  },
  getMasterSheet: {
    key: "getMasterSheet",
    path: "/cloud/api/Manager/getMasterSheet",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getMasterSheet",
    }),
  },
  getMessagesByParent: {
    key: "getMessagesByParent",
    path: "/cloud/api/Manager/getMessagesByParent",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getMessagesByParent",
    }),
  },
  getPeriodsBySport: {
    key: "getPeriodsBySport",
    path: "/cloud/api/Manager/getPeriodsBySport",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getPeriodsBySport",
    }),
  },
  getPlayerCount: {
    key: "getPlayerCount",
    path: "/cloud/api/Manager/getPlayerCount",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getPlayerCount",
    }),
  },
  getProps: {
    key: "getProps",
    path: "/cloud/api/Manager/getProps",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getProps",
    }),
  },
  getReportDeletedTransactions: {
    key: "getReportDeletedTransactions",
    path: "/cloud/api/Manager/getReportDeletedTransactions",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getReportDeletedTransactions" }),
  },
  getReportPlayerAnalysis: {
    key: "getReportPlayerAnalysis",
    path: "/cloud/api/Manager/getReportPlayerAnalysis",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getReportPlayerAnalysis" }),
  },
  getSettleBalance: {
    key: "getSettleBalance",
    path: "/cloud/api/Manager/getSettleBalance",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getSettleBalance",
    }),
  },
  getSportsTypesLive: {
    key: "getSportsTypesLive",
    path: "/cloud/api/Manager/getSportsTypesLive",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getSportsTypesLive",
    }),
  },
  getStores: {
    key: "getStores",
    path: "/cloud/api/Manager/getStores",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getStores",
    }),
  },
  getTotalActiveCustomer: {
    key: "getTotalActiveCustomer",
    path: "/cloud/api/Manager/getTotalActiveCustomer",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getTotalActiveCustomer",
    }),
  },
  getTransactionDetail: {
    key: "getTransactionDetail",
    path: "/cloud/api/Manager/getTransactionDetail",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getTransactionDetail",
    }),
  },
  getWebLog: {
    key: "getWebLog",
    path: "/cloud/api/Manager/getWebLog",
    buildBody: (env, now) =>
      withDateRange(env, now, {
        agentID: env.FANTASY402_AGENT_ID,
        agentOwner: env.FANTASY402_AGENT_ID,
        operation: "getWebLog",
      }),
  },
  getWeeklyFigureByAgent: {
    key: "getWeeklyFigureByAgent",
    path: "/cloud/api/Manager/getWeeklyFigureByAgent",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID,
      week: 0, type: "O", layout: "byDay", bigAmount: 500,
      operation: "getWeeklyFigureByAgent",
    }),
  },
  liveCasinoGetLimits: {
    key: "liveCasinoGetLimits",
    path: "/cloud/api/Manager/liveCasinoGetLimits",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "liveCasinoGetLimits",
    }),
  },
  primaryAgents: {
    key: "primaryAgents",
    path: "/cloud/api/Manager/primaryAgents",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "primaryAgents",
    }),
  },
  primaryAgentsGetAgents: {
    key: "primaryAgentsGetAgents",
    path: "/cloud/api/Manager/primaryAgentsGetAgents",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "primaryAgentsGetAgents",
    }),
  },
  primaryAgentsGetTransactions: {
    key: "primaryAgentsGetTransactions",
    path: "/cloud/api/Manager/primaryAgentsGetTransactions",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "primaryAgentsGetTransactions",
    }),
  },
  searchCustomerAdmin: {
    key: "searchCustomerAdmin",
    path: "/cloud/api/Manager/searchCustomerAdmin",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "searchCustomerAdmin",
    }),
  },
  providerGetAppsCashierURL: {
    key: "providerGetAppsCashierURL",
    path: "/cloud/api/Provider/getAppsCashierURL",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getAppsCashierURL",
    }),
  },
  providerGetCryptoWalletURL: {
    key: "providerGetCryptoWalletURL",
    path: "/cloud/api/Provider/getCryptoWalletURL",
    buildBody: (env) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getCryptoWalletURL",
    }),
  },
  reportGetDailyFiguresByCustomer: {
    key: "reportGetDailyFiguresByCustomer",
    path: "/cloud/api/Report/getDailyFiguresByCustomer",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getDailyFiguresByCustomer" }),
  },
  reportGetGrading: {
    key: "reportGetGrading",
    path: "/cloud/api/Report/getGrading",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getGrading" }),
  },
  reportGetLeaderBoard: {
    key: "reportGetLeaderBoard",
    path: "/cloud/api/Report/getLeaderBoard",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getLeaderBoard" }),
  },
  reportGetScoresLiveDynamic: {
    key: "reportGetScoresLiveDynamic",
    path: "/cloud/api/Report/getScoresLiveDynamic",
    contentType: "json",
    buildBody: (env, now) => ({
      RRO: 1, agentID: env.FANTASY402_AGENT_ID, agentOwner: env.FANTASY402_AGENT_ID, operation: "getScoresLiveDynamic",
    }),
  },
  reportGetTicketDetailPrint: {
    key: "reportGetTicketDetailPrint",
    path: "/cloud/api/Report/getTicketDetailPrint",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getTicketDetailPrint" }),
  },
  reportGetTransactions: {
    key: "reportGetTransactions",
    path: "/cloud/api/Report/getTransactions",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getTransactions" }),
  },
};

const worker = {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const runtimeEnv = await materializeSecretBindings(env);
    if (event.cron === "*/5 * * * *") {
      ctx.waitUntil(refreshAuthSchedule(runtimeEnv));
      return;
    }
    if (event.cron === "0 */6 * * *") {
      ctx.waitUntil(runScheduledScan(runtimeEnv));
      return;
    }
    if (event.cron === "0 6 * * *") {
      ctx.waitUntil(runDailyProfileWarmup(runtimeEnv));
      return;
    }
    if (event.cron === "*/2 * * * *") {
      ctx.waitUntil(evaluateAlertRules(runtimeEnv));
      return;
    }

    if (workerTriggerMode(runtimeEnv) === "skip") {
      console.info(
        "[Ingestion] Worker /trigger cron skipped (FANTASY402_WORKER_TRIGGER_MODE=skip); use local/browser ingest",
      );
      return;
    }
    ctx.waitUntil(runIngestion(runtimeEnv));
  },

  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return workerRoot(env, request);
    }

    if (url.pathname === "/auth/health" && request.method === "GET") {
      return await authHealth(env);
    }

    if (url.pathname === "/health") {
      const checks: Record<string, string> = {};

      checks.worker = "ok";

      try {
        await env.ANALYTICS_DB.prepare("SELECT 1").run();
        checks.d1 = "ok";
      } catch {
        checks.d1 = "error";
      }

      try {
        const doId = env.LIVE_WAGER_BROADCASTER.idFromName("health-check");
        const stub = env.LIVE_WAGER_BROADCASTER.get(doId);
        await stub.fetch("http://do/health", { method: "HEAD", signal: AbortSignal.timeout(5_000) });
        checks.durable_object = "ok";
      } catch {
        checks.durable_object = "error";
      }

      try {
        const upRes = await fetch(env.FANTASY402_BASE_URL, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
        checks.upstream = upRes.ok ? "ok" : "unreachable";
      } catch {
        checks.upstream = "unreachable";
      }

      checks.timestamp = new Date().toISOString();
      const status = Object.values(checks).some(v => v === "error") ? 503 : 200;
      return json(checks, status);
    }

    if (url.pathname === "/archive/viewer" && request.method === "GET") {
      return archiveViewer();
    }

    if (url.pathname === "/refresh-auth" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return refreshAuth(request, env);
    }

    if (url.pathname === "/update-cookies" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return updateCookies(request, env);
    }

    if (url.pathname === "/upstream-cookies-status" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return upstreamCookiesStatus(env);
    }

    if (url.pathname === "/ingest/local/plan" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return getLocalIngestPlan(await materializeSecretBindings(env));
    }

    if (url.pathname === "/ingest/catalog-status" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return getIngestCatalogStatus(await materializeSecretBindings(env));
    }

    if (url.pathname === "/ingest/local/bootstrap" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return getLocalIngestBootstrap(env);
    }

    if (url.pathname === "/ingestion/advance-cursor" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return advanceIngestionCursor(env);
    }

    if (url.pathname === "/ingest/local" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return ingestLocalResponses(request, env);
    }

    if (url.pathname === "/ingest/sync" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return ingestSync(request, env);
    }

    if (url.pathname === "/trigger" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }

      try {
        const result = await runIngestion(await materializeSecretBindings(env));
        return json(result, result.status === "failed" ? 500 : 202);
      } catch (error) {
        return json(
          {
            status: "failed",
            message: errorMessage(error),
          },
          500,
        );
      }
    }

    if (url.pathname === "/archive" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return listArchiveObjects(url, env);
    }

    if (url.pathname === "/archive/object" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return getArchiveObject(url, env);
    }

    if (url.pathname === "/diagnostics" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return diagnostics(await materializeSecretBindings(env));
    }

    if (url.pathname === "/runs" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return listIngestionRuns(url, env);
    }

    if (url.pathname === "/runs/endpoints" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return listIngestionRunEndpoints(url, env);
    }

    if (url.pathname === "/chart-aggregates" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return queryChartAggregates(url, env);
    }

    if (url.pathname === "/upstream-endpoints" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return await listUpstreamEndpoints(env);
    }

    if (url.pathname === "/bet-ticker-wagers" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return queryBetTickerWagers(url, env);
    }

    if (url.pathname === "/performance" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return queryAgentPerformance(url, env);
    }

    if (url.pathname === "/agent-performance-live" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return queryAgentPerformanceLive(url, env);
    }

    if (url.pathname === "/authorizations" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return queryAuthorizations(url, env);
    }

    if (url.pathname === "/graded-wagers" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return queryGradedWagers(url, env);
    }

    if (url.pathname === "/prop-wagers" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return queryPropWagers(url, env);
    }

    if (url.pathname === "/pending-wagers" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return queryPendingWagers(url, env);
    }

    if (url.pathname === "/position-data" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return queryPositionData(url, env);
    }

    if (url.pathname === "/summary" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return getDashboardSummary(url, env);
    }

    if (url.pathname === "/alerts" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return listAlertEvents(url, env);
    }

    if (url.pathname === "/alerts/summary" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return summarizeAlertEvents(url, env);
    }

    if (url.pathname === "/alerts/test" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return createSyntheticAlert(request, env);
    }

    if (url.pathname === "/alerts/policy-test" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return createSyntheticPolicyAlert(env);
    }

    if (url.pathname === "/alert-rules" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return createAlertRule(request, env);
    }

    if (url.pathname === "/alert-rules" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return listAlertRules(url, env);
    }

    if (url.pathname === "/alert-rules" && request.method === "DELETE") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return deleteAlertRule(url, env);
    }

    if (url.pathname === "/alert-rules" && request.method === "PATCH") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return patchAlertRule(request, url, env);
    }

    if (url.pathname === "/players" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return queryPlayers(url, env);
    }

    if (url.pathname === "/search-customers" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return searchCustomers(url, env);
    }

    if (url.pathname === "/customer-profile" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      const profileQuery = parseQuery(customerProfileQuerySchema, url.searchParams, json);
      if (!profileQuery.ok) return profileQuery.response;
      const filters = profileQuery.data;
      const customerId = filters.customerId;
      const profile = await loadCustomerProfile(env, customerId);
      const sourceOpts = { workerTriggerMode: env.FANTASY402_WORKER_TRIGGER_MODE };
      if (!filters.wantLive) {
        return json({ ...profile, sources: buildCustomerProfileSources(profile, null, sourceOpts) }, 200);
      }
      const loginHint = (filters.login ?? profile.player?.login ?? customerId).trim();
      try {
        const range = defaultAnalysisDateRange();
        const startDate = (filters.start_date ?? range.startDate).trim();
        const endDate = (filters.end_date ?? range.endDate).trim();
        const live = await fetchCustomerProfileLive(env, customerId, loginHint, filters.period, {
          startDate,
          endDate,
          reportType: filters.report_type,
          lineType: filters.line_type,
          analysisLimit: filters.analysis_limit,
        });
        return json({ ...profile, live, sources: buildCustomerProfileSources(profile, live, sourceOpts) }, 200);
      } catch (error) {
        const failedLive = {
          status: "failed",
          message: errorMessage(error),
          hint: "Refresh auth via Endpoints or POST /refresh-auth",
          fetched_at: new Date().toISOString(),
        };
        return json(
          {
            ...profile,
            live: failedLive,
            sources: buildCustomerProfileSources(profile, failedLive, sourceOpts),
          },
          503,
        );
      }
    }

    if (url.pathname === "/customer-profile/seed" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ status: "failed", message: "Invalid JSON body" }, 400);
      }
      const parsedSeed = parseBody(customerProfileSeedSchema, body, json);
      if (!parsedSeed.ok) return parsedSeed.response;
      const input = parsedSeed.data;
      try {
        const seedResult = await seedCustomerProfileD1(env, input.customer_id.trim());
        const profile = await loadCustomerProfile(env, input.customer_id.trim());
        return json(
          {
            ...seedResult,
            profile,
            sources: buildCustomerProfileSources(profile, null, {
              workerTriggerMode: env.FANTASY402_WORKER_TRIGGER_MODE,
            }),
          },
          seedResult.status === "failed" ? 503 : 200,
        );
      } catch (error) {
        return json({ status: "failed", message: errorMessage(error) }, 503);
      }
    }

    if (url.pathname === "/weekly-figures" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return queryWeeklyFigures(url, env);
    }

    if (url.pathname === "/customer-activity-search" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return queryCustomerActivitySearch(request, env);
    }

    if (url.pathname === "/customer-activity" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return queryCustomerActivity(url, env);
    }

    if (url.pathname === "/alert-log" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return listAlertLog(url, env);
    }

    if (url.pathname === "/live-wagers" && request.method === "GET") {
      const doId = env.LIVE_WAGER_BROADCASTER.idFromName("global");
      const stub = env.LIVE_WAGER_BROADCASTER.get(doId);
      return stub.fetch(request);
    }

    if (url.pathname === "/scanner/diagnostics" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      try {
        return json(await diagnoseUrlScanner(await materializeSecretBindings(env)), 200);
      } catch (error) {
        console.error("[URL Scanner] diagnostics secret resolution failed", safeError(error, { subsystem: "cloudflare-url-scanner" }));
        return json(scannerSecretResolutionError(error, env), 200);
      }
    }

    if (url.pathname === "/scans" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return listScanVerdicts(url, env);
    }

    if (url.pathname === "/scans/summary" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return summarizeScanVerdicts(url, env);
    }

    if (url.pathname === "/scans/detail" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return getScanDetail(url, env);
    }

    if (url.pathname === "/scans/screenshot" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return getScanScreenshot(url, env);
    }

    if (url.pathname === "/scans/har" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return getScanHar(url, env);
    }

    if (url.pathname === "/scans/network-summary" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return getScanNetworkSummary(url, env);
    }

    if (url.pathname === "/scans/network-diff" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return diffScanNetworkSummaries(url, env);
    }

    if (url.pathname === "/scans/export" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return exportScanEvidence(url, env);
    }

    if ((url.pathname === "/scans/trigger" || url.pathname === "/trigger-scan") && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      const body = await safeJson(request);
      const targetUrl = typeof body?.url === "string" && body.url.length > 0 ? body.url : "https://fantasy402.com";
      if (!isHttpUrl(targetUrl)) {
        return json({ status: "failed", message: "Invalid URL" }, 400);
      }
      if (!isAllowedScanTarget(env, targetUrl)) {
        return json({ status: "failed", message: "Scan target host is not allowed" }, 403);
      }
      try {
        const result = await runScheduledScan(await materializeSecretBindings(env), targetUrl);
        return json(
          {
            scanId: result.task.uuid,
            url: result.task.url,
            malicious: Boolean(result.verdicts?.overall?.malicious),
            tlsValidDays: result.page?.tlsValidDays ?? null,
          },
          202,
        );
      } catch (error) {
        return json(scanErrorResponse(error), 500);
      }
    }

    if (url.pathname === "/endpoints" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return json(listWorkerEndpoints(), 200);
    }

    if (url.pathname === "/endpoint-status" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return getEndpointStatus(env);
    }

    return json({ status: "failed", message: "Not Found" }, 404);
  },
};

export default worker;

async function runIngestion(env: Env): Promise<RunResult> {
  const runId = crypto.randomUUID();
  const startedAt = new Date();
  const { endpoints: endpointConfigs, batch } = await selectEndpointsForRun(env);

  await env.ANALYTICS_DB.prepare(
    "INSERT INTO ingestion_runs (id, started_at, status, endpoints_requested) VALUES (?, ?, 'running', ?)",
  )
    .bind(
      runId,
      startedAt.toISOString(),
      formatEndpointsRequested(batch, endpointConfigs),
    )
    .run();

  let endpointsSucceeded = 0;
  let endpointsFailed = 0;
  let endpointsSkipped = 0;

  try {
    const sessionCookie = await getOrRefreshSession(env);
    const ingestionRuntime: IngestionEnv = { ...env };

    for (const endpoint of endpointConfigs) {
      const traceId = crypto.randomUUID();
      const startedMs = Date.now();
      try {
        if (await shouldCircuitBreak(endpoint, env)) {
          endpointsSkipped += 1;
          console.warn("endpoint ingestion skipped", safeError(new Error("circuit breaker open"), { endpoint: endpoint.key, runId, traceId }));
          continue;
        }
        const result = await fetchAndArchiveEndpoint(env, runId, traceId, startedMs, endpoint, sessionCookie, new Date(), ingestionRuntime);
        await storeSnapshot(env, runId, result);

        if (endpoint.key === "getPlayers") {
          const playerCustomerId = extractPlayerCustomerId(result.data);
          if (playerCustomerId) {
            ingestionRuntime.__ingestionCustomerId = playerCustomerId;
            await cachePlayerCustomerId(env, playerCustomerId);
          }
        }
        if (endpoint.key === "getAgentPerformance") {
          const metric = mapAgentPerformance(result.data, env.FANTASY402_AGENT_ID, result.snapshotId, runId);
          await storeAgentPerformance(env, metric);
        }
        if (endpoint.key === "getAuthorizations") {
          await storeAuthorizations(env, mapAuthorizations(result.data, result.snapshotId, runId));
        }
        if (endpoint.key === "getBetTicker") {
          const records = mapBetTickerWagers(result.data, result.snapshotId, runId);
          await storeBetTickerWagers(env, records);
          for (const record of records) {
            notifyLiveWager(env, { id: record.id, login: record.login, wager_type: record.wagerType, amount_wagered: record.amountWagered, captured_at: record.capturedAt });
          }
        }
        if (endpoint.key === "getGraded") {
          const records = mapGradedWagers(result.data, result.snapshotId, runId);
          await storeGradedWagers(env, records);
          for (const record of records) {
            notifyLiveWager(env, { id: record.id, login: record.login, wager_type: record.wagerType, amount_wagered: record.amountWagered, captured_at: record.capturedAt });
          }
        }
        if (endpoint.key === "getPropWagers") {
          const records = mapPropWagers(result.data, result.snapshotId, runId);
          await storePropWagers(env, records);
          for (const record of records) {
            notifyLiveWager(env, { id: record.id, login: record.login, wager_type: record.wagerType, amount_wagered: record.amountWagered, captured_at: record.capturedAt });
          }
        }
        if (endpoint.key === "getAgentPositionData") {
          await storeAgentPositionData(env, mapAgentPositionData(result.data, result.snapshotId, runId));
        }
        if (endpoint.key === "getListAgenstByAgent") {
          await storePlayerAgents(env, mapPlayerAgents(result.data, result.snapshotId));
        }
        if (endpoint.key === "getWebLog") {
          const records = mapWebLogEntries(result.data, result.snapshotId, runId);
          await storeWebLogEntries(env, records);
        }
        await ingestCustomerProfileSnapshot(
          env,
          endpoint.key,
          result.data,
          result.snapshotId,
          customerIdHint(ingestionRuntime),
        );
        if (endpoint.key === "getWeeklyFigureByAgent" || endpoint.key === "getWeeklyFigureByAgentLite") {
          const records = mapWeeklyFigures(result.data, result.snapshotId, runId, env.FANTASY402_AGENT_ID);
          await storeWeeklyFigures(env, records);
        }

        endpointsSucceeded += 1;
        recordCircuitStatus(endpoint, true, env);
      } catch (error) {
        const upstream = unwrapUpstreamHttpError(error);
        const outcome = classifyIngestionOutcome(upstream?.status);
        if (outcome === "skipped") {
          endpointsSkipped += 1;
          recordCircuitStatus(endpoint, true, env);
          console.warn(
            "endpoint ingestion skipped",
            safeError(error, { endpoint: endpoint.key, runId, traceId, upstreamStatus: upstream?.status }),
          );
          continue;
        }

        endpointsFailed += 1;
        const durationMs = Math.max(0, Date.now() - startedMs);
        await storeEndpointFailure(env, runId, traceId, durationMs, endpoint, error);
        recordCircuitStatus(endpoint, false, env);
        console.error("endpoint ingestion failed", safeError(error, { endpoint: endpoint.key, runId, traceId }));
      }
    }

    const status = deriveRunStatus(endpointsSucceeded, endpointsFailed);
    const dbStatus = endpointsFailed === 0 ? "success" : "failed";
    const runMeta = formatRunMeta(
      endpointsSkipped,
      skipNoteForRun(endpointsSucceeded, endpointsFailed, endpointsSkipped),
    );
    await finishRun(env, runId, dbStatus, endpointsSucceeded, endpointsFailed, runMeta);

    if (endpointsFailed > 0) {
      await sendFailureAlert(env, {
        severity: status === "partial" ? "warning" : "warning",
        type: "ingestion-endpoint-failures",
        message: `Fantasy402 ingestion run ${runId}: ${endpointsSucceeded} OK, ${endpointsFailed} failed, ${endpointsSkipped} skipped.`,
        context: { runId, endpointsSucceeded, endpointsFailed, endpointsSkipped },
      });
    }

    return { runId, status, endpointsSucceeded, endpointsFailed, endpointsSkipped };
  } catch (error) {
    await finishRun(
      env,
      runId,
      "failed",
      endpointsSucceeded,
      endpointsFailed,
      formatRunMeta(endpointsSkipped, errorMessage(error)),
    );
    await sendFailureAlert(env, {
      severity: "critical",
      type: "ingestion-run-failed",
      message: `Fantasy402 ingestion run ${runId} failed: ${errorMessage(error)}`,
      context: { runId, endpointsSucceeded, endpointsFailed, endpointsSkipped },
    });
    throw error;
  }
}

async function ingestSync(request: Request, env: Env): Promise<Response> {
  const runtimeEnv = await materializeSecretBindings(env);
  let payload: Record<string, unknown> = {};
  const rawBody = await request.text();
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return json({ status: "failed", message: "Expected JSON body" }, 400);
    }
  }

  const trigger = payload.trigger !== false;
  const refresh = payload.refresh !== false;
  const authPayload = { ...payload };
  delete authPayload.trigger;
  delete authPayload.refresh;

  let auth: Record<string, unknown> | null = null;
  if (refresh) {
    const authRequest = new Request(request.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(authPayload),
    });
    const authResponse = await refreshAuth(authRequest, env);
    auth = (await authResponse.json()) as Record<string, unknown>;
    if (!authResponse.ok) {
      return json({ status: "failed", stage: "auth", auth }, authResponse.status);
    }
  }

  let ingestion: RunResult | null = null;
  if (trigger) {
    try {
      ingestion = await runIngestion(runtimeEnv);
    } catch (error) {
      return json(
        { status: "failed", stage: "ingestion", auth, message: errorMessage(error) },
        500,
      );
    }
  }

  let plan: Awaited<ReturnType<typeof getIngestionPlan>> | null = null;
  try {
    plan = await getIngestionPlan(runtimeEnv);
  } catch {
    plan = null;
  }

  const httpStatus = ingestion
    ? ingestion.status === "failed"
      ? 500
      : 202
    : 200;

  return json({ status: "ok", auth, ingestion, plan }, httpStatus);
}

async function getLocalIngestPlan(env: Env): Promise<Response> {
  const plan = await getIngestionPlan(env);
  const now = new Date();
  const cachedPlayerCustomerId = await readCachedPlayerCustomerId(env);
  const ingestionRuntime: IngestionEnv = {
    ...env,
    __ingestionCustomerId: cachedPlayerCustomerId ?? undefined,
  };
  const endpoints: Array<Record<string, unknown>> = [];
  const unsupported: string[] = [];

  const needsCustomerPrefetch =
    !hasEnvValue(env.FANTASY402_CUSTOMER_ID)
    && !cachedPlayerCustomerId
    && plan.keys.some((key) => isEndpointKey(key) && Boolean(ENDPOINTS[key].requiresCustomerId));
  const keysToProcess =
    needsCustomerPrefetch && !plan.keys.includes("getPlayers")
      ? ["getPlayers", ...plan.keys]
      : plan.keys;

  for (const key of keysToProcess) {
    if (!isEndpointKey(key)) {
      unsupported.push(key);
      continue;
    }
    try {
      const endpoint = resolveEndpointConfig(key, env, ingestionRuntime);
      if (
        endpoint.requiresCustomerId
        && !hasEnvValue(env.FANTASY402_CUSTOMER_ID)
        && !ingestionRuntime.__ingestionCustomerId
      ) {
        endpoints.push({
          key,
          path: endpoint.path,
          method: "POST",
          customerIdSource: customerIdSourceForKey(key) ?? GET_PLAYERS_CUSTOMER_ID_SOURCE,
          requiresCustomerIdResolution: true,
        });
        continue;
      }
      const body = endpoint.buildBody(ingestionRuntime, now);
      const encoded = encodeRequestBody(endpoint, body);
      endpoints.push({
        key,
        path: endpoint.path,
        method: "POST",
        contentType: encoded.contentType,
        body: serializeRequestBody(encoded),
      });
    } catch (error) {
      unsupported.push(key);
      console.warn("local ingest plan skipped endpoint", safeError(error, { key }));
    }
  }

  return json(
    {
      status: "ok",
      baseUrl: baseUrl(env),
      agentId: env.FANTASY402_AGENT_ID,
      batch: {
        keys: plan.keys,
        cursor: plan.cursor,
        nextCursor: plan.nextCursor,
        batchSize: plan.batchSize,
        catalogSize: plan.catalogSize,
        batching: plan.batching,
        customerIdPrefetch: needsCustomerPrefetch,
      },
      endpoints,
      unsupported,
      localFetchNote: "Fetch from the browser session on fantasy402.com; Worker /trigger cannot reuse IP-bound cf_clearance.",
    },
    200,
  );
}

async function readFailureBreakdown(env: Env): Promise<Array<{ code: string; count: number; example: string | null }>> {
  try {
    const rows = await env.ANALYTICS_DB.prepare(
      `SELECT error_message, COUNT(*) AS count
       FROM endpoint_failures
       WHERE failed_at > datetime('now', '-1 day')
       GROUP BY error_message
       ORDER BY count DESC
       LIMIT 10`,
    ).all<{ error_message: string; count: number }>();

    return (rows.results ?? []).map((row) => ({
      code: classifyFailureMessage(row.error_message),
      count: Number(row.count ?? 0),
      example: String(row.error_message ?? "").slice(0, 120) || null,
    }));
  } catch {
    return [];
  }
}

function classifyFailureMessage(message: string): string {
  const text = String(message ?? "");
  if (/HTTP 403/.test(text)) return "UPSTREAM_403_IP_OR_PERMISSION";
  if (/HTTP 404/.test(text)) return "UPSTREAM_404_NOT_FOUND";
  if (/HTTP 401/.test(text)) return "UPSTREAM_401_UNAUTHORIZED";
  if (/HTTP 429/.test(text)) return "UPSTREAM_429_RATE_LIMIT";
  if (/JWT expired/i.test(text)) return "AUTH_JWT_EXPIRED";
  if (/circuit breaker/i.test(text)) return "CIRCUIT_BREAKER_OPEN";
  if (/customerID/i.test(text)) return "CUSTOMER_ID_MISSING";
  return "OTHER";
}

function buildIngestionBlockers(
  auth: Record<string, unknown>,
  pendingCount: number,
  failureBreakdown: Array<{ code: string; count: number }>,
): Array<{ code: string; severity: "error" | "warn" | "info"; message: string; action: string }> {
  const blockers: Array<{ code: string; severity: "error" | "warn" | "info"; message: string; action: string }> = [];
  const readiness = auth.ingestionReadiness as { status?: string; blocker?: string | null } | undefined;
  const expiry = auth.authorizationExpiry as { status?: string; expiresAt?: string | null } | undefined;

  if (expiry?.status === "expired") {
    blockers.push({
      code: "AUTH_JWT_EXPIRED",
      severity: "error",
      message: `Bearer JWT expired at ${expiry.expiresAt ?? "unknown"}`,
      action: "Paste a fresh DevTools capture from fantasy402.com into Endpoints → Sync auth",
    });
  } else if (readiness?.status !== "ready") {
    blockers.push({
      code: "AUTH_NOT_READY",
      severity: "error",
      message: readiness?.blocker ?? "Upstream auth not ingestion-ready",
      action: "Refresh auth via browser capture or POST /refresh-auth with valid bearer + CF cookies",
    });
  }

  if (pendingCount > 0) {
    blockers.push({
      code: "CATALOG_INCOMPLETE",
      severity: "warn",
      message: `${pendingCount} upstream route(s) have no successful D1 snapshot yet`,
      action: "Run local/browser ingest (npm run ingest:local-all or manager.html auto-runner)",
    });
  }

  const worker403 = failureBreakdown.find((row) => row.code === "UPSTREAM_403_IP_OR_PERMISSION");
  if (worker403 && worker403.count > 0) {
    blockers.push({
      code: "WORKER_TRIGGER_403",
      severity: "info",
      message: `${worker403.count} worker /trigger failure(s) in 24h with HTTP 403 (Cloudflare error 1106 — IP-bound cookies)`,
      action: "Do not rely on Worker /trigger for catalog backfill; use local ingest from browser IP",
    });
  }

  return blockers;
}

async function getIngestCatalogStatus(env: Env): Promise<Response> {
  const configured = configuredIngestionKeys(env);
  const snapshotTimes = await readLatestSnapshotTimes(env);
  const manifestKeys = UPSTREAM_MANIFEST.endpoints.map((entry) => entry.key);
  const onlineKeys = manifestKeys.filter((key) => snapshotTimes.has(key));
  const pendingKeys = manifestKeys.filter((key) => configured.has(key) && !snapshotTimes.has(key));
  const plan = await getIngestionPlan(env);
  const auth = upstreamAuthDiagnostics(env);
  const batchSize = plan.batchSize || ingestionBatchSize(env.FANTASY402_INGESTION_BATCH_SIZE);
  const batchesRemaining = plan.batching
    ? Math.ceil(pendingKeys.length / Math.max(1, batchSize))
    : pendingKeys.length > 0 ? 1 : 0;

  const failureBreakdown = await readFailureBreakdown(env);
  const plane = ingestPlaneSummary(manifestKeys);

  return json(
    {
      status: "ok",
      catalogSize: manifestKeys.length,
      configuredCount: configured.size,
      onlineCount: onlineKeys.length,
      pendingCount: pendingKeys.length,
      ingestPlane: plane,
      workerTriggerMode: workerTriggerMode(env),
      onlineKeys,
      pendingKeys,
      cursor: plan.cursor,
      nextCursor: plan.nextCursor,
      batchSize,
      batching: plan.batching,
      batchesRemaining,
      auth: {
        ingestionReadiness: auth.ingestionReadiness,
        authorizationExpiry: auth.authorizationExpiry,
      },
      blockers: buildIngestionBlockers(auth, pendingKeys.length, failureBreakdown),
      failureBreakdown24h: failureBreakdown,
      backfillNote: pendingKeys.length > 0
        ? "Use local/browser ingest (manager.html auto-runner or npm run ingest:local-all). Worker /trigger alone will not backfill pending routes."
        : "Full catalog has at least one successful snapshot per route.",
    },
    200,
  );
}

async function getLocalIngestBootstrap(env: Env): Promise<Response> {
  const cached = await env.AUTH_CACHE.get<AuthCacheRecord>(AUTH_CACHE_KEY, "json");
  if (!cached?.authorization) {
    return json({ status: "failed", message: "No cached browser auth on worker" }, 404);
  }
  let browserHeaders: Record<string, string> | undefined;
  if (cached.browserHeadersJson) {
    try {
      browserHeaders = JSON.parse(cached.browserHeadersJson) as Record<string, string>;
    } catch {
      browserHeaders = undefined;
    }
  }
  return json(
    {
      status: "ok",
      authorization: cached.authorization,
      sessionCookie: cached.sessionCookie,
      cfClearance: cached.cfClearance,
      cfBm: cached.cfBm,
      browserHeaders,
      referer: cached.referer,
      userAgent: cached.userAgent,
      customerId: cached.customerId,
      updatedAt: cached.updatedAt,
      expiresAt: cached.expiresAt,
    },
    200,
  );
}

async function advanceIngestionCursor(env: Env): Promise<Response> {
  const advanced = await advanceIngestionCursorRecord(env);
  if (!advanced) {
    return json({ status: "failed", message: "Ingestion batching is not enabled" }, 400);
  }
  return json({ status: "ok", ...advanced }, 200);
}

async function advanceIngestionCursorRecord(env: Env): Promise<Record<string, unknown> | null> {
  const plan = await getIngestionPlan(env);
  if (!plan.batching) return null;
  await writeIngestionCursor(env, plan.nextCursor);
  return {
    previousCursor: plan.cursor,
    nextCursor: plan.nextCursor,
    batchSize: plan.batchSize,
    catalogSize: plan.catalogSize,
  };
}

function serializeRequestBody(encoded: ReturnType<typeof encodeRequestBody>): Record<string, string> | unknown {
  if (encoded.contentType.includes("json")) {
    return JSON.parse(String(encoded.body));
  }
  const form = encoded.body instanceof URLSearchParams
    ? encoded.body
    : new URLSearchParams(String(encoded.body));
  return Object.fromEntries(form.entries());
}

async function ingestLocalResponses(request: Request, env: Env): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ status: "failed", message: "Expected JSON body" }, 400);
  }
  const parsed = parseBody(localIngestSchema, payload, json);
  if (!parsed.ok) return parsed.response;
  const items = parsed.data.results;

  const runId = crypto.randomUUID();
  const startedAt = new Date();
  const endpointKeys: string[] = [];
  await env.ANALYTICS_DB.prepare(
    "INSERT INTO ingestion_runs (id, started_at, status, endpoints_requested) VALUES (?, ?, 'running', ?)",
  )
    .bind(runId, startedAt.toISOString(), "local-upload")
    .run();

  let endpointsSucceeded = 0;
  let endpointsFailed = 0;
  const stored: Array<Record<string, unknown>> = [];

  try {
    const ingestionRuntime: IngestionEnv = { ...env };
    for (const rawItem of items) {
      const item = normalizeLocalIngestItem(rawItem);
      if (!item) {
        endpointsFailed += 1;
        continue;
      }
      endpointKeys.push(item.endpointKey);
      const endpoint = ENDPOINTS[item.endpointKey];
      try {
        const result = await archiveLocalIngestItem(env, runId, endpoint, item);
        await storeSnapshot(env, runId, result);
        if (endpoint.key === "getAgentPerformance") {
          await storeAgentPerformance(env, mapAgentPerformance(result.data, env.FANTASY402_AGENT_ID, result.snapshotId, runId));
        }
        if (endpoint.key === "getAuthorizations") {
          await storeAuthorizations(env, mapAuthorizations(result.data, result.snapshotId, runId));
        }
        if (endpoint.key === "getBetTicker") {
          const records = mapBetTickerWagers(result.data, result.snapshotId, runId);
          await storeBetTickerWagers(env, records);
          for (const record of records) {
            notifyLiveWager(env, { id: record.id, login: record.login, wager_type: record.wagerType, amount_wagered: record.amountWagered, captured_at: record.capturedAt });
          }
        }
        if (endpoint.key === "getGraded") {
          const records = mapGradedWagers(result.data, result.snapshotId, runId);
          await storeGradedWagers(env, records);
          for (const record of records) {
            notifyLiveWager(env, { id: record.id, login: record.login, wager_type: record.wagerType, amount_wagered: record.amountWagered, captured_at: record.capturedAt });
          }
        }
        if (endpoint.key === "getPropWagers") {
          const records = mapPropWagers(result.data, result.snapshotId, runId);
          await storePropWagers(env, records);
          for (const record of records) {
            notifyLiveWager(env, { id: record.id, login: record.login, wager_type: record.wagerType, amount_wagered: record.amountWagered, captured_at: record.capturedAt });
          }
        }
        if (endpoint.key === "getAgentPositionData") {
          await storeAgentPositionData(env, mapAgentPositionData(result.data, result.snapshotId, runId));
        }
        if (endpoint.key === "getListAgenstByAgent") {
          await storePlayerAgents(env, mapPlayerAgents(result.data, result.snapshotId));
        }
        if (endpoint.key === "getPlayers") {
          const playerCustomerId = extractPlayerCustomerId(result.data);
          if (playerCustomerId) {
            ingestionRuntime.__ingestionCustomerId = playerCustomerId;
            await cachePlayerCustomerId(env, playerCustomerId);
          }
        }
        if (endpoint.key === "getWebLog") {
          const records = mapWebLogEntries(result.data, result.snapshotId, runId);
          await storeWebLogEntries(env, records);
        }
        await ingestCustomerProfileSnapshot(
          env,
          endpoint.key,
          result.data,
          result.snapshotId,
          customerIdHint(ingestionRuntime),
        );
        if (endpoint.key === "getWeeklyFigureByAgent" || endpoint.key === "getWeeklyFigureByAgentLite") {
          const records = mapWeeklyFigures(result.data, result.snapshotId, runId, env.FANTASY402_AGENT_ID);
          await storeWeeklyFigures(env, records);
        }
        endpointsSucceeded += 1;
        stored.push({
          endpointKey: endpoint.key,
          httpStatus: item.httpStatus,
          r2Key: result.r2Key,
          snapshotId: result.snapshotId,
          itemCount: countItems(result.data),
        });
      } catch (error) {
        endpointsFailed += 1;
        console.error("local endpoint ingestion failed", safeError(error, { endpoint: item.endpointKey, runId }));
      }
    }

    const status = endpointsFailed === 0 ? "success" : "failed";
    await env.ANALYTICS_DB.prepare("UPDATE ingestion_runs SET endpoints_requested = ? WHERE id = ?")
      .bind(endpointKeys.join(","), runId)
      .run();
    await finishRun(env, runId, status, endpointsSucceeded, endpointsFailed);

    let cursorAdvanced: Record<string, unknown> | null = null;
    if (parsed.data.advanceCursor && endpointsSucceeded > 0) {
      cursorAdvanced = await advanceIngestionCursorRecord(env);
    }

    return json(
      { runId, status, endpointsSucceeded, endpointsFailed, stored, cursorAdvanced },
      status === "success" ? 202 : 500,
    );
  } catch (error) {
    await finishRun(env, runId, "failed", endpointsSucceeded, endpointsFailed, errorMessage(error));
    return json({ status: "failed", message: errorMessage(error), runId }, 500);
  }
}

function normalizeLocalIngestItem(value: unknown): LocalIngestItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const endpointKey = String(record.endpointKey ?? "");
  if (!isEndpointKey(endpointKey)) return null;
  const httpStatus = clampInteger(Number(record.httpStatus ?? 200), 100, 599);
  const capturedAt = typeof record.capturedAt === "string" ? record.capturedAt : undefined;
  const item: LocalIngestItem = {
    endpointKey,
    httpStatus,
    data: record.data,
  };
  if (capturedAt) item.capturedAt = capturedAt;
  return item;
}

async function archiveLocalIngestItem(env: Env, runId: string, endpoint: EndpointConfig, item: LocalIngestItem): Promise<ApiResult> {
  const capturedAt = validDateOrNow(item.capturedAt);
  const traceId = crypto.randomUUID();
  const data = redactResponse(item.data);
  const serialized = JSON.stringify(data);
  const responseHash = await sha256Hex(serialized);
  const snapshotId = crypto.randomUUID();
  const date = capturedAt.toISOString().slice(0, 10);
  const r2Key = archiveKey(endpoint.key, date, snapshotId);
  const r2Object = await putArchiveObject(env, r2Key, serialized, {
    source: "fantasy402",
    archiveType: "success",
    ingestionMode: "local-browser-upload",
    endpoint: endpoint.key,
    path: endpoint.path,
    runId,
    traceId,
    snapshotId,
    responseHash,
    capturedAt: capturedAt.toISOString(),
    durationMs: "0",
    size: String(serialized.length),
  });

  return {
    endpoint,
    capturedAt: capturedAt.toISOString(),
    traceId,
    durationMs: 0,
    status: item.httpStatus,
    attempts: 1,
    data,
    r2Key,
    r2Etag: r2Object.etag,
    r2Size: r2Object.size,
    r2StorageClass: r2Object.storageClass,
    responseHash,
    snapshotId,
  };
}

function validDateOrNow(value: string | undefined): Date {
  if (value) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return new Date();
}

async function runScheduledScan(env: Env, targetUrl = "https://fantasy402.com") {
  try {
    required(env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN");
    console.info("[URL Scanner] Starting scheduled scan", { url: targetUrl });
    const result = await submitAndWait(targetUrl, env, {
      agentReadiness: true,
      screenshots: ["desktop", "mobile"],
    });
    console.info("[URL Scanner] Scan completed", {
      scanId: result.task.uuid,
      url: result.task.url,
      malicious: Boolean(result.verdicts?.overall?.malicious),
      tlsValidDays: result.page?.tlsValidDays ?? null,
    });

    if (result.verdicts?.overall?.malicious) {
      await sendFailureAlert(env, {
        severity: "critical",
        type: "url-scan-malicious",
        message: `URL Scanner malicious verdict for ${result.task.url}. Scan ID: ${result.task.uuid}`,
        context: { scanId: result.task.uuid, url: result.task.url },
      });
    }

    const tlsValidDays = result.page?.tlsValidDays;
    if (typeof tlsValidDays === "number" && tlsValidDays < 7) {
      await sendFailureAlert(env, {
        severity: "warning",
        type: "url-scan-tls-expiring",
        message: `URL Scanner TLS warning for ${result.task.url}: certificate expires in ${tlsValidDays} day(s).`,
        context: { scanId: result.task.uuid, url: result.task.url, tlsValidDays },
      });
    }

    const persistedSummary = await getPersistedNetworkSummary(result.task.uuid, env);
    const networkSummary = persistedSummary?.summary ?? result.networkSummary;
    if (networkSummary) {
      await alertOnNetworkSummary(env, result.task.uuid, result.task.url, networkSummary);
    }

    return result;
  } catch (error) {
    await sendFailureAlert(env, {
      severity: "critical",
      type: "url-scan-failed",
      message: `URL Scanner failed for ${targetUrl}: ${errorMessage(error)}`,
      context: { url: targetUrl },
    });
    throw error;
  }
}

async function alertOnNetworkSummary(env: Env, scanId: string, scannedUrl: string, summary: HarNetworkSummary): Promise<void> {
  const allowedHosts = allowedScanHosts(env);
  const observedHosts = Object.keys(summary.byHost);
  const unexpectedHosts = observedHosts.filter((host) => !allowedHosts.has(host));
  const thirdPartyHosts = unexpectedHosts.filter((host) => isThirdPartyHost(host, scannedUrl));
  if (unexpectedHosts.length > 0) {
    await sendFailureAlert(env, {
      severity: "warning",
      type: "url-scan-unexpected-hosts",
      message: `URL Scanner observed unexpected host(s) for ${scannedUrl}: ${unexpectedHosts.join(", ")}`,
      context: {
        scanId,
        url: scannedUrl,
        allowedHosts: [...allowedHosts],
        unexpectedHosts,
        observedHosts,
      },
    });
  }

  if (thirdPartyHosts.length > 0) {
    await sendFailureAlert(env, {
      severity: "warning",
      type: "url-scan-new-third-party",
      message: `URL Scanner observed new third-party host(s) for ${scannedUrl}: ${thirdPartyHosts.join(", ")}`,
      context: {
        scanId,
        url: scannedUrl,
        allowedHosts: [...allowedHosts],
        thirdPartyHosts,
        observedHosts,
        hostCounts: Object.fromEntries(thirdPartyHosts.map((host) => [host, summary.byHost[host] ?? 0])),
      },
    });
  }

  if (summary.failedRequests.length > 0) {
    await sendFailureAlert(env, {
      severity: "warning",
      type: "url-scan-failed-requests",
      message: `URL Scanner observed ${summary.failedRequests.length} failed request(s) for ${scannedUrl}. Scan ID: ${scanId}`,
      context: {
        scanId,
        url: scannedUrl,
        failedCount: summary.failedRequests.length,
        failedRequests: summary.failedRequests.slice(0, 10),
      },
    });
  }
}

function isThirdPartyHost(host: string, scannedUrl: string): boolean {
  const normalizedHost = host.toLowerCase();
  const root = firstPartyRoot(scannedUrl);
  if (!root) return true;
  return normalizedHost !== root && !normalizedHost.endsWith(`.${root}`);
}

function firstPartyRoot(scannedUrl: string): string | null {
  try {
    return new URL(scannedUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function allowedScanHosts(env: Env): Set<string> {
  return configuredScanHosts(env);
}

function configuredScanHosts(env: Env): Set<string> {
  const hosts = new Set(["fantasy402.com", "www.fantasy402.com"]);
  const configuredBaseHost = hostFromUrl(env.FANTASY402_BASE_URL);
  if (configuredBaseHost) hosts.add(configuredBaseHost);
  for (const host of (env.FANTASY402_ALLOWED_SCAN_HOSTS ?? "").split(",")) {
    const clean = normalizeHost(host);
    if (/^[a-z0-9.-]{1,253}$/.test(clean)) hosts.add(clean);
  }
  return hosts;
}

function isAllowedScanTarget(env: Env, targetUrl: string): boolean {
  const targetHost = hostFromUrl(targetUrl);
  return Boolean(targetHost && configuredScanHosts(env).has(targetHost));
}

function hostFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeHost(new URL(value).hostname);
  } catch {
    return null;
  }
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

async function refreshAuth(request: Request, env: Env): Promise<Response> {
  const runtimeEnv = await materializeSecretBindings(env);
  let payload: unknown = {};
  const rawBody = await request.text();
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ status: "failed", message: "Expected JSON body" }, 400);
    }
  }

  const parsed = parseBody(refreshAuthSchema, payload, json);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data as Record<string, unknown>;
  applyCookieHeaderAuthAliases(body);
  const authorizationExpiry = authorizationExpiryDiagnostics(firstString(body.authorization));
  if (authorizationExpiry.status === "expired") {
    return json(
      {
        status: "failed",
        message: `authorization JWT expired at ${authorizationExpiry.expiresAt}`,
      },
      400,
    );
  }
  if (
    body.sessionCookie !== undefined &&
    !hasNonCloudflareCookieHeader(String(body.sessionCookie ?? ""))
  ) {
    return json(
      {
        status: "failed",
        message: "sessionCookie must include a non-Cloudflare application cookie when provided; omit it for bearer plus cf_clearance and __cf_bm browser auth",
      },
      400,
    );
  }

  const record: AuthCacheRecord = {
    updatedAt: new Date().toISOString(),
    expiresAt: Date.now() + authCacheTtlSeconds(body.expiresInSeconds) * 1000,
  };
  const accepted: string[] = [];

  setAuthCacheString(record, accepted, "authorization", body.authorization, 8192, normalizeAuthorization);
  setAuthCacheString(record, accepted, "sessionCookie", body.sessionCookie, 8192);
  setAuthCacheString(record, accepted, "cfClearance", body.cfClearance, 4096, (value) => normalizeCookieValue("cf_clearance", value));
  setAuthCacheString(record, accepted, "cfBm", body.cfBm, 4096, (value) => normalizeCookieValue("__cf_bm", value));
  setAuthCacheString(record, accepted, "userAgent", body.userAgent, 512);
  setAuthCacheString(record, accepted, "referer", body.referer, 2048);
  setAuthCacheString(record, accepted, "customerId", body.customerId, 128);

  const browserHeadersJson = normalizeBrowserHeadersInput(body.browserHeadersJson ?? body.browserHeaders);
  if (browserHeadersJson) {
    record.browserHeadersJson = browserHeadersJson;
    accepted.push("browserHeadersJson");
  }

  if (accepted.length === 0) {
    return renewUpstreamAuthFromWorker(runtimeEnv);
  }

  const ttl = Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1000));
  await runtimeEnv.AUTH_CACHE.put(AUTH_CACHE_KEY, JSON.stringify(record), { expirationTtl: ttl });
  if (accepted.some((field) => field === "cfClearance" || field === "cfBm")) {
    await persistCloudflareCookies(runtimeEnv, record.cfClearance, record.cfBm);
  } else {
    d1CookiesCache = null;
  }

  return json(
    {
      status: "ok",
      mode: "overlay",
      accepted,
      expiresAt: new Date(record.expiresAt).toISOString(),
      ttlSeconds: ttl,
    },
    200,
  );
}

async function renewUpstreamAuthFromWorker(env: Env): Promise<Response> {
  const cachedAuth = await env.AUTH_CACHE.get<AuthCacheRecord>(AUTH_CACHE_KEY, "json");
  if (cachedAuth?.authorization) {
    applyAuthRecord(env, cachedAuth);
    const sessionCookie = cachedAuth.sessionCookie ?? env.FANTASY402_SESSION_COOKIE ?? "";
    const renewed = await tryRenewFantasy402Token(env, sessionCookie);
    if (renewed) {
      const stored = await env.AUTH_CACHE.get<AuthCacheRecord>(AUTH_CACHE_KEY, "json");
      const accepted = [
        renewed.authorization ? "authorization" : null,
        renewed.sessionCookie ? "sessionCookie" : null,
        renewed.cfClearance ? "cfClearance" : null,
        renewed.cfBm ? "cfBm" : null,
      ].filter(Boolean);
      return json(
        {
          status: "ok",
          mode: "renew",
          accepted,
          expiresAt: stored?.expiresAt ? new Date(stored.expiresAt).toISOString() : undefined,
        },
        200,
      );
    }
  }

  try {
    const sessionCookie = await getOrRefreshSession(env);
    const stored = await env.AUTH_CACHE.get<AuthCacheRecord>(AUTH_CACHE_KEY, "json");
    const accepted = [
      stored?.authorization ? "authorization" : null,
      sessionCookie ? "sessionCookie" : null,
      stored?.cfClearance ? "cfClearance" : null,
      stored?.cfBm ? "cfBm" : null,
    ].filter(Boolean);
    return json(
      {
        status: "ok",
        mode: "session",
        accepted,
        hasSession: Boolean(sessionCookie),
        expiresAt: stored?.expiresAt ? new Date(stored.expiresAt).toISOString() : undefined,
      },
      200,
    );
  } catch (error) {
    return json({ status: "failed", message: errorMessage(error) }, 502);
  }
}

async function updateCookies(request: Request, env: Env): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ status: "failed", message: "Expected JSON body" }, 400);
  }
  const parsed = parseBody(updateCookiesSchema, payload, json);
  if (!parsed.ok) return parsed.response;

  const { cf_clearance, __cf_bm } = parsed.data;

  try {
    await persistCloudflareCookies(env, cf_clearance, __cf_bm);
  } catch (error) {
    console.error("[Cookies] D1 upsert failed:", errorMessage(error));
    return json({ status: "failed", message: "D1 upsert failed", detail: errorMessage(error) }, 500);
  }

  return json({ status: "ok", updated: ["cf_clearance", "__cf_bm"] }, 200);
}

async function persistCloudflareCookies(
  env: Env,
  cfClearance: string | undefined,
  cfBm: string | undefined,
): Promise<void> {
  const clearanceValue = cookieValueOnly(cfClearance);
  const bmValue = cookieValueOnly(cfBm);
  if (!clearanceValue && !bmValue) {
    d1CookiesCache = null;
    return;
  }

  const stmt = env.ANALYTICS_DB.prepare(
    `INSERT INTO cookies (name, value, updated_at) VALUES (?1, ?2, datetime('now'))
     ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  );

  if (clearanceValue) await stmt.bind("cf_clearance", clearanceValue).run();
  if (bmValue) await stmt.bind("__cf_bm", bmValue).run();
  d1CookiesCache = null;
}

function cookieValueOnly(cookie: string | undefined): string | null {
  if (typeof cookie !== "string") return null;
  const trimmed = cookie.trim();
  if (!trimmed) return null;
  const index = trimmed.indexOf("=");
  return index > 0 ? trimmed.slice(index + 1).trim() : trimmed;
}

async function upstreamCookiesStatus(env: Env): Promise<Response> {
  try {
    const result = await env.ANALYTICS_DB.prepare(
      "SELECT name, value, updated_at FROM cookies WHERE name IN ('cf_clearance', '__cf_bm')"
    ).all();
    const rows = result.results as { name: string; value: string; updated_at: string }[];
    const cookies: Record<string, { updated_at: string; value_preview: string }> = {};
    for (const row of rows) {
      cookies[row.name] = {
        updated_at: row.updated_at,
        value_preview: row.value.slice(0, 30) + "...",
      };
    }
    return json(
      {
        status: "ok",
        source: "d1",
        cookies,
        cache_active: d1CookiesCache !== null && d1CookiesCache.expiresAt > Date.now(),
      },
      200,
    );
  } catch (error) {
    return json(
      {
        status: "ok",
        source: "fallback",
        cf_clearance_present: Boolean(env.FANTASY402_CF_CLEARANCE),
        __cf_bm_present: Boolean(env.FANTASY402_CF_BM),
        cache_active: d1CookiesCache !== null && d1CookiesCache.expiresAt > Date.now(),
        d1_error: errorMessage(error),
      },
      200,
    );
  }
}

function applyCookieHeaderAuthAliases(body: Record<string, unknown>): void {
  const cookieHeader = firstString(body.cookieHeader, body.cookie, body.cookies);
  if (!cookieHeader) return;
  if (body.sessionCookie === undefined) {
    const sessionCookie = cookieHeaderWithoutCloudflare(cookieHeader);
    if (sessionCookie) body.sessionCookie = sessionCookie;
  }
  if (body.cfClearance === undefined) {
    const cfClearance = cookieHeaderCookie(cookieHeader, "cf_clearance");
    if (cfClearance) body.cfClearance = cfClearance;
  }
  if (body.cfBm === undefined) {
    const cfBm = cookieHeaderCookie(cookieHeader, "__cf_bm");
    if (cfBm) body.cfBm = cfBm;
  }
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function cookieHeaderWithoutCloudflare(value: string): string {
  return splitCookieHeader(value)
    .filter((cookie) => {
      const name = cookieName(cookie);
      return Boolean(name && !isCloudflareCookieName(name));
    })
    .join("; ");
}

function cookieHeaderCookie(value: string, wantedName: string): string {
  return splitCookieHeader(value).find((cookie) => cookieName(cookie)?.toLowerCase() === wantedName.toLowerCase()) ?? "";
}

function authCacheTtlSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_AUTH_CACHE_TTL_SECONDS;
  return clampInteger(value, 60, MAX_AUTH_CACHE_TTL_SECONDS);
}

function setAuthCacheString(
  record: AuthCacheRecord,
  accepted: string[],
  key: keyof Omit<AuthCacheRecord, "updatedAt" | "expiresAt">,
  value: unknown,
  maxLength: number,
  normalize: (value: string) => string | null = (input) => input.trim(),
): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || /[\u0000-\u001f\u007f]/.test(trimmed)) return;
  const normalized = normalize(trimmed);
  if (!normalized) return;
  record[key] = normalized;
  accepted.push(key);
}

function normalizeBrowserHeadersInput(value: unknown): string | null {
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value.trim().slice(0, 8192);
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return JSON.stringify(value).slice(0, 8192);
  }
  return null;
}

async function getOrRefreshSession(env: Env): Promise<string> {
  const configuredSessionCookie = env.FANTASY402_SESSION_COOKIE;
  const configuredSession = typeof configuredSessionCookie === "string" ? configuredSessionCookie.trim() : "";
  const configuredAppSession = hasNonCloudflareCookieHeader(configuredSession);

  const cachedAuth = await env.AUTH_CACHE.get<AuthCacheRecord>(AUTH_CACHE_KEY, "json");
  if (cachedAuth && cachedAuth.expiresAt > Date.now() + 5 * 60_000) {
    applyAuthRecord(env, cachedAuth);
    const cachedSession = cachedAuth.sessionCookie ?? configuredSession;
    if (hasNonCloudflareCookieHeader(cachedSession)) return cachedSession;
    if (hasBearerCloudflareAuth(env)) return cachedSession;
  }

  if (cachedAuth?.authorization && (hasNonCloudflareCookieHeader(cachedAuth.sessionCookie ?? "") || configuredAppSession)) {
    applyAuthRecord(env, cachedAuth);
    const renewed = await tryRenewFantasy402Token(env, cachedAuth.sessionCookie ?? configuredSession);
    if (renewed) return renewed.sessionCookie;
  }

  if (normalizeAuthorization(env.FANTASY402_AUTHORIZATION) && configuredAppSession) {
    return configuredSession;
  }
  if (hasBearerCloudflareAuth(env)) {
    return configuredSession;
  }

  const cached = await env.SESSION_KV.get<SessionRecord>(SESSION_KEY, "json");
  if (cached && cached.expiresAt > Date.now() + 60_000 && (cached.cookie.length > 0 || cached.authorization)) {
    if (cached.authorization) env.FANTASY402_AUTHORIZATION = cached.authorization;
    return cached.cookie;
  }

  const authenticated = await authenticateFantasy402(env);
  await cacheFantasy402Auth(env, authenticated, DEFAULT_SESSION_TTL_SECONDS);
  return authenticated.sessionCookie;
}

async function authenticateFantasy402(env: Env): Promise<AuthMaterial> {
  const form = new URLSearchParams();
  const customerId = env.FANTASY402_USERNAME.toLocaleUpperCase();
  form.set("customerID", customerId);
  form.set("state", "true");
  form.set("password", env.FANTASY402_PASSWORD);
  form.set("sufix", "");
  form.set("prefix", "");
  form.set("multiaccount", "1");
  form.set("response_type", "code");
  form.set("client_id", customerId);
  form.set("domain", "fantasy402.com");
  form.set("redirect_uri", "fantasy402.com");
  form.set("operation", "authenticateCustomer");
  form.set("RRO", "1");

  const response = await fetchWithTimeout(`${baseUrl(env)}/cloud/api/System/authenticateCustomer`, {
    method: "POST",
    body: form,
    headers: await fantasy402ApiHeaders(env, "", "application/x-www-form-urlencoded; charset=UTF-8"),
  });

  if (!response.ok) {
    throw new Error(`Fantasy402 authenticateCustomer failed with HTTP ${response.status}`);
  }

  const authResponse = await safeReadJson(response);
  const authorization = normalizeAuthorization(extractAuthToken(authResponse));
  const cookie = optionalFirstSetCookie(response.headers);
  const cfClearance = setCookieValue(response.headers, "cf_clearance");
  const cfBm = setCookieValue(response.headers, "__cf_bm");
  if (authorization) env.FANTASY402_AUTHORIZATION = authorization;
  if (cfClearance) env.FANTASY402_CF_CLEARANCE = cfClearance;
  if (cfBm) env.FANTASY402_CF_BM = cfBm;
  if (!authorization && !cookie) {
    throw new Error("Fantasy402 authenticateCustomer response did not include bearer token or session cookie");
  }

  const session: SessionRecord = {
    cookie: cookie ?? "",
    expiresAt: Date.now() + DEFAULT_SESSION_TTL_SECONDS * 1000,
  };
  if (authorization) session.authorization = authorization;

  await env.SESSION_KV.put(SESSION_KEY, JSON.stringify(session), {
    expirationTtl: DEFAULT_SESSION_TTL_SECONDS,
  });

  const material: AuthMaterial = {
    sessionCookie: session.cookie,
  };
  if (session.authorization) material.authorization = session.authorization;
  if (cfClearance) material.cfClearance = cfClearance;
  if (cfBm) material.cfBm = cfBm;
  return material;
}

async function tryRenewFantasy402Token(env: Env, sessionCookie: string): Promise<AuthMaterial | null> {
  try {
    const response = await fetchWithTimeout(`${baseUrl(env)}/cloud/api/System/renewToken`, {
      method: "POST",
      body: new URLSearchParams(),
      headers: await fantasy402ApiHeaders(env, sessionCookie, "application/x-www-form-urlencoded; charset=UTF-8"),
    });
    if (!response.ok) {
      console.warn("[Fantasy402] renewToken failed", { status: response.status });
      return null;
    }
    const authResponse = await safeReadJson(response);
    const authorization = normalizeAuthorization(extractAuthToken(authResponse));
    const cookie = optionalFirstSetCookie(response.headers) ?? sessionCookie;
    const cfClearance = setCookieValue(response.headers, "cf_clearance");
    const cfBm = setCookieValue(response.headers, "__cf_bm");
    if (!authorization && !cookie) return null;
    if (authorization) env.FANTASY402_AUTHORIZATION = authorization;
    if (cookie) env.FANTASY402_SESSION_COOKIE = cookie;
    if (cfClearance) env.FANTASY402_CF_CLEARANCE = cfClearance;
    if (cfBm) env.FANTASY402_CF_BM = cfBm;
    const renewed: AuthMaterial = { sessionCookie: cookie };
    if (authorization) renewed.authorization = authorization;
    if (cfClearance) renewed.cfClearance = cfClearance;
    if (cfBm) renewed.cfBm = cfBm;
    await cacheFantasy402Auth(env, renewed, DEFAULT_SESSION_TTL_SECONDS);
    return renewed;
  } catch (error) {
    console.warn("[Fantasy402] renewToken failed", { message: errorMessage(error) });
    return null;
  }
}

async function cacheFantasy402Auth(env: Env, auth: AuthMaterial, ttlSeconds: number): Promise<void> {
  const record: AuthCacheRecord = {
    updatedAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  if (auth.authorization) record.authorization = auth.authorization;
  if (auth.sessionCookie) record.sessionCookie = auth.sessionCookie;
  const cfClearance = normalizeCookieValue("cf_clearance", auth.cfClearance ?? env.FANTASY402_CF_CLEARANCE);
  const cfBm = normalizeCookieValue("__cf_bm", auth.cfBm ?? env.FANTASY402_CF_BM);
  if (cfClearance) record.cfClearance = cfClearance;
  if (cfBm) record.cfBm = cfBm;
  if (env.FANTASY402_BROWSER_HEADERS_JSON) record.browserHeadersJson = env.FANTASY402_BROWSER_HEADERS_JSON;
  if (env.FANTASY402_USER_AGENT) record.userAgent = env.FANTASY402_USER_AGENT;
  if (env.FANTASY402_REFERER) record.referer = env.FANTASY402_REFERER;
  if (env.FANTASY402_CUSTOMER_ID) record.customerId = env.FANTASY402_CUSTOMER_ID;
  await env.AUTH_CACHE.put(AUTH_CACHE_KEY, JSON.stringify(record), { expirationTtl: ttlSeconds });
}

async function refreshAuthSchedule(env: Env): Promise<void> {
  const cachedAuth = await env.AUTH_CACHE.get<AuthCacheRecord>(AUTH_CACHE_KEY, "json");
  if (!cachedAuth?.authorization) {
    console.info("[Fantasy402] Scheduled renew skipped - no cached authorization to refresh");
    return;
  }
  applyAuthRecord(env, cachedAuth);
  const sessionCookie = cachedAuth.sessionCookie ?? env.FANTASY402_SESSION_COOKIE ?? "";
  const renewed = await tryRenewFantasy402Token(env, sessionCookie);
  if (renewed) {
    console.info("[Fantasy402] Token proactively renewed via 5-min schedule");
  } else {
    console.warn("[Fantasy402] Scheduled renew failed - cached session may expire soon");
  }
}

function applyAuthRecord(env: Env, record: AuthCacheRecord): void {
  if (record.authorization) env.FANTASY402_AUTHORIZATION = record.authorization;
  if (record.sessionCookie) env.FANTASY402_SESSION_COOKIE = record.sessionCookie;
  if (record.cfClearance) env.FANTASY402_CF_CLEARANCE = record.cfClearance;
  if (record.cfBm) env.FANTASY402_CF_BM = record.cfBm;
  if (record.browserHeadersJson) env.FANTASY402_BROWSER_HEADERS_JSON = record.browserHeadersJson;
  if (record.userAgent) env.FANTASY402_USER_AGENT = record.userAgent;
  if (record.referer) env.FANTASY402_REFERER = record.referer;
  if (record.customerId) env.FANTASY402_CUSTOMER_ID = record.customerId;
}

async function fetchAndArchiveEndpoint(
  env: Env,
  runId: string,
  traceId: string,
  startedMs: number,
  endpoint: EndpointConfig,
  sessionCookie: string,
  now: Date,
  ingestionRuntime: IngestionEnv,
): Promise<ApiResult> {
  const startedAt = new Date(startedMs);
  const attempted = await withRetries(
    () => postFantasy402(env, endpoint, sessionCookie, now, ingestionRuntime),
    MAX_ENDPOINT_ATTEMPTS,
  );
  const data = await attempted.response.json<unknown>();
  const serialized = JSON.stringify(redactResponse(data));
  const responseHash = await sha256Hex(serialized);
  const snapshotId = crypto.randomUUID();
  const date = now.toISOString().slice(0, 10);
  const r2Key = archiveKey(endpoint.key, date, snapshotId);
  const durationMs = Math.max(0, Date.now() - startedMs);
  const r2Object = await putArchiveObject(env, r2Key, serialized, {
    source: "fantasy402",
    archiveType: "success",
    endpoint: endpoint.key,
    path: endpoint.path,
    runId,
    traceId,
    snapshotId,
    responseHash,
    capturedAt: now.toISOString(),
    startedAt: startedAt.toISOString(),
    durationMs: String(durationMs),
    size: String(serialized.length),
  });

  console.info("r2 archive write", {
    key: r2Key,
    etag: r2Object.etag,
    size: r2Object.size,
    storageClass: r2Object.storageClass,
    runId,
    endpoint: endpoint.key,
    traceId,
  });

  return {
    endpoint,
    capturedAt: now.toISOString(),
    traceId,
    durationMs,
    status: attempted.response.status,
    attempts: attempted.attempts,
    data,
    r2Key,
    r2Etag: r2Object.etag,
    r2Size: r2Object.size,
    r2StorageClass: r2Object.storageClass,
    responseHash,
    snapshotId,
  };
}

interface AttemptedResponse {
  response: Response;
  attempts: number;
}

async function ensureIngestionCustomerId(
  env: Env,
  runtime: IngestionEnv,
  endpoint: EndpointConfig,
  sessionCookie: string,
  now: Date,
): Promise<void> {
  if (!endpoint.requiresCustomerId || hasEnvValue(env.FANTASY402_CUSTOMER_ID) || runtime.__ingestionCustomerId) {
    return;
  }

  const cached = await readCachedPlayerCustomerId(env);
  if (cached) {
    runtime.__ingestionCustomerId = cached;
    return;
  }

  const playersEndpoint = ENDPOINTS.getPlayers;
  const response = await withRetries(
    () => postFantasy402(env, playersEndpoint, sessionCookie, now, runtime),
    MAX_ENDPOINT_ATTEMPTS,
  );
  const data = await response.json<unknown>();
  const customerId = extractPlayerCustomerId(data);
  if (!customerId) {
    throw new Error("Unable to derive player customerID from Manager/getPlayers");
  }
  runtime.__ingestionCustomerId = customerId;
  await cachePlayerCustomerId(env, customerId);
}

async function postFantasy402(
  env: Env,
  endpoint: EndpointConfig,
  sessionCookie: string,
  now: Date,
  ingestionRuntime?: IngestionEnv,
): Promise<Response> {
  const runtime: IngestionEnv = ingestionRuntime ?? { ...env };
  await ensureIngestionCustomerId(env, runtime, endpoint, sessionCookie, now);
  const body = endpoint.buildBody(runtime, now);
  const encodedBody = encodeRequestBody(endpoint, body);
  const headers = await fantasy402ApiHeaders(env, sessionCookie, encodedBody.contentType);

  const response = await fetchWithTimeout(`${baseUrl(env)}${endpoint.path}`, {
    method: "POST",
    body: encodedBody.body,
    headers,
  });

  if (!response.ok) {
    throw new UpstreamHttpError(
      endpoint,
      response.status,
      response.statusText,
      await safeReadResponseText(response),
      safeResponseHeaders(response.headers),
      requestDiagnostics(headers, body),
    );
  }

  return response;
}

async function fantasy402ApiHeaders(env: Env, sessionCookie: string, contentType: string): Promise<Record<string, string>> {
  const base = baseUrl(env);
  const upstreamCookies = await getUpstreamCookies(env);
  const headers: Record<string, string> = {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": contentType,
    Cookie: fantasy402CookieHeader(env, sessionCookie, upstreamCookies),
    Origin: base,
    Referer: env.FANTASY402_REFERER || `${base}/manager.html`,
    "User-Agent": env.FANTASY402_USER_AGENT || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    Priority: "u=1, i",
    "Sec-CH-UA": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"macOS"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "X-Requested-With": "XMLHttpRequest",
  };
  applyObservedBrowserHeaders(headers, env.FANTASY402_BROWSER_HEADERS_JSON);
  headers["Content-Type"] = contentType;
  headers.Cookie = fantasy402CookieHeader(env, sessionCookie, upstreamCookies);
  const authorization = normalizeAuthorization(env.UPSTREAM_TOKEN) ?? normalizeAuthorization(env.FANTASY402_AUTHORIZATION);
  if (authorization) headers.Authorization = authorization;
  return headers;
}

const EXPECTED_BROWSER_HEADER_NAMES = [
  "accept",
  "accept-language",
  "origin",
  "priority",
  "referer",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "user-agent",
  "x-requested-with",
] as const;

const OBSERVED_BROWSER_HEADER_NAMES = new Map(EXPECTED_BROWSER_HEADER_NAMES.map((name) => [name, canonicalHeaderName(name)]));

function applyObservedBrowserHeaders(headers: Record<string, string>, rawJson: string | undefined): void {
  if (typeof rawJson !== "string" || rawJson.trim().length === 0) return;
  const jsonText = rawJson.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    console.error("[Fantasy402] Ignoring invalid FANTASY402_BROWSER_HEADERS_JSON", { message: errorMessage(error) });
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;

  for (const [rawName, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof rawValue !== "string") continue;
    const normalized = rawName.toLowerCase() as (typeof EXPECTED_BROWSER_HEADER_NAMES)[number];
    const canonical = OBSERVED_BROWSER_HEADER_NAMES.get(normalized);
    if (!canonical) continue;
    const value = rawValue.trim();
    if (value) headers[canonical] = value.slice(0, 500);
  }
}

function canonicalHeaderName(name: string): string {
  if (name === "sec-ch-ua") return "Sec-CH-UA";
  if (name === "sec-ch-ua-mobile") return "Sec-CH-UA-Mobile";
  if (name === "sec-ch-ua-platform") return "Sec-CH-UA-Platform";
  return name
    .split("-")
    .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part)
    .join("-");
}

function fantasy402CookieHeader(env: Env, sessionCookie: string, upstreamCookies?: string): string {
  const cookies: string[] = [];
  appendCookieHeaderIfMissing(cookies, env.FANTASY402_SESSION_COOKIE);
  appendCookieHeaderIfMissing(cookies, sessionCookie);
  // Auth overlay / secrets must win over stale D1 cookie cache entries.
  appendCookieIfMissing(cookies, "cf_clearance", env.FANTASY402_CF_CLEARANCE);
  appendCookieIfMissing(cookies, "__cf_bm", env.FANTASY402_CF_BM);
  appendCookieHeaderIfMissing(cookies, upstreamCookies);
  return cookies.join("; ");
}

async function getUpstreamCookies(env: Env): Promise<string> {
  const now = Date.now();
  if (d1CookiesCache && d1CookiesCache.expiresAt > now) {
    return d1CookiesCache.value;
  }

  try {
    const result = await env.ANALYTICS_DB.prepare(
      "SELECT name, value, updated_at FROM cookies WHERE name IN ('cf_clearance', '__cf_bm')"
    ).all();
    const rows = result.results as { name: string; value: string; updated_at: string }[];
    const cookies: string[] = [];
    for (const row of rows) {
      const clean = normalizeCookieValue(row.name, row.value);
      if (clean) cookies.push(clean);
    }
    if (cookies.length > 0) {
      const value = cookies.join("; ");
      d1CookiesCache = { value, expiresAt: now + D1_COOKIES_CACHE_TTL_MS };
      return value;
    }
  } catch (error) {
    console.error("[Cookies] Failed to read cookies from D1:", errorMessage(error));
  }

  // Fallback to env vars
  const fallback: string[] = [];
  appendCookieIfMissing(fallback, "cf_clearance", env.FANTASY402_CF_CLEARANCE);
  appendCookieIfMissing(fallback, "__cf_bm", env.FANTASY402_CF_BM);
  const value = fallback.join("; ");
  d1CookiesCache = { value, expiresAt: now + D1_COOKIES_CACHE_TTL_MS };
  return value;
}

function splitCookieHeader(value: string): string[] {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function appendCookieHeaderIfMissing(cookies: string[], value: string | undefined): void {
  if (typeof value !== "string") return;
  for (const cookie of splitCookieHeader(value)) {
    const name = cookieName(cookie);
    if (!name) continue;
    if (cookies.some((existing) => cookieName(existing)?.toLowerCase() === name.toLowerCase())) continue;
    cookies.push(cookie);
  }
}

function cookieName(cookie: string): string | null {
  const index = cookie.indexOf("=");
  if (index <= 0) return null;
  return cookie.slice(0, index).trim() || null;
}

function appendCookieIfMissing(cookies: string[], name: string, value: string | undefined): void {
  const clean = normalizeCookieValue(name, value);
  if (!clean) return;
  if (cookies.some((cookie) => cookieName(cookie)?.toLowerCase() === name.toLowerCase())) return;
  cookies.push(clean);
}

function normalizeCookieValue(name: string, value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.includes("=") ? trimmed : `${name}=${trimmed}`;
}

function normalizeAuthorization(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

interface AuthorizationExpiryDiagnostics {
  status: "valid" | "expiring" | "expired" | "unknown";
  expiresAt: string | null;
  secondsRemaining: number | null;
}

function authorizationExpiryDiagnostics(value: string | undefined, nowMs = Date.now()): AuthorizationExpiryDiagnostics {
  const token = normalizeAuthorization(value)?.replace(/^Bearer\s+/i, "") ?? "";
  const payload = decodeJwtPayload(token);
  const exp = typeof payload?.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : null;
  if (!exp) return { status: "unknown", expiresAt: null, secondsRemaining: null };

  const secondsRemaining = Math.floor(exp - nowMs / 1000);
  const expiresAt = new Date(exp * 1000).toISOString();
  if (secondsRemaining <= 0) return { status: "expired", expiresAt, secondsRemaining };
  if (secondsRemaining <= 300) return { status: "expiring", expiresAt, secondsRemaining };
  return { status: "valid", expiresAt, secondsRemaining };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(globalThis.atob(padded));
    return decoded && typeof decoded === "object" && !Array.isArray(decoded) ? decoded as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function encodeRequestBody(endpoint: EndpointConfig, body: Record<string, string | number>): { body: string | URLSearchParams; contentType: string } {
  if (endpoint.contentType === "json") {
    return {
      body: JSON.stringify(body),
      contentType: "application/json",
    };
  }

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    form.set(key, String(value));
  }
  return {
    body: form,
    contentType: "application/x-www-form-urlencoded",
  };
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 4000);
  } catch (error) {
    return `Unable to read response body: ${errorMessage(error)}`;
  }
}

function safeResponseHeaders(headers: Headers): Record<string, string> {
  const allowed = new Set([
    "cache-control",
    "cf-cache-status",
    "cf-ray",
    "content-length",
    "content-type",
    "date",
    "location",
    "server",
    "vary",
    "www-authenticate",
  ]);
  const safe: Record<string, string> = {};
  headers.forEach((value, key) => {
    const normalized = key.toLowerCase();
    if (allowed.has(normalized) || normalized.startsWith("x-")) {
      safe[normalized] = value.slice(0, 500);
    }
  });
  return safe;
}

function requestDiagnostics(headers: Record<string, string>, body: Record<string, string | number>): UpstreamRequestDiagnostics {
  const cookieNames = splitCookieHeader(headers.Cookie ?? "")
    .map((cookie) => cookieName(cookie))
    .filter((name): name is string => Boolean(name));
  const hasCookieName = (name: string) => cookieNames.some((cookie) => cookie.toLowerCase() === name.toLowerCase());
  return {
    contentType: headers["Content-Type"] ?? "",
    bodyKeys: Object.keys(body).sort(),
    hasAuthorization: hasEnvValue(headers.Authorization),
    hasCookie: hasEnvValue(headers.Cookie),
    hasSessionCookie: cookieNames.some((name) => !isCloudflareCookieName(name)),
    hasCfClearance: hasCookieName("cf_clearance"),
    hasCfBm: hasCookieName("__cf_bm"),
    cookieNames,
    origin: headers.Origin ?? "",
    referer: headers.Referer ?? "",
    userAgent: headers["User-Agent"] ?? "",
    browserHeaders: browserHeaderPresenceFromHeaders(headers),
  };
}

async function withRetries(request: () => Promise<Response>, maxAttempts: number): Promise<AttemptedResponse> {
  let lastError: unknown;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    try {
      const response = await request();
      return { response, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryableError(error)) break;
      await sleep(250 * attempt);
    }
  }

  throw new EndpointAttemptError(lastError, attempts);
}

async function storeSnapshot(env: Env, runId: string, result: ApiResult): Promise<void> {
  await env.ANALYTICS_DB.prepare(
    `INSERT INTO api_snapshots
       (id, run_id, endpoint_key, path, captured_at, http_status, r2_key, response_hash, item_count,
        attempts, r2_etag, r2_size, r2_storage_class, trace_id, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      result.snapshotId,
      runId,
      result.endpoint.key,
      result.endpoint.path,
      result.capturedAt,
      result.status,
      result.r2Key,
      result.responseHash,
      countItems(result.data),
      result.attempts,
      result.r2Etag,
      result.r2Size,
      result.r2StorageClass,
      result.traceId,
      result.durationMs,
    )
    .run();
}

async function storeEndpointFailure(
  env: Env,
  runId: string,
  traceId: string,
  durationMs: number,
  endpoint: EndpointConfig,
  error: unknown,
): Promise<void> {
  const failureId = crypto.randomUUID();
  const failedAt = new Date();
  const attempts = error instanceof EndpointAttemptError ? error.attempts : 1;
  const upstreamError = unwrapUpstreamHttpError(error);
  const body = JSON.stringify({
    source: "fantasy402-ingestion-worker",
    archiveType: "failure",
    failureId,
    runId,
    traceId,
    endpoint: endpoint.key,
    path: endpoint.path,
    attempts,
    failedAt: failedAt.toISOString(),
    durationMs,
    error: errorMessage(error).slice(0, 1000),
    upstream: upstreamError
      ? {
          status: upstreamError.status,
          statusText: upstreamError.statusText,
          responseHeaders: upstreamError.responseHeaders,
          responseBody: upstreamError.responseBody,
          request: upstreamError.request,
        }
      : null,
  }, null, 2);
  const responseHash = await sha256Hex(body);
  const r2Key = archiveKey(`${endpoint.key}/failures`, failedAt.toISOString().slice(0, 10), failureId);
  const r2Object = await putArchiveObject(env, r2Key, body, {
    source: "fantasy402-ingestion-worker",
    archiveType: "failure",
    endpoint: endpoint.key,
    path: endpoint.path,
    runId,
    traceId,
    failureId,
    responseHash,
    failedAt: failedAt.toISOString(),
    durationMs: String(durationMs),
    size: String(body.length),
  });

  await env.ANALYTICS_DB.prepare(
    `INSERT INTO endpoint_failures
       (id, run_id, endpoint_key, path, failed_at, attempts, error_message,
        r2_key, r2_etag, r2_size, r2_storage_class, trace_id, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      failureId,
      runId,
      endpoint.key,
      endpoint.path,
      failedAt.toISOString(),
      attempts,
      errorMessage(error).slice(0, 1000),
      r2Key,
      r2Object.etag,
      r2Object.size,
      r2Object.storageClass,
      traceId,
      durationMs,
    )
    .run();

  console.error("r2 failure archive write", {
    key: r2Key,
    etag: r2Object.etag,
    size: r2Object.size,
    storageClass: r2Object.storageClass,
    upstreamStatus: upstreamError?.status ?? null,
    runId,
    endpoint: endpoint.key,
    traceId,
  });
}

function unwrapUpstreamHttpError(error: unknown): UpstreamHttpError | null {
  if (error instanceof UpstreamHttpError) return error;
  if (error instanceof EndpointAttemptError && error.originalError instanceof UpstreamHttpError) {
    return error.originalError;
  }
  return null;
}

async function storeAgentPerformance(
  env: Env,
  metric: {
    id: string;
    runId: string;
    capturedAt: string;
    agentId: string;
    totalWagers: number;
    totalVolume: number;
    winRate: number;
    rawSnapshotId: string;
  },
): Promise<void> {
  await env.ANALYTICS_DB.prepare(
    `INSERT INTO agent_performance
       (id, run_id, captured_at, agent_id, total_wagers, total_volume, win_rate, raw_snapshot_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      metric.id,
      metric.runId,
      metric.capturedAt,
      metric.agentId,
      metric.totalWagers,
      metric.totalVolume,
      metric.winRate,
      metric.rawSnapshotId,
    )
    .run();
}

function mapAgentPerformance(data: unknown, fallbackAgentId: string, rawSnapshotId: string, runId: string) {
  const record = firstObject(data);
  return {
    id: crypto.randomUUID(),
    runId,
    capturedAt: new Date().toISOString(),
    agentId: stringField(record, ["agentID", "AgentID", "agent_id"], fallbackAgentId),
    totalWagers: numberField(record, ["totalWagers", "TotalWagers", "Wagers"], 0),
    totalVolume: numberField(record, ["totalVolume", "TotalVolume", "Handle", "Volume"], 0),
    winRate: numberField(record, ["winRate", "WinRate"], 0),
    rawSnapshotId,
  };
}

interface AuthorizationPermissionRecord {
  id: string;
  runId: string;
  capturedAt: string;
  snapshotId: string;
  agentId: string;
  masterAgentId: string | null;
  commissionType: string | null;
  rawJson: string;
}

async function storeAuthorizations(env: Env, record: AuthorizationPermissionRecord): Promise<void> {
  await env.ANALYTICS_DB.prepare(
    `INSERT INTO authorization_permissions
       (id, snapshot_id, run_id, captured_at, agent_id, master_agent_id, commission_type, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(record.id, record.snapshotId, record.runId, record.capturedAt, record.agentId, record.masterAgentId, record.commissionType, record.rawJson)
    .run();
}

function mapAuthorizations(data: unknown, rawSnapshotId: string, runId: string): AuthorizationPermissionRecord {
  const obj = firstObject(data);
  const info = (typeof obj?.INFO === "object" && obj.INFO ? (obj.INFO as Record<string, unknown>) : obj) as Record<string, unknown> | undefined;
  return {
    id: crypto.randomUUID(),
    runId,
    capturedAt: new Date().toISOString(),
    snapshotId: rawSnapshotId,
    agentId: stringField(info ?? {}, ["AgentID", "agentID", "CustomerID", "customerID"], "").trim(),
    masterAgentId: stringField(info ?? {}, ["MasterAgentID", "masterAgentID"], "").trim() || null,
    commissionType: stringField(info ?? {}, ["CommissionType", "commissionType"], "").trim() || null,
    rawJson: JSON.stringify(info ?? {}),
  };
}

interface PlayerAgentRecord {
  customerId: string;
  login: string;
  nameFirst: string;
  agentId: string;
  rawSnapshotId: string;
  capturedAt: string;
  rawJson: string;
}

async function storePlayerAgents(env: Env, records: PlayerAgentRecord[]): Promise<void> {
  if (!records.length) return;
  const BATCH_SIZE = 1000;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const stmts = batch.map((r) =>
      env.ANALYTICS_DB.prepare(
        `INSERT OR REPLACE INTO player_agents (customer_id, login, name_first, agent_id, raw_snapshot_id, captured_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(r.customerId, r.login, r.nameFirst, r.agentId, r.rawSnapshotId, r.capturedAt),
    );
    await env.ANALYTICS_DB.batch(stmts);
  }
}

function mapPlayerAgents(data: unknown, rawSnapshotId: string): PlayerAgentRecord[] {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const players = Array.isArray(root.PLAYERS) ? (root.PLAYERS as Record<string, unknown>[]) : [];
  const now = new Date().toISOString();
  return players.map((item) => ({
    customerId: stringField(item, ["customerID", "CustomerID"], "").trim(),
    login: stringField(item, ["Login", "login"], "").trim(),
    nameFirst: stringField(item, ["NameFirst", "nameFirst"], "").trim(),
    agentId: stringField(item, ["Agent", "agent"], "").trim(),
    rawSnapshotId,
    capturedAt: now,
    rawJson: JSON.stringify(item),
  }));
}

interface BetTickerWagerRecord {
  id: string;
  snapshotId: string;
  runId: string;
  capturedAt: string;
  wagerNumber: number;
  agentId: string;
  customerId: string;
  login: string;
  wagerType: string;
  amountWagered: number;
  toWinAmount: number | null;
  insertDateTime: string | null;
  ticketWriter: string | null;
  volumeAmount: number | null;
  shortDesc: string | null;
  agentLogin: string | null;
  rawJson: string;
  idempotencyKey: string;
}

interface WebLogEntryRecord {
  id: string;
  snapshotId: string;
  runId: string;
  capturedAt: string;
  login: string;
  operation: string | null;
  data: string | null;
  ipAddress: string | null;
  accessDateTime: string;
  rawJson: string;
}

function mapBetTickerWagers(data: unknown, rawSnapshotId: string, runId: string): BetTickerWagerRecord[] {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const items = (Array.isArray(root.LIST) ? root.LIST : Array.isArray(data) ? data : []) as Record<string, unknown>[];
  return items.map((item) => {
    const raw = item as Record<string, unknown>;
    const wagerNumber = numberField(item, ["WagerNumber"], 0);
    const agentId = stringField(item, ["AgentID", "agentID"], "").trim();
    return {
      id: crypto.randomUUID(),
      snapshotId: rawSnapshotId,
      runId,
      capturedAt: new Date().toISOString(),
      wagerNumber,
      agentId,
      customerId: stringField(item, ["CustomerID", "customerID"], "").trim(),
      login: stringField(item, ["Login", "login"], "").trim(),
      wagerType: stringField(item, ["WagerType", "wagerType"], "").trim(),
      amountWagered: numberField(item, ["AmountWagered", "amountWagered"], 0),
      toWinAmount: typeof raw.ToWinAmount === "number" ? raw.ToWinAmount : null,
      insertDateTime: typeof raw.InsertDateTime === "string" ? raw.InsertDateTime.trim() : null,
      ticketWriter: typeof raw.TicketWriter === "string" ? raw.TicketWriter.trim() : null,
      volumeAmount: typeof raw.VolumeAmount === "number" ? raw.VolumeAmount : null,
      shortDesc: typeof raw.ShortDesc === "string" ? raw.ShortDesc.trim() : null,
      agentLogin: typeof raw.AgentLogin === "string" ? raw.AgentLogin.trim() : null,
      rawJson: JSON.stringify(item),
      idempotencyKey: `betTicker:${agentId}:${wagerNumber}`,
    };
  });
}

async function storeBetTickerWagers(env: Env, records: BetTickerWagerRecord[]): Promise<void> {
  if (records.length === 0) return;
  const stmt = env.ANALYTICS_DB.prepare(
    `INSERT OR IGNORE INTO bet_ticker_wagers
       (id, snapshot_id, run_id, captured_at, wager_number, agent_id, customer_id, login, wager_type, amount_wagered, to_win_amount, insert_date_time, ticket_writer, volume_amount, short_desc, agent_login, raw_json, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const record of records) {
    await stmt
      .bind(record.id, record.snapshotId, record.runId, record.capturedAt, record.wagerNumber, record.agentId, record.customerId, record.login, record.wagerType, record.amountWagered, record.toWinAmount, record.insertDateTime, record.ticketWriter, record.volumeAmount, record.shortDesc, record.agentLogin, record.rawJson, record.idempotencyKey)
      .run();
  }
}

async function shouldCircuitBreak(endpoint: EndpointConfig, env: Env): Promise<boolean> {
  try {
    const key = `cb:${endpoint.key}`;
    const state = await env.SESSION_KV.get<{ failures: number; lastFailure: number }>(key, "json");
    if (!state || state.failures < 3) return false;
    const elapsed = Date.now() - state.lastFailure;
    return elapsed < 120_000;
  } catch {
    return false;
  }
}

async function recordCircuitStatus(endpoint: EndpointConfig, success: boolean, env: Env): Promise<void> {
  try {
    const key = `cb:${endpoint.key}`;
    if (success) {
      await env.SESSION_KV.delete(key);
      return;
    }
    const state = await env.SESSION_KV.get<{ failures: number; lastFailure: number }>(key, "json") ?? { failures: 0, lastFailure: 0 };
    state.failures += 1;
    state.lastFailure = Date.now();
    await env.SESSION_KV.put(key, JSON.stringify(state), { expirationTtl: 600 });
  } catch { /* circuit breaker state is best-effort */ }
}

interface WeeklyFigureRecord {
  id: string;
  snapshotId: string;
  runId: string;
  agentId: string;
  week: number;
  type: string;
  figureDate: string;
  wagerCount: number;
  volume: number;
  netAmount: number;
  bigWagers: number;
  rawJson: string;
  capturedAt: string;
}

function weeklyFigureListItems(data: unknown): Record<string, unknown>[] {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (Array.isArray(root.LIST)) return root.LIST as Record<string, unknown>[];
  if (root.LIST && typeof root.LIST === "object") {
    const list = root.LIST as Record<string, unknown>;
    if (Array.isArray(list.ARRAY)) return list.ARRAY as Record<string, unknown>[];
  }
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

function mapWeeklyFigures(data: unknown, snapshotId: string, runId: string, fallbackAgentId = ""): WeeklyFigureRecord[] {
  const items = weeklyFigureListItems(data);
  const capturedAt = new Date().toISOString();
  return items.map((item) => {
    const liteShape = "ThisWeek" in item || "Today" in item || "Active" in item;
    return {
      id: crypto.randomUUID(),
      snapshotId,
      runId,
      agentId: stringField(item, ["AgentID", "agentID", "Agent"], fallbackAgentId).trim() || fallbackAgentId || "unknown",
      week: numberField(item, ["Week", "week"], 0),
      type: stringField(item, ["Type", "type"], liteShape ? "A" : "O"),
      figureDate: stringField(item, ["Date", "date", "FigureDate", "figureDate"], liteShape ? "lite-summary" : ""),
      wagerCount: numberField(item, ["WagerCount", "wagerCount", "TotalWagers", "totalWagers", "Active", "active"], 0),
      volume: numberField(item, ["Volume", "volume", "TotalVolume", "totalVolume"], 0),
      netAmount: numberField(item, ["NetAmount", "netAmount", "Net", "net", "ThisWeek", "Today"], 0),
      bigWagers: numberField(item, ["BigWagers", "bigWagers", "BigAmountCount"], 0),
      rawJson: JSON.stringify(item),
      capturedAt,
    };
  });
}

async function storeWeeklyFigures(env: Env, records: WeeklyFigureRecord[]): Promise<void> {
  for (const r of records) {
    await env.ANALYTICS_DB.prepare(
      `INSERT INTO weekly_figures
         (snapshot_id, run_id, agent_id, week, type, figure_date, wager_count, volume, net_amount, big_wagers, raw_json, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(r.snapshotId, r.runId, r.agentId, r.week, r.type, r.figureDate, r.wagerCount, r.volume, r.netAmount, r.bigWagers, r.rawJson, r.capturedAt)
      .run();
  }
}

async function notifyLiveWager(env: Env, wager: { id: string; login: string; wager_type: string; amount_wagered: number; captured_at: string }): Promise<void> {
  try {
    const doId = env.LIVE_WAGER_BROADCASTER.idFromName("global");
    const stub = env.LIVE_WAGER_BROADCASTER.get(doId);
    await stub.fetch("http://do/internals/broadcast", {
      method: "POST",
      body: JSON.stringify(wager),
    });
  } catch (error) {
    console.error("live wager broadcast failed", safeError(error, { wagerId: wager.id }));
  }
}

interface GradedWagerRecord {
  id: string;
  snapshotId: string;
  runId: string;
  capturedAt: string;
  wagerNumber: number;
  agentId: string;
  customerId: string;
  login: string;
  wagerType: string;
  amountWagered: number;
  toWinAmount: number | null;
  gradeDateTime: string | null;
  result: string | null;
  netAmount: number | null;
  insertDateTime: string | null;
  ticketWriter: string | null;
  volumeAmount: number | null;
  shortDesc: string | null;
  agentLogin: string | null;
  rawJson: string;
  idempotencyKey: string;
}

function mapGradedWagers(data: unknown, rawSnapshotId: string, runId: string): GradedWagerRecord[] {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const items = (Array.isArray(root.LIST) ? root.LIST : Array.isArray(data) ? data : []) as Record<string, unknown>[];
  return items.map((item) => {
    const raw = item as Record<string, unknown>;
    const wagerNumber = numberField(item, ["WagerNumber"], 0);
    const agentId = stringField(item, ["AgentID", "agentID"], "").trim();
    return {
      id: crypto.randomUUID(),
      snapshotId: rawSnapshotId,
      runId,
      capturedAt: new Date().toISOString(),
      wagerNumber,
      agentId,
      customerId: stringField(item, ["CustomerID", "customerID"], "").trim(),
      login: stringField(item, ["Login", "login"], "").trim(),
      wagerType: stringField(item, ["WagerType", "wagerType"], "").trim(),
      amountWagered: numberField(item, ["AmountWagered", "amountWagered"], 0),
      toWinAmount: typeof raw.ToWinAmount === "number" ? raw.ToWinAmount : null,
      gradeDateTime: typeof raw.GradeDateTime === "string" ? raw.GradeDateTime.trim() : null,
      result: typeof raw.Result === "string" ? raw.Result.trim() : null,
      netAmount: typeof raw.NetAmount === "number" ? raw.NetAmount : null,
      insertDateTime: typeof raw.InsertDateTime === "string" ? raw.InsertDateTime.trim() : null,
      ticketWriter: typeof raw.TicketWriter === "string" ? raw.TicketWriter.trim() : null,
      volumeAmount: typeof raw.VolumeAmount === "number" ? raw.VolumeAmount : null,
      shortDesc: typeof raw.ShortDesc === "string" ? raw.ShortDesc.trim() : null,
      agentLogin: typeof raw.AgentLogin === "string" ? raw.AgentLogin.trim() : null,
      rawJson: JSON.stringify(item),
      idempotencyKey: `graded:${agentId}:${wagerNumber}`,
    };
  });
}

async function storeGradedWagers(env: Env, records: GradedWagerRecord[]): Promise<void> {
  if (records.length === 0) return;
  const stmt = env.ANALYTICS_DB.prepare(
    `INSERT OR IGNORE INTO graded_wagers
       (id, snapshot_id, run_id, captured_at, wager_number, agent_id, customer_id, login, wager_type, amount_wagered, to_win_amount, grade_date_time, result, net_amount, insert_date_time, ticket_writer, volume_amount, short_desc, agent_login, raw_json, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const record of records) {
    await stmt
      .bind(record.id, record.snapshotId, record.runId, record.capturedAt, record.wagerNumber, record.agentId, record.customerId, record.login, record.wagerType, record.amountWagered, record.toWinAmount, record.gradeDateTime, record.result, record.netAmount, record.insertDateTime, record.ticketWriter, record.volumeAmount, record.shortDesc, record.agentLogin, record.rawJson, record.idempotencyKey)
      .run();
  }
}

interface PropWagerRecord {
  id: string;
  snapshotId: string;
  runId: string;
  capturedAt: string;
  wagerNumber: number;
  agentId: string;
  customerId: string;
  login: string;
  wagerType: string;
  amountWagered: number;
  toWinAmount: number | null;
  insertDateTime: string | null;
  ticketWriter: string | null;
  volumeAmount: number | null;
  shortDesc: string | null;
  agentLogin: string | null;
  rawJson: string;
  idempotencyKey: string;
}

function mapPropWagers(data: unknown, rawSnapshotId: string, runId: string): PropWagerRecord[] {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const items = ((root as Record<string, unknown>).list ? (root as Record<string, unknown>).list : Array.isArray(root.LIST) ? root.LIST : Array.isArray(data) ? data : []) as Record<string, unknown>[];
  return items.map((item) => {
    const raw = item as Record<string, unknown>;
    const wagerNumber = numberField(item, ["WagerNumber"], 0);
    const agentId = stringField(item, ["AgentID", "agentID"], "").trim();
    return {
      id: crypto.randomUUID(),
      snapshotId: rawSnapshotId,
      runId,
      capturedAt: new Date().toISOString(),
      wagerNumber,
      agentId,
      customerId: stringField(item, ["CustomerID", "customerID"], "").trim(),
      login: stringField(item, ["Login", "login"], "").trim(),
      wagerType: stringField(item, ["WagerType", "wagerType"], "").trim(),
      amountWagered: numberField(item, ["AmountWagered", "amountWagered"], 0),
      toWinAmount: typeof raw.ToWinAmount === "number" ? raw.ToWinAmount : null,
      insertDateTime: typeof raw.InsertDateTime === "string" ? raw.InsertDateTime.trim() : null,
      ticketWriter: typeof raw.TicketWriter === "string" ? raw.TicketWriter.trim() : null,
      volumeAmount: typeof raw.VolumeAmount === "number" ? raw.VolumeAmount : null,
      shortDesc: typeof raw.ShortDesc === "string" ? raw.ShortDesc.trim() : null,
      agentLogin: typeof raw.AgentLogin === "string" ? raw.AgentLogin.trim() : null,
      rawJson: JSON.stringify(item),
      idempotencyKey: `prop:${agentId}:${wagerNumber}`,
    };
  });
}

async function storePropWagers(env: Env, records: PropWagerRecord[]): Promise<void> {
  if (records.length === 0) return;
  const stmt = env.ANALYTICS_DB.prepare(
    `INSERT OR IGNORE INTO prop_wagers
       (id, snapshot_id, run_id, captured_at, wager_number, agent_id, customer_id, login, wager_type, amount_wagered, to_win_amount, insert_date_time, ticket_writer, volume_amount, short_desc, agent_login, raw_json, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const record of records) {
    await stmt
      .bind(record.id, record.snapshotId, record.runId, record.capturedAt, record.wagerNumber, record.agentId, record.customerId, record.login, record.wagerType, record.amountWagered, record.toWinAmount, record.insertDateTime, record.ticketWriter, record.volumeAmount, record.shortDesc, record.agentLogin, record.rawJson, record.idempotencyKey)
      .run();
  }
}

interface AgentPositionRecord {
  id: string;
  snapshotId: string;
  runId: string;
  capturedAt: string;
  sportId: number | null;
  sportName: string | null;
  totalWagered: number | null;
  totalToWin: number | null;
  wagerCount: number | null;
  rawJson: string;
}

function mapAgentPositionData(data: unknown, rawSnapshotId: string, runId: string): AgentPositionRecord[] {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const items = (Array.isArray(root.LIST) ? root.LIST : Array.isArray(data) ? data : []) as Record<string, unknown>[];
  return items.map((item) => {
    const raw = item as Record<string, unknown>;
    return {
      id: crypto.randomUUID(),
      snapshotId: rawSnapshotId,
      runId,
      capturedAt: new Date().toISOString(),
      sportId: typeof raw.SportID === "number" ? raw.SportID : null,
      sportName: typeof raw.SportName === "string" ? raw.SportName.trim() : null,
      totalWagered: numberField(item, ["TotalWagered", "totalWagered"], 0) || null,
      totalToWin: numberField(item, ["TotalToWin", "totalToWin"], 0) || null,
      wagerCount: numberField(item, ["WagerCount", "wagerCount"], 0) || null,
      rawJson: JSON.stringify(item),
    };
  });
}

async function storeAgentPositionData(env: Env, records: AgentPositionRecord[]): Promise<void> {
  if (records.length === 0) return;
  const stmt = env.ANALYTICS_DB.prepare(
    `INSERT INTO agent_position_data
       (id, snapshot_id, run_id, captured_at, sport_id, sport_name, total_wagered, total_to_win, wager_count, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const record of records) {
    await stmt
      .bind(record.id, record.snapshotId, record.runId, record.capturedAt, record.sportId, record.sportName, record.totalWagered, record.totalToWin, record.wagerCount, record.rawJson)
      .run();
  }
}

function mapWebLogEntries(data: unknown, rawSnapshotId: string, runId: string): WebLogEntryRecord[] {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const items = (Array.isArray(root.LIST) ? root.LIST : Array.isArray(data) ? data : []) as Record<string, unknown>[];
  const now = new Date().toISOString();
  return items.map((item) => ({
    id: crypto.randomUUID(),
    snapshotId: rawSnapshotId,
    runId,
    capturedAt: now,
    login: stringField(item, ["LoginID", "loginID", "Login", "login"], "").trim(),
    operation: stringField(item, ["Operation", "operation"], "") || null,
    data: stringField(item, ["Data", "data"], "") || null,
    ipAddress: stringField(item, ["IPAddress", "ipAddress", "IP", "ip"], "") || null,
    accessDateTime: stringField(item, ["AccessDateTime", "accessDateTime", "AccessDate", "accessDate"], ""),
    rawJson: JSON.stringify(item),
  }));
}

async function storeWebLogEntries(env: Env, records: WebLogEntryRecord[]): Promise<void> {
  if (!records.length) return;
  const BATCH_SIZE = 1000;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const stmts = batch.map((r) =>
      env.ANALYTICS_DB.prepare(
        `INSERT OR REPLACE INTO web_logs (id, snapshot_id, run_id, captured_at, login, operation, data, ip_address, access_date_time, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(r.id, r.snapshotId, r.runId, r.capturedAt, r.login, r.operation, r.data, r.ipAddress, r.accessDateTime, r.rawJson),
    );
    await env.ANALYTICS_DB.batch(stmts);
  }
}

async function finishRun(
  env: Env,
  runId: string,
  status: "success" | "failed",
  endpointsSucceeded: number,
  endpointsFailed: number,
  error?: string,
): Promise<void> {
  await env.ANALYTICS_DB.prepare(
    `UPDATE ingestion_runs
     SET finished_at = ?, status = ?, endpoints_succeeded = ?, endpoints_failed = ?, error_message = ?
     WHERE id = ?`,
  )
    .bind(new Date().toISOString(), status, endpointsSucceeded, endpointsFailed, error ?? null, runId)
    .run();
}

async function listIngestionRuns(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(ingestionRunsQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { limit } = parsed.data;
  const result = await env.ANALYTICS_DB.prepare(
    `SELECT id, started_at, finished_at, status, endpoints_requested, endpoints_succeeded, endpoints_failed, error_message
     FROM ingestion_runs
     ORDER BY started_at DESC
     LIMIT ?`,
  )
    .bind(limit)
    .all();
  return json({ limit, runs: result.results ?? [] }, 200);
}

async function listIngestionRunEndpoints(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(runIdQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { runId } = parsed.data;

  const snapshots = await env.ANALYTICS_DB.prepare(
    `SELECT id, endpoint_key, path, captured_at, http_status, item_count, attempts,
            r2_key, r2_etag, r2_size, r2_storage_class, trace_id, duration_ms
     FROM api_snapshots
     WHERE run_id = ?
     ORDER BY captured_at DESC`,
  )
    .bind(runId)
    .all();

  const failures = await env.ANALYTICS_DB.prepare(
    `SELECT id, endpoint_key, path, failed_at, attempts, error_message,
            r2_key, r2_etag, r2_size, r2_storage_class, trace_id, duration_ms
     FROM endpoint_failures
     WHERE run_id = ?
     ORDER BY failed_at DESC`,
  )
    .bind(runId)
    .all();

  return json(
    {
      runId,
      snapshots: snapshots.results ?? [],
      failures: failures.results ?? [],
    },
    200,
  );
}

async function queryChartAggregates(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(chartAggregatesSchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { hours } = parsed.data;
  const sinceExpr = `datetime('now', '-${hours} hours')`;

  const hourly = await env.ANALYTICS_DB.prepare(
    `SELECT substr(captured_at, 1, 13) || ':00' AS hour,
            COUNT(*) AS count,
            COALESCE(SUM(amount_wagered), 0) AS volume_cents
     FROM bet_ticker_wagers
     WHERE captured_at >= ${sinceExpr}
     GROUP BY hour
     ORDER BY hour ASC`,
  ).all();

  const byType = await env.ANALYTICS_DB.prepare(
    `SELECT wager_type, COUNT(*) AS count
     FROM bet_ticker_wagers
     WHERE captured_at >= ${sinceExpr}
     GROUP BY wager_type`,
  ).all();

  const topAgents = await env.ANALYTICS_DB.prepare(
    `SELECT agent_id,
            COUNT(*) AS count,
            COALESCE(SUM(amount_wagered), 0) AS volume_cents
     FROM bet_ticker_wagers
     WHERE captured_at >= ${sinceExpr}
     GROUP BY agent_id
     ORDER BY volume_cents DESC
     LIMIT 5`,
  ).all();

  const typeMap: Record<string, number> = { S: 0, P: 0, M: 0, L: 0 };
  for (const row of byType.results ?? []) {
    const wt = String((row as { wager_type?: string }).wager_type ?? "");
    if (wt in typeMap) typeMap[wt] = Number((row as { count?: number }).count) || 0;
  }

  return json(
    {
      hours,
      since: new Date(Date.now() - hours * 3600000).toISOString(),
      hourly: hourly.results ?? [],
      byType: typeMap,
      topAgents: topAgents.results ?? [],
    },
    200,
  );
}

async function readLatestSnapshotTimes(env: Env): Promise<Map<string, { lastSnapshotAt: string; snapshotCount: number }>> {
  const map = new Map<string, { lastSnapshotAt: string; snapshotCount: number }>();
  try {
    const rows = await env.ANALYTICS_DB.prepare(
      `SELECT endpoint_key, MAX(captured_at) AS last_snapshot_at, COUNT(*) AS snapshot_count
       FROM api_snapshots
       GROUP BY endpoint_key`,
    ).all<{ endpoint_key: string; last_snapshot_at: string; snapshot_count: number }>();
    for (const row of rows.results ?? []) {
      const key = String(row.endpoint_key ?? "").trim();
      if (!key) continue;
      map.set(key, {
        lastSnapshotAt: String(row.last_snapshot_at ?? ""),
        snapshotCount: Number(row.snapshot_count ?? 0),
      });
    }
  } catch {
    /* best-effort */
  }
  return map;
}

async function listUpstreamEndpoints(env: Env): Promise<Response> {
  const configured = configuredIngestionKeys(env);
  const snapshotTimes = await readLatestSnapshotTimes(env);
  const routes = UPSTREAM_MANIFEST.endpoints.map((entry) => {
    const isConfigured = configured.has(entry.key);
    const implemented = Object.prototype.hasOwnProperty.call(ENDPOINTS, entry.key);
    const snapshot = snapshotTimes.get(entry.key);
    const online = Boolean(snapshot?.lastSnapshotAt);
    return {
      key: entry.key,
      path: entry.path,
      method: entry.method.toUpperCase(),
      zone: "upstream",
      configured: isConfigured,
      implemented,
      online,
      lastSnapshotAt: snapshot?.lastSnapshotAt ?? null,
      snapshotCount: snapshot?.snapshotCount ?? 0,
      contentType: entry.contentType,
      operationId: entry.operationId,
      requiresCustomerId: entry.requiresCustomerId === true,
      customerIdSource: entry.customerIdSource,
      description: entry.operationId,
      refreshMs: isConfigured ? "ingestion" : "—",
    };
  });
  return json(
    {
      count: routes.length,
      configuredCount: routes.filter((r) => r.configured).length,
      implementedCount: routes.filter((r) => r.implemented).length,
      onlineCount: routes.filter((r) => r.online).length,
      spec: UPSTREAM_MANIFEST.spec,
      routes,
    },
    200,
  );
}

async function queryBetTickerWagers(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(wagerQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const filters = parsed.data;
  const limit = filters.limit;
  const agentId = (filters.agent_id ?? "").trim();
  const wagerType = (filters.wager_type ?? "").trim().toUpperCase();
  const since = (filters.since ?? "").trim();
  const minAmount = filters.min_amount ?? 0;
  const maxAmount = filters.max_amount ?? 0;

  let sql = `SELECT id, wager_number, agent_id, customer_id, login, wager_type,
                    amount_wagered, to_win_amount, insert_date_time, ticket_writer,
                    volume_amount, short_desc, agent_login, captured_at
             FROM bet_ticker_wagers
             WHERE 1=1`;
  const bindings: (string | number)[] = [];

  if (agentId) { sql += " AND agent_id = ?"; bindings.push(agentId); }
  if (wagerType) { sql += " AND wager_type = ?"; bindings.push(wagerType); }
  if (since) { sql += " AND captured_at >= ?"; bindings.push(since); }
  if (minAmount > 0) { sql += " AND amount_wagered >= ?"; bindings.push(minAmount); }
  if (maxAmount > 0) { sql += " AND amount_wagered <= ?"; bindings.push(maxAmount); }

  sql += " ORDER BY captured_at DESC, wager_number DESC LIMIT ?";
  bindings.push(limit);

  const result = await env.ANALYTICS_DB.prepare(sql).bind(...bindings).all();
  return json({ limit, total: result.results?.length ?? 0, wagers: result.results ?? [] }, 200);
}

const AGENT_PERF_LIVE_CACHE_PREFIX = "fantasy402:agent-perf-live:";

async function queryAgentPerformanceLive(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(agentPerformanceLiveQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const filters = parsed.data;
  const agentId = (filters.agent_id ?? env.FANTASY402_AGENT_ID ?? "").trim().toUpperCase();
  if (!agentId) {
    return json({ status: "failed", message: "agent_id required (set FANTASY402_AGENT_ID on Worker)" }, 400);
  }

  const perfType = filters.type;
  const start = filters.start;
  const end = filters.end;
  const body = buildGetAgentPerformanceBody(agentId, {
    type: perfType,
    freePlay: filters.free_play,
    store: filters.store ?? agentId,
    sport: filters.sport ?? "",
    subsport: filters.subsport ?? "",
    period: filters.period,
    wagerType: filters.wager_type ?? "",
    betType: filters.bet_type ?? "",
    tipo: filters.tipo,
    start,
    end,
  });

  const cacheKey = `${AGENT_PERF_LIVE_CACHE_PREFIX}${agentId}:${perfType}:${start}:${end}:${filters.free_play}:${filters.period}`;
  type Cached = { rows: Array<Record<string, unknown>>; fetchedAt: string };
  const cached = await getProfileLiveCache<Cached>(env, cacheKey);

  if (cached) {
    return json(
      {
        status: "ok",
        source: "live",
        cached: true,
        agent_id: agentId,
        type: perfType,
        type_label: AGENT_PERFORMANCE_TYPES[perfType as keyof typeof AGENT_PERFORMANCE_TYPES] ?? perfType,
        filters: { start, end, free_play: filters.free_play, period: filters.period },
        fetched_at: cached.fetchedAt,
        total: cached.rows.length,
        rows: cached.rows.slice(0, filters.limit),
      },
      200,
    );
  }

  const path = "/cloud/api/Manager/getAgentPerformance";
  const res = await postManagerForm(env, path, body);
  if (!res.ok) {
    return json(
      {
        status: "failed",
        message: res.message,
        upstreamStatus: res.status,
        bodyPreview: res.bodyPreview,
        hint: "Refresh auth via Endpoints or POST /refresh-auth",
      },
      res.status === 503 ? 503 : 502,
    );
  }

  let rows = normalizeAgentPerformanceRows(res.data, perfType);
  const fetchedAt = new Date().toISOString();
  if (rows.length > filters.limit) rows = rows.slice(0, filters.limit);
  await putProfileLiveCache(env, cacheKey, { rows, fetchedAt });

  return json(
    {
      status: "ok",
      source: "live",
      cached: false,
      agent_id: agentId,
      type: perfType,
      type_label: AGENT_PERFORMANCE_TYPES[perfType as keyof typeof AGENT_PERFORMANCE_TYPES] ?? perfType,
      filters: { start, end, free_play: filters.free_play, period: filters.period },
      fetched_at: fetchedAt,
      total: rows.length,
      rows,
    },
    200,
  );
}

async function queryAgentPerformance(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(performanceQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const filters = parsed.data;
  const agentId = (filters.agent_id ?? "").trim();
  const since = (filters.since ?? new Date(Date.now() - 86400000).toISOString()).trim();
  const limit = filters.limit;

  let sql = `SELECT agent_id,
                    COUNT(*) as total_wagers,
                    COALESCE(SUM(amount_wagered),0) as total_volume,
                    0 as win_rate
             FROM bet_ticker_wagers WHERE 1=1`;
  const bindings: (string | number)[] = [];

  if (agentId) { sql += " AND agent_id = ?"; bindings.push(agentId); }
  if (since) { sql += " AND captured_at >= ?"; bindings.push(since); }

  sql += " GROUP BY agent_id ORDER BY total_volume DESC LIMIT ?";
  bindings.push(limit);

  const result = await env.ANALYTICS_DB.prepare(sql).bind(...bindings).all();
  return json({ limit, total: result.results?.length ?? 0, records: result.results ?? [] }, 200);
}

async function queryAuthorizations(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(authorizationsQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const filters = parsed.data;
  const agentId = (filters.agent_id ?? "").trim();
  const since = (filters.since ?? "").trim();
  const limit = filters.limit;

  let sql = `SELECT id, snapshot_id, run_id, captured_at, agent_id, master_agent_id, commission_type
             FROM authorization_permissions WHERE 1=1`;
  const bindings: (string | number)[] = [];

  if (agentId) { sql += " AND agent_id = ?"; bindings.push(agentId); }
  if (since) { sql += " AND captured_at >= ?"; bindings.push(since); }

  sql += " ORDER BY captured_at DESC LIMIT ?";
  bindings.push(limit);

  const result = await env.ANALYTICS_DB.prepare(sql).bind(...bindings).all();
  return json({ limit, total: result.results?.length ?? 0, records: result.results ?? [] }, 200);
}

async function queryPlayers(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(playersQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { customer_id: customerId, agent_id: agentId, q, limit } = parsed.data;

  let sql = "SELECT customer_id, login, name_first, agent_id, captured_at FROM player_agents WHERE 1=1";
  const bindings: (string | number)[] = [];

  if (customerId) { sql += " AND customer_id = ?"; bindings.push(customerId); }
  if (agentId) { sql += " AND agent_id = ?"; bindings.push(agentId); }
  if (q) {
    const like = `%${q}%`;
    sql += " AND (login LIKE ? COLLATE NOCASE OR name_first LIKE ? COLLATE NOCASE OR customer_id LIKE ?)";
    bindings.push(like, like, like);
  }

  sql += " ORDER BY login ASC LIMIT ?";
  bindings.push(limit);

  const result = await env.ANALYTICS_DB.prepare(sql).bind(...bindings).all();
  return json({ limit, total: result.results?.length ?? 0, records: result.results ?? [] }, 200);
}

async function searchCustomers(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(searchCustomersQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  url.searchParams.set("q", parsed.data.q);
  url.searchParams.set("limit", String(parsed.data.limit));
  if (parsed.data.agent_id) {
    url.searchParams.set("agent_id", parsed.data.agent_id);
  }
  return queryPlayers(url, env);
}

async function queryCustomerActivitySearch(request: Request, env: Env): Promise<Response> {
  const body = await safeJson(request);
  if (!body) {
    return json({ status: "failed", message: "Invalid JSON body" }, 400);
  }
  const parsed = parseBody(customerActivitySearchBodySchema, body, json);
  if (!parsed.ok) return parsed.response;
  const { q, limit } = parsed.data;
  const like = `%${q}%`;
  const result = await env.ANALYTICS_DB.prepare(
    "SELECT customer_id, login, name_first, agent_id, captured_at FROM player_agents WHERE login LIKE ? COLLATE NOCASE OR name_first LIKE ? COLLATE NOCASE OR customer_id LIKE ? ORDER BY login ASC LIMIT ?",
  ).bind(like, like, like, limit).all();
  return json({ limit, total: result.results?.length ?? 0, records: result.results ?? [] }, 200);
}

async function queryCustomerActivity(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(customerActivityQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { login, hours, limit } = parsed.data;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const player = await env.ANALYTICS_DB.prepare(
    "SELECT customer_id, login, name_first, agent_id, captured_at FROM player_agents WHERE login = ?",
  ).bind(login).first<{ customer_id: string; login: string; name_first: string; agent_id: string; captured_at: string }>();

  let profile = null;
  if (player?.customer_id) {
    try {
      profile = await loadCustomerProfile(env, player.customer_id);
    } catch { /* profile data is optional */ }
  }

  const webLogs = await env.ANALYTICS_DB.prepare(
    `SELECT id, login, operation, data, ip_address, access_date_time, captured_at
     FROM web_logs
     WHERE login = ? AND access_date_time >= ?
     ORDER BY access_date_time DESC
     LIMIT ?`,
  ).bind(login, since, limit).all<{ id: string; login: string; operation: string | null; data: string | null; ip_address: string | null; access_date_time: string; captured_at: string }>();

  const wagers = await env.ANALYTICS_DB.prepare(
    `SELECT id, wager_number, wager_type, amount_wagered, to_win_amount, short_desc, captured_at
     FROM bet_ticker_wagers
     WHERE login = ? AND captured_at >= ?
     ORDER BY captured_at DESC
     LIMIT ?`,
  ).bind(login, since, limit).all<{ id: string; wager_number: number; wager_type: string; amount_wagered: number; to_win_amount: number | null; short_desc: string | null; captured_at: string }>();

  const summary = await env.ANALYTICS_DB.prepare(
    `SELECT
       COUNT(DISTINCT b.id) AS total_wagers,
       COALESCE(SUM(b.amount_wagered), 0) AS total_volume,
       (SELECT COUNT(*) FROM web_logs WHERE login = ? AND access_date_time >= ?) AS total_logins,
       (SELECT COUNT(DISTINCT w.ip_address) FROM web_logs w WHERE w.login = ? AND w.access_date_time >= ?) AS unique_ips
     FROM bet_ticker_wagers b
     WHERE b.login = ? AND b.captured_at >= ?`,
  ).bind(login, since, login, since, login, since).first<{ total_wagers: number; total_volume: number; total_logins: number; unique_ips: number }>();

  return json({
    customer: player ?? null,
    profile,
    webLogs: webLogs.results ?? [],
    wagers: wagers.results ?? [],
    summary: summary ?? { total_wagers: 0, total_volume: 0, total_logins: 0, unique_ips: 0 },
    period: { hours, since },
  }, 200);
}

async function queryWeeklyFigures(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(weeklyFiguresQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const agentId = (parsed.data.agent_id ?? "").trim();
  const { limit } = parsed.data;

  let sql = `SELECT agent_id, week, type, figure_date, wager_count, volume, net_amount, big_wagers, captured_at
             FROM weekly_figures WHERE 1=1`;
  const bindings: (string | number)[] = [];

  if (agentId) {
    sql += " AND agent_id = ?";
    bindings.push(agentId);
  }

  sql += " ORDER BY captured_at DESC LIMIT ?";
  bindings.push(limit);

  const result = await env.ANALYTICS_DB.prepare(sql).bind(...bindings).all();
  return json({ limit, total: result.results?.length ?? 0, records: result.results ?? [] }, 200);
}

const MAX_LIVE_UPSTREAM_BYTES = 8_000_000;

async function postManagerForm(
  env: Env,
  path: string,
  body: Record<string, string | number>,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; message: string; bodyPreview: string }> {
  let sessionCookie: string;
  try {
    sessionCookie = await getOrRefreshSession(env);
  } catch (error) {
    return {
      ok: false,
      status: 503,
      message: `Fantasy402 session unavailable: ${errorMessage(error)}`,
      bodyPreview: "",
    };
  }
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    form.set(key, String(value));
  }
  const contentType = "application/x-www-form-urlencoded; charset=UTF-8";
  const headers = await fantasy402ApiHeaders(env, sessionCookie, contentType);
  const response = await fetchWithTimeout(`${baseUrl(env)}${path}`, {
    method: "POST",
    body: form,
    headers,
  });
  if (!response.ok) {
    const text = await safeReadResponseText(response);
    return {
      ok: false,
      status: response.status,
      message: `upstream HTTP ${response.status}`,
      bodyPreview: text.slice(0, 300),
    };
  }
  const text = await safeReadResponseText(response);
  if (text.length > MAX_LIVE_UPSTREAM_BYTES) {
    return {
      ok: false,
      status: 413,
      message: "upstream response too large",
      bodyPreview: `bytes=${text.length}`,
    };
  }
  try {
    return { ok: true, data: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 502, message: "invalid JSON from upstream", bodyPreview: text.slice(0, 300) };
  }
}

async function seedCustomerProfileD1(
  env: Env,
  customerId: string,
): Promise<{
  status: "ok" | "partial" | "failed";
  snapshotId: string;
  facets: Array<{ facet: string; ok: boolean; error?: string; upstreamStatus?: number }>;
}> {
  const agentId = (env.FANTASY402_AGENT_ID ?? "").trim().toUpperCase();
  if (!agentId) {
    return { status: "failed", snapshotId: "", facets: [{ facet: "all", ok: false, error: "FANTASY402_AGENT_ID not set" }] };
  }
  const snapshotId = `seed-${crypto.randomUUID()}`;
  const facets: Array<{ facet: string; ok: boolean; error?: string; upstreamStatus?: number }> = [];

  for (const facet of CUSTOMER_PROFILE_SEED_FACETS) {
    const path = CUSTOMER_FACET_PATHS[facet];
    const body = buildCustomerFacetBody(agentId, customerId, facet);
    const res = await postManagerForm(env, path, body);
    if (res.ok) {
      await ingestCustomerProfileSnapshot(env, facet, res.data, snapshotId, customerId);
      facets.push({ facet, ok: true });
    } else {
      facets.push({ facet, ok: false, error: res.message, upstreamStatus: res.status });
    }
  }

  const okCount = facets.filter((f) => f.ok).length;
  const status = okCount === facets.length ? "ok" : okCount > 0 ? "partial" : "failed";
  return { status, snapshotId, facets };
}

const DAILY_WARMUP_MAX_CUSTOMERS = 25;

async function runDailyProfileWarmup(env: Env): Promise<void> {
  const agentId = (env.FANTASY402_AGENT_ID ?? "").trim();
  if (!agentId) {
    console.warn("[DailyWarmup] Skipped — FANTASY402_AGENT_ID not set");
    return;
  }
  try {
    const playersEndpoint = ENDPOINTS.getPlayers;
    const now = new Date();
    const playersBody = playersEndpoint.buildBody(env, now);
    const playersRes = await postManagerForm(env, playersEndpoint.path, playersBody as Record<string, string | number>);
    if (playersRes.ok) {
      const snapshotId = `warmup-players-${now.toISOString().slice(0, 10)}`;
      await storePlayerAgents(env, mapPlayerAgents(playersRes.data, snapshotId));
      console.info("[DailyWarmup] player_agents refreshed");
    } else {
      console.warn("[DailyWarmup] getPlayers failed", playersRes.message);
    }
  } catch (error) {
    console.warn("[DailyWarmup] getPlayers error", errorMessage(error));
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const active = await env.ANALYTICS_DB.prepare(
    `SELECT DISTINCT p.customer_id, p.login
     FROM bet_ticker_wagers b
     INNER JOIN player_agents p ON p.login = b.login
     WHERE b.captured_at >= ?
     ORDER BY b.captured_at DESC
     LIMIT ?`,
  )
    .bind(since, DAILY_WARMUP_MAX_CUSTOMERS)
    .all<{ customer_id: string; login: string }>();

  const seen = new Set<string>();
  for (const row of active.results ?? []) {
    const cid = row.customer_id?.trim();
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    try {
      const result = await seedCustomerProfileD1(env, cid);
      console.info("[DailyWarmup] seeded profile", { customerId: cid, status: result.status });
    } catch (error) {
      console.warn("[DailyWarmup] seed failed", { customerId: cid, error: errorMessage(error) });
    }
  }
}

async function fetchCustomerProfileLive(
  env: Env,
  customerId: string,
  loginHint: string,
  period: number,
  analysis: {
    startDate: string;
    endDate: string;
    reportType: number;
    lineType: number;
    analysisLimit: number;
  },
): Promise<Record<string, unknown>> {
  const agentId = (env.FANTASY402_AGENT_ID ?? "").trim().toUpperCase();
  if (!agentId) {
    return {
      status: "failed",
      message: "FANTASY402_AGENT_ID not configured on Worker",
    };
  }

  const infoPath = "/cloud/api/Manager/getInfoPlayer";
  const perfPath = "/cloud/api/Manager/getPerformancePlayer";
  const analysisPath = "/cloud/api/Manager/getReportPlayerAnalysis";
  const infoBody = buildGetInfoPlayerBody(agentId, customerId);
  const acc = formatPerformanceAcc(loginHint);
  const perfBody = buildGetPerformancePlayerBody(agentId, acc, period);
  const analysisBody = buildGetReportPlayerAnalysisBody(
    agentId,
    loginHint,
    analysis.startDate,
    analysis.endDate,
    analysis.reportType,
    analysis.lineType,
  );

  const perfCacheKey = profileLiveCacheKeyPerf(agentId, acc, period);
  const analysisCacheKey = profileLiveCacheKeyAnalysis(
    agentId,
    loginHint,
    analysis.startDate,
    analysis.endDate,
    analysis.reportType,
    analysis.lineType,
  );

  type CachedPerf = { raw: unknown; rows: Array<Record<string, unknown>> };
  type CachedAnalysis = {
    raw: unknown;
    rows: Array<Record<string, unknown>>;
    total: number;
    summary: { wins: number; losses: number; pushes: number };
  };

  const [infoRes, cachedPerf, cachedAnalysis] = await Promise.all([
    postManagerForm(env, infoPath, infoBody),
    getProfileLiveCache<CachedPerf>(env, perfCacheKey),
    getProfileLiveCache<CachedAnalysis>(env, analysisCacheKey),
  ]);

  let perfRes: Awaited<ReturnType<typeof postManagerForm>> | null = null;
  let analysisRes: Awaited<ReturnType<typeof postManagerForm>> | null = null;
  if (!cachedPerf) {
    perfRes = await postManagerForm(env, perfPath, perfBody);
    if (perfRes.ok) {
      const rows = normalizePerformanceRows(perfRes.data);
      await putProfileLiveCache(env, perfCacheKey, { raw: perfRes.data, rows });
    }
  }
  if (!cachedAnalysis) {
    analysisRes = await postManagerForm(env, analysisPath, analysisBody);
    if (analysisRes.ok) {
      let rows = normalizePlayerAnalysisRows(analysisRes.data);
      if (rows.length > analysis.analysisLimit) rows = rows.slice(0, analysis.analysisLimit);
      const wins = rows.filter((r) => String(r.wager_status).toUpperCase() === "W").length;
      const losses = rows.filter((r) => String(r.wager_status).toUpperCase() === "L").length;
      await putProfileLiveCache(env, analysisCacheKey, {
        raw: analysisRes.data,
        rows,
        total: rows.length,
        summary: { wins, losses, pushes: rows.length - wins - losses },
      });
    }
  }

  const fetchedAt = new Date().toISOString();
  const live: Record<string, unknown> = {
    status: "ok",
    source: "live",
    fetched_at: fetchedAt,
    agent_id: agentId,
    customer_id: customerId,
    performance_acc: acc,
    period,
    analysis_filters: {
      start_date: analysis.startDate,
      end_date: analysis.endDate,
      report_type: analysis.reportType,
      line_type: analysis.lineType,
    },
  };

  if (infoRes.ok) {
    const parsed = extractInfoPlayerPayload(infoRes.data);
    live.getInfoPlayer = {
      ok: true,
      raw: infoRes.data,
      ...parsed,
    };
  } else {
    live.getInfoPlayer = { ok: false, error: infoRes.message, upstreamStatus: infoRes.status, bodyPreview: infoRes.bodyPreview };
  }

  if (cachedPerf) {
    live.getPerformancePlayer = {
      ok: true,
      raw: cachedPerf.raw,
      rows: cachedPerf.rows,
      total: cachedPerf.rows.length,
      cached: true,
    };
  } else if (perfRes?.ok) {
    const rows = normalizePerformanceRows(perfRes.data);
    live.getPerformancePlayer = {
      ok: true,
      raw: perfRes.data,
      rows,
      total: rows.length,
      cached: false,
    };
  } else {
    live.getPerformancePlayer = {
      ok: false,
      error: perfRes?.message ?? "upstream unavailable",
      upstreamStatus: perfRes?.status,
      bodyPreview: perfRes?.bodyPreview,
    };
  }

  if (cachedAnalysis) {
    live.getReportPlayerAnalysis = {
      ok: true,
      raw: cachedAnalysis.raw,
      rows: cachedAnalysis.rows,
      total: cachedAnalysis.total,
      summary: cachedAnalysis.summary,
      cached: true,
    };
  } else if (analysisRes?.ok) {
    let rows = normalizePlayerAnalysisRows(analysisRes.data);
    if (rows.length > analysis.analysisLimit) rows = rows.slice(0, analysis.analysisLimit);
    const wins = rows.filter((r) => String(r.wager_status).toUpperCase() === "W").length;
    const losses = rows.filter((r) => String(r.wager_status).toUpperCase() === "L").length;
    live.getReportPlayerAnalysis = {
      ok: true,
      rows,
      total: rows.length,
      summary: { wins, losses, pushes: rows.length - wins - losses },
      cached: false,
    };
  } else {
    live.getReportPlayerAnalysis = {
      ok: false,
      error: analysisRes?.message ?? "upstream unavailable",
      upstreamStatus: analysisRes?.status,
      bodyPreview: analysisRes?.bodyPreview,
    };
  }

  const results = [
    infoRes,
    cachedPerf ? { ok: true as const } : perfRes ?? { ok: false as const },
    cachedAnalysis ? { ok: true as const } : analysisRes ?? { ok: false as const },
  ];
  const okCount = results.filter((r) => r.ok).length;
  if (okCount === 0) {
    live.status = "failed";
    live.message = "All live customer profile upstream calls failed";
  } else if (okCount < results.length) {
    live.status = "partial";
  }

  return live;
}

async function queryPendingWagers(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(pendingWagersQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const filters = parsed.data;
  const now = new Date();
  const agentId = (filters.agent_id ?? env.FANTASY402_AGENT_ID ?? "").trim().toUpperCase();
  if (!agentId) {
    return json({ status: "failed", message: "agent_id required (set FANTASY402_AGENT_ID on Worker)" }, 400);
  }

  const body = buildGetPendingBody(env, now, {
    agentID: agentId,
    agentOwner: agentId,
    customerID: filters.customer_id ?? "0",
    date: filters.date,
    wagerType: filters.wager_type ?? "",
    sort: filters.sort ?? "1",
    typeSort: filters.type_sort ?? "2",
    week: filters.week ?? 0,
  });

  let sessionCookie: string;
  try {
    sessionCookie = await getOrRefreshSession(env);
  } catch (error) {
    return json(
      {
        status: "failed",
        message: `Fantasy402 session unavailable: ${errorMessage(error)}`,
        hint: "Refresh auth via Endpoints or POST /refresh-auth",
      },
      503,
    );
  }

  const endpoint = ENDPOINTS.getPending;
  const encoded = encodeRequestBody(endpoint, body);
  const headers = await fantasy402ApiHeaders(env, sessionCookie, encoded.contentType);

  const response = await fetchWithTimeout(`${baseUrl(env)}${endpoint.path}`, {
    method: "POST",
    body: encoded.body,
    headers,
  });

  if (!response.ok) {
    const text = await safeReadResponseText(response);
    return json(
      {
        status: "failed",
        message: `getPending upstream HTTP ${response.status}`,
        upstreamStatus: response.status,
        bodyPreview: text.slice(0, 300),
        request: { agentID: body.agentID, date: body.date, customerID: body.customerID },
      },
      response.status >= 500 ? 502 : 400,
    );
  }

  const text = await safeReadResponseText(response);
  if (text.length > MAX_LIVE_UPSTREAM_BYTES) {
    return json(
      {
        status: "failed",
        message: "getPending response too large",
        hint: "Filter by login or a specific customer_id instead of 0 (all players)",
        bytes: text.length,
      },
      413,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    return json({ status: "failed", message: `getPending invalid JSON: ${errorMessage(error)}` }, 502);
  }
  let wagers = normalizePendingWagerRows(raw);
  const loginFilter = (filters.login ?? "").trim().toLowerCase();
  const sportFilter = (filters.sport ?? "").trim().toLowerCase();
  if (loginFilter) {
    wagers = wagers.filter((row) => String(row.login ?? "").toLowerCase().includes(loginFilter));
  }
  if (sportFilter) {
    wagers = wagers.filter((row) => String(row.sport_type ?? "").toLowerCase().includes(sportFilter));
  }
  const limit = filters.limit;
  if (wagers.length > limit) wagers = wagers.slice(0, limit);

  return json(
    {
      status: "ok",
      source: "live",
      upstream: `${baseUrl(env)}${endpoint.path}`,
      filters: {
        date: body.date,
        agent_id: agentId,
        customer_id: body.customerID,
        wager_type: body.wagerType,
        sort: body.sort,
        type_sort: body.typeSort,
        week: body.week,
      },
      total: wagers.length,
      wagers,
    },
    200,
  );
}

async function queryGradedWagers(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(wagerQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const filters = parsed.data;
  const limit = filters.limit;
  const agentId = (filters.agent_id ?? "").trim();
  const wagerType = (filters.wager_type ?? "").trim().toUpperCase();
  const since = (filters.since ?? "").trim();
  const minAmount = filters.min_amount ?? 0;
  const maxAmount = filters.max_amount ?? 0;

  let sql = `SELECT id, wager_number, agent_id, customer_id, login, wager_type,
                    amount_wagered, to_win_amount, grade_date_time, result, net_amount,
                    insert_date_time, ticket_writer, volume_amount, short_desc, agent_login, captured_at
             FROM graded_wagers WHERE 1=1`;
  const bindings: (string | number)[] = [];

  if (agentId) { sql += " AND agent_id = ?"; bindings.push(agentId); }
  if (wagerType) { sql += " AND wager_type = ?"; bindings.push(wagerType); }
  if (since) { sql += " AND captured_at >= ?"; bindings.push(since); }
  if (minAmount > 0) { sql += " AND amount_wagered >= ?"; bindings.push(minAmount); }
  if (maxAmount > 0) { sql += " AND amount_wagered <= ?"; bindings.push(maxAmount); }

  sql += " ORDER BY captured_at DESC, wager_number DESC LIMIT ?";
  bindings.push(limit);

  const result = await env.ANALYTICS_DB.prepare(sql).bind(...bindings).all();
  return json({ limit, total: result.results?.length ?? 0, wagers: result.results ?? [] }, 200);
}

async function queryPropWagers(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(wagerQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const filters = parsed.data;
  const limit = filters.limit;
  const agentId = (filters.agent_id ?? "").trim();
  const wagerType = (filters.wager_type ?? "").trim().toUpperCase();
  const since = (filters.since ?? "").trim();
  const minAmount = filters.min_amount ?? 0;
  const maxAmount = filters.max_amount ?? 0;

  let sql = `SELECT id, wager_number, agent_id, customer_id, login, wager_type,
                    amount_wagered, to_win_amount, insert_date_time, ticket_writer,
                    volume_amount, short_desc, agent_login, captured_at
             FROM prop_wagers WHERE 1=1`;
  const bindings: (string | number)[] = [];

  if (agentId) { sql += " AND agent_id = ?"; bindings.push(agentId); }
  if (wagerType) { sql += " AND wager_type = ?"; bindings.push(wagerType); }
  if (since) { sql += " AND captured_at >= ?"; bindings.push(since); }
  if (minAmount > 0) { sql += " AND amount_wagered >= ?"; bindings.push(minAmount); }
  if (maxAmount > 0) { sql += " AND amount_wagered <= ?"; bindings.push(maxAmount); }

  sql += " ORDER BY captured_at DESC, wager_number DESC LIMIT ?";
  bindings.push(limit);

  const result = await env.ANALYTICS_DB.prepare(sql).bind(...bindings).all();
  return json({ limit, total: result.results?.length ?? 0, wagers: result.results ?? [] }, 200);
}

async function queryPositionData(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(positionDataQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { limit, sport_id: sportId } = parsed.data;

  let sql = `SELECT id, sport_id, sport_name, total_wagered, total_to_win, wager_count, captured_at
             FROM agent_position_data WHERE 1=1`;
  const bindings: (string | number)[] = [];

  if (sportId > 0) { sql += " AND sport_id = ?"; bindings.push(sportId); }

  sql += " ORDER BY captured_at DESC LIMIT ?";
  bindings.push(limit);

  const result = await env.ANALYTICS_DB.prepare(sql).bind(...bindings).all();
  return json({ limit, total: result.results?.length ?? 0, records: result.results ?? [] }, 200);
}

async function getDashboardSummary(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(dashboardSummaryQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { mode, days } = parsed.data;
  const today = new Date().toISOString().slice(0, 10);
  const since =
    mode === "calendar"
      ? `${today}T00:00:00.000Z`
      : new Date(Date.now() - days * 86400000).toISOString();
  const windowLabel =
    mode === "calendar"
      ? `UTC day ${today}`
      : days === 1
        ? "Last 24 hours"
        : `Last ${days} days`;

  const [tickerCount, gradedCount, perfRows, posRows] = await Promise.all([
    env.ANALYTICS_DB.prepare(
      `SELECT COUNT(*) as total, COALESCE(SUM(amount_wagered),0) as volume,
              COUNT(DISTINCT agent_id) as agents, COUNT(DISTINCT wager_type) as types
       FROM bet_ticker_wagers WHERE captured_at >= ?`,
    ).bind(since).first<Record<string, number>>(),
    env.ANALYTICS_DB.prepare(
      `SELECT COUNT(*) as total, COALESCE(SUM(net_amount),0) as pnl,
              COUNT(DISTINCT agent_id) as agents
       FROM graded_wagers WHERE captured_at >= ?`,
    ).bind(since).first<Record<string, number>>(),
    env.ANALYTICS_DB.prepare(
      `SELECT agent_id,
              COUNT(*) as total_wagers,
              COALESCE(SUM(amount_wagered),0) as total_volume,
              0 as win_rate
       FROM bet_ticker_wagers
       WHERE captured_at >= ?
       GROUP BY agent_id
       ORDER BY total_volume DESC
       LIMIT 5`,
    ).bind(since).all<{ agent_id: string; total_wagers: number; total_volume: number; win_rate: number }>(),
    env.ANALYTICS_DB.prepare(
      `SELECT sport_name, COALESCE(SUM(total_wagered),0) as volume,
              COALESCE(SUM(wager_count),0) as wagers
       FROM agent_position_data WHERE captured_at >= ?
       GROUP BY sport_name ORDER BY volume DESC LIMIT 5`,
    ).bind(since).all<{ sport_name: string; volume: number; wagers: number }>(),
  ]);

  return json({
    date: today,
    window: { mode, days, since, label: windowLabel },
    liveWagers: {
      total: tickerCount?.total ?? 0,
      volume: tickerCount?.volume ?? 0,
      agents: tickerCount?.agents ?? 0,
      types: tickerCount?.types ?? 0,
    },
    gradedWagers: {
      total: gradedCount?.total ?? 0,
      pnl: gradedCount?.pnl ?? 0,
      agents: gradedCount?.agents ?? 0,
    },
    topAgents: (perfRows.results ?? []).slice(0, 5),
    topSports: posRows.results ?? [],
  }, 200);
}

async function listAlertEvents(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(alertEventsQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { limit, severity, type } = parsed.data;
  const where: string[] = [];
  const bindings: string[] = [];
  if (severity) {
    where.push("severity = ?");
    bindings.push(severity);
  }
  if (type) {
    where.push("type = ?");
    bindings.push(type);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const result = await env.ANALYTICS_DB.prepare(
    `SELECT id, created_at, severity, type, message, context_json, r2_key
     FROM alert_events
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(...bindings, limit)
    .all();
  const events = (result.results ?? []).map((event) => ({
    ...event,
    context: parseJsonString(typeof event.context_json === "string" ? event.context_json : null),
  }));
  return json({ filters: { severity, type }, events }, 200);
}

async function summarizeAlertEvents(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(alertEventsSummaryQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { days, severity, type } = parsed.data;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const where = ["created_at >= ?"];
  const bindings: string[] = [since];
  if (severity) {
    where.push("severity = ?");
    bindings.push(severity);
  }
  if (type) {
    where.push("type = ?");
    bindings.push(type);
  }
  const result = await env.ANALYTICS_DB.prepare(
    `SELECT id, created_at, severity, type, message, context_json, r2_key
     FROM alert_events
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT 500`,
  )
    .bind(...bindings)
    .all();
  const rows = (result.results ?? []) as Array<Record<string, unknown>>;
  const bySeverity: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byDay: Record<string, { total: number; bySeverity: Record<string, number> }> = {};
  const grouped = new Map<string, { severity: string; type: string; count: number; latest: string | null }>();
  const scanCounts = new Map<string, { scanId: string; count: number; latest: string | null; types: Set<string> }>();

  for (const row of rows) {
    const severity = typeof row.severity === "string" ? row.severity : "unknown";
    const type = typeof row.type === "string" ? row.type : "unknown";
    const createdAt = typeof row.created_at === "string" ? row.created_at : "";
    const day = createdAt.slice(0, 10) || "unknown";
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    byType[type] = (byType[type] ?? 0) + 1;
    byDay[day] ??= { total: 0, bySeverity: {} };
    byDay[day].total += 1;
    byDay[day].bySeverity[severity] = (byDay[day].bySeverity[severity] ?? 0) + 1;

    const groupKey = `${severity}\0${type}`;
    const group = grouped.get(groupKey) ?? { severity, type, count: 0, latest: null };
    group.count += 1;
    if (!group.latest || createdAt > group.latest) group.latest = createdAt || null;
    grouped.set(groupKey, group);

    const context = parseJsonString(typeof row.context_json === "string" ? row.context_json : null);
    const scanId = context && typeof context === "object" && !Array.isArray(context) && typeof (context as Record<string, unknown>).scanId === "string"
      ? String((context as Record<string, unknown>).scanId)
      : null;
    if (scanId) {
      const scan = scanCounts.get(scanId) ?? { scanId, count: 0, latest: null, types: new Set<string>() };
      scan.count += 1;
      if (!scan.latest || createdAt > scan.latest) scan.latest = createdAt || null;
      scan.types.add(type);
      scanCounts.set(scanId, scan);
    }
  }

  const groups = [...grouped.values()].sort((a, b) => b.count - a.count || String(b.latest).localeCompare(String(a.latest)));
  const daily = Object.entries(byDay)
    .map(([date, bucket]) => ({ date, ...bucket }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const topAffectedScans = [...scanCounts.values()]
    .sort((a, b) => b.count - a.count || String(b.latest).localeCompare(String(a.latest)))
    .slice(0, 10)
    .map((scan) => ({ scanId: scan.scanId, count: scan.count, latest: scan.latest, types: [...scan.types].sort() }));

  return json({ days, since, filters: { severity, type }, total: rows.length, bySeverity, byType, daily, topAffectedScans, groups }, 200);
}

async function createSyntheticAlert(request: Request, env: Env): Promise<Response> {
  const raw = await safeJson(request);
  const parsed = parseBody(syntheticAlertBodySchema, raw ?? {}, json);
  if (!parsed.ok) return parsed.response;
  const { severity, message } = parsed.data;
  const event = await sendFailureAlert(env, {
    severity,
    type: "synthetic-test",
    message,
    context: {
      synthetic: true,
      source: "operator-api",
    },
  });
  return json({ status: "created", event }, 201);
}

async function createSyntheticPolicyAlert(env: Env): Promise<Response> {
  const scanId = crypto.randomUUID();
  const url = env.FANTASY402_BASE_URL || "https://fantasy402.com";
  const summary: HarNetworkSummary = {
    totalRequests: 2,
    byMethod: { GET: 2 },
    byStatus: { "200": 1, "500": 1 },
    byHost: { "fantasy402.com": 1, "unexpected.example": 1 },
    byMimeType: { "text/html": 1, "application/javascript": 1 },
    failedRequests: [
      {
        method: "GET",
        url: "https://unexpected.example/synthetic-policy-test.js",
        host: "unexpected.example",
        status: 500,
        statusText: "Synthetic Failure",
        timeMs: 25,
        bodySize: 10,
      },
    ],
    slowestRequests: [],
    largestResponses: [],
  };
  await alertOnNetworkSummary(env, scanId, url, summary);
  return json({ status: "created", scanId, synthetic: true, summary }, 201);
}

async function sendFailureAlert(env: Env, alert: AlertEventInput): Promise<Record<string, unknown> | null> {
  const event = await storeAlertEvent(env, alert);
  if (!env.ALERT_WEBHOOK_URL) {
    console.error("ingestion alert", alert.message);
    return event;
  }

  await fetch(env.ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: alert.message, severity: alert.severity, type: alert.type, context: alert.context ?? {} }),
  });
  return event;
}

async function storeAlertEvent(env: Env, alert: AlertEventInput): Promise<Record<string, unknown> | null> {
  try {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const payload = {
      id,
      created_at: createdAt,
      severity: alert.severity,
      type: alert.type,
      message: alert.message,
      context: alert.context ?? null,
    };
    const r2Key = archiveKey(`alerts/${alert.type}`, createdAt.slice(0, 10), id);
    await putArchiveObject(env, r2Key, JSON.stringify(payload, null, 2), {
      source: "fantasy402-ingestion-worker",
      archiveType: "alert-event",
      alertType: alert.type,
      severity: alert.severity,
      alertId: id,
      createdAt,
    });
    const event = {
      id,
      created_at: createdAt,
      severity: alert.severity,
      type: alert.type,
      message: alert.message,
      context_json: alert.context ? JSON.stringify(alert.context) : null,
      r2_key: r2Key,
    };
    await env.ANALYTICS_DB.prepare(
      `INSERT INTO alert_events (id, created_at, severity, type, message, context_json, r2_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        event.id,
        event.created_at,
        event.severity,
        event.type,
        event.message,
        event.context_json,
        event.r2_key,
      )
      .run();
    return { ...event, context: alert.context ?? null };
  } catch (error) {
    console.error("alert event persistence failed", safeError(error, { type: alert.type, severity: alert.severity }));
    return null;
  }
}

const ALERT_RULE_METRICS = new Set(["wager_amount", "agent_volume", "agent_loss", "agent_wager_count", "total_volume", "win_rate"]);
const ALERT_RULE_OPERATORS = new Set(["gt", "lt", "gte", "lte"]);

function cleanAlertRuleId(value: string | null): string | null {
  if (!value) return null;
  return isUuid(value.trim()) ? value.trim() : null;
}

function cleanAlertRuleMetric(value: string | null): string | null {
  if (!value) return null;
  return ALERT_RULE_METRICS.has(value) ? value : null;
}

function cleanAlertRuleOperator(value: string | null): string | null {
  if (!value) return null;
  return ALERT_RULE_OPERATORS.has(value) ? value : null;
}

function cleanAgentId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 40) return null;
  if (!/^[A-Za-z0-9_*.-]+$/.test(trimmed)) return null;
  return trimmed;
}

async function createAlertRule(request: Request, env: Env): Promise<Response> {
  const raw = await safeJson(request);
  if (!raw) {
    return json({ status: "failed", message: "Invalid JSON body" }, 400);
  }
  const parsed = parseBody(createAlertRuleBodySchema, raw, json);
  if (!parsed.ok) return parsed.response;
  const { agent_id: agentId, metric, operator, threshold, severity, enabled } = parsed.data;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.ANALYTICS_DB.prepare(
    `INSERT INTO alert_rules (id, agent_id, metric, operator, threshold, severity, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, agentId, metric, operator, threshold, severity, enabled ? 1 : 0, now, now).run();

  const enabledFlag = enabled ? 1 : 0;
  return json(
    {
      status: "created",
      rule: { id, agent_id: agentId, metric, operator, threshold, severity, enabled: enabledFlag, created_at: now, updated_at: now },
    },
    201,
  );
}

async function listAlertRules(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(alertRulesListQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { limit } = parsed.data;
  const result = await env.ANALYTICS_DB.prepare(
    `SELECT id, agent_id, metric, operator, threshold, severity, enabled, created_at, updated_at
     FROM alert_rules
     ORDER BY created_at DESC
     LIMIT ?`,
  ).bind(limit).all();

  return json({ limit, total: result.results?.length ?? 0, rules: result.results ?? [] }, 200);
}

async function deleteAlertRule(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(uuidQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { id } = parsed.data;

  const result = await env.ANALYTICS_DB.prepare("DELETE FROM alert_rules WHERE id = ?").bind(id).run();
  if (result.meta.changes === 0) {
    return json({ status: "failed", message: "Rule not found" }, 404);
  }

  return json({ status: "deleted", id }, 200);
}

async function patchAlertRule(request: Request, url: URL, env: Env): Promise<Response> {
  const idParsed = parseQuery(uuidQuerySchema, url.searchParams, json);
  if (!idParsed.ok) return idParsed.response;
  const { id } = idParsed.data;

  const raw = await safeJson(request);
  if (!raw) {
    return json({ status: "failed", message: "Invalid JSON body" }, 400);
  }
  const bodyParsed = parseBody(patchAlertRuleBodySchema, raw, json);
  if (!bodyParsed.ok) return bodyParsed.response;
  const body = bodyParsed.data;

  const updates: string[] = [];
  const bindings: (string | number)[] = [];

  if (typeof body.enabled === "boolean") {
    updates.push("enabled = ?");
    bindings.push(body.enabled ? 1 : 0);
  }
  if (body.severity) {
    updates.push("severity = ?");
    bindings.push(body.severity);
  }
  if (typeof body.threshold === "number") {
    updates.push("threshold = ?");
    bindings.push(body.threshold);
  }

  const now = new Date().toISOString();
  updates.push("updated_at = ?");
  bindings.push(now);
  bindings.push(id);

  const result = await env.ANALYTICS_DB.prepare(
    `UPDATE alert_rules SET ${updates.join(", ")} WHERE id = ?`,
  ).bind(...bindings).run();

  if (result.meta.changes === 0) {
    return json({ status: "failed", message: "Rule not found" }, 404);
  }

  return json({ status: "updated", id }, 200);
}

async function listAlertLog(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(alertLogQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { limit, rule_id: ruleId, agent_id: agentId, metric, severity } = parsed.data;

  const where: string[] = [];
  const bindings: (string | number)[] = [];

  if (ruleId) {
    where.push("rule_id = ?");
    bindings.push(ruleId);
  }
  if (agentId) {
    where.push("agent_id = ?");
    bindings.push(agentId);
  }
  if (metric) {
    where.push("metric = ?");
    bindings.push(metric);
  }
  if (severity) {
    where.push("severity = ?");
    bindings.push(severity);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const result = await env.ANALYTICS_DB.prepare(
    `SELECT id, rule_id, agent_id, metric, actual_value, threshold, operator, severity, message, created_at
     FROM alert_log
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT ?`,
  ).bind(...bindings, limit).all();

  return json({ limit, total: result.results?.length ?? 0, entries: result.results ?? [] }, 200);
}

async function evaluateAlertRules(env: Env): Promise<void> {
  try {
    const rules = await env.ANALYTICS_DB.prepare(
      `SELECT id, agent_id, metric, operator, threshold, severity
       FROM alert_rules
       WHERE enabled = 1
       ORDER BY created_at ASC`,
    ).all<{ id: string; agent_id: string; metric: string; operator: string; threshold: number; severity: string }>();

    if (!rules.results?.length) return;

    const today = new Date().toISOString().slice(0, 10);
    const since = `${today}T00:00:00.000Z`;

    for (const rule of rules.results) {
      try {
        await evaluateSingleRule(env, rule, since);
      } catch (error) {
        console.error("alert rule evaluation failed", safeError(error, { ruleId: rule.id }));
      }
    }
  } catch (error) {
    console.error("alert rules query failed", safeError(error, {}));
  }
}

async function evaluateSingleRule(
  env: Env,
  rule: { id: string; agent_id: string; metric: string; operator: string; threshold: number; severity: string },
  since: string,
): Promise<void> {
  let currentValue: number | null = null;
  let agentId = rule.agent_id;

  switch (rule.metric) {
    case "wager_amount": {
      const row = await env.ANALYTICS_DB.prepare(
        "SELECT COALESCE(MAX(amount_wagered), 0) as val FROM bet_ticker_wagers WHERE captured_at >= ?",
      ).bind(since).first<{ val: number }>();
      currentValue = row?.val ?? 0;
      break;
    }
    case "total_volume": {
      const row = await env.ANALYTICS_DB.prepare(
        "SELECT COALESCE(SUM(amount_wagered), 0) as val FROM bet_ticker_wagers WHERE captured_at >= ?",
      ).bind(since).first<{ val: number }>();
      currentValue = row?.val ?? 0;
      break;
    }
    case "agent_volume": {
      const row = await env.ANALYTICS_DB.prepare(
        agentId === "*"
          ? "SELECT COALESCE(SUM(amount_wagered), 0) as val FROM bet_ticker_wagers WHERE captured_at >= ?"
          : "SELECT COALESCE(SUM(amount_wagered), 0) as val FROM bet_ticker_wagers WHERE agent_id = ? AND captured_at >= ?",
      ).bind(...(agentId === "*" ? [since] : [agentId, since])).first<{ val: number }>();
      currentValue = row?.val ?? 0;
      break;
    }
    case "agent_loss": {
      const row = await env.ANALYTICS_DB.prepare(
        agentId === "*"
          ? "SELECT COALESCE(SUM(net_amount), 0) as val FROM graded_wagers WHERE captured_at >= ?"
          : "SELECT COALESCE(SUM(net_amount), 0) as val FROM graded_wagers WHERE agent_id = ? AND captured_at >= ?",
      ).bind(...(agentId === "*" ? [since] : [agentId, since])).first<{ val: number }>();
      currentValue = row?.val ?? 0;
      break;
    }
    case "agent_wager_count": {
      const row = await env.ANALYTICS_DB.prepare(
        agentId === "*"
          ? "SELECT COUNT(*) as val FROM bet_ticker_wagers WHERE captured_at >= ?"
          : "SELECT COUNT(*) as val FROM bet_ticker_wagers WHERE agent_id = ? AND captured_at >= ?",
      ).bind(...(agentId === "*" ? [since] : [agentId, since])).first<{ val: number }>();
      currentValue = row?.val ?? 0;
      break;
    }
    case "win_rate": {
      if (agentId === "*") return;
      const row = await env.ANALYTICS_DB.prepare(
        `SELECT COALESCE(SUM(CASE WHEN result = 'W' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 0) as val
         FROM graded_wagers WHERE agent_id = ? AND captured_at >= ?`,
      ).bind(agentId, since).first<{ val: number }>();
      currentValue = row?.val ?? 0;
      break;
    }
  }

  if (currentValue === null) return;

  const breached = rule.operator === "gt" ? currentValue > rule.threshold
    : rule.operator === "gte" ? currentValue >= rule.threshold
      : rule.operator === "lt" ? currentValue < rule.threshold
        : rule.operator === "lte" ? currentValue <= rule.threshold
          : false;

  if (!breached) return;

  const alreadyAlerted = await env.ANALYTICS_DB.prepare(
    "SELECT COUNT(*) as cnt FROM alert_log WHERE rule_id = ? AND agent_id = ? AND created_at >= ?",
  ).bind(rule.id, agentId, since).first<{ cnt: number }>();

  if (alreadyAlerted && alreadyAlerted.cnt > 0) return;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const message = `Alert rule ${rule.id.slice(0, 8)}: ${rule.metric} ${rule.operator} ${rule.threshold} (actual: ${currentValue}) for agent ${agentId}`;

  await env.ANALYTICS_DB.prepare(
    `INSERT INTO alert_log (id, rule_id, agent_id, metric, actual_value, threshold, operator, severity, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, rule.id, agentId, rule.metric, currentValue, rule.threshold, rule.operator, rule.severity, message, now).run();

  await sendFailureAlert(env, {
    severity: rule.severity as "info" | "warning" | "critical",
    type: "alert-rule-breach",
    message,
    context: { ruleId: rule.id, agentId, metric: rule.metric, actualValue: currentValue, threshold: rule.threshold },
  });
}

async function liveWagersStream(url: URL, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const parsed = parseQuery(wagerQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const filters = parsed.data;
  const since = (filters.since ?? new Date(Date.now() - 300_000).toISOString()).trim();
  const wagerType = (filters.wager_type ?? "").trim().toUpperCase();
  const minAmount = filters.min_amount ?? 0;
  const maxAmount = filters.max_amount ?? 0;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  async function pump() {
    let lastSince = since;
    const encoder = new TextEncoder();
    while (true) {
      try {
        let sql = `SELECT id, wager_number, agent_id, customer_id, login, wager_type,
                          amount_wagered, to_win_amount, insert_date_time, ticket_writer,
                          volume_amount, short_desc, agent_login, captured_at
                   FROM bet_ticker_wagers
                   WHERE captured_at > ?`;
        const bindings: (string | number)[] = [lastSince];
        if (wagerType) sql += " AND wager_type = ?", bindings.push(wagerType);
        if (minAmount > 0) sql += " AND amount_wagered >= ?", bindings.push(minAmount);
        if (maxAmount > 0) sql += " AND amount_wagered <= ?", bindings.push(maxAmount);
        sql += " ORDER BY captured_at ASC, wager_number ASC";

        const result = await env.ANALYTICS_DB.prepare(sql).bind(...bindings).all();
        const rows = result.results ?? [];

        for (const row of rows) {
          const r = row as Record<string, unknown>;
          const captured = (r.captured_at ?? "") as string;
          if (captured > lastSince) lastSince = captured;
          await writer.write(encoder.encode(`event: wager\ndata: ${JSON.stringify({ event: "wager", wager: r })}\n\n`));
        }

        if (rows.length > 0) {
          await writer.write(encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ count: rows.length, since: lastSince })}\n\n`));
        }

        await writer.write(encoder.encode(": keepalive\n\n"));
        await new Promise((r) => setTimeout(r, 3000));
      } catch {
        try { await writer.close(); } catch { /* ignore */ }
        return;
      }
    }
  }

  if (ctx) { ctx.waitUntil(pump()); } else { pump(); }

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function configuredIngestionKeys(env: Env): Set<string> {
  return new Set(
    resolveIngestionEndpointKeys(env.FANTASY402_INGESTION_ENDPOINTS, {
      hasCustomerId: ingestionHasCustomerId(env),
      isKnownKey: (key) => isEndpointKey(key),
      requiresCustomerId: (key) => isEndpointKey(key) && Boolean(ENDPOINTS[key].requiresCustomerId),
    }),
  );
}

function formatEndpointsRequested(
  batch: ReturnType<typeof planIngestionBatch>,
  endpoints: EndpointConfig[],
): string {
  const keys = endpoints.map((endpoint) => endpoint.key).join(",");
  if (batch.catalogSize <= batch.batchSize) return keys;
  return `[batch ${batch.cursor}-${batch.cursor + batch.batchSize - 1}/${batch.catalogSize}] ${keys}`;
}

async function readIngestionCursor(env: Env): Promise<number> {
  try {
    const raw = await env.AUTH_CACHE.get(INGESTION_CURSOR_KEY);
    const parsed = Number.parseInt(raw ?? "0", 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

async function writeIngestionCursor(env: Env, cursor: number): Promise<void> {
  try {
    await env.AUTH_CACHE.put(INGESTION_CURSOR_KEY, String(cursor));
  } catch {
    /* cursor is best-effort */
  }
}

async function getIngestionPlan(env: Env): Promise<
  ReturnType<typeof planIngestionBatch> & { configured: string; batching: boolean }
> {
  const configured = env.FANTASY402_INGESTION_ENDPOINTS.trim();
  const catalogKeys = resolveIngestionEndpointKeys(configured, {
    hasCustomerId: ingestionHasCustomerId(env),
    isKnownKey: (key) => isEndpointKey(key),
    requiresCustomerId: (key) => isEndpointKey(key) && Boolean(ENDPOINTS[key].requiresCustomerId),
  });

  const batchSize = ingestionBatchSize(env.FANTASY402_INGESTION_BATCH_SIZE);
  const batching = configured.toLowerCase() === INGESTION_ALL;

  if (!batching) {
    return {
      keys: catalogKeys,
      cursor: 0,
      nextCursor: 0,
      batchSize: catalogKeys.length,
      catalogSize: catalogKeys.length,
      configured,
      batching: false,
    };
  }

  const cursor = await readIngestionCursor(env);
  return {
    ...planIngestionBatch(catalogKeys, cursor, batchSize),
    configured,
    batching: true,
  };
}

async function selectEndpointsForRun(env: Env): Promise<{
  endpoints: EndpointConfig[];
  batch: ReturnType<typeof planIngestionBatch>;
}> {
  const catalogKeys = resolveIngestionEndpointKeys(env.FANTASY402_INGESTION_ENDPOINTS, {
    hasCustomerId: ingestionHasCustomerId(env),
    isKnownKey: (key) => isEndpointKey(key),
    requiresCustomerId: (key) => isEndpointKey(key) && Boolean(ENDPOINTS[key].requiresCustomerId),
  });

  if (!catalogKeys.length) {
    throw new Error("No ingestion endpoints resolved from FANTASY402_INGESTION_ENDPOINTS");
  }

  const batchSize = ingestionBatchSize(env.FANTASY402_INGESTION_BATCH_SIZE);
  const useBatching = env.FANTASY402_INGESTION_ENDPOINTS.trim().toLowerCase() === INGESTION_ALL;

  if (!useBatching) {
    const endpoints = catalogKeys.map((key) => resolveEndpointConfig(key, env));
    return {
      endpoints,
      batch: {
        keys: catalogKeys,
        cursor: 0,
        nextCursor: 0,
        batchSize: catalogKeys.length,
        catalogSize: catalogKeys.length,
      },
    };
  }

  const cursor = await readIngestionCursor(env);
  const batch = planIngestionBatch(catalogKeys, cursor, batchSize);
  await writeIngestionCursor(env, batch.nextCursor);
  const endpoints = batch.keys.map((key) => resolveEndpointConfig(key, env));
  return { endpoints, batch };
}

function resolveEndpointConfig(key: string, env: Env, runtime?: IngestionEnv): EndpointConfig {
  if (!isEndpointKey(key)) {
    throw new Error(`Unknown endpoint configured: ${key}`);
  }
  const endpoint = ENDPOINTS[key];
  if (
    endpoint.requiresCustomerId
    && !hasEnvValue(env.FANTASY402_CUSTOMER_ID)
    && !runtime?.__ingestionCustomerId
    && !canDeriveCustomerId()
  ) {
    throw new Error(`${key} requires FANTASY402_CUSTOMER_ID`);
  }
  return endpoint;
}

function selectEndpoints(env: Env): EndpointConfig[] {
  const catalogKeys = resolveIngestionEndpointKeys(env.FANTASY402_INGESTION_ENDPOINTS, {
    hasCustomerId: ingestionHasCustomerId(env),
    isKnownKey: (key) => isEndpointKey(key),
    requiresCustomerId: (key) => isEndpointKey(key) && Boolean(ENDPOINTS[key].requiresCustomerId),
  });
  return catalogKeys.map((key) => resolveEndpointConfig(key, env));
}

function withDateRange(env: Env, now: Date, input: Record<string, string | number>): Record<string, string | number> {
  const date = now.toISOString().slice(0, 10);
  return {
    RRO: 1,
    agentOwner: env.FANTASY402_AGENT_ID,
    startDate: date,
    endDate: date,
    start: date,
    end: date,
    ...input,
  };
}

async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractAuthToken(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["tokenauth", "tokenAuth", "token", "access_token", "authorization"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  for (const child of Object.values(record)) {
    const candidate = extractAuthToken(child);
    if (candidate) return candidate;
  }
  return undefined;
}

function optionalFirstSetCookie(headers: Headers): string | null {
  return setCookiePairs(headers)
    .find((cookie) => {
      const name = cookieName(cookie);
      return Boolean(name && !isCloudflareCookieName(name));
    }) ?? null;
}

function setCookieValue(headers: Headers, wantedName: string): string | null {
  return setCookiePairs(headers)
    .find((cookie) => cookieName(cookie)?.toLowerCase() === wantedName.toLowerCase()) ?? null;
}

function setCookiePairs(headers: Headers): string[] {
  const setCookie = headers.get("set-cookie") ?? "";
  return setCookie
    .split(/,(?=\s*[^;=]+=[^;]+)/)
    .map((cookie) => cookie.trim().split(";")[0] ?? "")
    .filter(Boolean);
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("request-timeout"), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function redactResponse(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactResponse);
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = isCredentialField(key) ? "[REDACTED]" : redactResponse(nested);
    }
    return output;
  }
  return value;
}

function isCredentialField(key: string): boolean {
  return /^(password|pass|passwordf|payoutpassword|placewagerpassword)$/i.test(key);
}

function countItems(data: unknown): number | null {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) return value.length;
    }
  }
  return null;
}

function firstObject(data: unknown): Record<string, unknown> {
  if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
    return data[0] as Record<string, unknown>;
  }
  if (data && typeof data === "object") {
    for (const value of Object.values(data)) {
      if (Array.isArray(value) && value[0] && typeof value[0] === "object") {
        return value[0] as Record<string, unknown>;
      }
    }
    return data as Record<string, unknown>;
  }
  return {};
}

function stringField(record: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return fallback;
}

function numberField(record: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/,/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function baseUrl(env: Env): string {
  return env.FANTASY402_BASE_URL.replace(/\/+$/, "");
}

async function putArchiveObject(
  env: Env,
  key: string,
  body: string,
  customMetadata: Record<string, string>,
): Promise<R2Object> {
  return env.RAW_ARCHIVE.put(key, body, {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: "no-store, max-age=0",
    },
    customMetadata: {
      ...customMetadata,
      storageClass: "infrequent_access",
    },
    storageClass: R2_ARCHIVE_STORAGE_CLASS,
  });
}

async function listArchiveObjects(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(archiveListQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const query = parsed.data;
  const filters = {
    prefix: query.prefix
      ? normalizeArchivePrefix(query.prefix)
      : archivePrefix(query.endpoint ?? null, query.date ?? null),
    endpoint: query.endpoint ?? null,
    date: query.date ?? null,
    archiveType: query.archiveType ?? null,
  };
  const { limit, cursor } = query;
  const prefix = filters.prefix;
  const listed = await env.RAW_ARCHIVE.list(cursor ? { prefix, limit, cursor } : { prefix, limit });
  const objects = listed.objects
    .filter((object) => matchesArchiveFilters(object, filters))
    .map((object) => ({
      key: object.key,
      etag: object.etag,
      size: object.size,
      uploaded: object.uploaded.toISOString(),
      storageClass: object.storageClass,
      httpMetadata: object.httpMetadata ?? {},
      customMetadata: object.customMetadata ?? {},
    }));

  return json(
    {
      filters,
      objects,
      truncated: listed.truncated,
      cursor: listed.truncated ? listed.cursor : null,
    },
    200,
  );
}

interface ArchiveFilters {
  prefix: string;
  endpoint: string | null;
  date: string | null;
  archiveType: string | null;
}

function archiveFilters(url: URL): ArchiveFilters {
  const endpoint = cleanPathSegment(url.searchParams.get("endpoint"));
  const date = validDate(url.searchParams.get("date"));
  const archiveType = cleanMetadataValue(url.searchParams.get("archiveType"));
  const explicitPrefix = url.searchParams.get("prefix");
  const prefix = explicitPrefix ? normalizeArchivePrefix(explicitPrefix) : archivePrefix(endpoint, date);
  return { prefix, endpoint, date, archiveType };
}

function archivePrefix(endpoint: string | null, date: string | null): string {
  if (endpoint && date) return `${R2_ARCHIVE_PREFIX}/${endpoint}/${date}`;
  if (endpoint) return `${R2_ARCHIVE_PREFIX}/${endpoint}`;
  return R2_ARCHIVE_PREFIX;
}

function matchesArchiveFilters(object: R2Object, filters: ArchiveFilters): boolean {
  const metadata = object.customMetadata ?? {};
  if (filters.archiveType && metadata.archiveType !== filters.archiveType) return false;
  return true;
}

async function getArchiveObject(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(archiveKeyQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { key } = parsed.data;

  const object = await env.RAW_ARCHIVE.get(key);
  if (!object) return json({ status: "failed", message: "Archive object not found" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", headers.get("Content-Type") ?? "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("ETag", object.etag);
  headers.set("X-Archive-Key", object.key);
  headers.set("X-Archive-Storage-Class", object.storageClass);
  headers.set("X-Archive-Size", String(object.size));

  return new Response(object.body, { headers });
}

async function listScanVerdicts(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(scanListQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { limit, malicious, urlContains, since, until } = parsed.data;
  const filters = {
    malicious: malicious ?? null,
    urlContains: urlContains ?? null,
    since: since ?? null,
    until: until ?? null,
  };
  const where: string[] = [];
  const bindings: Array<string | number> = [];
  if (filters.malicious !== null) {
    where.push("malicious = ?");
    bindings.push(filters.malicious);
  }
  if (filters.urlContains !== null) {
    where.push("url LIKE ?");
    bindings.push(`%${filters.urlContains}%`);
  }
  if (filters.since !== null) {
    where.push("timestamp >= ?");
    bindings.push(`${filters.since}T00:00:00.000Z`);
  }
  if (filters.until !== null) {
    where.push("timestamp <= ?");
    bindings.push(`${filters.until}T23:59:59.999Z`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const result = await env.ANALYTICS_DB.prepare(
    `SELECT scan_id, timestamp, url, malicious, tls_valid_days, agent_readiness_level,
            scan_r2_key, screenshot_r2_key, har_r2_key
     FROM scans_verdicts
     ${whereSql}
     ORDER BY timestamp DESC
     LIMIT ?`,
  )
    .bind(...bindings, limit)
    .all();

  return json({ filters, results: result.results ?? [] }, 200);
}

async function summarizeScanVerdicts(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(scanSummaryQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { days, tlsWarningDays } = parsed.data;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const query = await env.ANALYTICS_DB.prepare(
    `SELECT scan_id, timestamp, url, malicious, tls_valid_days, agent_readiness_level,
            scan_r2_key, screenshot_r2_key, har_r2_key
     FROM scans_verdicts
     WHERE timestamp >= ?
     ORDER BY timestamp DESC
     LIMIT 1000`,
  )
    .bind(since)
    .all();
  const rows = (query.results ?? []) as Array<Record<string, unknown>>;
  const maliciousCount = rows.filter((row) => Number(row.malicious) === 1).length;
  const tlsExpiringCount = rows.filter((row) => typeof row.tls_valid_days === "number" && row.tls_valid_days <= tlsWarningDays).length;
  const tlsValues = rows.map((row) => row.tls_valid_days).filter((value): value is number => typeof value === "number");

  return json(
    {
      window: {
        days,
        since,
        tlsWarningDays,
        scannedRows: rows.length,
        capped: rows.length >= 1000,
      },
      totals: {
        scans: rows.length,
        malicious: maliciousCount,
        clean: rows.length - maliciousCount,
        tlsExpiring: tlsExpiringCount,
        minTlsValidDays: tlsValues.length ? Math.min(...tlsValues) : null,
      },
      latest: rows[0] ?? null,
      status:
        maliciousCount > 0
          ? "alert"
          : tlsExpiringCount > 0
            ? "warning"
            : rows.length > 0
              ? "ok"
              : "empty",
    },
    200,
  );
}

async function getScanDetail(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(scanDetailQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { scanId, includeRaw } = parsed.data;

  const result = await getScanVerdict(scanId, env);
  if (!result) return json({ status: "failed", message: "Scan verdict not found" }, 404);
  const scanR2Key = typeof result.scan_r2_key === "string" ? result.scan_r2_key : null;
  const archive = scanR2Key ? await scanArchiveSummary(scanR2Key, env, includeRaw) : null;
  return json({ verdict: result, archive }, 200);
}

async function getScanScreenshot(url: URL, env: Env): Promise<Response> {
  return streamScanArtifact(url, env, {
    column: "screenshot_r2_key",
    prefix: `${R2_ARCHIVE_PREFIX}/screenshots/`,
    contentType: "image/png",
    notAvailableMessage: "Scan screenshot not available",
    invalidKeyMessage: "Invalid screenshot archive key",
    notFoundMessage: "Scan screenshot object not found",
  });
}

async function getScanHar(url: URL, env: Env): Promise<Response> {
  return streamScanArtifact(url, env, {
    column: "har_r2_key",
    prefix: `${R2_ARCHIVE_PREFIX}/hars/`,
    contentType: "application/json; charset=utf-8",
    notAvailableMessage: "Scan HAR not available",
    invalidKeyMessage: "Invalid HAR archive key",
    notFoundMessage: "Scan HAR object not found",
  });
}

async function getScanNetworkSummary(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(scanIdQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { scanId } = parsed.data;

  const persisted = await getPersistedNetworkSummary(scanId, env);
  if (persisted) {
    return json(
      {
        scanId,
        harR2Key: persisted.harR2Key,
        generatedAt: new Date().toISOString(),
        source: "d1",
        summary: persisted.summary,
      },
      200,
    );
  }

  const fallback = await computeNetworkSummaryFromHar(scanId, env);
  if (fallback instanceof Response) return fallback;
  return json({ scanId, harR2Key: fallback.harR2Key, generatedAt: new Date().toISOString(), source: "r2", summary: fallback.summary }, 200);
}

async function diffScanNetworkSummaries(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(scanCompareQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { baseScanId, compareScanId } = parsed.data;

  const [base, compare] = await Promise.all([
    getNetworkSummaryForComparison(baseScanId, env),
    getNetworkSummaryForComparison(compareScanId, env),
  ]);
  if (base instanceof Response) return base;
  if (compare instanceof Response) return compare;

  return json(
    {
      generatedAt: new Date().toISOString(),
      base: { scanId: baseScanId, source: base.source, harR2Key: base.harR2Key, totalRequests: base.summary.totalRequests },
      compare: { scanId: compareScanId, source: compare.source, harR2Key: compare.harR2Key, totalRequests: compare.summary.totalRequests },
      diff: {
        totalRequestsDelta: compare.summary.totalRequests - base.summary.totalRequests,
        hosts: diffCounts(base.summary.byHost, compare.summary.byHost),
        statuses: diffCounts(base.summary.byStatus, compare.summary.byStatus),
        methods: diffCounts(base.summary.byMethod, compare.summary.byMethod),
        mimeTypes: diffCounts(base.summary.byMimeType, compare.summary.byMimeType),
        failedRequestsDelta: compare.summary.failedRequests.length - base.summary.failedRequests.length,
      },
    },
    200,
  );
}

async function getNetworkSummaryForComparison(scanId: string, env: Env): Promise<{ source: "d1" | "r2"; harR2Key: string; summary: ReturnType<typeof summarizeHar> } | Response> {
  const persisted = await getPersistedNetworkSummary(scanId, env);
  if (persisted) return { source: "d1", ...persisted };
  const computed = await computeNetworkSummaryFromHar(scanId, env);
  if (computed instanceof Response) return computed;
  return { source: "r2", ...computed };
}

async function getPersistedNetworkSummary(scanId: string, env: Env): Promise<{ harR2Key: string; summary: ReturnType<typeof summarizeHar> } | null> {
  const query = await env.ANALYTICS_DB.prepare(
    `SELECT total_requests, status_counts_json, method_counts_json, host_counts_json,
            mime_counts_json, failed_requests_json, slowest_requests_json,
            largest_responses_json, har_r2_key
     FROM scan_network_summary
     WHERE scan_id = ?
     LIMIT 1`,
  )
    .bind(scanId)
    .all();
  const row = (query.results ?? [])[0] as Record<string, unknown> | undefined;
  if (!row || typeof row.total_requests !== "number") return null;
  return {
    harR2Key: typeof row.har_r2_key === "string" ? row.har_r2_key : "",
    summary: {
      totalRequests: row.total_requests,
      byStatus: parseJsonObjectOfNumbers(row.status_counts_json),
      byMethod: parseJsonObjectOfNumbers(row.method_counts_json),
      byHost: parseJsonObjectOfNumbers(row.host_counts_json),
      byMimeType: parseJsonObjectOfNumbers(row.mime_counts_json),
      failedRequests: parseJsonArray(row.failed_requests_json),
      slowestRequests: parseJsonArray(row.slowest_requests_json),
      largestResponses: parseJsonArray(row.largest_responses_json),
    },
  };
}

async function computeNetworkSummaryFromHar(scanId: string, env: Env): Promise<{ harR2Key: string; summary: ReturnType<typeof summarizeHar> } | Response> {
  const verdict = await getScanVerdict(scanId, env);
  if (!verdict) return json({ status: "failed", message: "Scan verdict not found" }, 404);

  const key = typeof verdict.har_r2_key === "string" ? verdict.har_r2_key : "";
  if (!key) return json({ status: "failed", message: "Scan HAR not available" }, 404);
  if (!key.startsWith(`${R2_ARCHIVE_PREFIX}/hars/`)) {
    return json({ status: "failed", message: "Invalid HAR archive key" }, 400);
  }

  const object = await env.RAW_ARCHIVE.get(key);
  if (!object) return json({ status: "failed", message: "Scan HAR object not found" }, 404);

  let har: unknown;
  try {
    har = JSON.parse(await object.text());
  } catch {
    return json({ status: "failed", message: "Invalid HAR JSON" }, 422);
  }

  return { harR2Key: key, summary: summarizeHar(har) };
}

function parseJsonObjectOfNumbers(value: unknown): Record<string, number> {
  const parsed = parseJsonString(typeof value === "string" ? value : null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
  );
}

function parseJsonArray(value: unknown): HarRequestSummary[] {
  const parsed = parseJsonString(typeof value === "string" ? value : null);
  return Array.isArray(parsed) ? parsed.filter(isHarRequestSummary) : [];
}

function isHarRequestSummary(value: unknown): value is HarRequestSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.method === "string"
    && typeof item.url === "string"
    && typeof item.host === "string"
    && typeof item.status === "number"
    && typeof item.statusText === "string"
    && typeof item.timeMs === "number"
    && typeof item.bodySize === "number";
}

function diffCounts(base: Record<string, number>, compare: Record<string, number>): Record<string, { base: number; compare: number; delta: number }> {
  const keys = new Set([...Object.keys(base), ...Object.keys(compare)]);
  return Object.fromEntries(
    [...keys]
      .map((key) => ({ key, base: base[key] ?? 0, compare: compare[key] ?? 0 }))
      .filter((entry) => entry.base !== entry.compare)
      .sort((a, b) => Math.abs(b.compare - b.base) - Math.abs(a.compare - a.base) || a.key.localeCompare(b.key))
      .map((entry) => [entry.key, { base: entry.base, compare: entry.compare, delta: entry.compare - entry.base }]),
  );
}

async function streamScanArtifact(
  url: URL,
  env: Env,
  options: {
    column: "screenshot_r2_key" | "har_r2_key";
    prefix: string;
    contentType: string;
    notAvailableMessage: string;
    invalidKeyMessage: string;
    notFoundMessage: string;
  },
): Promise<Response> {
  const parsed = parseQuery(scanIdQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { scanId } = parsed.data;

  const verdict = await getScanVerdict(scanId, env);
  if (!verdict) return json({ status: "failed", message: "Scan verdict not found" }, 404);

  const artifactKey = verdict[options.column];
  const key = typeof artifactKey === "string" ? artifactKey : "";
  if (!key) return json({ status: "failed", message: options.notAvailableMessage }, 404);
  if (!key.startsWith(options.prefix)) {
    return json({ status: "failed", message: options.invalidKeyMessage }, 400);
  }

  const object = await env.RAW_ARCHIVE.get(key);
  if (!object) return json({ status: "failed", message: options.notFoundMessage }, 404);

  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": options.contentType,
    "X-Archive-Key": key,
    "ETag": object.etag,
  });
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Content-Type", options.contentType);
  return new Response(object.body, { status: 200, headers });
}

async function exportScanEvidence(url: URL, env: Env): Promise<Response> {
  const parsed = parseQuery(scanIdQuerySchema, url.searchParams, json);
  if (!parsed.ok) return parsed.response;
  const { scanId } = parsed.data;

  const verdict = await getScanVerdict(scanId, env);
  if (!verdict) return json({ status: "failed", message: "Scan verdict not found" }, 404);

  const artifactKeys: Array<{ type: "scan" | "screenshot" | "har"; key: unknown }> = [
    { type: "scan", key: verdict.scan_r2_key },
    { type: "screenshot", key: verdict.screenshot_r2_key },
    { type: "har", key: verdict.har_r2_key },
  ];
  const artifacts = await Promise.all(
    artifactKeys
      .filter((entry): entry is { type: "scan" | "screenshot" | "har"; key: string } => typeof entry.key === "string" && entry.key.length > 0)
      .map(async ({ type, key }) => ({ type, ...(await archiveEvidenceSummary(key, env)) })),
  );

  return json(
    {
      generatedAt: new Date().toISOString(),
      scanId,
      verdict,
      artifacts,
    },
    200,
  );
}

async function getScanVerdict(scanId: string, env: Env): Promise<Record<string, unknown> | undefined> {
  const query = await env.ANALYTICS_DB.prepare(
    `SELECT scan_id, timestamp, url, malicious, tls_valid_days, agent_readiness_level,
            scan_r2_key, screenshot_r2_key, har_r2_key
     FROM scans_verdicts
     WHERE scan_id = ?
     LIMIT 1`,
  )
    .bind(scanId)
    .all();
  return (query.results ?? [])[0] as Record<string, unknown> | undefined;
}

async function scanArchiveSummary(key: string, env: Env, includeRaw: boolean): Promise<Record<string, unknown> | null> {
  if (!key.startsWith(`${R2_ARCHIVE_PREFIX}/scans/`)) return null;
  return archiveEvidenceSummary(key, env, includeRaw);
}

async function archiveEvidenceSummary(key: string, env: Env, includeRaw = false): Promise<Record<string, unknown>> {
  if (!key.startsWith(`${R2_ARCHIVE_PREFIX}/`)) {
    return { key, found: false, reason: "invalid-prefix" };
  }
  const object = await env.RAW_ARCHIVE.get(key);
  if (!object) {
    return { key, found: false };
  }
  const summary: Record<string, unknown> = {
    key: object.key,
    found: true,
    etag: object.etag,
    size: object.size,
    uploaded: object.uploaded.toISOString(),
    storageClass: object.storageClass,
    httpMetadata: object.httpMetadata ?? {},
    customMetadata: object.customMetadata ?? {},
  };
  if (includeRaw) {
    const text = await object.text();
    try {
      summary.raw = JSON.parse(text);
    } catch {
      summary.raw = text;
    }
  }
  return summary;
}

interface ScanListFilters {
  malicious: 0 | 1 | null;
  urlContains: string | null;
  since: string | null;
  until: string | null;
}

function scanListFilters(url: URL): ScanListFilters {
  const maliciousParam = url.searchParams.get("malicious");
  return {
    malicious: maliciousParam === "true" || maliciousParam === "1" ? 1 : maliciousParam === "false" || maliciousParam === "0" ? 0 : null,
    urlContains: cleanSearchText(url.searchParams.get("urlContains"), 120),
    since: validDate(url.searchParams.get("since")),
    until: validDate(url.searchParams.get("until")),
  };
}

function diagnostics(env: Env): Response {
  const requiredSecrets = [
    "FANTASY402_USERNAME",
    "FANTASY402_PASSWORD",
    "FANTASY402_AGENT_ID",
    "CLOUDFLARE_API_TOKEN",
  ] as const;
  const authReady = hasEnvValue(authToken(env));
  const optionalSecrets = [
    "FANTASY402_CUSTOMER_ID",
    "FANTASY402_SESSION_COOKIE",
    "FANTASY402_CF_CLEARANCE",
    "FANTASY402_CF_BM",
    "FANTASY402_AUTHORIZATION",
    "FANTASY402_USER_AGENT",
    "FANTASY402_REFERER",
    "FANTASY402_BROWSER_HEADERS_JSON",
    "ALERT_WEBHOOK_URL",
  ] as const;
  const presentRequiredSecrets = requiredSecrets.filter((name) => hasEnvValue(env[name]));
  const missingRequiredSecrets = requiredSecrets.filter((name) => !hasEnvValue(env[name]));
  const upstreamAuthShape = upstreamAuthDiagnostics(env);
  const upstreamReady = (upstreamAuthShape.ingestionReadiness as { status?: string } | undefined)?.status === "ready";

  return json(
    {
      status: missingRequiredSecrets.length === 0 && authReady && upstreamReady ? "ready" : "degraded",
      environment: env.ENVIRONMENT,
      workerName: env.WORKER_NAME,
      cloudflare: {
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        zoneId: env.CLOUDFLARE_ZONE_ID,
      },
      bindings: {
        sessionKv: Boolean(env.SESSION_KV),
        authCache: Boolean(env.AUTH_CACHE),
        analyticsDb: Boolean(env.ANALYTICS_DB),
        rawArchive: Boolean(env.RAW_ARCHIVE),
      },
      requiredSecrets: {
        present: presentRequiredSecrets,
        missing: missingRequiredSecrets,
      },
      auth: {
        configured: authReady,
        acceptedSecrets: ["INGESTION_TRIGGER_TOKEN", "ARCHIVE_AUTH_TOKEN"],
        preferredSecret: "INGESTION_TRIGGER_TOKEN",
      },
      upstreamAuthShape,
      optionalSecrets: Object.fromEntries(optionalSecrets.map((name) => [name, hasEnvValue(env[name])])),
      scanPolicy: {
        allowedHosts: [...allowedScanHosts(env)],
      },
      configuredEndpoints: [...configuredIngestionKeys(env)],
      archive: {
        prefix: R2_ARCHIVE_PREFIX,
        storageClass: R2_ARCHIVE_STORAGE_CLASS,
      },
    },
    200,
  );
}

async function authHealth(env: Env): Promise<Response> {
  const runtimeEnv = await materializeSecretBindings(env);
  const shape = upstreamAuthDiagnostics(runtimeEnv);
  const readiness = shape.ingestionReadiness as { status?: string; blocker?: string | null };
  const authorizationExpiry = shape.authorizationExpiry as {
    status?: string;
    expiresAt?: string | null;
    secondsRemaining?: number | null;
  };
  const overlay = await runtimeEnv.AUTH_CACHE.get<AuthCacheRecord>(AUTH_CACHE_KEY, "json");
  const overlayActive = Boolean(
    overlay?.authorization &&
      typeof overlay.expiresAt === "number" &&
      overlay.expiresAt > Date.now(),
  );
  const ready = readiness?.status === "ready";
  return json(
    {
      status: ready ? "ready" : "degraded",
      ingestionReadiness: readiness,
      authorizationExpiry: {
        status: authorizationExpiry?.status ?? "unknown",
        expiresAt: authorizationExpiry?.expiresAt ?? null,
        ttlSeconds:
          typeof authorizationExpiry?.secondsRemaining === "number"
            ? authorizationExpiry.secondsRemaining
            : null,
      },
      hasCfClearance: shape.hasCfClearance,
      hasCfBm: shape.hasCfBm,
      hasSessionCookie: shape.hasSessionCookie,
      authCacheOverlay: {
        active: overlayActive,
        updatedAt: overlay?.updatedAt ?? null,
        expiresAt: overlay?.expiresAt ? new Date(overlay.expiresAt).toISOString() : null,
      },
      timestamp: new Date().toISOString(),
    },
    ready ? 200 : 503,
  );
}

function upstreamAuthDiagnostics(env: Env): Record<string, unknown> {
  const cookieNames = splitCookieHeader(fantasy402CookieHeader(env, ""))
    .map((cookie) => cookieName(cookie))
    .filter((name): name is string => Boolean(name));
  const hasCookieName = (name: string) => cookieNames.some((cookie) => cookie.toLowerCase() === name.toLowerCase());
  const hasSessionCookie = cookieNames.some((name) => !isCloudflareCookieName(name));
  const hasAuthorization = Boolean(normalizeAuthorization(env.FANTASY402_AUTHORIZATION));
  const authorizationExpiry = authorizationExpiryDiagnostics(env.FANTASY402_AUTHORIZATION);
  const hasUsableAuthorization = hasAuthorization && authorizationExpiry.status !== "expired";
  const hasCfClearance = hasCookieName("cf_clearance");
  const hasCfBm = hasCookieName("__cf_bm");
  const ready = hasUsableAuthorization && hasCfClearance && hasCfBm;
  return {
    hasAuthorization,
    authorizationExpiry,
    hasCookie: cookieNames.length > 0,
    hasSessionCookie,
    hasCfClearance,
    hasCfBm,
    cookieNames,
    browserHeaderCount: observedBrowserHeaderCount(env.FANTASY402_BROWSER_HEADERS_JSON),
    browserHeaders: observedBrowserHeaderPresence(env.FANTASY402_BROWSER_HEADERS_JSON, optionalHeaderFallback(env)),
    ingestionReadiness: {
      status: ready ? "ready" : "blocked",
      blocker: ready
        ? null
        : authorizationExpiry.status === "expired"
          ? `authorization JWT expired at ${authorizationExpiry.expiresAt}`
          : "missing bearer authorization plus cf_clearance and __cf_bm; bearer must be unexpired",
    },
  };
}

function hasBearerCloudflareAuth(env: Env): boolean {
  const cookieHeader = fantasy402CookieHeader(env, "");
  const authorization = normalizeAuthorization(env.FANTASY402_AUTHORIZATION) ?? undefined;
  return Boolean(
    authorization &&
      authorizationExpiryDiagnostics(authorization).status !== "expired" &&
      cookieHeaderHasName(cookieHeader, "cf_clearance") &&
      cookieHeaderHasName(cookieHeader, "__cf_bm"),
  );
}

function cookieHeaderHasName(value: string, name: string): boolean {
  return splitCookieHeader(value)
    .map((cookie) => cookieName(cookie))
    .some((cookie) => cookie?.toLowerCase() === name.toLowerCase());
}

function isCloudflareCookieName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "cf_clearance" || normalized === "__cf_bm";
}

function hasNonCloudflareCookieHeader(value: string | undefined): boolean {
  return splitCookieHeader(value ?? "")
    .map((cookie) => cookieName(cookie))
    .some((name) => Boolean(name && !isCloudflareCookieName(name)));
}

function observedBrowserHeaderCount(rawJson: string | undefined): number {
  return Object.keys(parseObservedBrowserHeaders(rawJson)).length;
}

function observedBrowserHeaderPresence(
  rawJson: string | undefined,
  fallback: { userAgent?: string; referer?: string } = {},
): HeaderPresenceDiagnostics {
  const headers = parseObservedBrowserHeaders(rawJson);
  if (fallback.userAgent && !headers["user-agent"]) headers["user-agent"] = fallback.userAgent;
  if (fallback.referer && !headers.referer) headers.referer = fallback.referer;
  const present = EXPECTED_BROWSER_HEADER_NAMES.filter((name) => hasEnvValue(headers[name]));
  const missing = EXPECTED_BROWSER_HEADER_NAMES.filter((name) => !hasEnvValue(headers[name]));
  return { present, missing, count: present.length, complete: missing.length === 0 };
}

function optionalHeaderFallback(env: Env): { userAgent?: string; referer?: string } {
  const fallback: { userAgent?: string; referer?: string } = {};
  if (env.FANTASY402_USER_AGENT) fallback.userAgent = env.FANTASY402_USER_AGENT;
  if (env.FANTASY402_REFERER) fallback.referer = env.FANTASY402_REFERER;
  return fallback;
}

function browserHeaderPresenceFromHeaders(headers: Record<string, string>): HeaderPresenceDiagnostics {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) normalized[name.toLowerCase()] = value;
  const present = EXPECTED_BROWSER_HEADER_NAMES.filter((name) => hasEnvValue(normalized[name]));
  const missing = EXPECTED_BROWSER_HEADER_NAMES.filter((name) => !hasEnvValue(normalized[name]));
  return { present, missing, count: present.length, complete: missing.length === 0 };
}

function parseObservedBrowserHeaders(rawJson: string | undefined): Record<string, string> {
  if (typeof rawJson !== "string" || rawJson.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) headers[name.toLowerCase()] = value.trim();
    }
    return headers;
  } catch {
    return {};
  }
}

function archiveKey(endpointSegment: string, date: string, id: string): string {
  return `${R2_ARCHIVE_PREFIX}/${endpointSegment}/${date}/${id}.json`;
}

function normalizeArchivePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, "");
  if (trimmed === R2_ARCHIVE_PREFIX || trimmed.startsWith(`${R2_ARCHIVE_PREFIX}/`)) return trimmed;
  return R2_ARCHIVE_PREFIX;
}

function cleanPathSegment(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(trimmed)) return null;
  return trimmed;
}

function cleanMetadataValue(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(trimmed)) return null;
  return trimmed;
}

function cleanAlertSeverity(value: string | null): "info" | "warning" | "critical" | null {
  return value === "info" || value === "warning" || value === "critical" ? value : null;
}

function cleanAlertType(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(trimmed)) return null;
  return trimmed;
}

function cleanAlertMessage(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 500);
}

function cleanSearchText(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  if (!/^[\w .:/?&=%-]+$/.test(trimmed)) return null;
  return trimmed;
}

function parseJsonString(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function validDate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return Number.isNaN(Date.parse(`${trimmed}T00:00:00.000Z`)) ? null : trimmed;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isAuthorized(request: Request, env: Env): boolean {
  const token = authToken(env);
  if (!token) return false;
  return request.headers.get("Authorization") === `Bearer ${token}`;
}

function hasEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}

function authToken(env: Env): string | undefined {
  return env.INGESTION_TRIGGER_TOKEN || env.ARCHIVE_AUTH_TOKEN;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function safeJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return await request.json<Record<string, unknown>>();
  } catch {
    return null;
  }
}

const DEFAULT_DASHBOARD_URL = "https://fantasy402-dashboard-5q6.pages.dev";

function dashboardUrl(env: Env): string {
  const configured = env.FANTASY402_DASHBOARD_URL?.trim();
  return configured && isHttpUrl(configured) ? configured : DEFAULT_DASHBOARD_URL;
}

function prefersHtml(request: Request): boolean {
  const accept = request.headers.get("Accept") ?? "";
  if (!accept.includes("text/html")) return false;
  const htmlQ = qualityValue(accept, "text/html");
  const jsonQ = qualityValue(accept, "application/json");
  return htmlQ >= jsonQ;
}

function qualityValue(accept: string, mime: string): number {
  const parts = accept.split(",").map((part) => part.trim());
  for (const part of parts) {
    const [type, ...params] = part.split(";").map((piece) => piece.trim());
    if (type !== mime) continue;
    const qParam = params.find((param) => param.startsWith("q="));
    if (!qParam) return 1;
    const q = Number.parseFloat(qParam.slice(2));
    return Number.isFinite(q) ? q : 1;
  }
  return 0;
}

function workerRoot(env: Env, request: Request): Response {
  if (prefersHtml(request)) {
    return workerRootHtml(env);
  }
  return workerRootJson(env);
}

function workerRootJson(env: Env): Response {
  const dashboard = dashboardUrl(env);
  return json(
    {
      service: env.WORKER_NAME,
      environment: env.ENVIRONMENT,
      message: "Fantasy402 ingestion API. Use Bearer auth for protected routes.",
      links: {
        dashboard,
        health: "/health",
        authHealth: "/auth/health",
        archiveViewer: "/archive/viewer",
        endpoints: "/endpoints",
        upstreamEndpoints: "/upstream-endpoints",
      },
    },
    200,
  );
}

function workerRootHtml(env: Env): Response {
  const dashboard = dashboardUrl(env);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(env.WORKER_NAME)}</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f8fafc; color: #111827; }
    main { max-width: 720px; margin: 0 auto; padding: 32px 24px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    p { margin: 0 0 20px; color: #475569; line-height: 1.5; }
    ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
    a { display: block; padding: 14px 16px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #0f172a; text-decoration: none; }
    a:hover { border-color: #94a3b8; background: #f1f5f9; }
    a strong { display: block; margin-bottom: 4px; }
    a span { font-size: 13px; color: #64748b; }
    .primary { background: #0f172a; color: #fff; border-color: #0f172a; }
    .primary span { color: #cbd5e1; }
    .meta { margin-top: 24px; font-size: 13px; color: #64748b; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(env.WORKER_NAME)}</h1>
    <p>Ingestion and query API for Fantasy402. Protected routes require <code>Authorization: Bearer …</code>.</p>
    <ul>
      <li><a class="primary" href="${escapeHtml(dashboard)}"><strong>Monitoring dashboard</strong><span>Live wagers, charts, endpoints, logs</span></a></li>
      <li><a href="/health"><strong>Health</strong><span>Worker, D1, Durable Object, upstream probe</span></a></li>
      <li><a href="/auth/health"><strong>Auth health</strong><span>Sanitized ingestion auth readiness (public)</span></a></li>
      <li><a href="/archive/viewer"><strong>Archive viewer</strong><span>Browse R2 ingestion archives</span></a></li>
    </ul>
    <p class="meta">Environment: <code>${escapeHtml(env.ENVIRONMENT)}</code> · API discovery: <code>GET /</code> with <code>Accept: application/json</code></p>
  </main>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function archiveViewer(): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fantasy402 Archive Viewer</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f8fafc; color: #111827; }
    main { max-width: 1180px; margin: 0 auto; padding: 24px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
    h1 { font-size: 24px; margin: 0; }
    .controls { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(150px, 220px) minmax(130px, 180px) minmax(120px, 160px) 92px 104px; gap: 8px; margin-bottom: 16px; }
    input, button, textarea, select { font: inherit; border: 1px solid #cbd5e1; border-radius: 6px; padding: 9px 10px; background: #fff; color: #111827; }
    button { cursor: pointer; background: #0f172a; color: white; border-color: #0f172a; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; }
    th { background: #eef2f7; color: #334155; font-weight: 650; }
    tr:hover td { background: #f8fafc; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
    .layout { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr); gap: 16px; align-items: start; }
    .panel { border: 1px solid #e2e8f0; background: #fff; border-radius: 6px; overflow: hidden; }
    .panel h2 { font-size: 14px; margin: 0; padding: 10px 12px; background: #eef2f7; border-bottom: 1px solid #e2e8f0; }
    pre { margin: 0; padding: 12px; min-height: 460px; max-height: 720px; overflow: auto; font-size: 12px; line-height: 1.45; white-space: pre-wrap; }
    .status { min-height: 20px; font-size: 13px; color: #475569; }
    .error { color: #b91c1c; }
    .screenshot-wrap { padding: 12px; border-bottom: 1px solid #e2e8f0; }
    .screenshot-wrap img { display: block; width: 100%; max-height: 520px; object-fit: contain; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
    .screenshot-wrap[hidden] { display: none; }
    .mini-card { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; padding: 12px; border-bottom: 1px solid #e2e8f0; }
    .metric { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; background: #f8fafc; min-width: 0; }
    .metric b { display: block; font-size: 12px; color: #475569; margin-bottom: 4px; }
    .metric span { overflow-wrap: anywhere; font-size: 13px; }
    .badges { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px; border-bottom: 1px solid #e2e8f0; }
    .badge { border-radius: 999px; padding: 4px 9px; font-size: 12px; font-weight: 700; background: #e2e8f0; color: #334155; }
    .badge.critical { background: #fee2e2; color: #991b1b; }
    .badge.warning { background: #fef3c7; color: #92400e; }
    .badge.info { background: #dbeafe; color: #1e40af; }
    @media (max-width: 900px) { .controls, .layout { grid-template-columns: 1fr; } header { align-items: flex-start; flex-direction: column; } }
    @media (prefers-color-scheme: dark) {
      body { background: #0b1020; color: #e5e7eb; }
      input, textarea, select, table, .panel { background: #111827; color: #e5e7eb; border-color: #334155; }
      th, .panel h2 { background: #1f2937; color: #e5e7eb; border-color: #334155; }
      tr:hover td { background: #172033; }
      td, th { border-color: #334155; }
      .screenshot-wrap { border-color: #334155; }
      .screenshot-wrap img { background: #0b1020; border-color: #334155; }
      .mini-card, .badges { border-color: #334155; }
      .metric { background: #172033; border-color: #334155; }
      .metric b { color: #cbd5e1; }
      button { background: #e5e7eb; color: #111827; border-color: #e5e7eb; }
      .status { color: #cbd5e1; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Fantasy402 Archive Viewer</h1>
      <div class="status" id="status">Enter a bearer token to list archived R2 objects.</div>
    </header>
    <section class="controls">
      <input id="prefix" value="fantasy402/" aria-label="Archive prefix">
      <input id="endpoint" placeholder="Endpoint" aria-label="Endpoint filter">
      <input id="date" type="date" aria-label="Archive date filter">
      <input id="archiveType" placeholder="Archive type" aria-label="Archive type filter">
      <input id="token" type="password" autocomplete="off" placeholder="Bearer token" aria-label="Bearer token">
      <input id="limit" type="number" min="1" max="1000" value="50" aria-label="Limit">
      <button id="list">List</button>
    </section>
    <section class="layout">
      <div class="panel">
        <h2>Objects</h2>
        <table>
          <thead><tr><th>Key</th><th>Size</th><th>Uploaded</th><th>Class</th></tr></thead>
          <tbody id="objects"></tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Preview</h2>
        <pre id="preview"></pre>
      </div>
    </section>
    <section class="panel" style="margin-top: 16px;">
      <h2>Scan Verdicts</h2>
      <div class="controls" style="grid-template-columns: minmax(260px, 1fr) 120px 1fr; margin: 12px;">
        <input id="scanNowUrl" value="https://fantasy402.com" aria-label="Manual scan URL">
        <button id="scanNow">Scan Now</button>
        <div class="status" id="scanNowStatus"></div>
      </div>
      <div class="controls" style="grid-template-columns: minmax(160px, 1fr) 132px 140px 140px 96px 120px 1fr; margin: 12px;">
        <input id="scanUrlContains" placeholder="URL contains" aria-label="Scan URL contains">
        <select id="scanMalicious" aria-label="Malicious filter">
          <option value="">Any verdict</option>
          <option value="false">Clean</option>
          <option value="true">Malicious</option>
        </select>
        <input id="scanSince" type="date" aria-label="Scan since date">
        <input id="scanUntil" type="date" aria-label="Scan until date">
        <input id="scanLimit" type="number" min="1" max="100" value="20" aria-label="Scan limit">
        <button id="loadScans">Load Scans</button>
        <div class="status" id="scanStatus"></div>
      </div>
      <div class="controls" style="grid-template-columns: 120px 150px 140px 1fr; margin: 12px;">
        <input id="summaryDays" type="number" min="1" max="90" value="7" aria-label="Summary window days">
        <input id="tlsWarningDays" type="number" min="1" max="90" value="7" aria-label="TLS warning days">
        <button id="loadScanSummary">Load Summary</button>
        <div class="status" id="summaryStatus"></div>
      </div>
      <pre id="scanSummary"></pre>
      <pre id="scans"></pre>
      <div class="screenshot-wrap" id="scanScreenshotWrap" hidden>
        <img id="scanScreenshot" alt="Latest selected scan screenshot">
      </div>
      <div class="mini-card" id="scanNetworkCard" hidden></div>
      <div class="controls" style="grid-template-columns: 130px 1fr; margin: 12px;">
        <button id="loadScanHar" disabled>Load HAR</button>
        <div class="status" id="scanHarStatus"></div>
      </div>
      <pre id="scanNetworkSummary"></pre>
      <pre id="scanHar"></pre>
      <pre id="scanDetail"></pre>
    </section>
    <section class="panel" style="margin-top: 16px;">
      <h2>Diagnostics</h2>
      <div class="controls" style="grid-template-columns: 160px 1fr; margin: 12px;">
        <button id="loadDiagnostics">Load Diagnostics</button>
        <div class="status" id="diagnosticsStatus"></div>
      </div>
      <div class="mini-card" id="authStateCard" hidden></div>
      <pre id="diagnostics"></pre>
    </section>
    <section class="panel" style="margin-top: 16px;">
      <h2>Alerts</h2>
      <div class="controls" style="grid-template-columns: 150px 180px 96px 120px 140px 150px 1fr; margin: 12px;">
        <select id="alertSeverity" aria-label="Alert severity filter">
          <option value="">Any severity</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
        <input id="alertType" placeholder="Alert type" aria-label="Alert type filter">
        <input id="alertLimit" type="number" min="1" max="100" value="20" aria-label="Alert limit">
        <button id="loadAlerts">Load Alerts</button>
        <button id="testAlert">Test Alert</button>
        <button id="testPolicyAlert">Test Policy</button>
        <div class="status" id="alertsStatus"></div>
      </div>
      <div class="badges" id="alertBadges"></div>
      <pre id="alertsSummary"></pre>
      <pre id="alerts"></pre>
    </section>
  </main>
  <script>
    const statusEl = document.querySelector("#status");
    const objectsEl = document.querySelector("#objects");
    const previewEl = document.querySelector("#preview");
    const scanStatusEl = document.querySelector("#scanStatus");
    const scanNowStatusEl = document.querySelector("#scanNowStatus");
    const scansEl = document.querySelector("#scans");
    const scanDetailEl = document.querySelector("#scanDetail");
    const scanScreenshotWrapEl = document.querySelector("#scanScreenshotWrap");
    const scanScreenshotEl = document.querySelector("#scanScreenshot");
    const scanHarButtonEl = document.querySelector("#loadScanHar");
    const scanHarStatusEl = document.querySelector("#scanHarStatus");
    const scanHarEl = document.querySelector("#scanHar");
    const scanNetworkSummaryEl = document.querySelector("#scanNetworkSummary");
    const scanNetworkCardEl = document.querySelector("#scanNetworkCard");
    const summaryStatusEl = document.querySelector("#summaryStatus");
    const scanSummaryEl = document.querySelector("#scanSummary");
    const diagnosticsStatusEl = document.querySelector("#diagnosticsStatus");
    const diagnosticsEl = document.querySelector("#diagnostics");
    const authStateCardEl = document.querySelector("#authStateCard");
    const alertsStatusEl = document.querySelector("#alertsStatus");
    const alertBadgesEl = document.querySelector("#alertBadges");
    const alertsSummaryEl = document.querySelector("#alertsSummary");
    const alertsEl = document.querySelector("#alerts");
    let scanScreenshotUrl = null;

    document.querySelector("#list").addEventListener("click", listObjects);
    document.querySelector("#scanNow").addEventListener("click", scanNow);
    document.querySelector("#loadScans").addEventListener("click", listScans);
    scanHarButtonEl.addEventListener("click", () => loadScanHar(scanHarButtonEl.dataset.scanId));
    document.querySelector("#loadScanSummary").addEventListener("click", loadScanSummary);
    document.querySelector("#loadDiagnostics").addEventListener("click", loadDiagnostics);
    document.querySelector("#loadAlerts").addEventListener("click", loadAlerts);
    document.querySelector("#testAlert").addEventListener("click", testAlert);
    document.querySelector("#testPolicyAlert").addEventListener("click", testPolicyAlert);

    async function listObjects() {
      const prefix = document.querySelector("#prefix").value || "fantasy402/";
      const limit = document.querySelector("#limit").value || "50";
      const endpoint = document.querySelector("#endpoint").value;
      const date = document.querySelector("#date").value;
      const archiveType = document.querySelector("#archiveType").value;
      const token = document.querySelector("#token").value;
      if (!token) return setStatus("Missing bearer token.", true);
      setStatus("Loading archive objects...");
      previewEl.textContent = "";
      objectsEl.textContent = "";
      const params = new URLSearchParams({ prefix, limit });
      if (endpoint) params.set("endpoint", endpoint);
      if (date) params.set("date", date);
      if (archiveType) params.set("archiveType", archiveType);
      const response = await fetch("/archive?" + params.toString(), {
        headers: { Authorization: "Bearer " + token }
      });
      const body = await response.json();
      if (!response.ok) return setStatus(body.message || "Archive list failed.", true);
      for (const object of body.objects) {
        const row = document.createElement("tr");
        const keyCell = document.createElement("td");
        const openButton = document.createElement("button");
        const keyCode = document.createElement("code");
        openButton.dataset.key = object.key;
        openButton.textContent = "Open";
        openButton.addEventListener("click", () => openObject(object.key));
        keyCode.textContent = object.key;
        keyCell.append(openButton, " ", keyCode);
        const sizeCell = document.createElement("td");
        const uploadedCell = document.createElement("td");
        const storageClassCell = document.createElement("td");
        sizeCell.textContent = String(object.size);
        uploadedCell.textContent = object.uploaded;
        storageClassCell.textContent = object.storageClass;
        row.append(keyCell, sizeCell, uploadedCell, storageClassCell);
        objectsEl.append(row);
      }
      setStatus("Loaded " + body.objects.length + " object(s)." + (body.truncated ? " More results are available with cursor paging." : ""));
    }

    async function openObject(key) {
      const token = document.querySelector("#token").value;
      if (!token) return setStatus("Missing bearer token.", true);
      setStatus("Loading " + key + "...");
      const response = await fetch("/archive/object?key=" + encodeURIComponent(key), {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      if (!response.ok) {
        setStatus("Archive object load failed.", true);
        previewEl.textContent = text;
        return;
      }
      setStatus("Loaded " + key + ".");
      try {
        previewEl.textContent = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        previewEl.textContent = text;
      }
    }

    async function scanNow() {
      const token = document.querySelector("#token").value;
      const url = document.querySelector("#scanNowUrl").value || "https://fantasy402.com";
      if (!token) return setScanNowStatus("Missing bearer token.", true);
      setScanNowStatus("Submitting scan...");
      scanDetailEl.textContent = "";
      clearScanHar();
      clearScanScreenshot();
      const response = await fetch("/trigger-scan", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ url })
      });
      const text = await response.text();
      if (!response.ok) {
        setScanNowStatus("Scan failed.", true);
        scanDetailEl.textContent = text;
        return;
      }
      const body = parseJsonOrText(text);
      setScanNowStatus("Scan completed: " + body.scanId + ".");
      scanDetailEl.textContent = JSON.stringify(body, null, 2);
      await Promise.all([loadScanSummary(), listScans(), loadAlerts()]);
    }

    async function loadDiagnostics() {
      const token = document.querySelector("#token").value;
      if (!token) return setDiagnosticsStatus("Missing bearer token.", true);
      setDiagnosticsStatus("Loading diagnostics...");
      diagnosticsEl.textContent = "";
      authStateCardEl.hidden = true;
      authStateCardEl.textContent = "";
      const [runtimeResponse, scannerResponse] = await Promise.all([
        fetch("/diagnostics", {
          headers: { Authorization: "Bearer " + token }
        }),
        fetch("/scanner/diagnostics", {
          headers: { Authorization: "Bearer " + token }
        })
      ]);
      const runtimeText = await runtimeResponse.text();
      const scannerText = await scannerResponse.text();
      if (!runtimeResponse.ok || !scannerResponse.ok) {
        setDiagnosticsStatus("Diagnostics failed.", true);
        diagnosticsEl.textContent = JSON.stringify({
          runtime: parseJsonOrText(runtimeText),
          scanner: parseJsonOrText(scannerText)
        }, null, 2);
        return;
      }
      const diagnostics = {
        runtime: parseJsonOrText(runtimeText),
        scanner: parseJsonOrText(scannerText)
      };
      renderAuthState(diagnostics.runtime);
      const authBlocked = diagnostics.runtime.upstreamAuthShape?.ingestionReadiness?.status === "blocked";
      const scannerBlocked = diagnostics.scanner.status !== "ready";
      setDiagnosticsStatus(authBlocked ? "Loaded diagnostics with ingestion auth blocker." : scannerBlocked ? "Loaded diagnostics with scanner issues." : "Loaded diagnostics.", authBlocked || scannerBlocked);
      diagnosticsEl.textContent = JSON.stringify(diagnostics, null, 2);
    }

    function renderAuthState(runtime) {
      const shape = runtime.upstreamAuthShape || {};
      const readiness = shape.ingestionReadiness || {};
      const items = [
        ["Ingestion", readiness.status || "unknown"],
        ["Bearer", shape.hasAuthorization ? "present" : "missing"],
        ["App session", shape.hasSessionCookie ? "present" : "missing"],
        ["cf_clearance", shape.hasCfClearance ? "present" : "missing"],
        ["__cf_bm", shape.hasCfBm ? "present" : "missing"],
        ["Browser headers", String(shape.browserHeaderCount ?? 0)],
      ];
      authStateCardEl.textContent = "";
      for (const [label, value] of items) {
        const item = document.createElement("div");
        const labelEl = document.createElement("b");
        const valueEl = document.createElement("span");
        item.className = "metric";
        labelEl.textContent = label;
        valueEl.textContent = value;
        item.append(labelEl, valueEl);
        authStateCardEl.appendChild(item);
      }
      if (readiness.blocker) {
        const item = document.createElement("div");
        const labelEl = document.createElement("b");
        const valueEl = document.createElement("span");
        item.className = "metric";
        labelEl.textContent = "Blocker";
        valueEl.textContent = readiness.blocker;
        item.append(labelEl, valueEl);
        authStateCardEl.appendChild(item);
      }
      authStateCardEl.hidden = false;
    }

    async function loadAlerts() {
      const token = document.querySelector("#token").value;
      const severity = document.querySelector("#alertSeverity").value;
      const type = document.querySelector("#alertType").value;
      const limit = document.querySelector("#alertLimit").value || "20";
      if (!token) return setAlertsStatus("Missing bearer token.", true);
      setAlertsStatus("Loading alerts...");
      alertsEl.textContent = "";
      alertsSummaryEl.textContent = "";
      const params = new URLSearchParams({ limit });
      if (severity) params.set("severity", severity);
      if (type) params.set("type", type);
      const response = await fetch("/alerts?" + params.toString(), {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      if (!response.ok) {
        setAlertsStatus("Alerts failed.", true);
        alertsEl.textContent = text;
        return;
      }
      const body = parseJsonOrText(text);
      setAlertsStatus("Loaded " + (body.events ? body.events.length : 0) + " alert(s).", false);
      alertsEl.textContent = JSON.stringify(body, null, 2);
      await loadAlertsSummary();
    }

    async function loadAlertsSummary() {
      const token = document.querySelector("#token").value;
      if (!token) return;
      const response = await fetch("/alerts/summary?days=7", {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      const body = parseJsonOrText(text);
      if (response.ok) renderAlertBadges(body);
      alertsSummaryEl.textContent = response.ok ? JSON.stringify(body, null, 2) : text;
    }

    function renderAlertBadges(summary) {
      alertBadgesEl.textContent = "";
      const severities = summary.bySeverity || {};
      for (const severity of ["critical", "warning", "info"]) {
        const count = severities[severity] || 0;
        const badge = document.createElement("span");
        badge.className = "badge " + severity;
        badge.textContent = severity + ": " + count;
        alertBadgesEl.append(badge);
      }
    }

    async function testAlert() {
      const token = document.querySelector("#token").value;
      if (!token) return setAlertsStatus("Missing bearer token.", true);
      setAlertsStatus("Creating synthetic alert...");
      const response = await fetch("/alerts/test", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          severity: "warning",
          message: "Synthetic alert test from archive viewer"
        })
      });
      const text = await response.text();
      if (!response.ok) {
        setAlertsStatus("Synthetic alert failed.", true);
        alertsEl.textContent = text;
        return;
      }
      setAlertsStatus("Synthetic alert created.");
      alertsEl.textContent = JSON.stringify(parseJsonOrText(text), null, 2);
      await loadAlerts();
    }

    async function testPolicyAlert() {
      const token = document.querySelector("#token").value;
      if (!token) return setAlertsStatus("Missing bearer token.", true);
      setAlertsStatus("Creating synthetic policy alerts...");
      const response = await fetch("/alerts/policy-test", {
        method: "POST",
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      if (!response.ok) {
        setAlertsStatus("Synthetic policy alert failed.", true);
        alertsEl.textContent = text;
        return;
      }
      setAlertsStatus("Synthetic policy alerts created.");
      alertsEl.textContent = JSON.stringify(parseJsonOrText(text), null, 2);
      await loadAlerts();
    }

    function parseJsonOrText(text) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    async function listScans() {
      const token = document.querySelector("#token").value;
      const limit = document.querySelector("#scanLimit").value || "20";
      const urlContains = document.querySelector("#scanUrlContains").value;
      const malicious = document.querySelector("#scanMalicious").value;
      const since = document.querySelector("#scanSince").value;
      const until = document.querySelector("#scanUntil").value;
      if (!token) return setScanStatus("Missing bearer token.", true);
      setScanStatus("Loading scan verdicts...");
      scansEl.textContent = "";
      scanDetailEl.textContent = "";
      clearScanHar();
      const params = new URLSearchParams({ limit });
      if (urlContains) params.set("urlContains", urlContains);
      if (malicious) params.set("malicious", malicious);
      if (since) params.set("since", since);
      if (until) params.set("until", until);
      const response = await fetch("/scans?" + params.toString(), {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      if (!response.ok) {
        setScanStatus("Scan list failed.", true);
        scansEl.textContent = text;
        clearScanHar();
        clearScanScreenshot();
        return;
      }
      setScanStatus("Loaded scan verdicts.");
      try {
        const body = JSON.parse(text);
        scansEl.textContent = JSON.stringify(body, null, 2);
        if (body.results && body.results.length > 0) {
          await loadScanDetail(body.results[0].scan_id);
        }
      } catch {
        scansEl.textContent = text;
      }
    }

    async function loadScanSummary() {
      const token = document.querySelector("#token").value;
      const days = document.querySelector("#summaryDays").value || "7";
      const tlsWarningDays = document.querySelector("#tlsWarningDays").value || "7";
      if (!token) return setSummaryStatus("Missing bearer token.", true);
      setSummaryStatus("Loading scan summary...");
      scanSummaryEl.textContent = "";
      const params = new URLSearchParams({ days, tlsWarningDays });
      const response = await fetch("/scans/summary?" + params.toString(), {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      if (!response.ok) {
        setSummaryStatus("Scan summary failed.", true);
        scanSummaryEl.textContent = text;
        return;
      }
      const body = parseJsonOrText(text);
      const hasIssue = body.status === "alert" || body.status === "warning";
      setSummaryStatus("Loaded scan summary: " + body.status + ".", hasIssue);
      scanSummaryEl.textContent = JSON.stringify(body, null, 2);
    }

    async function loadScanDetail(scanId) {
      const token = document.querySelector("#token").value;
      if (!token || !scanId) return;
      scanDetailEl.textContent = "";
      clearScanHar();
      clearScanScreenshot();
      const response = await fetch("/scans/detail?includeRaw=true&scanId=" + encodeURIComponent(scanId), {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      try {
        scanDetailEl.textContent = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        scanDetailEl.textContent = text;
      }
      if (response.ok) {
        scanHarButtonEl.disabled = false;
        scanHarButtonEl.dataset.scanId = scanId;
        setScanHarStatus("Loading network summary...");
        await Promise.all([loadScanScreenshot(scanId), loadScanNetworkSummary(scanId)]);
      }
    }

    async function loadScanScreenshot(scanId) {
      const token = document.querySelector("#token").value;
      if (!token || !scanId) return;
      const response = await fetch("/scans/screenshot?scanId=" + encodeURIComponent(scanId), {
        headers: { Authorization: "Bearer " + token }
      });
      if (!response.ok) return;
      const blob = await response.blob();
      clearScanScreenshot();
      scanScreenshotUrl = URL.createObjectURL(blob);
      scanScreenshotEl.src = scanScreenshotUrl;
      scanScreenshotWrapEl.hidden = false;
    }

    async function loadScanNetworkSummary(scanId) {
      const token = document.querySelector("#token").value;
      if (!token || !scanId) return;
      scanNetworkSummaryEl.textContent = "";
      const response = await fetch("/scans/network-summary?scanId=" + encodeURIComponent(scanId), {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      if (!response.ok) {
        setScanHarStatus("Network summary failed.", true);
        scanNetworkSummaryEl.textContent = text;
        scanNetworkCardEl.hidden = true;
        return;
      }
      setScanHarStatus("Loaded network summary. HAR available for selected scan.");
      const body = parseJsonOrText(text);
      renderNetworkCard(body.summary);
      scanNetworkSummaryEl.textContent = JSON.stringify(body, null, 2);
    }

    function renderNetworkCard(summary) {
      scanNetworkCardEl.textContent = "";
      if (!summary) {
        scanNetworkCardEl.hidden = true;
        return;
      }
      const topHost = Object.entries(summary.byHost || {})[0] || ["none", 0];
      const slowest = (summary.slowestRequests || [])[0] || {};
      const cards = [
        ["Requests", String(summary.totalRequests || 0)],
        ["Top host", topHost[0] + " (" + topHost[1] + ")"],
        ["Slowest", (slowest.host || "none") + " " + Math.round(slowest.timeMs || 0) + "ms"]
      ];
      for (const card of cards) {
        const el = document.createElement("div");
        const labelEl = document.createElement("b");
        const valueEl = document.createElement("span");
        el.className = "metric";
        labelEl.textContent = card[0];
        valueEl.textContent = card[1];
        el.append(labelEl, valueEl);
        scanNetworkCardEl.append(el);
      }
      scanNetworkCardEl.hidden = false;
    }

    async function loadScanHar(scanId) {
      const token = document.querySelector("#token").value;
      if (!token || !scanId) return setScanHarStatus("Missing bearer token or scan.", true);
      setScanHarStatus("Loading HAR...");
      scanHarEl.textContent = "";
      const response = await fetch("/scans/har?scanId=" + encodeURIComponent(scanId), {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      if (!response.ok) {
        setScanHarStatus("HAR load failed.", true);
        scanHarEl.textContent = text;
        return;
      }
      setScanHarStatus("Loaded HAR.");
      try {
        scanHarEl.textContent = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        scanHarEl.textContent = text;
      }
    }

    function clearScanScreenshot() {
      if (scanScreenshotUrl) URL.revokeObjectURL(scanScreenshotUrl);
      scanScreenshotUrl = null;
      scanScreenshotEl.removeAttribute("src");
      scanScreenshotWrapEl.hidden = true;
    }

    function clearScanHar() {
      scanHarButtonEl.disabled = true;
      delete scanHarButtonEl.dataset.scanId;
      scanHarEl.textContent = "";
      scanNetworkCardEl.hidden = true;
      scanNetworkSummaryEl.textContent = "";
      setScanHarStatus("");
    }

    function setStatus(message, error = false) {
      statusEl.textContent = message;
      statusEl.className = error ? "status error" : "status";
    }

    function setScanStatus(message, error = false) {
      scanStatusEl.textContent = message;
      scanStatusEl.className = error ? "status error" : "status";
    }

    function setScanNowStatus(message, error = false) {
      scanNowStatusEl.textContent = message;
      scanNowStatusEl.className = error ? "status error" : "status";
    }

    function setScanHarStatus(message, error = false) {
      scanHarStatusEl.textContent = message;
      scanHarStatusEl.className = error ? "status error" : "status";
    }

    function setSummaryStatus(message, error = false) {
      summaryStatusEl.textContent = message;
      summaryStatusEl.className = error ? "status error" : "status";
    }

    function setDiagnosticsStatus(message, error = false) {
      diagnosticsStatusEl.textContent = message;
      diagnosticsStatusEl.className = error ? "status error" : "status";
    }

    function setAlertsStatus(message, error = false) {
      alertsStatusEl.textContent = message;
      alertsStatusEl.className = error ? "status error" : "status";
    }
  </script>
</body>
</html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src blob:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof UpstreamHttpError) return error.retryable;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// ── Worker API Endpoint Manifest ──────────────────────────────

interface WorkerEndpointEntry {
  path: string;
  method: string;
  refreshMs: number | string;
  description: string;
}

const WORKER_API_ZONE: Record<string, string> = {
  '/summary': 'query',
  '/chart-aggregates': 'query',
  '/upstream-endpoints': 'upstream',
  '/bet-ticker-wagers': 'query',
  '/performance': 'query',
  '/graded-wagers': 'query',
  '/prop-wagers': 'query',
  '/pending-wagers': 'query',
  '/position-data': 'query',
  '/authorizations': 'query',
  '/players': 'query',
  '/search-customers': 'query',
  '/customer-profile': 'query',
  '/weekly-figures': 'query',
  '/customer-activity': 'query',
  '/customer-activity-search': 'query',
  '/alert-rules': 'auth',
  '/alert-log': 'auth',
  '/alerts': 'auth',
  '/alerts/summary': 'auth',
  '/health': 'auth',
  '/diagnostics': 'auth',
  '/runs': 'auth',
  '/runs/endpoints': 'auth',
  '/endpoints': 'auth',
  '/endpoint-status': 'auth',
  '/scans': 'network',
  '/scanner/diagnostics': 'network',
  '/live-wagers': 'do',
  '/ingest/local': 'ingestion',
  '/ingest/local/plan': 'ingestion',
  '/ingest/catalog-status': 'ingestion',
  '/ingest/local/bootstrap': 'ingestion',
  '/ingestion/advance-cursor': 'ingestion',
  '/ingest/sync': 'ingestion',
  '/trigger': 'ingestion',
  '/refresh-auth': 'cookie',
  '/update-cookies': 'cookie',
  '/upstream-cookies-status': 'cookie',
};

const WORKER_API_ROUTES: WorkerEndpointEntry[] = [
  { path: '/summary', method: 'GET', description: 'Aggregated daily KPIs', refreshMs: 15000 },
  { path: '/chart-aggregates', method: 'GET', description: 'Server-side chart buckets (hourly, types, agents)', refreshMs: 15000 },
  { path: '/upstream-endpoints', method: 'GET', description: 'Fantasy402 upstream API catalog + configured flags', refreshMs: 60000 },
  { path: '/bet-ticker-wagers', method: 'GET', description: 'Live wager ticker (polling fallback)', refreshMs: 5000 },
  { path: '/performance', method: 'GET', description: 'Agent performance metrics', refreshMs: 15000 },
  { path: '/graded-wagers', method: 'GET', description: 'Graded wager results', refreshMs: 10000 },
  { path: '/prop-wagers', method: 'GET', description: 'Prop bet wagers', refreshMs: 15000 },
  { path: '/pending-wagers', method: 'GET', description: 'Live pending wagers (Manager/getPending)', refreshMs: 15000 },
  { path: '/position-data', method: 'GET', description: 'Sport-level position data', refreshMs: 30000 },
  { path: '/authorizations', method: 'GET', description: 'Agent authorization permissions', refreshMs: 30000 },
  { path: '/players', method: 'GET', description: 'Player list', refreshMs: 30000 },
  { path: '/search-customers', method: 'GET', description: 'Search player_agents by login, name, or customer id', refreshMs: 30000 },
  { path: '/customer-profile', method: 'GET', description: 'Customer profile (D1 seeded facets + live Manager calls; includes sources catalog)', refreshMs: 30000 },
  { path: '/customer-profile/seed', method: 'POST', description: 'Seed customer_profile_facets from Manager (getInfoPlayer, crypto, mail, teaser)', refreshMs: 'manual' },
  { path: '/agent-performance-live', method: 'GET', description: 'Live Manager/getAgentPerformance (CP, CPS, CPV, G)', refreshMs: 30000 },
  { path: '/weekly-figures', method: 'GET', description: 'Agent weekly figure lite snapshots', refreshMs: 30000 },
  { path: '/customer-activity', method: 'GET', description: 'Customer web logs + wagers for a login', refreshMs: 30000 },
  { path: '/customer-activity-search', method: 'POST', description: 'Search players for activity monitor', refreshMs: 30000 },
  { path: '/alert-rules', method: 'GET', description: 'List alert rules', refreshMs: 30000 },
  { path: '/alert-rules', method: 'POST', description: 'Create alert rule', refreshMs: 'manual' },
  { path: '/alert-rules', method: 'PATCH', description: 'Toggle alert rule', refreshMs: 'manual' },
  { path: '/alert-rules', method: 'DELETE', description: 'Delete alert rule', refreshMs: 'manual' },
  { path: '/alert-log', method: 'GET', description: 'Alert breach history', refreshMs: 30000 },
  { path: '/alerts', method: 'GET', description: 'Recent alerts', refreshMs: 30000 },
  { path: '/alerts/summary', method: 'GET', description: 'Alert summary counts', refreshMs: 30000 },
  { path: '/health', method: 'GET', description: 'Worker, D1, DO, upstream health', refreshMs: 30000 },
  { path: '/auth/health', method: 'GET', description: 'Sanitized upstream auth readiness', refreshMs: 30000 },
  { path: '/diagnostics', method: 'GET', description: 'Full system diagnostics', refreshMs: 60000 },
  { path: '/runs', method: 'GET', description: 'Ingestion run history', refreshMs: 30000 },
  { path: '/runs/endpoints', method: 'GET', description: 'Per-run endpoint details', refreshMs: 30000 },
  { path: '/endpoints', method: 'GET', description: 'API endpoint manifest', refreshMs: 60000 },
  { path: '/endpoint-status', method: 'GET', description: 'Endpoint health status', refreshMs: 30000 },
  { path: '/scans', method: 'GET', description: 'Scan history', refreshMs: 30000 },
  { path: '/scanner/diagnostics', method: 'GET', description: 'Scanner subsystem diagnostics', refreshMs: 60000 },
  { path: '/live-wagers', method: 'GET', description: 'SSE real-time wager stream', refreshMs: 'realtime' },
  { path: '/ingest/local', method: 'POST', description: 'Local browser ingestion', refreshMs: 'manual' },
  { path: '/ingest/local/plan', method: 'GET', description: 'Next batch fetch specs for local browser ingest', refreshMs: 'manual' },
  { path: '/ingest/catalog-status', method: 'GET', description: 'Catalog online/pending counts + backfill progress', refreshMs: 'manual' },
  { path: '/ingest/local/bootstrap', method: 'GET', description: 'Cached browser auth for local/auto-runner ingest', refreshMs: 'manual' },
  { path: '/ingestion/advance-cursor', method: 'POST', description: 'Advance batched ingestion cursor after local upload', refreshMs: 'manual' },
  { path: '/ingest/sync', method: 'POST', description: 'Refresh auth and trigger ingestion in one call', refreshMs: 'manual' },
  { path: '/trigger', method: 'POST', description: 'Run next ingestion batch', refreshMs: 'manual' },
  { path: '/refresh-auth', method: 'POST', description: 'Refresh upstream auth token', refreshMs: 'manual' },
  { path: '/update-cookies', method: 'POST', description: 'Update browser cookies', refreshMs: 'manual' },
  { path: '/upstream-cookies-status', method: 'GET', description: 'Cookie health status', refreshMs: 60000 },
];

function listWorkerEndpoints(): { count: number; routes: (WorkerEndpointEntry & { zone: string })[] } {
  const routes = WORKER_API_ROUTES.map((r) => ({
    ...r,
    zone: WORKER_API_ZONE[r.path] || 'worker',
  }));
  return { count: routes.length, routes };
}

async function getRouteLatencyForRun(
  env: Env,
  runId: string | null | undefined,
): Promise<Array<Record<string, unknown>>> {
  if (!runId) return [];

  const snapshots = await env.ANALYTICS_DB.prepare(
    `SELECT endpoint_key, path,
            CAST(AVG(duration_ms) AS INTEGER) AS avg_duration_ms,
            MAX(duration_ms) AS max_duration_ms,
            COUNT(*) AS samples
     FROM api_snapshots
     WHERE run_id = ? AND duration_ms IS NOT NULL
     GROUP BY endpoint_key
     ORDER BY avg_duration_ms DESC
     LIMIT 25`,
  )
    .bind(runId)
    .all();

  const failureLatency = await env.ANALYTICS_DB.prepare(
    `SELECT endpoint_key, path,
            CAST(AVG(duration_ms) AS INTEGER) AS avg_duration_ms,
            MAX(duration_ms) AS max_duration_ms,
            COUNT(*) AS samples
     FROM endpoint_failures
     WHERE run_id = ? AND duration_ms IS NOT NULL
     GROUP BY endpoint_key`,
  )
    .bind(runId)
    .all();

  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of snapshots.results ?? []) {
    const key = String(row.endpoint_key ?? row.path ?? "");
    if (key) byKey.set(key, row);
  }
  for (const row of failureLatency.results ?? []) {
    const key = String(row.endpoint_key ?? row.path ?? "");
    if (!key || byKey.has(key)) continue;
    byKey.set(key, { ...row, source: "failure" });
  }

  return [...byKey.values()].sort(
    (a, b) => Number(b.avg_duration_ms ?? 0) - Number(a.avg_duration_ms ?? 0),
  );
}

async function getEndpointStatus(env: Env): Promise<Response> {
  const latestRun = await env.ANALYTICS_DB.prepare(
    `SELECT id, started_at, finished_at, status, endpoints_requested, endpoints_succeeded, endpoints_failed, error_message
     FROM ingestion_runs
     ORDER BY started_at DESC
     LIMIT 1`,
  ).all();

  const failures = await env.ANALYTICS_DB.prepare(
    `SELECT endpoint_key, path, COUNT(*) as failure_count, MAX(failed_at) as last_failure
     FROM endpoint_failures
     WHERE failed_at > datetime('now', '-1 day')
     GROUP BY endpoint_key
     ORDER BY failure_count DESC`,
  ).all();

  const latestRaw = latestRun.results?.[0] as Record<string, unknown> | undefined;
  const runMeta = parseRunMeta(typeof latestRaw?.error_message === "string" ? latestRaw.error_message : null);
  const latest = latestRaw
    ? {
        ...latestRaw,
        endpoints_skipped: runMeta.skipped,
        skip_note: runMeta.note ?? null,
      }
    : null;
  const routeLatency = await getRouteLatencyForRun(env, typeof latestRaw?.id === "string" ? latestRaw.id : undefined);

  let ingestion: Awaited<ReturnType<typeof getIngestionPlan>> | null = null;
  try {
    ingestion = await getIngestionPlan(env);
  } catch {
    ingestion = null;
  }

  const failureBreakdown = await readFailureBreakdown(env);

  return json(
    {
      worker: 'ok',
      latestRun: latest,
      recentFailures: failures.results ?? [],
      recentFailuresNote: "Historical D1 endpoint_failures (last 24h). Routes may still be online via local ingest.",
      failureBreakdown24h: failureBreakdown,
      routeLatency,
      ingestion,
      timestamp: new Date().toISOString(),
    },
    200,
  );
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function isEndpointKey(key: string): key is EndpointKey {
  return Object.prototype.hasOwnProperty.call(ENDPOINTS, key);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scanErrorResponse(error: unknown): Record<string, unknown> {
  if (error instanceof UrlScannerApiError) {
    return {
      status: "failed",
      subsystem: "cloudflare-url-scanner",
      stage: error.stage,
      method: error.method,
      path: error.path,
      httpStatus: error.status,
      code: error.code,
      message: error.apiMessage,
      retryable: error.retryable,
    };
  }

  return {
    status: "failed",
    subsystem: "cloudflare-url-scanner",
    message: errorMessage(error),
  };
}

async function materializeSecretBindings(env: Env): Promise<Env> {
  const resolved = { ...env } as Record<string, unknown>;
  for (const key of [
    "FANTASY402_USERNAME",
    "FANTASY402_PASSWORD",
    "FANTASY402_AGENT_ID",
    "FANTASY402_SESSION_COOKIE",
    "FANTASY402_CF_CLEARANCE",
    "FANTASY402_CF_BM",
    "FANTASY402_AUTHORIZATION",
    "FANTASY402_USER_AGENT",
    "FANTASY402_REFERER",
    "FANTASY402_BROWSER_HEADERS_JSON",
    "CLOUDFLARE_API_TOKEN",
  ] as const) {
    const value = resolved[key];
    if (isSecretsStoreBinding(value)) {
      try {
        resolved[key] = await value.get();
      } catch (error) {
        console.error("[Config] Secrets Store binding resolution failed", {
          binding: key,
          message: errorMessage(error),
        });
        throw new Error(`Secrets Store binding ${key} failed to resolve: ${errorMessage(error)}`);
      }
    }
  }
  const materialized = resolved as unknown as Env;
  return applyAuthCacheOverlay(materialized);
}

async function applyAuthCacheOverlay(env: Env): Promise<Env> {
  if (!env.AUTH_CACHE) return env;
  const cached = await env.AUTH_CACHE.get<AuthCacheRecord>(AUTH_CACHE_KEY, "json");
  if (!cached || cached.expiresAt <= Date.now()) return env;
  const overlaid = { ...env };
  if (cached.authorization) overlaid.FANTASY402_AUTHORIZATION = cached.authorization;
  if (cached.sessionCookie) overlaid.FANTASY402_SESSION_COOKIE = cached.sessionCookie;
  if (cached.cfClearance) overlaid.FANTASY402_CF_CLEARANCE = cached.cfClearance;
  if (cached.cfBm) overlaid.FANTASY402_CF_BM = cached.cfBm;
  if (cached.browserHeadersJson) overlaid.FANTASY402_BROWSER_HEADERS_JSON = cached.browserHeadersJson;
  if (cached.userAgent) overlaid.FANTASY402_USER_AGENT = cached.userAgent;
  if (cached.referer) overlaid.FANTASY402_REFERER = cached.referer;
  if (cached.customerId) overlaid.FANTASY402_CUSTOMER_ID = cached.customerId;
  return overlaid;
}

function isSecretsStoreBinding(value: unknown): value is SecretsStoreBinding {
  return typeof value === "object" && value !== null && typeof (value as SecretsStoreBinding).get === "function";
}

function scannerSecretResolutionError(error: unknown, env: Env): Record<string, unknown> {
  return {
    status: "degraded",
    subsystem: "cloudflare-url-scanner",
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    tokenShape: {
      configured: Boolean(env.CLOUDFLARE_API_TOKEN),
      length: 0,
      trimmedLength: 0,
      asciiOnly: true,
      hasWhitespace: false,
      hasLeadingOrTrailingWhitespace: false,
      looksLikeFormattedOutput: false,
    },
    checks: [],
    failure: {
      stage: "secret-store",
      code: null,
      message: errorMessage(error),
    },
  };
}

function safeError(error: unknown, context: Record<string, string>): Record<string, string> {
  return {
    ...context,
    message: errorMessage(error),
  };
}
