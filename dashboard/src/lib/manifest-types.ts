import { z } from 'zod';

const nonEmptyString = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const cloudflareId = z.string().regex(/^[a-f0-9]{32}$/i, 'Expected a 32-character Cloudflare id');
const bindingName = z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'Expected an uppercase binding name');
const workerName = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Expected a Cloudflare worker/service name');
const tableName = z.string().regex(/^[a-z][a-z0-9_]*$/, 'Expected a database table name');
const columnName = z.string().regex(/^[a-z][A-Za-z0-9_]*$/, 'Expected a database column name');
const stringRecord = z.record(nonEmptyString, nonEmptyString);
const nonEmptyStringArray = z.array(nonEmptyString).nonempty();
const bindingArray = z.array(bindingName).nonempty();

export const PagesProjectSchema = z.strictObject({
  production_branch: nonEmptyString,
  preview_branches: nonEmptyStringArray,
  secrets: bindingArray,
  build_config: z.strictObject({
    build_command: nonEmptyString,
    output_dir: nonEmptyString,
    environment_variables: z.strictObject({
      common: stringRecord,
      production: stringRecord,
      preview: stringRecord,
    }),
    compatibility_date: isoDate,
    compatibility_flags: z.array(nonEmptyString),
    wrangler_config: z.strictObject({
      legacy_npm_compatibility: z.literal(true),
    }),
  }),
});

export const WorkerSchema = z.strictObject({
  name: workerName,
  script_name: workerName,
  main_module: nonEmptyString,
  environment_bindings: z.strictObject({
    d1_databases: bindingArray,
    r2_buckets: bindingArray,
    kv_namespaces: bindingArray,
    queues: bindingArray,
    durable_objects: bindingArray,
  }),
  secrets: bindingArray,
  environment_variables: z.strictObject({
    development: stringRecord,
    staging: stringRecord,
    production: stringRecord,
  }),
});

export const D1TableSchema = z.strictObject({
  name: tableName,
  columns: z.array(columnName).nonempty(),
  primary_key: z.union([columnName, z.array(columnName).nonempty()]),
  indexes: z.array(nonEmptyString).optional(),
});

export const D1DatabaseSchema = z.strictObject({
  binding: bindingName,
  database_name: nonEmptyString,
  tables: z.array(D1TableSchema).nonempty(),
});

export const R2BucketSchema = z.strictObject({
  binding: bindingName,
  bucket_name: nonEmptyString,
  purpose: nonEmptyString,
  public_url: z.string().url().optional(),
  lifecycle_rules: z.array(z.strictObject({
    prefix: nonEmptyString,
    days_to_expire: z.number().int().positive(),
  })),
});

export const KVNamespaceSchema = z.strictObject({
  binding: bindingName,
  namespace: nonEmptyString,
  purpose: nonEmptyString,
  ttl_seconds: z.number().int().positive(),
  keys: nonEmptyStringArray,
});

export const QueueSchema = z.strictObject({
  binding: bindingName,
  queue_name: workerName,
  purpose: nonEmptyString,
  max_retries: z.number().int().nonnegative(),
  retry_delay_seconds: z.number().positive(),
  visibility_timeout_seconds: z.number().positive(),
  consumer: workerName,
});

export const DurableObjectSchema = z.strictObject({
  binding: bindingName,
  class_name: nonEmptyString,
  script_name: workerName,
  purpose: nonEmptyString,
  alarms_enabled: z.boolean(),
  persistence: z.enum(['sqlite', 'none']),
});

export const RouteSchema = z.strictObject({
  domain: nonEmptyString,
  pattern: nonEmptyString,
  service: workerName,
  priority: z.number().int(),
});

export const RowMappingSchema = z.strictObject({
  name: nonEmptyString,
  source_table: tableName,
  source_db: bindingName,
  target_model: nonEmptyString,
  mapping: stringRecord,
  transformation: stringRecord.optional(),
});

const REQUIRED_D1_BINDINGS = ['DB_AGENTS', 'DB_TRANSACTIONS', 'DB_WAGERS'] as const;
const REQUIRED_PAGES_SECRETS = ['INGESTION_TRIGGER_TOKEN'] as const;
const REQUIRED_PAGES_CONSTANTS = ['FANTASY402_WORKER_UPSTREAM'] as const;

export const CloudflareSchema = z.strictObject({
  account_id: cloudflareId,
  zone_id: cloudflareId,
  pages_projects: z.strictObject({
    dashboard: PagesProjectSchema,
  }),
  workers: z.array(WorkerSchema).nonempty(),
  d1_databases: z.array(D1DatabaseSchema).nonempty(),
  r2_buckets: z.array(R2BucketSchema).nonempty(),
  kv_namespaces: z.array(KVNamespaceSchema).nonempty(),
  queues: z.array(QueueSchema),
  durable_objects: z.array(DurableObjectSchema),
  routes: z.array(RouteSchema).nonempty(),
  row_mappings: z.array(RowMappingSchema).nonempty(),
}).superRefine((cloudflare, ctx) => {
  const workerD1Bindings = new Set(
    cloudflare.workers.flatMap((worker) => worker.environment_bindings.d1_databases),
  );

  for (const binding of REQUIRED_D1_BINDINGS) {
    if (!workerD1Bindings.has(binding)) {
      ctx.addIssue({
        code: 'custom',
        path: ['workers'],
        message: `Missing D1 binding ${binding} in manifest.cloudflare.workers`,
      });
    }
  }

  const dashboardProject = cloudflare.pages_projects.dashboard;
  for (const secret of REQUIRED_PAGES_SECRETS) {
    if (!dashboardProject.secrets.includes(secret)) {
      ctx.addIssue({
        code: 'custom',
        path: ['pages_projects', 'dashboard', 'secrets'],
        message: `Missing Pages secret ${secret} for dashboard ingestion proxy`,
      });
    }
  }

  const commonVars = dashboardProject.build_config.environment_variables.common;
  const productionVars = dashboardProject.build_config.environment_variables.production;
  const previewVars = dashboardProject.build_config.environment_variables.preview;
  for (const constant of REQUIRED_PAGES_CONSTANTS) {
    if (!commonVars[constant] && !productionVars[constant] && !previewVars[constant]) {
      ctx.addIssue({
        code: 'custom',
        path: ['pages_projects', 'dashboard', 'build_config', 'environment_variables'],
        message: `Missing Pages constant ${constant} for dashboard ingestion proxy`,
      });
    }
  }

  const tableRefs = new Set<string>();
  for (const database of cloudflare.d1_databases) {
    for (const table of database.tables) {
      const tableRef = `${database.binding}.${table.name}`;
      if (tableRefs.has(tableRef)) {
        ctx.addIssue({
          code: 'custom',
          path: ['d1_databases'],
          message: `Duplicate D1 table reference ${tableRef}`,
        });
      }
      tableRefs.add(tableRef);
    }
  }

  cloudflare.row_mappings.forEach((mapping, index) => {
    const sourceRef = `${mapping.source_db}.${mapping.source_table}`;
    if (!tableRefs.has(sourceRef)) {
      ctx.addIssue({
        code: 'custom',
        path: ['row_mappings', index, 'source_table'],
        message: `Row mapping source table ${sourceRef} does not exist in manifest.cloudflare.d1_databases`,
      });
    }
  });
});

export const ManifestSchema = z.object({
  version: nonEmptyString,
  generated_at: z.string().datetime(),
  cloudflare: CloudflareSchema,
}).passthrough();

export type Manifest = z.infer<typeof ManifestSchema>;
export type Cloudflare = z.infer<typeof CloudflareSchema>;
