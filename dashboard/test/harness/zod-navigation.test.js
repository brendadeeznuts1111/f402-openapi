/**
 * Navigation Zod validation — schemas, fixtures, registry edge cases.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMetadata } from '../../harness/verify.js';
import {
  navItemSchema,
  navGroupSchema,
  sidebarConfigSchema,
} from '../../js/lib/navigation-schemas.js';
import {
  generateSchemaFixtures,
  generateNavigationSchemaFixtures,
  runGeneratedFixtureTests,
} from '../../harness/zod-fixtures.js';
import {
  getTabPath,
  getTabGroup,
  isValidTabId,
} from '../../js/lib/navigation-config.js';

test('navigation fixture registry edge cases', () => {
  const defs = generateNavigationSchemaFixtures();
  const schemas = { navItemSchema, navGroupSchema, sidebarConfigSchema };
  const findings = [];
  for (const [name, def] of Object.entries(defs)) {
    const schema = schemas[name];
    for (const c of def.invalidCases ?? []) {
      const bad = schema.safeParse(c.input);
      if (bad.success) findings.push(`${name}/${c.id} should fail`);
    }
    if (def.valid) {
      const ok = schema.safeParse(def.valid);
      if (!ok.success) findings.push(`${name}: valid fixture rejected`);
    }
  }
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('generated fixtures for navigation schemas', () => {
  const schemas = [
    ['navItemSchema', navItemSchema, { id: 'tab-x', label: 'X', path: '/dashboard/tab-x' }],
    [
      'navGroupSchema',
      navGroupSchema,
      {
        id: 'group-a',
        label: 'A',
        items: [{ id: 'tab-x', label: 'X', path: '/dashboard/tab-x' }],
      },
    ],
  ];
  const findings = [];
  for (const [name, schema, validInput] of schemas) {
    const fx = generateSchemaFixtures(schema, name);
    if (fx.valid && schema.safeParse(fx.valid).success) {
      findings.push(...runGeneratedFixtureTests(schema, fx));
    } else {
      const ok = schema.safeParse(validInput);
      if (!ok.success) {
        findings.push(`${name}: manual valid input rejected`);
      }
    }
  }
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('navigation-registry invalid configs', () => {
  const registry = loadMetadata('navigation-registry.json');
  for (const c of registry.invalidConfigs ?? []) {
    const r = sidebarConfigSchema.safeParse(c.config);
    assert.equal(r.success, false, `${c.id} should fail`);
    if (c.messageIncludes) {
      const msg = r.error?.issues.map((i) => i.message).join(' ') ?? '';
      assert.match(msg, new RegExp(c.messageIncludes, 'i'), c.id);
    }
  }
});

test('navigation helper error paths from registry', () => {
  const registry = loadMetadata('navigation-registry.json');
  for (const c of registry.helperCases ?? []) {
    if (c.fn === 'getTabPath') {
      const r = getTabPath(c.input);
      assert.equal(r.ok, c.expectOk, c.fn);
    }
    if (c.fn === 'getTabGroup') {
      const r = getTabGroup(c.input);
      assert.equal(r.ok, c.expectOk, c.fn);
    }
    if (c.fn === 'isValidTabId') {
      assert.equal(isValidTabId(c.input), c.expect, c.fn);
    }
  }
});
