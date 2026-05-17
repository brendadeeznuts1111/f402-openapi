#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const specPath = path.resolve(process.argv[2] || path.join(root, '.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.examples.json'));
const outDir = path.resolve(process.argv[3] || path.join(root, '.o11y/fantasy402-redacted-deep/api-spec-secured/site'));
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function methodClass(method) {
  return method.toLowerCase();
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function resolveRef(schema) {
  if (!isObject(schema) || typeof schema.$ref !== 'string') return schema;
  const parts = schema.$ref.replace(/^#\//, '').split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let cursor = spec;
  for (const part of parts) cursor = cursor?.[part];
  return cursor || schema;
}

function requestBodyInfo(operation) {
  const content = operation.requestBody?.content || {};
  const contentType = Object.keys(content)[0] || 'none';
  const schema = resolveRef(content[contentType]?.schema || {});
  const properties = resolveRef(schema)?.properties || {};
  const required = new Set(resolveRef(schema)?.required || []);
  const requiredFields = Object.keys(properties).filter((name) => required.has(name));
  const optionalFields = Object.keys(properties).filter((name) => !required.has(name));

  return {
    contentType,
    requiredFields,
    optionalFields,
  };
}

const operations = [];
for (const [apiPath, methods] of Object.entries(spec.paths || {})) {
  for (const [method, operation] of Object.entries(methods)) {
    const body = requestBodyInfo(operation);
    operations.push({
      path: apiPath,
      method: method.toUpperCase(),
      summary: operation.summary || `${method.toUpperCase()} ${apiPath}`,
      roles: operation['x-required-roles'] || [],
      deprecated: operation.deprecated === true,
      rate: operation['x-rate-limit'],
      security: operation.security || [],
      responses: Object.keys(operation.responses || {}),
      examples: Object.values(operation.responses || {}).reduce((count, response) => (
        count + Object.keys(response.content?.['application/json']?.examples || {}).length
      ), 0),
      operationId: operation.operationId || '',
      requestContentType: body.contentType,
      requiredFields: body.requiredFields,
      optionalFields: body.optionalFields,
    });
  }
}
operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

const sensitiveSchemas = Object.entries(spec.components?.schemas || {})
  .filter(([, schema]) => JSON.stringify(schema).includes('"x-sensitive":true') || JSON.stringify(schema).includes('"x-sensitive": true'))
  .map(([name]) => name)
  .sort();

function collectSensitivePaths(value, pathParts = [], paths = []) {
  if (!isObject(value)) return paths;
  if (value['x-sensitive'] === true) paths.push(pathParts.join('.') || '(schema)');
  for (const [key, child] of Object.entries(value)) {
    collectSensitivePaths(child, pathParts.concat(key), paths);
  }
  return paths;
}

const sensitiveSchemaRows = Object.entries(spec.components?.schemas || {})
  .map(([name, schema]) => ({
    name,
    paths: collectSensitivePaths(schema)
      .map((pointer) => pointer.replace(/^properties\./, ''))
      .sort(),
  }))
  .filter((row) => row.paths.length)
  .sort((a, b) => a.name.localeCompare(b.name));

const deprecatedOperations = operations.filter((op) => op.deprecated);

function securityLocation(scheme) {
  if (scheme.type === 'apiKey') return `${scheme.in || ''}${scheme.name ? `: ${scheme.name}` : ''}`;
  return scheme.scheme || scheme.in || '';
}

function fieldTags(fields) {
  if (!fields.length) return '<span class="tag">none</span>';
  return fields.map((field) => `<code>${escapeHtml(field)}</code>`).join(' ');
}

function schemaNameFromRef(ref) {
  return typeof ref === 'string' && ref.startsWith('#/components/schemas/')
    ? ref.slice('#/components/schemas/'.length)
    : '';
}

function collectSchemaRefs(value, refs = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaRefs(item, refs);
    return refs;
  }
  if (!isObject(value)) return refs;
  const schemaName = schemaNameFromRef(value.$ref);
  if (schemaName) refs.add(schemaName);
  for (const child of Object.values(value)) collectSchemaRefs(child, refs);
  return refs;
}

function schemaUsageMap() {
  const usage = new Map();
  for (const [apiPath, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const opLabel = `${method.toUpperCase()} ${apiPath}`;
      for (const ref of collectSchemaRefs(operation)) {
        if (!usage.has(ref)) usage.set(ref, new Set());
        usage.get(ref).add(opLabel);
      }
    }
  }
  return usage;
}

function schemaContextMap() {
  const contexts = new Map();
  function add(ref, context) {
    if (!contexts.has(ref)) contexts.set(ref, new Set());
    contexts.get(ref).add(context);
  }
  for (const methods of Object.values(spec.paths || {})) {
    for (const operation of Object.values(methods || {})) {
      for (const ref of collectSchemaRefs(operation.requestBody || {})) add(ref, 'request');
      for (const response of Object.values(operation.responses || {})) {
        for (const ref of collectSchemaRefs(response)) add(ref, 'response');
      }
    }
  }
  return contexts;
}

function constraintSummary(schema) {
  const resolved = resolveRef(schema) || {};
  const constraints = [];
  for (const key of ['type', 'format', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern']) {
    if (resolved[key] !== undefined) constraints.push(`${key}: ${JSON.stringify(resolved[key])}`);
  }
  if (Array.isArray(resolved.enum)) constraints.push(`enum: ${resolved.enum.map((item) => JSON.stringify(item)).join(', ')}`);
  const itemRef = schemaNameFromRef(resolved.items?.$ref);
  if (itemRef) constraints.push(`items: ${itemRef}`);
  return constraints.length ? constraints.join('; ') : 'none';
}

function schemaFieldRows(name, schema) {
  const resolved = resolveRef(schema) || {};
  const properties = resolved.properties || {};
  const required = new Set(resolved.required || []);
  const rows = Object.entries(properties).map(([field, property]) => {
    const propertySchema = resolveRef(property) || property;
    const refName = schemaNameFromRef(property?.$ref) || schemaNameFromRef(propertySchema?.items?.$ref);
    return `<tr>
      <td>${propertySchema?.['x-sensitive'] === true ? '<span title="Sensitive field">🔒</span> ' : ''}<code>${escapeHtml(field)}</code></td>
      <td>${required.has(field) ? 'required' : 'optional'}</td>
      <td>${refName ? `<a href="#schema-${escapeHtml(refName)}"><code>${escapeHtml(refName)}</code></a>` : escapeHtml(constraintSummary(property))}</td>
    </tr>`;
  });
  if (!rows.length) {
    rows.push(`<tr><td colspan="3">${escapeHtml(constraintSummary(schema))}</td></tr>`);
  }
  return rows.join('\n');
}

function schemaType(schema) {
  const resolved = resolveRef(schema) || {};
  if (Array.isArray(resolved.type)) return resolved.type.join(' | ');
  if (resolved.type) return resolved.type;
  if (resolved.oneOf) return 'oneOf';
  if (resolved.anyOf) return 'anyOf';
  if (resolved.allOf) return 'allOf';
  return 'unspecified';
}

function countEnums(value) {
  if (Array.isArray(value)) return value.reduce((count, item) => count + countEnums(item), 0);
  if (!isObject(value)) return 0;
  return (Array.isArray(value.enum) ? 1 : 0)
    + Object.values(value).reduce((count, child) => count + countEnums(child), 0);
}

function collectSchemaSearchTerms(value, terms = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaSearchTerms(item, terms);
    return terms;
  }
  if (!isObject(value)) return terms;
  for (const key of ['type', 'format', 'pattern', 'description', 'x-privacy-classification']) {
    if (typeof value[key] === 'string') terms.add(value[key].toLowerCase());
  }
  if (Array.isArray(value.enum)) {
    for (const item of value.enum.slice(0, 20)) terms.add(String(item).toLowerCase());
  }
  for (const propertyName of Object.keys(value.properties || {})) terms.add(propertyName.toLowerCase());
  for (const child of Object.values(value)) collectSchemaSearchTerms(child, terms);
  return terms;
}

const schemaUsage = schemaUsageMap();
const schemaContexts = schemaContextMap();
const schemaRows = Object.entries(spec.components?.schemas || {})
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, schema]) => ({
    name,
    schema,
    type: schemaType(schema),
    category: Array.from(schemaContexts.get(name) || []).sort().join(' + ') || 'primitive',
    required: Array.isArray(schema.required) ? schema.required.slice().sort() : [],
    enumCount: countEnums(schema),
    sensitive: collectSensitivePaths(schema).length,
    usedBy: Array.from(schemaUsage.get(name) || []).sort(),
  }));

