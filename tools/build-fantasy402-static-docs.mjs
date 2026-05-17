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

const operations = [];
for (const [apiPath, methods] of Object.entries(spec.paths || {})) {
  for (const [method, operation] of Object.entries(methods)) {
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
    });
  }
}
operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

const sensitiveSchemas = Object.entries(spec.components?.schemas || {})
  .filter(([, schema]) => JSON.stringify(schema).includes('"x-sensitive":true') || JSON.stringify(schema).includes('"x-sensitive": true'))
  .map(([name]) => name)
  .sort();

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
      <h2>Security Schemes</h2>
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Location/Scheme</th><th>Description</th></tr></thead>
        <tbody>
          ${Object.entries(spec.components?.securitySchemes || {}).map(([name, scheme]) => `<tr>
            <td><code>${escapeHtml(name)}</code></td>
            <td>${escapeHtml(scheme.type)}</td>
            <td>${escapeHtml(scheme.in || scheme.scheme || '')}</td>
            <td>${escapeHtml(scheme.description || '')}</td>
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

console.log(JSON.stringify({
  output: path.relative(root, path.join(outDir, 'index.html')),
  operations: operations.length,
  sensitiveSchemas: sensitiveSchemas.length,
}, null, 2));
