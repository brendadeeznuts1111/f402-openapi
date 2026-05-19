import { z } from "zod";

/** Treat empty query values as undefined (avoids coerce → `"undefined"`). */
export function emptyToUndefined(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  if (trimmed === "" || trimmed === "undefined" || trimmed === "null") return undefined;
  return trimmed;
}

const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const requiredTrimmed = z.preprocess(
  (v) => String(v ?? "").trim(),
  z.string().min(1),
);

/** Manager sends literal `Invalid date` when no range is selected. */
export const managerDateParamSchema = z.union([
  z.literal("Invalid date"),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD or omit for manager default"),
]);

const isoDateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const agentPerformanceTypeSchema = z.enum(["CP", "CPS", "CPV", "G"]);

export const freePlaySchema = z.enum(["Y", "N"]);

function refineDateRange(
  data: { start_date?: string; end_date?: string; start?: string; end?: string },
  ctx: z.RefinementCtx,
  label = "date range",
): void {
  const start = data.start_date ?? data.start;
  const end = data.end_date ?? data.end;
  if (!start || !end) return;
  if (start === "Invalid date" || end === "Invalid date") return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return;
  if (start > end) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${label}: start must be on or before end`,
      path: ["end_date"],
    });
  }
}

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  since: optionalTrimmed,
  agent_id: optionalTrimmed,
});

export const wagerQuerySchema = paginationSchema.extend({
  wager_type: optionalTrimmed,
  min_amount: z.coerce.number().int().min(0).optional(),
  max_amount: z.coerce.number().int().min(0).optional(),
});

export const localIngestItemSchema = z.object({
  endpointKey: z.string().min(1),
  httpStatus: z.number().int().min(100).max(599).default(200),
  data: z.unknown(),
  capturedAt: z.string().optional(),
});

export const localIngestSchema = z.object({
  results: z.array(localIngestItemSchema).min(1).max(25),
  advanceCursor: z.boolean().optional(),
});

export const refreshAuthSchema = z.object({
  authorization: z.string().min(1).optional(),
  sessionCookie: z.string().optional(),
  cfClearance: z.string().optional(),
  cfBm: z.string().optional(),
  browserHeadersJson: z.string().optional(),
  browserHeaders: z.unknown().optional(),
  userAgent: z.string().optional(),
  referer: z.string().optional(),
  customerId: z.string().optional(),
  expiresInSeconds: z.number().int().positive().max(28800).optional(),
  cookieHeader: z.string().optional(),
  cookie: z.string().optional(),
  cookies: z.string().optional(),
});

export const performanceQuerySchema = paginationSchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const authorizationsQuerySchema = paginationSchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const updateCookiesSchema = z.object({
  cf_clearance: z.string().min(1),
  __cf_bm: z.string().min(1),
});

export const chartAggregatesSchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24),
});

export const searchCustomersQuerySchema = z.object({
  q: requiredTrimmed.pipe(z.string().min(2, "q must be at least 2 characters")),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  agent_id: optionalTrimmed,
});

export const customerActivityQuerySchema = z.object({
  login: z.preprocess(
    (v) => String(v ?? "").trim(),
    z.string().min(1, "login is required"),
  ),
  hours: z.coerce.number().int().min(1).max(168).default(24),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const customerActivitySearchBodySchema = z.object({
  q: requiredTrimmed.pipe(z.string().min(2, "q must be at least 2 characters")),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const customerProfileQueryBaseSchema = z
  .object({
    customer_id: optionalTrimmed,
    id: optionalTrimmed,
    login: optionalTrimmed,
    live: z.preprocess(emptyToUndefined, z.string().optional()),
    period: z.coerce.number().int().min(0).max(52).default(0),
    start_date: z.preprocess(emptyToUndefined, isoDateOnly.optional()),
    end_date: z.preprocess(emptyToUndefined, isoDateOnly.optional()),
    report_type: z.coerce.number().int().min(0).max(9).default(2),
    line_type: z.coerce.number().int().min(0).max(9).default(2),
    analysis_limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .superRefine((data, ctx) => {
    const customerId = (data.customer_id ?? data.id ?? "").trim();
    if (!customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "customer_id or id is required",
        path: ["customer_id"],
      });
    }
    refineDateRange(data, ctx, "analysis");
  })
  .transform((data) => {
    const customerId = (data.customer_id ?? data.id ?? "").trim();
    const liveRaw = (data.live ?? "1").toLowerCase();
    const wantLive = liveRaw !== "0" && liveRaw !== "false" && liveRaw !== "no";
    return {
      ...data,
      customerId,
      wantLive,
    };
  });

export const customerProfileQuerySchema = customerProfileQueryBaseSchema;

export const customerProfileSeedSchema = z.object({
  customer_id: z.preprocess(
    emptyToUndefined,
    z
      .string({ error: "customer_id is required" })
      .min(1, "customer_id is required")
      .max(32, "customer_id too long"),
  ),
  login: optionalTrimmed,
});

export const agentPerformanceLiveQuerySchema = z
  .object({
    agent_id: optionalTrimmed,
    type: z.preprocess(
      (v) => String(v ?? "CP").trim().toUpperCase(),
      agentPerformanceTypeSchema,
    ),
    free_play: z.preprocess(
      (v) => String(v ?? "Y").trim().toUpperCase(),
      freePlaySchema,
    ),
    store: optionalTrimmed,
    sport: z.preprocess(emptyToUndefined, z.string().optional()),
    subsport: z.preprocess(emptyToUndefined, z.string().optional()),
    period: z.coerce.number().int().min(-1).max(99).default(-1),
    wager_type: z.preprocess(emptyToUndefined, z.string().optional()),
    bet_type: z.preprocess(emptyToUndefined, z.string().optional()),
    tipo: z.coerce.number().int().default(-1),
    start: z.preprocess(emptyToUndefined, managerDateParamSchema.optional()),
    end: z.preprocess(emptyToUndefined, managerDateParamSchema.optional()),
    start_date: z.preprocess(emptyToUndefined, isoDateOnly.optional()),
    end_date: z.preprocess(emptyToUndefined, isoDateOnly.optional()),
    limit: z.coerce.number().int().min(1).max(2000).default(500),
  })
  .superRefine((data, ctx) => refineDateRange(data, ctx, "performance"))
  .transform((data) => {
    const start = data.start_date ?? data.start ?? "Invalid date";
    const end = data.end_date ?? data.end ?? "Invalid date";
    return { ...data, start, end };
  });

export const pendingWagersQuerySchema = z
  .object({
    date: z.preprocess(emptyToUndefined, isoDateOnly.optional()),
    agent_id: optionalTrimmed,
    customer_id: optionalTrimmed,
    wager_type: optionalTrimmed,
    sort: optionalTrimmed,
    type_sort: optionalTrimmed,
    week: z.coerce.number().int().min(0).max(52).optional(),
    login: optionalTrimmed,
    sport: optionalTrimmed,
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .superRefine((data, ctx) => {
    if (data.wager_type && !/^[SPML]?$/i.test(data.wager_type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "wager_type must be S, P, M, L, or empty",
        path: ["wager_type"],
      });
    }
  });

export type Pagination = z.infer<typeof paginationSchema>;
export type WagerQuery = z.infer<typeof wagerQuerySchema>;
export type LocalIngestItem = z.infer<typeof localIngestItemSchema>;
export type LocalIngest = z.infer<typeof localIngestSchema>;
export type RefreshAuthInput = z.infer<typeof refreshAuthSchema>;
export type PerformanceQuery = z.infer<typeof performanceQuerySchema>;
export type AuthorizationsQuery = z.infer<typeof authorizationsQuerySchema>;
export type CustomerProfileQuery = z.infer<typeof customerProfileQuerySchema>;
export type AgentPerformanceLiveQuery = z.infer<typeof agentPerformanceLiveQuerySchema>;
export type SearchCustomersQuery = z.infer<typeof searchCustomersQuerySchema>;
export type CustomerActivityQuery = z.infer<typeof customerActivityQuerySchema>;

const pathSegmentSchema = z.preprocess(
  emptyToUndefined,
  z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
);

const isoDateOptional = z.preprocess(emptyToUndefined, isoDateOnly.optional());

const searchTextOptional = z.preprocess((v) => {
  const s = emptyToUndefined(v);
  if (s === undefined) return undefined;
  const trimmed = String(s).trim();
  if (!trimmed || trimmed.length > 120) return undefined;
  return /^[\w .:/?&=%-]+$/.test(trimmed) ? trimmed : undefined;
}, z.string().optional());

const agentIdFilterSchema = z.preprocess((v) => {
  const s = emptyToUndefined(v);
  if (s === undefined) return undefined;
  const trimmed = String(s).trim();
  if (!trimmed || trimmed.length > 40) return undefined;
  return /^[A-Za-z0-9_*.-]+$/.test(trimmed) ? trimmed : undefined;
}, z.string().optional());

export const optionalAlertSeveritySchema = z.preprocess((v) => {
  const s = emptyToUndefined(v);
  if (s === undefined) return undefined;
  return s === "info" || s === "warning" || s === "critical" ? s : undefined;
}, z.enum(["info", "warning", "critical"]).optional());

export const optionalAlertTypeSchema = z.preprocess((v) => {
  const s = emptyToUndefined(v);
  if (s === undefined) return undefined;
  const trimmed = String(s).trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(trimmed) ? trimmed : undefined;
}, z.string().optional());

export const ALERT_RULE_METRICS = [
  "wager_amount",
  "agent_volume",
  "agent_loss",
  "agent_wager_count",
  "total_volume",
  "win_rate",
] as const;

export const ALERT_RULE_OPERATORS = ["gt", "lt", "gte", "lte"] as const;

export const alertRuleMetricSchema = z.enum(ALERT_RULE_METRICS);
export const alertRuleOperatorSchema = z.enum(ALERT_RULE_OPERATORS);

export const optionalAlertRuleMetricSchema = z.preprocess((v) => {
  const s = emptyToUndefined(v);
  if (s === undefined) return undefined;
  return ALERT_RULE_METRICS.includes(s as (typeof ALERT_RULE_METRICS)[number]) ? s : undefined;
}, alertRuleMetricSchema.optional());

export const optionalUuidSchema = z.preprocess((v) => {
  const s = emptyToUndefined(v);
  if (s === undefined) return undefined;
  const trimmed = String(s).trim();
  return z.string().uuid().safeParse(trimmed).success ? trimmed : undefined;
}, z.string().uuid().optional());

export const uuidQuerySchema = z.object({
  id: z.preprocess(
    (v) => String(v ?? "").trim(),
    z.string().uuid("Missing or invalid ?id= parameter"),
  ),
});

export const runIdQuerySchema = z.object({
  runId: z.preprocess(
    (v) => String(v ?? "").trim(),
    z.string().uuid("runId must be a valid UUID"),
  ),
});

export const scanIdQuerySchema = z.object({
  scanId: z.preprocess(
    (v) => String(v ?? "").trim(),
    z.string().uuid("Invalid scanId"),
  ),
});

export const scanCompareQuerySchema = z.object({
  baseScanId: z.preprocess(
    (v) => String(v ?? "").trim(),
    z.string().uuid("Invalid scan ID"),
  ),
  compareScanId: z.preprocess(
    (v) => String(v ?? "").trim(),
    z.string().uuid("Invalid scan ID"),
  ),
});

export const scanDetailQuerySchema = scanIdQuerySchema.extend({
  includeRaw: z
    .preprocess((v) => v === "true" || v === "1", z.boolean())
    .optional()
    .default(false),
});

export const playersQuerySchema = z.object({
  customer_id: optionalTrimmed,
  agent_id: optionalTrimmed,
  q: optionalTrimmed,
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const positionDataQuerySchema = paginationSchema.extend({
  sport_id: z.coerce.number().int().min(0).default(0),
});

export const weeklyFiguresQuerySchema = z.object({
  agent_id: optionalTrimmed,
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const dashboardSummaryQuerySchema = z.object({
  mode: z.preprocess(
    (v) => (String(v ?? "").trim() === "calendar" ? "calendar" : "rolling"),
    z.enum(["calendar", "rolling"]),
  ),
  days: z.coerce.number().int().min(1).max(90).default(1),
});

export const ingestionRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const alertEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  severity: optionalAlertSeveritySchema,
  type: optionalAlertTypeSchema,
});

export const alertEventsSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  severity: optionalAlertSeveritySchema,
  type: optionalAlertTypeSchema,
});

export const alertRulesListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const alertLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  rule_id: optionalUuidSchema,
  agent_id: agentIdFilterSchema,
  metric: optionalAlertRuleMetricSchema,
  severity: optionalAlertSeveritySchema,
});

export const archiveListQuerySchema = z.object({
  endpoint: pathSegmentSchema,
  date: isoDateOptional,
  archiveType: pathSegmentSchema,
  prefix: z.preprocess(emptyToUndefined, z.string().max(512).optional()),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  cursor: optionalTrimmed,
});

export const ARCHIVE_KEY_PREFIX = "fantasy402/";

export const archiveKeyQuerySchema = z
  .object({
    key: z.preprocess(
      (v) => String(v ?? "").trim(),
      z.string().min(1, "Missing key"),
    ),
  })
  .superRefine((data, ctx) => {
    if (!data.key.startsWith(ARCHIVE_KEY_PREFIX)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid key prefix",
        path: ["key"],
      });
    }
  });

export const scanListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  malicious: z.preprocess((v) => {
    const s = emptyToUndefined(v);
    if (s === undefined) return null;
    if (s === "true" || s === "1") return 1 as const;
    if (s === "false" || s === "0") return 0 as const;
    return null;
  }, z.union([z.literal(0), z.literal(1), z.null()]).default(null)),
  urlContains: searchTextOptional,
  since: isoDateOptional,
  until: isoDateOptional,
});

export const scanSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  tlsWarningDays: z.coerce.number().int().min(1).max(90).default(7),
});

export const createAlertRuleBodySchema = z
  .object({
    agent_id: agentIdFilterSchema,
    metric: alertRuleMetricSchema,
    operator: alertRuleOperatorSchema,
    threshold: z.coerce.number().int().min(0),
    severity: optionalAlertSeveritySchema,
    enabled: z.boolean().optional(),
  })
  .transform((data) => ({
    agent_id: data.agent_id ?? "*",
    metric: data.metric,
    operator: data.operator,
    threshold: data.threshold,
    severity: data.severity ?? "warning",
    enabled: data.enabled !== false,
  }));

export const patchAlertRuleBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    severity: optionalAlertSeveritySchema,
    threshold: z.coerce.number().int().min(0).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.enabled === undefined && data.severity === undefined && data.threshold === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "No valid fields to update. Supported: enabled, severity, threshold",
        path: ["enabled"],
      });
    }
  });

export const syntheticAlertBodySchema = z.object({
  severity: optionalAlertSeveritySchema.default("warning"),
  message: z.preprocess(
    (v) => {
      if (typeof v !== "string") return "Synthetic alert test";
      const trimmed = v.trim();
      return trimmed ? trimmed.slice(0, 500) : "Synthetic alert test";
    },
    z.string(),
  ),
});
