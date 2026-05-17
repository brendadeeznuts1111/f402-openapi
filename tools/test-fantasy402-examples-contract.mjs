#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const specPath = path.resolve(process.argv[2] || path.join(root, '.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.examples.json'));
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const findings = [];

const credentialFieldRe = /^(Password|password|pass|PasswordF|PayoutPassword|PlaceWagerPassword)$/;
const redactedTokens = new Set(['<redacted>', '__REDACTED__']);
const criticalPaths = [
  '/cloud/api/Report/Pending',
  '/cloud/api/Manager/getPlayers',
  '/cloud/api/Manager/getAgentBilling',
  '/cloud/api/Manager/getEnterTransactions',
];

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function add(priority, pointer, message) {
  findings.push({ priority, pointer, message });
}

function looksLikePii(value) {
  if (typeof value !== 'string') return false;
  if (!value || redactedTokens.has(value)) return false;
  if (/@/.test(value)) return true;
  if (/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(value)) return true;
  if (/\b[0-9a-f]{0,4}:[0-9a-f:]{2,}\b/i.test(value)) return true;
  if (/^[A-Z0-9._-]{4,20}$/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)) return true;
  return false;
}

function resolveRef(ref) {
  if (!ref?.startsWith('#/')) throw new Error(`unsupported ref ${ref}`);
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

function schemaAllowsType(schema, type) {
  const allowed = Array.isArray(schema.type) ? schema.type : [schema.type].filter(Boolean);
  if (!allowed.length) return true;
  if (type === 'integer' && allowed.includes('number')) return true;
  return allowed.includes(type);
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function validateValue(schema, value, pointer) {
  if (!schema) return;
  if (schema.$ref) return validateValue(resolveRef(schema.$ref), value, pointer);
  if (schema['x-sensitive'] === true && looksLikePii(value)) {
    add(0, pointer, 'Sensitive example value must be redacted or synthetic, not real-looking PII.');
  }
  if (schema.oneOf?.length) {
    const matched = schema.oneOf.some((candidate) => {
      const before = findings.length;
      validateValue(candidate, value, pointer);
      const ok = findings.length === before;
      findings.splice(before);
      return ok;
    });
    if (!matched) add(0, pointer, 'Example does not match any oneOf schema.');
    return;
  }
  if (schema.anyOf?.length) {
    const matched = schema.anyOf.some((candidate) => {
      const before = findings.length;
      validateValue(candidate, value, pointer);
      const ok = findings.length === before;
      findings.splice(before);
      return ok;
    });
    if (!matched) add(0, pointer, 'Example does not match any anyOf schema.');
    return;
  }
  if (schema.const !== undefined && value !== schema.const) {
    add(0, pointer, `Expected const ${schema.const}.`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    add(0, pointer, `Value is not in enum.`);
    return;
  }

  const type = valueType(value);
  if (!schemaAllowsType(schema, type)) {
    add(0, pointer, `Expected type ${schema.type}, got ${type}.`);
    return;
  }

  if (isObject(value)) {
    for (const key of Object.keys(value)) {
      const childSchema = schema.properties?.[key];
      if (credentialFieldRe.test(key) && !isReviewedCredentialExample(childSchema, value[key], `${pointer}/${key}`)) {
        add(0, `${pointer}/${key}`, 'Credential field appears in example payload.');
      }
    }
    for (const required of schema.required || []) {
      if (!(required in value)) add(0, `${pointer}/${required}`, 'Required field missing from example payload.');
    }
    for (const [key, childValue] of Object.entries(value)) {
      const childSchema = schema.properties?.[key];
      if (childSchema) validateValue(childSchema, childValue, `${pointer}/${key}`);
      else if (schema.additionalProperties === false) add(0, `${pointer}/${key}`, 'Unexpected property in example payload.');
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => validateValue(schema.items, item, `${pointer}/${index}`));
  }
}

function schemaHasSensitiveAnnotation(schema, seen = new Set()) {
  if (!schema) return false;
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return false;
    seen.add(schema.$ref);
    return schemaHasSensitiveAnnotation(resolveRef(schema.$ref), seen);
  }
  if (schema['x-sensitive'] === true) return true;
  if (Array.isArray(schema)) return schema.some((item) => schemaHasSensitiveAnnotation(item, seen));
  if (!isObject(schema)) return false;
  return Object.values(schema).some((child) => schemaHasSensitiveAnnotation(child, seen));
}

function walkExampleValues(value, pointer) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkExampleValues(item, `${pointer}/${index}`));
    return;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (credentialFieldRe.test(key) && !isReviewedCredentialExample(null, child, `${pointer}/${key}`)) {
        add(0, `${pointer}/${key}`, 'Credential field appears in example payload.');
      }
      walkExampleValues(child, `${pointer}/${key}`);
    }
    return;
  }
  if (looksLikePii(value)) add(0, pointer, 'Example contains real-looking PII outside an explicitly synthetic allowlist.');
}

