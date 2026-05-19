/**
 * Contract verification for dashboard ↔ worker ↔ OpenAPI ↔ design system.
 * Used by dashboard/test/harness-contract.test.js (no manual convention checks).
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const harnessDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(harnessDir, '../..');
const metadataDir = join(harnessDir, 'metadata');

export function loadMetadata(name) {
  const path = join(metadataDir, name);
  if (!existsSync(path)) throw new Error(`missing harness metadata: ${name}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Mirrors dashboard/_worker.js isPublicWorkerPath (keep in sync). */
export function pagesProxyIsPublicPath(pathname) {
  if (pathname === '/health') return true;
  if (pathname === '/auth/health') return true;
  if (pathname === '/live-wagers' || pathname.startsWith('/live-wagers/')) return true;
  return false;
}

export function verifyPublicRouteIsolation({ publicRoutesMeta, constantsPublicPaths }) {
  const findings = [];
  const metaSet = new Set(publicRoutesMeta.paths);
  const constSet = new Set(constantsPublicPaths);

  for (const p of metaSet) {
    if (!constSet.has(p) && !p.startsWith('/live-wagers')) {
      findings.push(`PUBLIC_API_PATHS missing ${p} from public-routes.json`);
    }
    if (!pagesProxyIsPublicPath(p)) {
      findings.push(`_worker.js isPublicWorkerPath does not treat ${p} as public`);
    }
  }

  for (const p of constSet) {
    if (!metaSet.has(p) && p !== '/live-wagers') {
      findings.push(`public-routes.json missing ${p} (listed in PUBLIC_API_PATHS)`);
    }
  }

  const protectedSamples = ['/summary', '/pending-wagers', '/customer-profile'];
  for (const p of protectedSamples) {
    if (pagesProxyIsPublicPath(p)) {
      findings.push(`route isolation breach: ${p} must not be public on Pages proxy`);
    }
  }

  return findings;
}

export function parseWorkerApiManifest(workerIndexSource) {
  const zoneBlock = workerIndexSource.match(
    /const WORKER_API_ZONE[^=]*=\s*\{([\s\S]*?)\n\};/,
  );
  const routesBlock = workerIndexSource.match(
    /const WORKER_API_ROUTES[^=]*=\s*\[([\s\S]*?)\n\];/,
  );
  if (!routesBlock) throw new Error('WORKER_API_ROUTES block not found in worker index.ts');

  const zones = {};
  if (zoneBlock) {
    const zoneRe = /'([^']+)':\s*'([^']+)'/g;
    let zm;
    while ((zm = zoneRe.exec(zoneBlock[1]))) zones[zm[1]] = zm[2];
  }

  const routes = [];
  const routeRe = /\{\s*path:\s*'([^']+)',\s*method:\s*'([^']+)'[^}]*refreshMs:\s*([^,}]+)/g;
  let m;
  while ((m = routeRe.exec(routesBlock[1]))) {
    const refreshRaw = m[3].trim();
    const refreshMs =
      refreshRaw === "'realtime'" || refreshRaw === '"realtime"'
        ? 'realtime'
        : refreshRaw === "'manual'" || refreshRaw === '"manual"'
          ? 'manual'
          : Number(refreshRaw);
    routes.push({
      path: m[1],
      method: m[2],
      refreshMs,
      zone: zones[m[1]] ?? 'worker',
    });
  }
  return { routes, zones };
}

