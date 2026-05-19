#!/usr/bin/env node
/**
 * CLI metadata sync check — exits 1 when llms.txt / manifests drift from code.
 */
import { runMetadataSyncChecks } from '../harness/sync-metadata.js';

const findings = runMetadataSyncChecks();
if (findings.length === 0) {
  console.log('metadata sync: OK');
  process.exit(0);
}
console.error('metadata sync: FAILED\n' + findings.map((f) => `  - ${f}`).join('\n'));
process.exit(1);
