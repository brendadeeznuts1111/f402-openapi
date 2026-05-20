/**
 * Zod schemas for typed dashboard sidebar navigation (24 tabs / 7 groups).
 */
import { z } from 'zod';

export const BADGE_VARIANTS = ['default', 'info', 'warning', 'critical', 'success'];

export const tabIdSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9-]*$/, 'tab id must be kebab-case');

export const navBadgeSchema = z.object({
  text: z.string().max(12),
  variant: z.enum(BADGE_VARIANTS),
});

export const navItemSchema = z.object({
  id: tabIdSchema,
  label: z.string().min(1).max(40),
  path: z.string().regex(/^\/dashboard\/[a-z0-9-]+$/, 'path must be /dashboard/{tab-id}'),
  viewId: z.string().optional(),
  openApiOperationId: z.string().optional(),
  workerApiPath: z.string().regex(/^\/[\w./-]+$/).optional(),
  badge: navBadgeSchema.optional(),
});

export const navGroupSchema = z.object({
  id: z.string().min(1).max(32).regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1).max(32),
  items: z.array(navItemSchema).min(1),
});

export const sidebarConfigSchema = z
  .object({
    version: z.literal(1),
    groups: z.array(navGroupSchema).min(1),
  })
  .superRefine((cfg, ctx) => {
    const ids = new Set();
    const paths = new Set();
    for (const group of cfg.groups) {
      for (const item of group.items) {
        if (ids.has(item.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate tab id: ${item.id}`,
            path: ['groups'],
          });
        }
        ids.add(item.id);
        if (paths.has(item.path)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate path: ${item.path}`,
            path: ['groups'],
          });
        }
        paths.add(item.path);
      }
    }
  });