export function verifyDashboardRoutesManifest({
  dashboardRoutes,
  endpointZoneMap,
  refreshIntervals,
  workerRoutes,
}) {
  const findings = [];
  const workerGetPaths = new Set(
    workerRoutes.filter((r) => r.method === 'GET').map((r) => r.path),
  );

  for (const entry of dashboardRoutes) {
    const { path, zone, refreshMs, public: isPublic } = entry;

    if (!isPublic && !workerGetPaths.has(path) && !path.endsWith('/seed')) {
      const hasPost = workerRoutes.some((r) => r.path === path);
      if (!hasPost) {
        findings.push(`dashboard route ${path} not found in worker WORKER_API_ROUTES`);
      }
    }

    const zonePrefix = Object.entries(endpointZoneMap).find(([prefix]) => path.startsWith(prefix));
    if (zonePrefix && zonePrefix[1] !== zone) {
      findings.push(
        `ENDPOINT_ZONE_MAP zone for ${path}: expected ${zone}, got ${zonePrefix[1]}`,
      );
    }

    const refreshPrefix = Object.entries(refreshIntervals)
      .filter(([prefix]) => path.startsWith(prefix))
      .sort((a, b) => b[0].length - a[0].length)[0];
    if (refreshPrefix && refreshPrefix[1] !== refreshMs) {
      findings.push(
        `REFRESH_INTERVALS for ${path}: manifest ${refreshMs}, constants ${refreshPrefix[1]}`,
      );
    }

    if (isPublic && !pagesProxyIsPublicPath(path)) {
      findings.push(`dashboard marks ${path} public but Pages proxy requires token`);
    }
  }

  return findings;
}

export function verifySchemaBindings({ bindings, dashboardSchemas, workerSchemas, parseSearchParams }) {
  const findings = [];

  for (const binding of bindings) {
    const dash = dashboardSchemas[binding.dashboardSchema];
    const worker = workerSchemas[binding.workerSchema];
    if (!dash) findings.push(`dashboard schema missing: ${binding.dashboardSchema}`);
    if (!worker) findings.push(`worker schema missing: ${binding.workerSchema}`);
    if (!dash || !worker) continue;

    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(binding.sampleQuery ?? {})) {
      params.set(k, String(v));
    }

    const dashInput = binding.sampleDashboard
      ? binding.sampleDashboard
      : Object.fromEntries(
          [...params.entries()].map(([k, v]) => {
            if (v === 'true' || v === 'false') return [k, v];
            const n = Number(v);
            return [k, Number.isFinite(n) && String(n) === v ? n : v];
          }),
        );

    const dashResult = dash.safeParse(dashInput);

    const workerResult = parseSearchParams(worker, params);
    if (!dashResult.success) {
      findings.push(
        `${binding.id}: dashboard ${binding.dashboardSchema} rejected sample: ${dashResult.error.issues[0]?.message}`,
      );
      continue;
    }
    if (!workerResult.ok) {
      findings.push(
        `${binding.id}: worker ${binding.workerSchema} rejected sample: ${workerResult.error.issues[0]?.message}`,
      );
      continue;
    }
  }

  return findings;
}

export function verifyOpenApiSchemaNames(openApiSchemas, openApiSpec) {
  const findings = [];
  const components = openApiSpec?.components?.schemas ?? {};

  for (const entry of openApiSchemas) {
    if (!entry.requiredInOpenApi) continue;
    if (!components[entry.name]) {
      findings.push(`openapi.worker.json missing components.schemas.${entry.name}`);
    }
  }

  if (openApiSpec.openapi !== '3.1.0') {
    findings.push('openapi.worker.json must declare openapi 3.1.0');
  }

  return findings;
}

export function verifyComponentsManifest({ components, dashboardCssPath, componentsDir }) {
  const findings = [];
  const css = readFileSync(dashboardCssPath, 'utf8');

  for (const comp of components) {
    const filePath = join(componentsDir, comp.file);
    if (!existsSync(filePath)) {
      findings.push(`components.manifest references missing file: ${comp.file}`);
      continue;
    }
    if (!css.includes(`components/${comp.file}`)) {
      findings.push(`dashboard.css does not import components/${comp.file}`);
    }
    const block = comp.blockClass.startsWith('.') ? comp.blockClass.slice(1) : comp.blockClass;
    const fileContent = readFileSync(filePath, 'utf8');
    const needle = comp.attributeSelector ? `[${block}]` : `.${block}`;
    if (!fileContent.includes(needle)) {
      findings.push(`${comp.file} does not define ${needle}`);
    }
  }

  return findings;
}

export function readWorkerIndexSource() {
  return readFileSync(
    join(repoRoot, 'workers/fantasy402-ingestion/src/index.ts'),
    'utf8',
  );
}

export function readOpenApiWorkerSpec() {
  return JSON.parse(
    readFileSync(join(repoRoot, 'workers/fantasy402-ingestion/openapi.worker.json'), 'utf8'),
  );
}