function responseSchema(apiPath, status) {
  return spec.paths?.[apiPath]?.post?.responses?.[status]?.content?.['application/json']?.schema;
}

function requestSchema(apiPath) {
  return spec.paths?.[apiPath]?.post?.requestBody?.content?.['application/x-www-form-urlencoded']?.schema;
}

for (const apiPath of criticalPaths) {
  const op = spec.paths?.[apiPath]?.post;
  if (!op) {
    add(0, `#/paths/${apiPath}`, 'Critical path missing from examples contract.');
    continue;
  }
  const requestExamples = op.requestBody?.content?.['application/x-www-form-urlencoded']?.examples || {};
  if (!Object.keys(requestExamples).length) add(0, `#/paths/${apiPath}/post/requestBody`, 'Critical path missing request examples.');
  for (const [name, example] of Object.entries(requestExamples)) {
    validateValue(requestSchema(apiPath), resolveExample(example), `#/paths/${apiPath}/post/requestBody/examples/${name}`);
  }

  const successExamples = op.responses?.['200']?.content?.['application/json']?.examples || {};
  if (!Object.keys(successExamples).length) add(0, `#/paths/${apiPath}/post/responses/200`, 'Critical path missing 200 response examples.');
  for (const [name, example] of Object.entries(successExamples)) {
    validateValue(responseSchema(apiPath, '200'), resolveExample(example), `#/paths/${apiPath}/post/responses/200/examples/${name}`);
  }
}

let sensitiveResponseExamplesChecked = 0;
for (const [apiPath, methods] of Object.entries(spec.paths || {})) {
  for (const [method, operation] of Object.entries(methods)) {
    for (const [status, response] of Object.entries(operation.responses || {})) {
      const content = response.content?.['application/json'];
      if (!content?.examples || !schemaHasSensitiveAnnotation(content.schema)) continue;
      for (const [name, example] of Object.entries(content.examples)) {
        sensitiveResponseExamplesChecked++;
        const value = resolveExample(example);
        validateValue(content.schema, value, `#/paths/${apiPath}/${method}/responses/${status}/examples/${name}`);
        walkExampleValues(value, `#/paths/${apiPath}/${method}/responses/${status}/examples/${name}`);
      }
    }
  }
}

for (const apiPath of ['/cloud/api/Report/Pending', '/cloud/api/Manager/getPlayers', '/cloud/api/Manager/getAgentBilling', '/cloud/api/Manager/getEnterTransactions']) {
  const rateExamples = spec.paths?.[apiPath]?.post?.responses?.['429']?.content?.['application/json']?.examples || {};
  if (!rateExamples.tooManyRequests) add(0, `#/paths/${apiPath}/post/responses/429`, 'Missing 429 rate-limit example.');
}

const billingRoles = spec.paths?.['/cloud/api/Manager/getAgentBilling']?.post?.['x-required-roles'] || [];
if (billingRoles.includes('ROLE_SUB_AGENT') || !billingRoles.includes('ROLE_MASTER')) {
  add(0, '#/paths/~1cloud~1api~1Manager~1getAgentBilling/post/x-required-roles', 'getAgentBilling must stay master-only.');
}

const enterRoles = spec.paths?.['/cloud/api/Manager/getEnterTransactions']?.post?.['x-required-roles'] || [];
if (enterRoles.includes('ROLE_SUB_AGENT')) {
  add(0, '#/paths/~1cloud~1api~1Manager~1getEnterTransactions/post/x-required-roles', 'getEnterTransactions must not allow sub-agent role.');
}

console.log(JSON.stringify({
  spec: path.relative(root, specPath),
  criticalPathsChecked: criticalPaths.length,
  sensitiveResponseExamplesChecked,
  findings: findings.length,
  byPriority: findings.reduce((acc, finding) => {
    acc[finding.priority] = (acc[finding.priority] || 0) + 1;
    return acc;
  }, {}),
  sample: findings.slice(0, 20),
}, null, 2));

if (findings.some((finding) => finding.priority === 0)) process.exit(1);

function isReviewedCredentialExample(schema, value, pointer) {
  if (
    pointer.includes('AuthenticateCustomerRequestRedacted')
    && typeof value === 'string'
    && /^__REDACTED_/.test(value)
  ) {
    return true;
  }

  return Boolean(
    schema
      && schema.writeOnly === true
      && schema['x-sensitive'] === true
      && schema['x-security-review-required'] === true
      && typeof value === 'string'
      && /^__REDACTED_/.test(value)
  );
}
