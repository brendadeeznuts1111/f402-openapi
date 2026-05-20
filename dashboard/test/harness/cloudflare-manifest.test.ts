import { describe, expect, it } from 'bun:test';
import manifest from '../../public/manifest.json';
import { CloudflareSchema } from '../../src/lib/manifest-types';

describe('Cloudflare manifest validation', () => {
  it('validates the entire cloudflare object', () => {
    const result = CloudflareSchema.safeParse(manifest.cloudflare);
    if (!result.success) console.error(result.error.flatten());
    expect(result.success).toBe(true);
  });

  it('ensures each D1 database has at least one table', () => {
    manifest.cloudflare.d1_databases.forEach((db) => {
      expect(db.tables.length).toBeGreaterThan(0);
      db.tables.forEach((table) => {
        expect(table.columns.length).toBeGreaterThan(0);
        expect(table.primary_key).toBeDefined();
      });
    });
  });

  it('ensures row mappings reference existing source tables', () => {
    const allTables = new Set(
      manifest.cloudflare.d1_databases.flatMap((db) =>
        db.tables.map((table) => `${db.binding}.${table.name}`),
      ),
    );

    manifest.cloudflare.row_mappings.forEach((mapping) => {
      const sourceRef = `${mapping.source_db}.${mapping.source_table}`;
      expect(allTables.has(sourceRef)).toBe(true);
    });
  });

  it('rejects missing required D1 bindings and dangling row mappings', () => {
    const broken = structuredClone(manifest.cloudflare);
    broken.workers[0].environment_bindings.d1_databases =
      broken.workers[0].environment_bindings.d1_databases.filter((binding) => binding !== 'DB_WAGERS');
    broken.row_mappings[0].source_table = 'missing_table';

    const result = CloudflareSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('Missing D1 binding DB_WAGERS in manifest.cloudflare.workers');
      expect(messages).toContain(
        'Row mapping source table DB_AGENTS.missing_table does not exist in manifest.cloudflare.d1_databases',
      );
    }
  });

  it('requires dashboard Pages ingestion proxy secrets, constants, and wrangler compatibility', () => {
    const missingProxyConfig = structuredClone(manifest.cloudflare);
    missingProxyConfig.pages_projects.dashboard.secrets = ['OTHER_SECRET'];
    delete missingProxyConfig.pages_projects.dashboard.build_config.environment_variables.common.FANTASY402_WORKER_UPSTREAM;

    const result = CloudflareSchema.safeParse(missingProxyConfig);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('Missing Pages secret INGESTION_TRIGGER_TOKEN for dashboard ingestion proxy');
      expect(messages).toContain('Missing Pages constant FANTASY402_WORKER_UPSTREAM for dashboard ingestion proxy');
    }

    const badCompatibility = structuredClone(manifest.cloudflare);
    badCompatibility.pages_projects.dashboard.build_config.wrangler_config.legacy_npm_compatibility = false;

    const compatibilityResult = CloudflareSchema.safeParse(badCompatibility);
    expect(compatibilityResult.success).toBe(false);
  });
});