const roleOptions = Array.from(new Set(operations.flatMap((op) => op.roles))).sort();
const rateLimitRows = operations
  .filter((op) => op.rate?.limit && op.rate?.window)
  .map((op) => ({
    path: op.path,
    method: op.method,
    roles: op.roles,
    limit: Number(op.rate.limit),
    window: Number(op.rate.window),
  }));

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(spec.info?.title || 'Fantasy402 Secured API')}</title>
  <style>
    :root { color-scheme: light; --ink:#17202a; --muted:#5d6d7e; --line:#d7dde5; --bg:#f7f9fb; --panel:#fff; --accent:#0b5cad; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: var(--bg); }
    header { padding: 32px 40px 24px; background: #0f1720; color: white; }
    header p { max-width: 980px; color: #d7dde5; line-height: 1.5; }
    main { padding: 28px 40px 48px; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 12px; max-width: 1100px; margin-bottom: 28px; }
    .stat { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; }
    .stat strong { display: block; font-size: 28px; }
    .stat span { color: var(--muted); font-size: 13px; }
    table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 13px; }
    th { background: #edf2f7; font-size: 12px; text-transform: uppercase; color: #405163; }
    tr:last-child td { border-bottom: 0; }
    code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 12px; }
    .method { display: inline-block; min-width: 48px; padding: 2px 6px; border-radius: 4px; color: white; text-align: center; font-weight: 700; font-size: 11px; }
    .post { background: #1f7a4d; }
    .get { background: #0b5cad; }
    .tag { display: inline-block; padding: 2px 6px; margin: 1px 2px 1px 0; border-radius: 999px; background: #e7eef7; color: #243b53; font-size: 12px; }
    .deprecated { color: #9f3a38; font-weight: 700; }
    .section { margin-top: 32px; }
    .matrix td:not(:first-child), .matrix th:not(:first-child) { text-align: center; }
    .callout { border-left: 4px solid var(--accent); background: #eef5fc; padding: 12px 14px; margin: 12px 0; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 12px 0 16px; }
    .control { display: inline-flex; gap: 6px; align-items: center; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); font-size: 13px; }
    button, input, select, textarea { font: inherit; }
    button { border: 1px solid var(--line); background: #fff; border-radius: 6px; padding: 6px 9px; cursor: pointer; }
    button:hover { border-color: var(--accent); }
    pre { position: relative; margin: 12px 0; padding: 14px; overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: #101820; color: #edf2f7; }
    pre code { color: inherit; }
    .copy-code { position: absolute; top: 8px; right: 8px; background: #edf2f7; color: #17202a; }
    details.schema { margin: 10px 0; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
    details.schema > summary { cursor: pointer; padding: 12px 14px; font-weight: 700; }
    .schema-body { padding: 0 14px 14px; }
    .schema-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 14px 0; }
    .schema-controls input[type="search"] { min-width: min(420px, 100%); flex: 1; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; }
    .schema-filter.active { border-color: var(--accent); background: #eef5fc; color: var(--accent); }
    .schema-filter[data-filter="sensitive"].active { border-color: #9f3a38; color: #9f3a38; background: #fbeeee; }
    .schema-summary { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .schema-title { min-width: 220px; }
    .schema-meta-line { color: var(--muted); margin: 6px 0 10px; }
    .schema-grid-note { color: var(--muted); margin: 8px 0; }
    .schema-hidden { display: none; }
    #schema-empty { display: none; }
    #schema-empty.visible { display: block; }
    .sandbox { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 10px; max-width: 980px; }
    .sandbox label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
    .sandbox input, .sandbox select, .sandbox textarea { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 8px; }
    .sandbox textarea { grid-column: 1 / -1; min-height: 120px; font-family: "SFMono-Regular", Consolas, monospace; }
    .hidden-by-role { display: none; }
    @media (max-width: 760px) { header, main { padding-left: 18px; padding-right: 18px; } .stats { grid-template-columns: 1fr 1fr; } table { display: block; overflow-x: auto; } }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(spec.info?.title || 'Fantasy402 Secured API')}</h1>
    <p>${escapeHtml(spec.info?.description || '')}</p>
  </header>
  <main>
    <section class="stats">
      <div class="stat"><strong>${operations.length}</strong><span>Operations</span></div>
      <div class="stat"><strong>${Object.keys(spec.components?.schemas || {}).length}</strong><span>Schemas</span></div>
      <div class="stat"><strong>${sensitiveSchemas.length}</strong><span>Sensitive Schemas</span></div>
      <div class="stat"><strong>${operations.filter(op => op.deprecated).length}</strong><span>Deprecated</span></div>
    </section>

    <section>
      <h2>Operations</h2>
      <div class="toolbar" aria-label="Role filters">
        ${roleOptions.map((role) => `<label class="control"><input type="checkbox" class="role-filter" value="${escapeHtml(role)}" checked> ${escapeHtml(role)}</label>`).join('\n')}
        <button type="button" id="show-all-roles">Show all</button>
      </div>
      <table>
        <thead><tr><th>Method</th><th>Path</th><th>Roles</th><th>Responses</th><th>Rate Limit</th><th>Examples</th><th>Status</th></tr></thead>
        <tbody>
          ${operations.map(op => `<tr data-roles="${escapeHtml(op.roles.join(' '))}">
            <td><span class="method ${methodClass(op.method)}">${escapeHtml(op.method)}</span></td>
            <td><code>${escapeHtml(op.path)}</code><br>${escapeHtml(op.summary)}</td>
            <td>${op.roles.map(role => `<span class="tag">${escapeHtml(role)}</span>`).join('')}</td>
            <td>${op.responses.map(status => `<span class="tag">${escapeHtml(status)}</span>`).join('')}</td>
            <td>${op.rate ? `${escapeHtml(op.rate.limit)}/${escapeHtml(op.rate.window)}s` : ''}</td>
            <td>${escapeHtml(op.examples)}</td>
            <td>${op.deprecated ? '<span class="deprecated">Deprecated</span>' : 'Active'}</td>
          </tr>`).join('\n')}
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2>Rate Limit Calculator</h2>
      <div class="toolbar">
        <label class="control">Tier multiplier <input id="tier-multiplier" type="number" min="0.1" step="0.1" value="1" style="width:80px"></label>
        <label class="control">Operation <select id="rate-operation">
          ${rateLimitRows.map((op, index) => `<option value="${index}">${escapeHtml(op.method)} ${escapeHtml(op.path)} (${escapeHtml(op.limit)}/${escapeHtml(op.window)}s)</option>`).join('\n')}
        </select></label>
      </div>
      <div class="callout" id="rate-output"></div>
    </section>

    <section class="section">
      <h2>Try It Now Proxy</h2>
      <p>This sandbox calls the ingestion Worker operator API from your browser. Use a non-production token unless you intend to inspect protected diagnostics or archive routes.</p>
      <div class="sandbox">
        <label>Worker origin <input id="try-origin" value="https://fantasy402-ingestion.utahj4754.workers.dev"></label>
        <label>Bearer token <input id="try-token" type="password" autocomplete="off" placeholder="optional for /health"></label>
        <label>Route <select id="try-route">
          <option value="/health">GET /health</option>
          <option value="/diagnostics">GET /diagnostics</option>
          <option value="/scans?limit=5">GET /scans?limit=5</option>
          <option value="/alerts/summary?days=7">GET /alerts/summary?days=7</option>
        </select></label>
        <label>Method <select id="try-method"><option>GET</option><option>POST</option></select></label>
        <textarea id="try-output" readonly placeholder="Response appears here"></textarea>
      </div>
      <div class="toolbar"><button type="button" id="try-send">Send sandbox request</button></div>
    </section>

    <section class="section">
      <h2>Discovery</h2>
      <div class="callout">Use <code>openapi.json</code> as the stable machine-readable JSON contract for SDK generators, contract tests, and AI agents. Use <code>llms.txt</code> for a compact natural-language index before loading the full schema.</div>
      <table>
        <thead><tr><th>Artifact</th><th>Use</th></tr></thead>
        <tbody>
          <tr><td><code>openapi.json</code></td><td>Stable JSON alias for the secured examples contract.</td></tr>
          <tr><td><code>openapi.secured.examples.json</code></td><td>Versioned JSON artifact used by CI and the static docs.</td></tr>
          <tr><td><code>openapi.yaml</code></td><td>Stable YAML alias when the generated YAML artifact is present.</td></tr>
          <tr><td><code>llms.txt</code></td><td>Compact API map for AI-assisted clients and documentation agents.</td></tr>
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2>Mock Server Recipe</h2>
      <p>The examples contract is mock-server ready for local frontend development and generated-client smoke tests. This repo does not deploy a live mock runtime.</p>
      <pre><button type="button" class="copy-code" aria-label="Copy mock command">Copy</button><code>npx @stoplight/prism-cli mock .o11y/fantasy402-redacted-deep/api-spec-secured/site/openapi.secured.examples.json --host 127.0.0.1 --port 4010</code></pre>
      <p>Mock responses are synthetic and redacted. Use them for shape validation and UI wiring, not production wagering or settlement behavior.</p>
    </section>

    <section class="section">
      <h2>Role Capability Matrix</h2>
      <table class="matrix">
        <thead><tr><th>Capability</th><th>ROLE_AGENT</th><th>ROLE_MASTER</th><th>ROLE_SUB_AGENT</th></tr></thead>
        <tbody>
          <tr><td>Authenticate and refresh browser-derived upstream auth</td><td>Yes</td><td>Yes</td><td>Yes</td></tr>
          <tr><td>Read own hierarchy player and pending wager data</td><td>Yes</td><td>Yes</td><td>Yes, scoped</td></tr>
          <tr><td>Read sub-agent hierarchy data</td><td>No</td><td>Yes</td><td>Yes, scoped</td></tr>
          <tr><td>Read billing, settlement, and master accounting data</td><td>No</td><td>Yes</td><td>No</td></tr>
          <tr><td>Read transaction-entry reference data</td><td>Yes</td><td>Yes</td><td>No</td></tr>
          <tr><td>Access deprecated audit or print-detail surfaces</td><td>No, migration only</td><td>No, migration only</td><td>No</td></tr>
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2>Error Responses</h2>
      <p>Error responses retain the observed JSON shape where available and also document <code>application/problem+json</code> for RFC 9457-compatible clients. Rate-limited responses include <code>Retry-After</code>, <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code>, and <code>X-RateLimit-Reset</code> headers.</p>
      <table>
        <thead><tr><th>Status</th><th>Problem Type</th><th>Client Behavior</th></tr></thead>
        <tbody>
          <tr><td><code>400</code></td><td><code>about:blank</code></td><td>Fix missing or invalid form fields before retrying.</td></tr>
          <tr><td><code>401</code>/<code>403</code></td><td><code>about:blank</code></td><td>Refresh auth material or verify agent hierarchy authorization.</td></tr>
          <tr><td><code>410</code></td><td><code>about:blank</code></td><td>Stop calling deprecated endpoints and follow the operation migration guidance.</td></tr>
          <tr><td><code>429</code></td><td><code>https://fantasy402.com/errors/rate-limit-exceeded</code></td><td>Retry only after the greater of <code>Retry-After</code> or the rate-limit reset time.</td></tr>
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2>Deprecation Signals</h2>
      <p>Deprecated operations carry <code>Deprecation</code>, <code>Sunset</code>, and <code>Link</code> response headers in the contract so clients can surface migration warnings without scraping prose.</p>
      <table>
        <thead><tr><th>Operation</th><th>Reason</th><th>Replacement / Timeline</th></tr></thead>
        <tbody>
          ${deprecatedOperations.map(op => `<tr>
            <td><code>${escapeHtml(op.path)}</code></td>
            <td>${escapeHtml(op.path.includes('getWebLog') ? 'Audit-log surface exposes login activity, network addresses, and operational messages.' : 'Observed print-detail call returned Invalid Method and remains manual-review only.')}</td>
            <td>${escapeHtml(op.path.includes('getTicketDetailPrint') ? 'Replacement candidates: Report/getPendingByTicket, Report/getWagerDetailTransaction, or Manager/getWagaerDetailShort. Confirm exact print-detail replacement before removing manual-review flag. Sunset target: 2026-06-30.' : 'No like-for-like replacement has been observed. Treat 410 Gone as authoritative and keep blocked until a narrowed audit-log endpoint is captured. Sunset target: 2026-06-30.')}</td>
          </tr>`).join('\n')}
        </tbody>
      </table>
    </section>

    <section class="section" id="schemas">
      <h2>Schemas</h2>
      <p>All component schemas are shown below. Sensitive fields are marked with <span title="Sensitive field">🔒</span>, references link to other schemas, and usage lists show which operations reference each schema.</p>
      <div class="schema-controls" aria-label="Schema filters">
        <input id="schema-search" type="search" placeholder="Search schemas, fields, constraints, or operations" autocomplete="off">
        <button type="button" class="schema-filter active" data-filter="all">All</button>
        <button type="button" class="schema-filter" data-filter="sensitive">Sensitive</button>
        <button type="button" class="schema-filter" data-filter="request">Request</button>
        <button type="button" class="schema-filter" data-filter="response">Response</button>
        <button type="button" class="schema-filter" data-filter="primitive">Primitive</button>
        <button type="button" id="expand-schemas">Expand visible</button>
        <button type="button" id="collapse-schemas">Collapse all</button>
      </div>
      <p class="schema-grid-note"><span id="schema-visible-count">${schemaRows.length}</span> of ${schemaRows.length} schemas shown.</p>
      <table>
        <thead><tr><th>Schema</th><th>Type</th><th>Required Fields</th><th>Sensitive Fields</th><th>Enum Count</th><th>Operation Usage</th></tr></thead>
        <tbody>
          ${schemaRows.map((row) => `<tr>
            <td><a href="#schema-${escapeHtml(row.name)}"><code>${escapeHtml(row.name)}</code></a></td>
            <td>${escapeHtml(row.type)}</td>
            <td>${fieldTags(row.required)}</td>
            <td>${row.sensitive ? `<span class="tag">${escapeHtml(row.sensitive)}</span>` : '<span class="tag">none</span>'}</td>
            <td>${escapeHtml(row.enumCount)}</td>
            <td>${escapeHtml(row.usedBy.length)}</td>
          </tr>`).join('\n')}
        </tbody>
      </table>
      <div id="schema-empty" class="callout">No schemas match the current search and filter.</div>
      ${schemaRows.map((row) => {
        const searchText = [
          row.name,
          row.type,
          row.category,
          row.required.join(' '),
          row.usedBy.join(' '),
          collectSensitivePaths(row.schema).join(' '),
          constraintSummary(row.schema),
          Array.from(collectSchemaSearchTerms(row.schema)).join(' '),
        ].join(' ').toLowerCase();
        return `<details class="schema" id="schema-${escapeHtml(row.name)}" data-schema-name="${escapeHtml(row.name.toLowerCase())}" data-schema-category="${escapeHtml(row.category)}" data-schema-sensitive="${row.sensitive ? 'true' : 'false'}" data-schema-search="${escapeHtml(searchText)}">
        <summary><span class="schema-summary"><span class="schema-title"><code>${escapeHtml(row.name)}</code></span><span class="tag">${escapeHtml(row.type)}</span><span class="tag">${escapeHtml(row.category)}</span>${row.sensitive ? `<span class="tag">${row.sensitive} sensitive</span>` : ''}<span class="tag">${escapeHtml(row.usedBy.length)} ops</span></span></summary>
        <div class="schema-body">
          <p>${escapeHtml(row.schema.description || 'No schema description.')}</p>
          <p class="schema-meta-line"><strong>Required:</strong> ${fieldTags(row.required)} <strong>Enums:</strong> ${escapeHtml(row.enumCount)} <strong>Sensitive fields:</strong> ${escapeHtml(row.sensitive)}</p>
          <p><strong>Used by:</strong> ${row.usedBy.length ? row.usedBy.map((op) => `<code>${escapeHtml(op)}</code>`).join(' ') : '<span class="tag">not directly referenced by operations</span>'}</p>
          <table>
            <thead><tr><th>Field</th><th>Required</th><th>Constraints / Reference</th></tr></thead>
            <tbody>${schemaFieldRows(row.name, row.schema)}</tbody>
          </table>
        </div>
      </details>`;
      }).join('\n')}
    </section>

    <section class="section" id="operation-request-parameters">
      <h2>Operation Request Parameters</h2>
      <p>Every non-GET operation in this secured contract has a request body schema and at least one required parameter. Common form-encoded read operations use <code>CommonAgentRequest</code>: <code>agentID</code> and <code>operation</code> are required; <code>RRO</code>, <code>agentOwner</code>, date fields, and <code>customerID</code> are documented when observed. The Worker sends the browser-observed routing tuple for default ingestion endpoints.</p>
      <table>
        <thead><tr><th>Method</th><th>Operation</th><th>Content Type</th><th>Required Params</th><th>Optional / Observed Params</th></tr></thead>
        <tbody>
          ${operations.map(op => `<tr>
            <td><span class="method ${methodClass(op.method)}">${escapeHtml(op.method)}</span></td>
            <td><code>${escapeHtml(op.path)}</code><br>${escapeHtml(op.operationId || op.summary)}</td>
            <td>${escapeHtml(op.requestContentType)}</td>
            <td>${fieldTags(op.requiredFields)}</td>
            <td>${fieldTags(op.optionalFields)}</td>
          </tr>`).join('\n')}
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2>Security Schemes</h2>
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Location/Scheme</th><th>Description</th></tr></thead>
        <tbody>
          ${Object.entries(spec.components?.securitySchemes || {}).map(([name, scheme]) => `<tr>
            <td><code>${escapeHtml(name)}</code></td>
            <td>${escapeHtml(scheme.type)}</td>
            <td>${escapeHtml(securityLocation(scheme))}</td>
            <td>${escapeHtml(scheme.description || '')}</td>
          </tr>`).join('\n')}
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2>Worker Environment And Secrets Matrix</h2>
      <p>The ingestion Worker reports only presence/absence for secrets in <code>/diagnostics</code>. Secret values must stay in Cloudflare Secrets Store or Worker secrets, never in the OpenAPI artifacts.</p>
      <table>
        <thead><tr><th>Name</th><th>Kind</th><th>Binding Source</th><th>Required</th><th>Used For</th><th>Diagnostics</th></tr></thead>
        <tbody>
          <tr><td><code>SESSION_KV</code></td><td>binding</td><td>KV namespace</td><td>Yes</td><td>Session cache and refresh bookkeeping.</td><td><code>bindings.sessionKv</code></td></tr>
          <tr><td><code>AUTH_CACHE</code></td><td>binding</td><td>KV namespace</td><td>Yes</td><td>Short-lived browser auth overlay populated by protected <code>/refresh-auth</code>.</td><td><code>bindings.authCache</code></td></tr>
          <tr><td><code>ANALYTICS_DB</code></td><td>binding</td><td>D1 database</td><td>Yes</td><td>Runs, snapshots, failures, scan verdicts, network summaries, and alert metadata.</td><td><code>bindings.analyticsDb</code></td></tr>
          <tr><td><code>RAW_ARCHIVE</code></td><td>binding</td><td>R2 bucket</td><td>Yes</td><td>Raw success/failure archives, scan artifacts, screenshots, HAR files, and alert payloads.</td><td><code>bindings.rawArchive</code></td></tr>
          <tr><td><code>ENVIRONMENT</code></td><td>var</td><td><code>wrangler.toml</code></td><td>Yes</td><td>Runtime environment label.</td><td><code>environment</code></td></tr>
          <tr><td><code>WORKER_NAME</code></td><td>var</td><td><code>wrangler.toml</code></td><td>Yes</td><td>Deployment identity and diagnostics.</td><td><code>workerName</code></td></tr>
          <tr><td><code>CLOUDFLARE_ACCOUNT_ID</code></td><td>var</td><td><code>wrangler.toml</code></td><td>Yes</td><td>Cloudflare URL Scanner API account scope.</td><td><code>cloudflare.accountId</code></td></tr>
          <tr><td><code>CLOUDFLARE_ZONE_ID</code></td><td>var</td><td><code>wrangler.toml</code></td><td>Yes</td><td>Zone identity for operator context.</td><td><code>cloudflare.zoneId</code></td></tr>
          <tr><td><code>FANTASY402_BASE_URL</code></td><td>var</td><td><code>wrangler.toml</code></td><td>Yes</td><td>Upstream Fantasy402 origin.</td><td>Implicit</td></tr>
          <tr><td><code>FANTASY402_AUTH_STATE</code></td><td>var/constant</td><td>code or <code>wrangler.toml</code></td><td>No</td><td>Static authentication flow value for <code>state</code>; observed as <code>true</code>.</td><td>Not secret</td></tr>
          <tr><td><code>FANTASY402_AUTH_MULTIACCOUNT</code></td><td>var/constant</td><td>code or <code>wrangler.toml</code></td><td>No</td><td>Static authentication flow value for <code>multiaccount</code>; observed as <code>1</code>.</td><td>Not secret</td></tr>
          <tr><td><code>FANTASY402_AUTH_RESPONSE_TYPE</code></td><td>var/constant</td><td>code or <code>wrangler.toml</code></td><td>No</td><td>Static authentication flow value for <code>response_type</code>; observed as <code>code</code>.</td><td>Not secret</td></tr>
          <tr><td><code>FANTASY402_AUTH_DOMAIN</code></td><td>var/constant</td><td>code or <code>wrangler.toml</code></td><td>No</td><td>Static authentication flow value for <code>domain</code>; observed as <code>fantasy402.com</code>.</td><td>Not secret</td></tr>
          <tr><td><code>FANTASY402_AUTH_REDIRECT_URI</code></td><td>var/constant</td><td>code or <code>wrangler.toml</code></td><td>No</td><td>Static authentication flow value for <code>redirect_uri</code>; observed as <code>fantasy402.com</code>.</td><td>Not secret</td></tr>
          <tr><td><code>FANTASY402_AUTH_OPERATION</code></td><td>constant</td><td>code</td><td>No</td><td>Static authentication flow value for <code>operation</code>; always <code>authenticateCustomer</code>.</td><td>Not secret</td></tr>
          <tr><td><code>FANTASY402_AUTH_RRO</code></td><td>var/constant</td><td>code or <code>wrangler.toml</code></td><td>No</td><td>Static authentication flow value for <code>RRO</code>; observed as <code>1</code>.</td><td>Not secret</td></tr>
          <tr><td><code>FANTASY402_INGESTION_ENDPOINTS</code></td><td>var</td><td><code>wrangler.toml</code></td><td>Yes</td><td>Comma-separated read-only ingestion endpoint keys.</td><td><code>configuredEndpoints</code></td></tr>
          <tr><td><code>FANTASY402_ALLOWED_SCAN_HOSTS</code></td><td>var</td><td><code>wrangler.toml</code></td><td>Yes</td><td>URL Scanner host allowlist for unexpected-host alerts.</td><td><code>scanPolicy.allowedHosts</code></td></tr>
          <tr><td><code>FANTASY402_REFERER</code></td><td>var/secret</td><td><code>wrangler.toml</code> or secret</td><td>Recommended</td><td>Browser-compatible upstream <code>Referer</code> header.</td><td><code>optionalSecrets.FANTASY402_REFERER</code></td></tr>
          <tr><td><code>FANTASY402_USER_AGENT</code></td><td>var/secret</td><td><code>wrangler.toml</code> or secret</td><td>Recommended</td><td>Browser-compatible upstream <code>User-Agent</code> header.</td><td><code>optionalSecrets.FANTASY402_USER_AGENT</code></td></tr>
          <tr><td><code>FANTASY402_USERNAME</code></td><td>secret</td><td>Secrets Store</td><td>Yes</td><td>Fallback login attempt when no browser session cookie is configured.</td><td><code>requiredSecrets</code></td></tr>
          <tr><td><code>FANTASY402_PASSWORD</code></td><td>secret</td><td>Secrets Store</td><td>Yes</td><td>Fallback login attempt only. Never emitted in archives or docs.</td><td><code>requiredSecrets</code></td></tr>
          <tr><td><code>FANTASY402_AGENT_ID</code></td><td>secret</td><td>Secrets Store</td><td>Yes</td><td>Agent-scoped request body fields for read-only ingestion calls.</td><td><code>requiredSecrets</code></td></tr>
          <tr><td><code>CLOUDFLARE_API_TOKEN</code></td><td>secret</td><td>Secrets Store</td><td>Yes</td><td>Cloudflare URL Scanner submit/search/result calls.</td><td><code>requiredSecrets</code></td></tr>
          <tr><td><code>FANTASY402_SESSION_COOKIE</code></td><td>secret</td><td>Secrets Store</td><td>Recommended</td><td>Optional browser-observed non-Cloudflare application cookie. Included in every upstream Cookie header when configured.</td><td><code>optionalSecrets.FANTASY402_SESSION_COOKIE</code></td></tr>
          <tr><td><code>FANTASY402_AUTHORIZATION</code></td><td>secret</td><td>Worker secret</td><td>Recommended</td><td>Browser-observed bearer token for upstream API calls.</td><td><code>optionalSecrets.FANTASY402_AUTHORIZATION</code></td></tr>
          <tr><td><code>FANTASY402_CF_CLEARANCE</code></td><td>secret</td><td>Secrets Store</td><td>Recommended</td><td>Cloudflare <code>cf_clearance</code> cookie appended to upstream requests.</td><td><code>optionalSecrets.FANTASY402_CF_CLEARANCE</code></td></tr>
          <tr><td><code>FANTASY402_CF_BM</code></td><td>secret</td><td>Secrets Store</td><td>Recommended</td><td>Cloudflare <code>__cf_bm</code> cookie appended to upstream requests.</td><td><code>optionalSecrets.FANTASY402_CF_BM</code></td></tr>
          <tr><td><code>FANTASY402_BROWSER_HEADERS_JSON</code></td><td>secret</td><td>Secrets Store</td><td>Recommended</td><td>Allowlisted observed browser metadata headers for upstream replay.</td><td><code>optionalSecrets.FANTASY402_BROWSER_HEADERS_JSON</code></td></tr>
          <tr><td><code>FANTASY402_CUSTOMER_ID</code></td><td>secret</td><td>Worker secret or Secrets Store</td><td>Optional</td><td>Customer-scoped endpoints such as pending or communication messages.</td><td><code>optionalSecrets.FANTASY402_CUSTOMER_ID</code></td></tr>
          <tr><td><code>INGESTION_TRIGGER_TOKEN</code></td><td>secret</td><td>Worker secret</td><td>Recommended</td><td>Preferred bearer token for protected operator routes.</td><td><code>auth.acceptedSecrets</code></td></tr>
          <tr><td><code>ARCHIVE_AUTH_TOKEN</code></td><td>secret</td><td>Worker secret</td><td>Fallback</td><td>Fallback bearer token for archive, diagnostics, scan, and alert routes.</td><td><code>auth.acceptedSecrets</code></td></tr>
          <tr><td><code>ALERT_WEBHOOK_URL</code></td><td>secret</td><td>Worker secret or Secrets Store</td><td>Optional</td><td>External alert delivery for ingestion and scan findings.</td><td><code>optionalSecrets.ALERT_WEBHOOK_URL</code></td></tr>
        </tbody>
      </table>
      <p>For default form-encoded ingestion endpoints, the Worker sends the browser-observed routing tuple together: <code>RRO=1</code>, <code>agentID=&lt;FANTASY402_AGENT_ID&gt;</code>, <code>agentOwner=&lt;FANTASY402_AGENT_ID&gt;</code>, and <code>operation=&lt;endpoint operation&gt;</code>. <code>RRO</code> is static and non-sensitive, so it stays in code rather than Secrets Store.</p>
    </section>

    <section class="section">
      <h2>Runtime Auth Refresh</h2>
      <p><code>POST /refresh-auth</code> lets an operator or headless browser refresher update browser-derived upstream auth without changing Cloudflare secrets. The route is protected by the same bearer token as archive, scan, alert, and diagnostics routes. The runtime overlay takes precedence over configured Fantasy402 auth secrets until its TTL expires.</p>
      <table>
        <thead><tr><th>Accepted Field</th><th>Stored In</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td><code>authorization</code></td><td><code>AUTH_CACHE</code></td><td>Write-only browser bearer value; normalized to <code>Bearer ...</code>.</td></tr>
          <tr><td><code>sessionCookie</code></td><td><code>AUTH_CACHE</code></td><td>Write-only browser cookie fragment for any non-Cloudflare application cookies observed in successful browser traffic.</td></tr>
          <tr><td><code>cfClearance</code></td><td><code>AUTH_CACHE</code></td><td>Write-only <code>cf_clearance</code> cookie value or name/value pair.</td></tr>
          <tr><td><code>cfBm</code></td><td><code>AUTH_CACHE</code></td><td>Write-only <code>__cf_bm</code> cookie value or name/value pair.</td></tr>
          <tr><td><code>browserHeaders</code> / <code>browserHeadersJson</code></td><td><code>AUTH_CACHE</code></td><td>Allowlisted browser metadata headers only; auth and cookie headers remain controlled by Worker code.</td></tr>
          <tr><td><code>expiresInSeconds</code></td><td><code>AUTH_CACHE</code></td><td>Overlay TTL clamped between 60 seconds and 8 hours. Responses return only field names and expiry metadata.</td></tr>
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2>Upstream Cookie Assembly</h2>
      <p>The Worker preserves any browser-observed non-Cloudflare application cookie when it is configured. It adds <code>FANTASY402_SESSION_COOKIE</code> first, then appends any refreshed session cookie, <code>cf_clearance</code>, and <code>__cf_bm</code> without replacing existing cookie names.</p>
      <table>
        <thead><tr><th>Order</th><th>Cookie Source</th><th>Behavior</th></tr></thead>
        <tbody>
          <tr><td>1</td><td><code>FANTASY402_SESSION_COOKIE</code> or <code>AUTH_CACHE.sessionCookie</code></td><td>Optional application cookie. Always included when present.</td></tr>
          <tr><td>2</td><td>Fallback login session</td><td>Added only when a cookie with the same name is not already present.</td></tr>
          <tr><td>3</td><td><code>FANTASY402_CF_CLEARANCE</code> or <code>AUTH_CACHE.cfClearance</code></td><td>Cloudflare clearance cookie, normalized to <code>cf_clearance=...</code> if only the value is supplied.</td></tr>
          <tr><td>4</td><td><code>FANTASY402_CF_BM</code> or <code>AUTH_CACHE.cfBm</code></td><td>Cloudflare Bot Management cookie, normalized to <code>__cf_bm=...</code> if only the value is supplied.</td></tr>
        </tbody>
      </table>
      <p>Expected sanitized shape when an app cookie exists: <code>app_session=&lt;redacted&gt;; cf_clearance=&lt;redacted&gt;; __cf_bm=&lt;redacted&gt;</code>. Current captures may only show Cloudflare cookies; diagnostics reports names, not values.</p>
    </section>

    <section class="section">
      <h2>Observed Authentication Form</h2>
      <p><code>POST /cloud/api/System/authenticateCustomer</code> was observed as a browser form-encoded request. The password field is documented as write-only and every example is redacted.</p>
      <table>
        <thead><tr><th>Field</th><th>Type</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td><code>customerID</code></td><td>string</td><td>Sensitive account identifier.</td></tr>
          <tr><td><code>state</code></td><td>boolean</td><td>Static non-sensitive flow value. Observed value: <code>true</code>.</td></tr>
          <tr><td><code>password</code></td><td>string</td><td>Write-only credential. Never returned by the API; examples use <code>__REDACTED_PASSWORD__</code>.</td></tr>
          <tr><td><code>multiaccount</code></td><td>integer</td><td>Static non-sensitive flow value. Observed value: <code>1</code>.</td></tr>
          <tr><td><code>response_type</code></td><td>string</td><td>Static non-sensitive flow value. Observed value: <code>code</code>.</td></tr>
          <tr><td><code>client_id</code></td><td>string</td><td>Sensitive account/client identifier.</td></tr>
          <tr><td><code>domain</code></td><td>string</td><td>Static non-sensitive flow value. Observed value: <code>fantasy402.com</code>.</td></tr>
          <tr><td><code>redirect_uri</code></td><td>string</td><td>Static non-sensitive flow value. Observed value: <code>fantasy402.com</code>.</td></tr>
          <tr><td><code>operation</code></td><td>string</td><td>Static non-sensitive discriminator. Required value: <code>authenticateCustomer</code>.</td></tr>
          <tr><td><code>RRO</code></td><td>integer</td><td>Static non-sensitive request flag. Observed value: <code>1</code>.</td></tr>
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2>Sensitive Schemas</h2>
      <p>These schemas contain fields annotated with <code>x-sensitive: true</code>. Synthetic examples are linted so they do not contain raw credentials, live tokens, cookies, or real-looking PII.</p>
      <table>
        <thead><tr><th>Schema</th><th>Sensitive Fields</th></tr></thead>
        <tbody>
          ${sensitiveSchemaRows.map(row => `<tr>
            <td><code>${escapeHtml(row.name)}</code></td>
            <td>${row.paths.map(field => `<code>${escapeHtml(field)}</code>`).join(' ')}</td>
          </tr>`).join('\n')}
        </tbody>
      </table>
    </section>
  </main>
  <script type="application/json" id="rate-limit-data">${JSON.stringify(rateLimitRows).replaceAll('<', '\\u003c')}</script>
  <script>
    const roleInputs = Array.from(document.querySelectorAll('.role-filter'));
    function applyRoleFilters() {
      const active = new Set(roleInputs.filter((input) => input.checked).map((input) => input.value));
      document.querySelectorAll('tr[data-roles]').forEach((row) => {
        const roles = String(row.dataset.roles || '').split(/\\s+/).filter(Boolean);
        row.classList.toggle('hidden-by-role', roles.length > 0 && !roles.some((role) => active.has(role)));
      });
    }
    roleInputs.forEach((input) => input.addEventListener('change', applyRoleFilters));
    document.querySelector('#show-all-roles')?.addEventListener('click', () => {
      roleInputs.forEach((input) => { input.checked = true; });
      applyRoleFilters();
    });

    document.querySelectorAll('pre').forEach((pre) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy-code';
      button.textContent = 'Copy';
      button.addEventListener('click', async () => {
        await navigator.clipboard.writeText(pre.innerText);
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy'; }, 1200);
      });
      pre.appendChild(button);
    });

    const rateData = JSON.parse(document.querySelector('#rate-limit-data')?.textContent || '[]');
    const rateSelect = document.querySelector('#rate-operation');
    const tierInput = document.querySelector('#tier-multiplier');
    const rateOutput = document.querySelector('#rate-output');
    function updateRateLimit() {
      const selected = rateData[Number(rateSelect?.value || 0)];
      if (!selected || !rateOutput) return;
      const multiplier = Math.max(Number(tierInput?.value || 1), 0);
      const budget = Math.floor(selected.limit * multiplier);
      const perMinute = Math.floor((budget * 60) / selected.window);
      rateOutput.textContent = selected.method + ' ' + selected.path + ': ' + budget + ' requests per ' + selected.window + 's window, approximately ' + perMinute + ' requests/min at tier multiplier ' + multiplier + '.';
    }
    rateSelect?.addEventListener('change', updateRateLimit);
    tierInput?.addEventListener('input', updateRateLimit);
    updateRateLimit();

    document.querySelector('#try-send')?.addEventListener('click', async () => {
      const output = document.querySelector('#try-output');
      const origin = String(document.querySelector('#try-origin')?.value || '').replace(/\\/$/, '');
      const route = String(document.querySelector('#try-route')?.value || '/health');
      const method = String(document.querySelector('#try-method')?.value || 'GET');
      const token = String(document.querySelector('#try-token')?.value || '');
      output.value = 'Sending...';
      try {
        const headers = { Accept: 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        const response = await fetch(origin + route, { method, headers });
        const text = await response.text();
        output.value = JSON.stringify({ status: response.status, body: text ? JSON.parse(text) : null }, null, 2);
      } catch (error) {
        output.value = error instanceof Error ? error.message : String(error);
      }
    });

    const schemaSearch = document.querySelector('#schema-search');
    const schemaFilters = Array.from(document.querySelectorAll('.schema-filter'));
    const schemaCards = Array.from(document.querySelectorAll('details.schema'));
    const schemaVisibleCount = document.querySelector('#schema-visible-count');
    const schemaEmpty = document.querySelector('#schema-empty');
    let activeSchemaFilter = 'all';

    function schemaMatchesFilter(card) {
      if (activeSchemaFilter === 'all') return true;
      if (activeSchemaFilter === 'sensitive') return card.dataset.schemaSensitive === 'true';
      return String(card.dataset.schemaCategory || '').includes(activeSchemaFilter);
    }

    function applySchemaFilters() {
      const query = String(schemaSearch?.value || '').trim().toLowerCase();
      let visible = 0;
      for (const card of schemaCards) {
        const matchesQuery = !query || String(card.dataset.schemaSearch || '').includes(query);
        const show = matchesQuery && schemaMatchesFilter(card);
        card.classList.toggle('schema-hidden', !show);
        if (show) visible += 1;
      }
      if (schemaVisibleCount) schemaVisibleCount.textContent = String(visible);
      schemaEmpty?.classList.toggle('visible', visible === 0);
    }

    schemaSearch?.addEventListener('input', applySchemaFilters);
    schemaFilters.forEach((button) => {
      button.addEventListener('click', () => {
        activeSchemaFilter = String(button.dataset.filter || 'all');
        schemaFilters.forEach((candidate) => candidate.classList.toggle('active', candidate === button));
        applySchemaFilters();
      });
    });
    document.querySelector('#expand-schemas')?.addEventListener('click', () => {
      schemaCards.forEach((card) => {
        if (!card.classList.contains('schema-hidden')) card.open = true;
      });
    });
    document.querySelector('#collapse-schemas')?.addEventListener('click', () => {
      schemaCards.forEach((card) => { card.open = false; });
    });
    applySchemaFilters();
  </script>
</body>
</html>`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
fs.copyFileSync(specPath, path.join(outDir, 'openapi.secured.examples.json'));
fs.writeFileSync(path.join(outDir, '_redirects'), [
  '/openapi.json /openapi.secured.examples.json 200',
  '/openapi.yaml /openapi.secured.examples.yaml 200',
  '',
].join('\n'));

const llmsText = `# ${spec.info?.title || 'Fantasy402 API'}
> Secured observed contract for Fantasy402 pay-per-head sportsbook operations.

## Overview
- Operations: ${operations.length}
- Schemas: ${Object.keys(spec.components?.schemas || {}).length}
- Sensitive schemas: ${sensitiveSchemas.length}
- Deprecated operations: ${deprecatedOperations.length}
- Authentication: session cookie or bearer token plus browser-derived Cloudflare/application cookies where required.
- Primary roles: ROLE_AGENT, ROLE_MASTER, ROLE_SUB_AGENT.

## Key Workflows
1. authenticateCustomer -> cached bearer/session auth for ingestion.
2. getPlayers -> Pending -> getWagerDetailTransaction for player and wager workflows.
3. getAgentPositionList -> getAgentPositionData for risk-management workflows.
4. URL Scanner evidence -> scan verdicts, screenshots, HAR summaries, and alert metadata.

## Artifacts
- Stable OpenAPI JSON: ./openapi.json
- Stable OpenAPI YAML: ./openapi.yaml
- Versioned examples spec: ./openapi.secured.examples.json
- HTML reference: ./index.html

## Safety Notes
- Credential fields are removed from response schemas and examples.
- Account identifiers, login names, emails, names, and IP-like fields carry x-sensitive metadata.
- Error responses document application/problem+json and rate-limit retry headers.
- Deprecated endpoints carry Deprecation, Sunset, and Link header contracts.
`;
fs.writeFileSync(path.join(outDir, 'llms.txt'), llmsText);

console.log(JSON.stringify({
  output: path.relative(root, path.join(outDir, 'index.html')),
  operations: operations.length,
  sensitiveSchemas: sensitiveSchemas.length,
}, null, 2));
