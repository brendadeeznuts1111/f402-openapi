/**
 * Dashboard Zod schemas — aligned with workers/fantasy402-ingestion/src/schemas.ts
 */
import { z } from 'zod';

export function emptyToUndefined(value) {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed === 'undefined' || trimmed === 'null') return undefined;
  return trimmed;
}

const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().min(1).optional());

export const customerIdSchema = z.preprocess(
  emptyToUndefined,
  z.string().min(1, 'customer_id is required').max(32),
);

export const loginSchema = z.preprocess(
  emptyToUndefined,
  z.string().min(1, 'login is required').max(64),
);

export const agentIdSchema = z.preprocess(emptyToUndefined, z
  .string()
  .regex(/^[A-Za-z0-9_*.-]+$/, 'invalid agent_id')
  .max(40));

export const isoDateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const agentPerformanceTypeSchema = z.enum(['CP', 'CPS', 'CPV', 'G']);
export const freePlaySchema = z.enum(['Y', 'N']);

export const searchCustomersQuerySchema = z.object({
  q: z.preprocess(
    (v) => String(v ?? '').trim(),
    z.string().min(2, 'q must be at least 2 characters'),
  ),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

export const pendingWagersFiltersSchema = z.object({
  date: z.preprocess(emptyToUndefined, isoDateOnlySchema.optional()),
  customer_id: z.preprocess((v) => String(v ?? '0').trim(), z.string().max(32)).default('0'),
  wager_type: z.preprocess((v) => String(v ?? '').trim().toUpperCase(), z.string().max(4)).default(''),
  sort: z.string().default('1'),
  type_sort: z.string().default('2'),
  week: z.coerce.number().int().min(0).max(52).default(0),
  login: optionalTrimmed.default(''),
  sport: optionalTrimmed.default(''),
  limit: z.coerce.number().int().min(1).max(500).default(200),
}).superRefine((data, ctx) => {
  if (data.wager_type && !/^[SPML]?$/.test(data.wager_type)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'wager_type must be S, P, M, L, or empty',
      path: ['wager_type'],
    });
  }
});

export const agentPerformanceFiltersSchema = z.object({
  type: z.preprocess(
    (v) => String(v ?? 'CP').trim().toUpperCase(),
    agentPerformanceTypeSchema,
  ),
  freePlay: z.preprocess(
    (v) => String(v ?? 'Y').trim().toUpperCase(),
    freePlaySchema,
  ),
  start: z.preprocess(emptyToUndefined, isoDateOnlySchema.optional()),
  end: z.preprocess(emptyToUndefined, isoDateOnlySchema.optional()),
});

export const customerProfilePathSchema = z.object({
  customerId: customerIdSchema,
  login: optionalTrimmed,
  period: z.coerce.number().int().min(0).max(52).default(0),
  analysis: z
    .object({
      start: z.preprocess(emptyToUndefined, isoDateOnlySchema.optional()),
      end: z.preprocess(emptyToUndefined, isoDateOnlySchema.optional()),
      reportType: z.coerce.number().int().min(0).max(9).default(2),
      lineType: z.coerce.number().int().min(0).max(9).default(2),
    })
    .optional(),
});

export const wagerLinkSchema = z.object({
  ticketNumber: z.union([z.string(), z.number()]).optional(),
  login: optionalTrimmed,
  customerId: optionalTrimmed,
});

export const customerNavSchema = z.object({
  customerId: customerIdSchema,
  login: optionalTrimmed,
});

export const agentNavSchema = z.object({
  agentId: agentIdSchema,
});

export function parseOrThrow(schema, value, label = 'input') {
  const result = schema.safeParse(value);
  if (!result.success) {
    const msg = result.error.issues[0]?.message ?? 'validation failed';
    throw new Error(`${label}: ${msg}`);
  }
  return result.data;
}

export function parseSafe(schema, value) {
  return schema.safeParse(value);
}
