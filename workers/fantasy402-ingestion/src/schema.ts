import { z } from "zod";

export const R2_ARCHIVE_PREFIX = "fantasy402";
export const R2_ARCHIVE_STORAGE_CLASS = "InfrequentAccess";
export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
export const NO_STORE_CACHE_CONTROL = "no-store, max-age=0";
export const WORKER_NO_STORE_CACHE_CONTROL = "no-store";

export const ENDPOINT_KEYS = [
  "getAgentPerformance",
  "getAgentBilling",
  "getEnterTransactions",
  "getPending",
  "Pending",
  "getPlayers",
  "getAddedInfo",
  "getCommunicationMessages",
  "getLineTypes",
  "getHeriarchy",
] as const;

export type EndpointKey = (typeof ENDPOINT_KEYS)[number];

export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export interface HealthResponse {
  status: "ok";
  environment: string;
}

export interface TriggerResponse {
  runId: string;
  status: "success" | "failed";
  endpointsSucceeded: number;
  endpointsFailed: number;
}

export interface ArchiveObjectSummary {
  key: string;
  etag: string;
  size: number;
  uploaded: string;
  storageClass: string;
  httpMetadata: Record<string, unknown>;
  customMetadata: Record<string, string>;
}

export interface ArchiveListResponse {
  objects: ArchiveObjectSummary[];
  truncated: boolean;
  cursor: string | null;
}

export interface ScanVerdictRow {
  scan_id: string;
  timestamp: string;
  url: string;
  malicious: 0 | 1;
  tls_valid_days: number | null;
  agent_readiness_level: number | null;
  scan_r2_key: string | null;
  screenshot_r2_key: string | null;
  har_r2_key: string | null;
}

export interface ScanListResponse {
  results: ScanVerdictRow[];
}

export interface ScanTriggerRequest {
  url?: string;
}

export interface ScanTriggerResponse {
  scanId: string;
  url: string;
  malicious: boolean;
  tlsValidDays: number | null;
}

export interface Settings {
  archivePrefix: string;
  archiveListLimit: number;
  scanListLimit: number;
  defaultScanUrl: string;
  screenshots: ("desktop" | "mobile")[];
  agentReadiness: boolean;
}

export const AGENT_IDS = ["Summarizer", "Router", "CodeGen"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const AGENT_CONFIGS = [
  {
    id: "Summarizer",
    capability: "Summarizes ingestion runs, archive objects, and scanner verdicts for operators.",
    invocation: "internal",
    route: "/api/v1/agents/Summarizer",
  },
  {
    id: "Router",
    capability: "Classifies operator intent and routes requests to ingestion, archive, scanner, or settings workflows.",
    invocation: "internal",
    route: "/api/v1/agents/Router",
  },
  {
    id: "CodeGen",
    capability: "Generates typed integration examples from the OpenAPI and Zod schema bundle.",
    invocation: "internal",
    route: "/api/v1/agents/CodeGen",
  },
] as const;

export const ERROR_CODES = {
  AUTH_001: {
    httpStatus: 401,
    message: "Unauthorized",
    description: "Bearer token is missing or invalid.",
    frontendHandling: "Prompt for a valid operator token and retry the request.",
  },
  VALIDATION_001: {
    httpStatus: 400,
    message: "Invalid request",
    description: "Request body or query parameters failed schema validation.",
    frontendHandling: "Show field-level validation details when available.",
  },
  NOT_FOUND_001: {
    httpStatus: 404,
    message: "Not Found",
    description: "The requested public route or archive object does not exist.",
    frontendHandling: "Show a not-found state and offer navigation back to a valid tab.",
  },
  RATE_LIMIT_002: {
    httpStatus: 429,
    message: "Too Many Requests",
    description: "Request rate exceeded the Worker guardrail.",
    frontendHandling: "Back off and retry after the displayed cooldown.",
  },
  UPSTREAM_001: {
    httpStatus: 502,
    message: "Upstream service failed",
    description: "Fantasy402 or Cloudflare URL Scanner returned an upstream error.",
    frontendHandling: "Show retry affordance and preserve operator context.",
  },
  LLM_TIMEOUT: {
    httpStatus: 504,
    message: "LLM agent timed out",
    description: "An LLM agent did not complete within the configured timeout.",
    frontendHandling: "Allow retry and note that no downstream state was committed.",
  },
  LLM_INVALID_RESPONSE: {
    httpStatus: 502,
    message: "LLM agent returned an invalid response",
    description: "Agent output failed the declared response schema.",
    frontendHandling: "Show agent failure state and log the request id for debugging.",
  },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

const stringRecordSchema = z.record(z.string());
const metadataRecordSchema = z.record(z.unknown());
const httpUrlSchema = z.string().url().refine((value) => isHttpUrl(value), {
  message: "URL must use http or https",
});

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  environment: z.string().min(1),
}).strict();

export const triggerResponseSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum(["success", "failed"]),
  endpointsSucceeded: z.number().int().min(0),
  endpointsFailed: z.number().int().min(0),
}).strict();

export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.enum(Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]]),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }).strict(),
}).strict();

