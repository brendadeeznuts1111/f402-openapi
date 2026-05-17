#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { toYaml } from './yaml.mjs';

const root = process.cwd();
const defaultSpecs = [
  '.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.json',
  '.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.slim.json',
  '.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.examples.json',
];
const specPaths = process.argv.slice(2).length ? process.argv.slice(2) : defaultSpecs;

const piiFieldRe = /^(IPAddress|IP|LoginID|Login|AgentLogin|MasterLogin|PlayerLogin|CustomerID|CustomerIDF|CustomerIDFix|CustomerIDPrefix|CustomerIDSufix|customerID|Agent|AgentF|AgentID|agentID|agentOwner|MasterAgent|MasterAgentID|Name|NameF|NameFirst|NameLast|NameMI|PlayerName|showName|email|EMail|EmailOffice|OfficeReceiveEmail)$/i;

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function privacyClassFor(fieldName) {
  if (/^IP(Address)?$/i.test(fieldName)) return 'PII:NetworkAddress';
  if (/email/i.test(fieldName)) return 'PII:EmailAddress';
  if (/name/i.test(fieldName)) return 'PII:Name';
  return 'PII:AccountIdentifier';
}

function annotate(value) {
  let changes = 0;

  function walk(node) {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isObject(node)) return;

    if (isObject(node.properties)) {
      for (const [fieldName, property] of Object.entries(node.properties)) {
        if (isObject(property) && piiFieldRe.test(fieldName)) {
          if (property['x-sensitive'] !== true) {
            property['x-sensitive'] = true;
            changes++;
          }
          const privacy = privacyClassFor(fieldName);
          if (property['x-privacy-classification'] !== privacy) {
            property['x-privacy-classification'] = privacy;
            changes++;
          }
        }
        walk(property);
      }
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === 'properties') continue;
      walk(child);
    }
  }

  walk(value);
  return changes;
}

function resolveRef(spec, ref) {
  if (!ref?.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current = spec;
  for (const part of parts) current = current?.[part];
  return current || null;
}

function resolveExample(spec, example) {
  if (example?.$ref) return resolveExample(spec, resolveRef(spec, example.$ref));
  return example?.value;
}

function isRedactedValue(value) {
  return typeof value === 'string' && /^(__REDACTED|<redacted>)/.test(value);
}

function redactedValueFor(pathParts) {
  return pathParts.at(-1)?.toLowerCase() === 'password' ? '__REDACTED_PASSWORD__' : '__REDACTED__';
}

function redactSensitiveExampleValues(spec) {
  let changes = 0;

  function walk(schema, value, pathParts = [], seen = new Set()) {
    if (!schema || value === undefined) return;
    if (schema.$ref) {
      if (seen.has(schema.$ref)) return;
      seen.add(schema.$ref);
      return walk(resolveRef(spec, schema.$ref), value, pathParts, seen);
    }
    for (const key of ['allOf', 'oneOf', 'anyOf']) {
      if (Array.isArray(schema[key])) {
        for (const item of schema[key]) walk(item, value, pathParts, new Set(seen));
      }
    }

    if (schema['x-sensitive'] === true && (value === null || typeof value !== 'object')) {
      if (!isRedactedValue(value)) {
        return redactedValueFor(pathParts);
      }
      return;
    }

    if (Array.isArray(value) && schema.items) {
      for (let index = 0; index < value.length; index++) {
        const replacement = walk(schema.items, value[index], pathParts.concat(String(index)), new Set(seen));
        if (replacement !== undefined) {
          value[index] = replacement;
          changes++;
        }
      }
      return;
    }

    if (isObject(value) && isObject(schema.properties)) {
      for (const [fieldName, childSchema] of Object.entries(schema.properties)) {
        if (!(fieldName in value)) continue;
        const replacement = walk(childSchema, value[fieldName], pathParts.concat(fieldName), new Set(seen));
        if (replacement !== undefined) {
          value[fieldName] = replacement;
          changes++;
        }
      }
    }
  }

  for (const pathItem of Object.values(spec.paths || {})) {
    for (const operation of Object.values(pathItem || {})) {
      for (const content of Object.values(operation.requestBody?.content || {})) {
        for (const example of Object.values(content.examples || {})) {
          walk(content.schema, resolveExample(spec, example));
        }
      }
      for (const response of Object.values(operation.responses || {})) {
        for (const content of Object.values(response.content || {})) {
          for (const example of Object.values(content.examples || {})) {
            walk(content.schema, resolveExample(spec, example));
          }
        }
      }
    }
  }

  return changes;
}

const results = [];
for (const relativeSpecPath of specPaths) {
  const jsonPath = path.resolve(root, relativeSpecPath);
  if (!fs.existsSync(jsonPath)) continue;

  const spec = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const annotationChanges = annotate(spec);
  const exampleRedactions = redactSensitiveExampleValues(spec);
  fs.writeFileSync(jsonPath, `${JSON.stringify(spec, null, 2)}\n`);

  const yamlPath = jsonPath.replace(/\.json$/, '.yaml');
  if (fs.existsSync(yamlPath)) {
    fs.writeFileSync(yamlPath, `${toYaml(spec)}\n`);
  }

  results.push({
    spec: path.relative(root, jsonPath),
    annotationChanges,
    exampleRedactions,
  });
}

console.log(JSON.stringify({
  status: 'ok',
  repaired: results,
}, null, 2));
