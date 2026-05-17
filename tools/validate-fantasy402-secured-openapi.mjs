#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const specPath = path.resolve(process.argv[2] || path.join(root, '.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.json'));
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

const credentialFieldRe = /^(Password|password|pass|PasswordF|PayoutPassword|PlaceWagerPassword)$/;

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(value, visit, pointer = '#') {
  visit(value, pointer);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visit, `${pointer}/${index}`));
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      walk(child, visit, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
    }
  }
}

function resolvePointer(pointer) {
  assert(pointer.startsWith('#/'), `unsupported ref ${pointer}`);
  const parts = pointer.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current = spec;
  for (const part of parts) {
    assert(current && Object.prototype.hasOwnProperty.call(current, part), `unresolved ref ${pointer}`);
    current = current[part];
  }
  return current;
}

assert(spec.openapi === '3.1.0', 'expected OpenAPI 3.1.0');
assert(spec.info?.title, 'missing info.title');
assert(spec.paths && Object.keys(spec.paths).length > 0, 'missing paths');
assert(spec.components?.schemas, 'missing components.schemas');
assert(spec.components?.securitySchemes?.sessionCookie, 'missing sessionCookie scheme');
assert(spec.components?.securitySchemes?.agentToken, 'missing agentToken scheme');
assert(Array.isArray(spec.security) && spec.security.length > 0, 'missing global security');

const refs = [];
const credentialFields = [];
walk(spec, (value, pointer) => {
  if (isObject(value) && typeof value.$ref === 'string') refs.push(value.$ref);
  const key = pointer.split('/').at(-1)?.replaceAll('~1', '/').replaceAll('~0', '~');
  if (key && credentialFieldRe.test(key)) credentialFields.push(pointer);
});
refs.forEach(resolvePointer);
assert(credentialFields.length === 0, `credential fields remain: ${credentialFields.slice(0, 10).join(', ')}`);

const firstPartyOps = [];
for (const [apiPath, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!apiPath.startsWith('/cloud/api/')) continue;
    firstPartyOps.push({ apiPath, method, operation });
    assert(operation.security, `${method.toUpperCase()} ${apiPath} missing operation security`);
    assert(operation['x-required-roles'], `${method.toUpperCase()} ${apiPath} missing x-required-roles`);
    assert(operation['x-rate-limit'], `${method.toUpperCase()} ${apiPath} missing x-rate-limit`);
    assert(operation.responses?.['429'], `${method.toUpperCase()} ${apiPath} missing 429 response`);
  }
}

const pending = spec.paths['/cloud/api/Report/Pending']?.post;
assert(pending, 'missing Report/Pending');
assert(pending.requestBody?.content?.['application/x-www-form-urlencoded'], 'Pending must use observed form-encoded request body');
assert(pending.responses?.['400']?.content?.['application/json']?.schema?.$ref === '#/components/schemas/ErrorResponse', 'Pending 400 must reference ErrorResponse');
assert(pending.responses?.['403'], 'Pending missing 403 response');

assert(spec.paths['/cloud/api/Manager/getWebLog']?.post?.deprecated === true, 'getWebLog must be deprecated');
assert(spec.paths['/cloud/api/Report/getTicketDetailPrint']?.post?.deprecated === true, 'getTicketDetailPrint must be deprecated');

console.log(JSON.stringify({
  spec: path.relative(root, specPath),
  refsChecked: refs.length,
  firstPartyOpsChecked: firstPartyOps.length,
  credentialFieldsRemaining: credentialFields.length,
}, null, 2));
