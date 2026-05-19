import { z } from "zod";

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100).catch(100),
  since: z.coerce.string().optional(),
  agent_id: z.coerce.string().optional(),
});

export const wagerQuerySchema = paginationSchema.extend({
  wager_type: z.coerce.string().optional(),
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

const nonEmptyString = z.string().min(1);
const optionalString = z.string().optional();

export const refreshAuthSchema = z.object({
  authorization: nonEmptyString.optional(),
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
  limit: z.coerce.number().int().min(1).max(200).default(20).catch(20),
});

export const authorizationsQuerySchema = paginationSchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(20).catch(20),
});

export const updateCookiesSchema = z.object({
  cf_clearance: z.string().min(1),
  __cf_bm: z.string().min(1),
});

export const chartAggregatesSchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24).catch(24),
});

export type Pagination = z.infer<typeof paginationSchema>;
export type WagerQuery = z.infer<typeof wagerQuerySchema>;
export type LocalIngestItem = z.infer<typeof localIngestItemSchema>;
export type LocalIngest = z.infer<typeof localIngestSchema>;
export type RefreshAuthInput = z.infer<typeof refreshAuthSchema>;
export type PerformanceQuery = z.infer<typeof performanceQuerySchema>;
export type AuthorizationsQuery = z.infer<typeof authorizationsQuerySchema>;