export function readRepoFile(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

/** Parse sidebar data-view and panel ids from index.html. */
export function parseViewIdsFromHtml(html) {
  const sidebar = [...html.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1]);
  const panels = [...html.matchAll(/id="(view-[^"]+)"/g)].map((m) => m[1]);
  return { sidebar: [...new Set(sidebar)], panels: [...new Set(panels)] };
}

export function verifyViewRouteIsolation({ views, html, viewsDir }) {
  const findings = [];
  const { sidebar, panels } = parseViewIdsFromHtml(html);
  const sidebarSet = new Set(sidebar);
  const panelSet = new Set(panels);

  for (const view of views) {
    if (!sidebarSet.has(view.id)) {
      findings.push(`index.html sidebar missing data-view="${view.id}"`);
    }
    if (!panelSet.has(view.panelId)) {
      findings.push(`index.html missing panel #${view.panelId}`);
    }
    const modulePath = join(viewsDir, view.module);
    if (!existsSync(modulePath)) {
      findings.push(`view module missing: ${view.module}`);
      continue;
    }
    const src = readFileSync(modulePath, 'utf8');
    for (const exp of view.loadExports ?? []) {
      if (!new RegExp(`export\\s+(async\\s+)?function\\s+${exp}\\b`).test(src)) {
        findings.push(`${view.module} missing export ${exp}`);
      }
    }
    for (const other of views) {
      if (other.module === view.module) continue;
      const allowed = new Set([...(view.nestedModules ?? []), other.module]);
      if (allowed.has(other.module)) continue;
      if (src.includes(`./${other.module}`) || src.includes(`'./${other.module.replace('.js', '')}'`)) {
        findings.push(`${view.module} imports sibling view ${other.module} (breaks isolation)`);
      }
    }
  }

  for (const id of sidebar) {
    if (!views.some((v) => v.id === id)) {
      findings.push(`view-routes.json missing entry for sidebar view "${id}"`);
    }
  }

  return findings;
}

export function verifyViewApiPathsDeclared({ views, dashboardRoutes }) {
  const findings = [];
  const routePaths = new Set(dashboardRoutes.map((r) => r.path));
  for (const view of views) {
    for (const apiPath of view.apiPaths ?? []) {
      if (!routePaths.has(apiPath)) {
        findings.push(
          `${view.id}: api path ${apiPath} not listed in dashboard-api-routes.json`,
        );
      }
    }
  }
  return findings;
}

export function runDashboardZodCases(cases, schemas, primitives) {
  const findings = [];
  for (const c of cases.dashboardPrimitives ?? []) {
    const fn = primitives[c.fn];
    if (!fn) {
      findings.push(`unknown primitive fn: ${c.fn}`);
      continue;
    }
    const out = fn(c.input);
    const expected = c.expect === 'undefined' ? undefined : c.expect;
    if (out !== expected) {
      findings.push(`${c.id}: expected ${String(expected)}, got ${String(out)}`);
    }
  }
  for (const c of cases.dashboardSchemas ?? []) {
    const schema = schemas[c.schema];
    if (!schema) {
      findings.push(`missing dashboard schema ${c.schema}`);
      continue;
    }
    if (c.valid) {
      const r = schema.safeParse(c.valid);
      if (!r.success) {
        findings.push(`${c.id}: valid input rejected: ${r.error.issues[0]?.message}`);
        continue;
      }
      if (c.expect) {
        for (const [k, v] of Object.entries(c.expect)) {
          if (r.data[k] !== v) {
            findings.push(`${c.id}: expected ${k}=${v}, got ${r.data[k]}`);
          }
        }
      }
    }
    if (c.invalid) {
      const r = schema.safeParse(c.invalid);
      if (r.success) {
        findings.push(`${c.id}: invalid input accepted`);
        continue;
      }
      if (c.messageIncludes) {
        const msg = r.error.issues.map((i) => i.message).join(' ');
        if (!msg.includes(c.messageIncludes)) {
          findings.push(`${c.id}: expected message containing "${c.messageIncludes}"`);
        }
      }
    }
  }
  return findings;
}

