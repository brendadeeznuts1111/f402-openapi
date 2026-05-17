#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const root = process.cwd();
const node = process.execPath;
const slimSpec = path.join(root, '.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.slim.json');
const fullSpec = path.join(root, '.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.json');
const examplesSpec = path.join(root, '.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.examples.json');
const sourceObservedSpec = path.join(root, '.o11y/fantasy402-redacted-deep/api-spec/openapi.json');

function run(args) {
  const result = spawnSync(node, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

if (require('fs').existsSync(sourceObservedSpec)) {
  run(['tools/enhance-fantasy402-openapi.mjs']);
} else {
  console.log(JSON.stringify({
    status: 'skip-enhance',
    reason: 'Observed source OpenAPI is not present; validating checked-in secured artifacts only.',
    sourceObservedSpec: path.relative(root, sourceObservedSpec),
  }, null, 2));
}
if (require('fs').existsSync(fullSpec)) {
  run(['tools/validate-fantasy402-secured-openapi.mjs', fullSpec]);
}
run(['tools/validate-fantasy402-secured-openapi.mjs', slimSpec]);
run(['tools/validate-fantasy402-secured-openapi.mjs', examplesSpec]);
run(['tools/lint-fantasy402-security-contract.mjs', slimSpec]);
run(['tools/lint-fantasy402-security-contract.mjs', examplesSpec]);
run(['tools/test-fantasy402-examples-contract.mjs', examplesSpec]);
run(['tools/build-fantasy402-static-docs.mjs', examplesSpec]);

console.log(JSON.stringify({
  status: 'ok',
  fullSpec: path.relative(root, fullSpec),
  slimSpec: path.relative(root, slimSpec),
  examplesSpec: path.relative(root, examplesSpec),
  docs: '.o11y/fantasy402-redacted-deep/api-spec-secured/site/index.html',
}, null, 2));
