#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const specPath = path.resolve(process.argv[2] || path.join(root, '.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.examples.json'));
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

const baseUrl = process.env.FANTASY402_STAGING_BASE_URL;
const authorization = process.env.FANTASY402_STAGING_AUTHORIZATION;
const cookie = process.env.FANTASY402_STAGING_COOKIE;

if (!baseUrl) {
  console.log(JSON.stringify({
    status: 'skipped',
    reason: 'FANTASY402_STAGING_BASE_URL is not configured',
  }, null, 2));
  process.exit(0);
}

const findings = [];
const credentialFieldRe = /^(Password|password|pass|PasswordF|PayoutPassword|PlaceWagerPassword)$/;
const probePaths = [
  '/cloud/api/Report/Pending',
  '/cloud/api/Manager/getPlayers',
  '/cloud/api/Manager/getAgentBilling',
  '/cloud/api/Manager/getEnterTransactions',
];

function add(priority, pointer, message) {
  findings.push({ priority, pointer, message });
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function resolveRef(ref) {
  const parts = ref.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current = spec;
  for (const part of parts) current = current?.[part];
  if (current == null) throw new Error(`unresolved ref ${ref}`);
  return current;
}

function resolveExample(exampleOrRef) {
  if (exampleOrRef?.$ref) return resolveExample(resolveRef(exampleOrRef.$ref));
  return exampleOrRef?.value;
}

function scanNoCredentials(value, pointer) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanNoCredentials(item, `${pointer}/${index}`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (credentialFieldRe.test(key)) add(0, `${pointer}/${key}`, 'Live response includes forbidden credential field.');
    scanNoCredentials(child, `${pointer}/${key}`);
  }
}

function firstRequestExample(apiPath) {
  const examples = spec.paths?.[apiPath]?.post?.requestBody?.content?.['application/x-www-form-urlencoded']?.examples || {};
  const first = Object.values(examples)[0];
  return first ? resolveExample(first) : null;
}

for (const apiPath of probePaths) {
  const op = spec.paths?.[apiPath]?.post;
  if (!op) continue;
  const body = firstRequestExample(apiPath);
  if (!body) {
    add(0, `#/paths/${apiPath}/post/requestBody`, 'No request example available for staging probe.');
    continue;
  }

  const headers = {
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'x-contract-test': 'fantasy402-secured-contract',
  };
  if (authorization) headers.authorization = authorization;
  if (cookie) headers.cookie = cookie;

  const url = new URL(apiPath, baseUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: new URLSearchParams(body).toString(),
  });

  const allowedStatuses = new Set(Object.keys(op.responses || {}).map(Number));
  if (!allowedStatuses.has(response.status)) {
    add(0, `#/paths/${apiPath}/post`, `Unexpected live status ${response.status}.`);
  }

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    add(0, `#/paths/${apiPath}/post`, 'Live response was not JSON.');
  }
  if (json != null) scanNoCredentials(json, `live:${apiPath}`);
}

console.log(JSON.stringify({
  status: findings.some((finding) => finding.priority === 0) ? 'failed' : 'ok',
  baseUrl,
  probed: probePaths.length,
  findings: findings.length,
  sample: findings.slice(0, 20),
}, null, 2));

if (findings.some((finding) => finding.priority === 0)) process.exit(1);