export function runWorkerZodCases(cases, workerSchemas, parseSearchParams) {
  const findings = [];
  for (const c of cases.workerSchemas ?? []) {
    const schema = workerSchemas[c.schema];
    if (!schema) {
      findings.push(`missing worker schema ${c.schema}`);
      continue;
    }
    if (c.query !== undefined) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(c.query)) params.set(k, String(v));
      const result = parseSearchParams(schema, params);
      if (c.valid) {
        if (!result.ok) {
          findings.push(`${c.id}: expected valid query: ${result.error.issues[0]?.message}`);
          continue;
        }
        if (c.expect) {
          for (const [k, v] of Object.entries(c.expect)) {
            if (result.data[k] !== v) {
              findings.push(`${c.id}: expected ${k}=${v}, got ${result.data[k]}`);
            }
          }
        }
      } else if (result.ok) {
        findings.push(`${c.id}: expected invalid query`);
      } else if (c.pathIncludes) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        if (!paths.some((p) => p.includes(c.pathIncludes))) {
          findings.push(`${c.id}: expected issue path containing ${c.pathIncludes}`);
        }
      }
    }
    if (c.body !== undefined) {
      const parsed = schema.safeParse(c.body);
      if (c.valid === false && parsed.success) {
        findings.push(`${c.id}: expected invalid body`);
      }
      if (c.valid === true && !parsed.success) {
        findings.push(`${c.id}: expected valid body: ${parsed.error.issues[0]?.message}`);
      }
    }
  }
  return findings;
}

export function verifyOpenApiNamingConvention(rules, openApiSpec) {
  const findings = [];
  const re = new RegExp(rules.pattern);
  const schemas = openApiSpec?.components?.schemas ?? {};

  for (const name of Object.keys(schemas)) {
    if (!re.test(name)) {
      findings.push(`schema name "${name}" does not match ${rules.pattern}`);
    }
    for (const forbidden of rules.forbiddenSubstrings ?? []) {
      if (name.toLowerCase().includes(forbidden.toLowerCase())) {
        findings.push(`schema name "${name}" contains forbidden substring ${forbidden}`);
      }
    }
    const schema = schemas[name];
    if (
      rules.objectSchemasRequireAdditionalPropertiesFalse &&
      schema?.type === 'object' &&
      schema.additionalProperties !== false
    ) {
      findings.push(`schema ${name} must set additionalProperties: false`);
    }
  }

  return findings;
}

