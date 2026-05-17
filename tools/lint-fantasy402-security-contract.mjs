#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const specPath = path.resolve(process.argv[2] || path.join(root, '.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.slim.json'));
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

const findings = [];
const credentialFieldRe = /^(Password|password|pass|PasswordF|PayoutPassword|PlaceWagerPassword)$/;
const sensitiveNameRe = /(IPAddress|IP|LoginID|Login|AgentLogin|MasterLogin|PlayerLogin|CustomerID|customerID|AgentID|agentID|agentOwner|MasterAgentID|email)$/;

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function add(priority, pointer, message) {
  findings.push({ priority, pointer, message });
}

function walk(value, pointer = '#') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${pointer}/${index}`));
    return;
  }
  if (!isObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPointer = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    if (credentialFieldRe.test(key)) add(0, childPointer, 'Credential field is forbidden in the secured OpenAPI contract.');
    if (sensitiveNameRe.test(key) && isObject(child) && child.type && child['x-sensitive'] !== true) {
      add(1, childPointer, 'Sensitive account/network field must include x-sensitive: true.');
    }
    walk(child, childPointer);
  }
}

if (!spec.components?.securitySchemes?.sessionCookie) add(0, '#/components/securitySchemes', 'Missing sessionCookie security scheme.');
if (!spec.components?.securitySchemes?.agentToken) add(0, '#/components/securitySchemes', 'Missing agentToken security scheme.');
if (!Array.isArray(spec.security) || spec.security.length === 0) add(0, '#/security', 'Missing global security requirement.');

for (const [apiPath, methods] of Object.entries(spec.paths || {})) {
  for (const [method, operation] of Object.entries(methods)) {
    const pointer = `#/paths/${apiPath.replaceAll('~', '~0').replaceAll('/', '~1')}/${method}`;
    if (!apiPath.startsWith('/cloud/api/')) continue;
    if (!operation.security) add(0, pointer, 'First-party API operation missing security.');
    if (!operation['x-required-roles']) add(0, pointer, 'First-party API operation missing x-required-roles.');
    if (!operation['x-rate-limit']) add(1, pointer, 'First-party API operation missing x-rate-limit.');
    if (!operation.responses?.['429']) add(1, pointer, 'First-party API operation missing 429 response.');
    if (/getWebLog/i.test(apiPath) && operation.deprecated !== true) add(0, pointer, 'getWebLog must remain deprecated until audit-log replacement exists.');
    if (/getTicketDetailPrint/i.test(apiPath) && operation['x-manual-review-required'] !== true) add(0, pointer, 'getTicketDetailPrint must stay manual-review until a valid backend method is observed.');
  }
}

walk(spec);

const maxPriority = findings.reduce((max, finding) => Math.min(max, finding.priority), 3);
console.log(JSON.stringify({
  spec: path.relative(root, specPath),
  findings: findings.length,
  byPriority: findings.reduce((acc, finding) => {
    acc[finding.priority] = (acc[finding.priority] || 0) + 1;
    return acc;
  }, {}),
  sample: findings.slice(0, 20),
}, null, 2));

if (findings.some((finding) => finding.priority === 0)) process.exit(1);
if (maxPriority < 3 && process.env.FAIL_ON_WARNINGS === '1') process.exit(1);
