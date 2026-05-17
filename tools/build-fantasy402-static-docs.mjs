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
      <table>
        <thead><tr><th>Method</th><th>Path</th><th>Roles</th><th>Responses</th><th>Rate Limit</th><th>Examples</th><th>Status</th></tr></thead>
        <tbody>
          ${operations.map(op => `<tr>
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
        <thead><tr><th>Operation</th><th>Reason</th><th>Migration</th></tr></thead>
        <tbody>
          ${deprecatedOperations.map(op => `<tr>
            <td><code>${escapeHtml(op.path)}</code></td>
            <td>${escapeHtml(op.path.includes('getWebLog') ? 'Audit-log surface exposes login activity, network addresses, and operational messages.' : 'Observed print-detail call returned Invalid Method and remains manual-review only.')}</td>
            <td>${escapeHtml(op.path.includes('getTicketDetailPrint') ? 'Use getPendingByTicket, getWagerDetailTransaction, or Manager/getWagaerDetailShort for read-only ticket data.' : 'Use a narrowed audit-log endpoint when one is available.')}</td>
          </tr>`).join('\n')}
        </tbody>
      </table>
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
