import { readFileSync } from 'fs';
import { ManifestSchema } from '../src/lib/manifest-types';

const manifestPath = 'public/manifest.json';
const raw = readFileSync(manifestPath, 'utf-8');
const manifest = JSON.parse(raw);
const result = ManifestSchema.safeParse(manifest);

if (!result.success) {
  console.error('Manifest validation failed:');
  for (const issue of result.error.issues) {
    const path = issue.path.length ? issue.path.join('.') : '<root>';
    console.error(`  - ${path}: ${issue.message}`);
  }
  process.exit(1);
}

const dashboard = result.data.cloudflare.pages_projects.dashboard;
const worker = result.data.cloudflare.workers[0];

console.log('✅ Manifest validates against Zod schema');
console.log(`Cloudflare account: ${result.data.cloudflare.account_id}`);
console.log(`Dashboard Pages secrets: ${dashboard.secrets.join(', ')}`);
console.log(`Dashboard Worker upstream: ${dashboard.build_config.environment_variables.common.FANTASY402_WORKER_UPSTREAM}`);
console.log(`Worker bindings: D1=${worker.environment_bindings.d1_databases.join(', ')} R2=${worker.environment_bindings.r2_buckets.join(', ')} KV=${worker.environment_bindings.kv_namespaces.join(', ')}`);
