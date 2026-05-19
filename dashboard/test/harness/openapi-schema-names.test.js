/**
 * OpenAPI schema names — naming conventions, required components, $ref integrity.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadMetadata,
  readOpenApiWorkerSpec,
  verifyOpenApiSchemaNames,
  verifyOpenApiNamingConvention,
  verifyOpenApiRefsResolve,
} from '../../harness/verify.js';

test('required OpenAPI component schemas exist', () => {
  const bindings = loadMetadata('schema-bindings.json');
  const spec = readOpenApiWorkerSpec();
  const findings = verifyOpenApiSchemaNames(bindings.openApiSchemas, spec);
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('OpenAPI schema naming convention (PascalCase, no credential substrings)', () => {
  const repoMeta = loadMetadata('repo-metadata.json');
  const spec = readOpenApiWorkerSpec();
  const findings = verifyOpenApiNamingConvention(repoMeta.openApiNaming, spec);
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('all OpenAPI $ref pointers resolve under components.schemas', () => {
  const spec = readOpenApiWorkerSpec();
  const findings = verifyOpenApiRefsResolve(spec);
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('OpenAPI object schemas use closed additionalProperties', () => {
  const spec = readOpenApiWorkerSpec();
  const open = Object.entries(spec.components?.schemas ?? {}).filter(
    ([, s]) => s.type === 'object' && s.additionalProperties !== false,
  );
  assert.deepEqual(
    open.map(([n]) => n),
    [],
    `schemas with open additionalProperties: ${open.map(([n]) => n).join(', ')}`,
  );
});

test('Response and Request suffix conventions for primary DTOs', () => {
  const spec = readOpenApiWorkerSpec();
  const names = Object.keys(spec.components?.schemas ?? {});
  const requiredDto = [
    'ErrorResponse',
    'HealthResponse',
    'RefreshAuthRequest',
    'EndpointsManifestResponse',
  ];
  for (const name of requiredDto) {
    assert.ok(names.includes(name), `missing DTO ${name}`);
  }
});
