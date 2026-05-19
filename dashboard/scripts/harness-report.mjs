#!/usr/bin/env node
/**
 * Harness health report — console summary + harness-report.json
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHarnessHealthReport, writeHarnessReportJson } from '../harness/health-report.js';

const dashboardRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outJson = join(dashboardRoot, 'harness/harness-report.json');

const report = buildHarnessHealthReport();
writeHarnessReportJson(report, outJson);

console.log('Fantasy402 dashboard harness report\n');
console.log(`  Generated:               ${report.generatedAt}`);
console.log(`  Snapshots drift:         ${report.snapshots.ok ? 'none' : report.snapshots.driftCount}`);
console.log(`  Metadata sync:           ${report.metadataSync.ok ? 'OK' : report.metadataSync.findings.length + ' issue(s)'}`);
console.log(`  llms.txt:                ${report.llms.ok ? 'OK' : report.llms.findings.length + ' issue(s)'}`);
console.log(`  Routes in llms.txt:      ${report.llms.routesDocumented}/${report.llms.routesTotal}`);
console.log(`  Fixture coverage:        ${report.fixtures.generated}/${report.fixtures.total} (skipped ${report.fixtures.skipped})`);
console.log(`  Circular deps:           ${report.circularDependencies.ok ? 'OK' : report.circularDependencies.cycles.length}`);
console.log(
  `  Performance:             ${report.performance.ok ? 'OK' : report.performance.regressions?.join('; ')}`,
);
console.log('\n  Navigation');
console.log(
  `    Snapshot drift:        ${report.navigation.snapshot.ok ? 'none' : 'yes'}`,
);
console.log(
  `    Metadata sync:         ${report.navigation.metadataSync.ok ? 'OK' : report.navigation.metadataSync.findings.length + ' issue(s)'}`,
);
console.log(
  `    Fixture coverage:      ${report.navigation.fixtures.generated}/${report.navigation.fixtures.total}`,
);
console.log(
  `    Perf (SidebarConfig):  ${report.navigation.performance.ok ? 'OK' : report.navigation.performance.regressions?.join('; ')}`,
);
console.log(`    Tabs / groups:         ${report.navigation.tabCount} / ${report.navigation.groupCount}`);

if (!report.metadataSync.ok) {
  for (const f of report.metadataSync.findings) console.log(`    - ${f}`);
}
if (!report.llms.ok) {
  for (const f of report.llms.findings) console.log(`    - ${f}`);
}
if (!report.snapshots.ok) {
  for (const d of report.snapshots.drift) {
    console.log(`    - ${d.snapshot}: ${d.changes?.length ?? 1} change(s)`);
  }
}

console.log(`\nJSON report: ${outJson}`);
console.log('Commands: npm run harness:verify | test:harness:ci | test:harness:update');

process.exit(
  report.metadataSync.ok &&
    report.llms.ok &&
    report.snapshots.ok &&
    report.circularDependencies.ok &&
    report.performance.ok &&
    report.navigation.snapshot.ok &&
    report.navigation.metadataSync.ok &&
    report.navigation.performance.ok
    ? 0
    : 1,
);