export const archiveObjectSummarySchema = z.object({
  key: z.string().startsWith(`${R2_ARCHIVE_PREFIX}/`),
  etag: z.string().min(1),
  size: z.number().int().min(0),
  uploaded: z.string().datetime(),
  storageClass: z.string().min(1),
  httpMetadata: metadataRecordSchema,
  customMetadata: stringRecordSchema,
}).strict();

export const archiveListResponseSchema = z.object({
  objects: z.array(archiveObjectSummarySchema),
  truncated: z.boolean(),
  cursor: z.string().nullable(),
}).strict();

export const scanVerdictSchema = z.object({
  scan_id: z.string().min(1),
  timestamp: z.string().datetime(),
  url: httpUrlSchema,
  malicious: z.union([z.literal(0), z.literal(1)]),
  tls_valid_days: z.number().int().nullable(),
  agent_readiness_level: z.number().int().nullable(),
  scan_r2_key: z.string().startsWith(`${R2_ARCHIVE_PREFIX}/`).nullable(),
  screenshot_r2_key: z.string().startsWith(`${R2_ARCHIVE_PREFIX}/`).nullable(),
  har_r2_key: z.string().startsWith(`${R2_ARCHIVE_PREFIX}/`).nullable(),
}).strict();

export const scanListResponseSchema = z.object({
  results: z.array(scanVerdictSchema),
}).strict();

export const scanTriggerRequestSchema = z.object({
  url: httpUrlSchema.optional(),
}).strict();

export const scanTriggerResponseSchema = z.object({
  scanId: z.string().min(1),
  url: httpUrlSchema,
  malicious: z.boolean(),
  tlsValidDays: z.number().int().nullable(),
}).strict();

export const settingsSchema = z.object({
  archivePrefix: z.string().startsWith(`${R2_ARCHIVE_PREFIX}/`),
  archiveListLimit: z.number().int().min(1).max(1000),
  scanListLimit: z.number().int().min(1).max(100),
  defaultScanUrl: httpUrlSchema,
  screenshots: z.array(z.enum(["desktop", "mobile"])).min(1).max(2),
  agentReadiness: z.boolean(),
}).strict();

export const agentInputSchema = z.object({
  agentId: z.enum(AGENT_IDS),
  requestId: z.string().min(1),
  prompt: z.string().min(1),
  context: z.record(z.unknown()).default({}),
}).strict();

export const agentOutputSchema = z.object({
  agentId: z.enum(AGENT_IDS),
  requestId: z.string().min(1),
  success: z.boolean(),
  content: z.string(),
  usage: z.object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
  }).strict().optional(),
  error: z.object({
    code: z.enum(["LLM_TIMEOUT", "LLM_INVALID_RESPONSE"]),
    message: z.string().min(1),
  }).strict().optional(),
}).strict();

export const agentHealthSchema = z.object({
  agents: z.array(z.object({
    id: z.enum(AGENT_IDS),
    status: z.enum(["ok", "degraded"]),
    capability: z.string().min(1),
    invocation: z.enum(["public-route", "internal", "webhook"]),
  }).strict()),
}).strict();

export const DEFAULT_SETTINGS: Settings = {
  archivePrefix: `${R2_ARCHIVE_PREFIX}/`,
  archiveListLimit: 50,
  scanListLimit: 20,
  defaultScanUrl: "https://fantasy402.com",
  screenshots: ["desktop", "mobile"],
  agentReadiness: true,
};

export const routeSchemas = {
  HealthResponse: healthResponseSchema,
  TriggerResponse: triggerResponseSchema,
  ErrorResponse: errorResponseSchema,
  ArchiveObjectSummary: archiveObjectSummarySchema,
  ArchiveListResponse: archiveListResponseSchema,
  ScanVerdict: scanVerdictSchema,
  ScanListResponse: scanListResponseSchema,
  ScanTriggerRequest: scanTriggerRequestSchema,
  ScanTriggerResponse: scanTriggerResponseSchema,
  SettingsSchema: settingsSchema,
  AgentInput: agentInputSchema,
  AgentOutput: agentOutputSchema,
  AgentHealthResponse: agentHealthSchema,
} as const;

export function isEndpointKey(key: string): key is EndpointKey {
  return (ENDPOINT_KEYS as readonly string[]).includes(key);
}

export function archiveKey(endpointSegment: string, date: string, id: string): string {
  return `${R2_ARCHIVE_PREFIX}/${endpointSegment}/${date}/${id}.json`;
}

export function normalizeArchivePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, "");
  if (trimmed === R2_ARCHIVE_PREFIX || trimmed.startsWith(`${R2_ARCHIVE_PREFIX}/`)) return trimmed;
  return R2_ARCHIVE_PREFIX;
}

export function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function parseScanTriggerRequest(body: Record<string, unknown> | null): ScanTriggerRequest | ErrorResponse {
  if (body?.url === undefined || body.url === null || body.url === "") return {};
  const parsed = scanTriggerRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "VALIDATION_001",
        message: "Invalid URL",
        details: parsed.error.issues,
      },
    };
  }
  return parsed.data.url === undefined ? {} : { url: parsed.data.url };
}