export function verifyOpenApiRefsResolve(openApiSpec) {
  const findings = [];
  const schemas = openApiSpec?.components?.schemas ?? {};
  const walk = (node, path = '') => {
    if (!node || typeof node !== 'object') return;
    if (node.$ref && typeof node.$ref === 'string') {
      const m = node.$ref.match(/^#\/components\/schemas\/(.+)$/);
      if (!m) {
        findings.push(`unexpected $ref at ${path}: ${node.$ref}`);
      } else if (!schemas[m[1]]) {
        findings.push(`unresolved $ref at ${path}: ${node.$ref}`);
      }
    }
    for (const [k, v] of Object.entries(node)) {
      walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(openApiSpec);
  return findings;
}

export function verifyRepoMetadataFiles(repoMeta) {
  const findings = [];
  for (const entry of repoMeta.requiredFiles ?? []) {
    const full = join(repoRoot, entry.path);
    if (!existsSync(full)) {
      findings.push(`required metadata file missing: ${entry.path}`);
      continue;
    }
    const content = readFileSync(full, 'utf8');
    if (entry.minLines && content.split('\n').length < entry.minLines) {
      findings.push(`${entry.path}: fewer than ${entry.minLines} lines`);
    }
    for (const needle of entry.mustInclude ?? []) {
      if (!content.includes(needle)) {
        findings.push(`${entry.path}: must include "${needle}"`);
      }
    }
    if (entry.json) {
      try {
        const parsed = JSON.parse(content);
        for (const field of entry.jsonFields ?? []) {
          const parts = field.split('.');
          let cur = parsed;
          for (const p of parts) {
            cur = cur?.[p];
          }
          if (cur === undefined) {
            findings.push(`${entry.path}: missing JSON field ${field}`);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        findings.push(`${entry.path}: invalid JSON (${msg})`);
      }
    }
  }
  return findings;
}

export function verifySchemaHelperRoundTrip({ parseOrThrow, buildSearchCustomersQuery, searchSchema, parseSearchParams }) {
  const findings = [];
  const qs = buildSearchCustomersQuery('GX195', 15);
  const params = new URLSearchParams(qs);
  try {
    parseOrThrow(searchSchema, { q: params.get('q'), limit: Number(params.get('limit')) }, 'roundtrip');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    findings.push(`parseOrThrow roundtrip failed: ${msg}`);
  }
  const worker = parseSearchParams(searchSchema, params);
  if (!worker.ok) {
    findings.push(`worker parseSearchParams roundtrip failed`);
  }
  return findings;
}

export function verifyValidationErrorShape(error, validationErrorBody) {
  const findings = [];
  const body = validationErrorBody(error);
  if (body.code !== 'VALIDATION_ERROR') findings.push('validationErrorBody.code must be VALIDATION_ERROR');
  if (body.status !== 'failed') findings.push('validationErrorBody.status must be failed');
  if (!Array.isArray(body.issues) || body.issues.length === 0) {
    findings.push('validationErrorBody.issues must be non-empty');
  }
  return findings;
}

export function runSchemaRegistryDashboardCases(registry, schemas) {
  const findings = [];
  for (const entry of registry.dashboard ?? []) {
    const schema = schemas[entry.schema];
    if (!schema) {
      findings.push(`registry: missing dashboard schema ${entry.schema}`);
      continue;
    }
    for (const c of entry.cases ?? []) {
      const result = schema.safeParse(c.input);
      if (c.expectValid) {
        if (!result.success) {
          findings.push(`${entry.schema}/${c.id}: expected valid: ${result.error.issues[0]?.message}`);
        }
        continue;
      }
      if (result.success) {
        findings.push(`${entry.schema}/${c.id}: expected invalid input to fail`);
        continue;
      }
      if (c.messageIncludes) {
        const msg = result.error.issues.map((i) => i.message).join(' ');
        if (!msg.includes(c.messageIncludes)) {
          findings.push(`${entry.schema}/${c.id}: expected message containing "${c.messageIncludes}"`);
        }
      }
      if (c.pathIncludes) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        if (!paths.some((p) => p.includes(c.pathIncludes))) {
          findings.push(`${entry.schema}/${c.id}: expected path containing ${c.pathIncludes}`);
        }
      }
    }
  }
  return findings;
}

export function runSchemaRegistryWorkerCases(registry, workerSchemas, parseSearchParams) {
  const findings = [];
  for (const entry of registry.worker ?? []) {
    const schema = workerSchemas[entry.schema];
    if (!schema) {
      findings.push(`registry: missing worker schema ${entry.schema}`);
      continue;
    }
    if (entry.query !== undefined) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(entry.query)) params.set(k, String(v));
      const result = parseSearchParams(schema, params);
      if (entry.valid === false) {
        if (result.ok) findings.push(`${entry.schema}: expected invalid query`);
        else {
          if (entry.messageIncludes) {
            const msg = result.error.issues.map((i) => i.message).join(' ');
            if (!msg.includes(entry.messageIncludes)) {
              findings.push(`${entry.schema}: expected message "${entry.messageIncludes}"`);
            }
          }
          if (entry.pathIncludes) {
            const paths = result.error.issues.map((i) => i.path.join('.'));
            if (!paths.some((p) => p.includes(entry.pathIncludes))) {
              findings.push(`${entry.schema}: expected path ${entry.pathIncludes}`);
            }
          }
        }
      } else if (entry.valid === true && !result.ok) {
        findings.push(`${entry.schema}: expected valid query`);
      }
    }
    if (entry.body !== undefined) {
      const parsed = schema.safeParse(entry.body);
      if (entry.valid === false && parsed.success) {
        findings.push(`${entry.schema}: expected invalid body`);
      }
      if (entry.valid === true && !parsed.success) {
        findings.push(`${entry.schema}: expected valid body`);
      }
    }
  }
  return findings;
}
