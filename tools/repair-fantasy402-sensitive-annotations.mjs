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

const results = [];
for (const relativeSpecPath of specPaths) {
  const jsonPath = path.resolve(root, relativeSpecPath);
  if (!fs.existsSync(jsonPath)) continue;

  const spec = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const changes = annotate(spec);
  fs.writeFileSync(jsonPath, `${JSON.stringify(spec, null, 2)}\n`);

  const yamlPath = jsonPath.replace(/\.json$/, '.yaml');
  if (fs.existsSync(yamlPath)) {
    fs.writeFileSync(yamlPath, `${toYaml(spec)}\n`);
  }

  results.push({
    spec: path.relative(root, jsonPath),
    changes,
  });
}

console.log(JSON.stringify({
  status: 'ok',
  repaired: results,
}, null, 2));
