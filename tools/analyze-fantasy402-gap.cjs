const fs = require('fs');
const path = require('path');

const root = process.cwd();
const maxSpecPath = path.join(root, '.o11y/fantasy402-max/api-spec/openapi.json');
const latestSpecPath = path.join(root, '.o11y/fantasy402-redacted-deep/api-spec/openapi.json');
const latestSamplesPath = path.join(root, '.o11y/fantasy402-redacted-deep/api-spec/intermediate/endpoint-samples.jsonl');
const outDir = path.join(root, '.o11y/fantasy402-redacted-deep/gap-analysis');

const mutationRe = /^(insert|update|save|set|apply|remove|delete|change|created|create|send|mailAgentNew|mailAgentUpdate|mailAgentDelete)/i;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function operationFromPath(apiPath) {
  return apiPath.split('/').filter(Boolean).at(-1) || apiPath;
}

function endpointSet(spec) {
  const rows = [];
  for (const [apiPath, methods] of Object.entries(spec.paths || {})) {
    for (const method of Object.keys(methods)) {
      const operation = operationFromPath(apiPath);
      rows.push({
        key: `${method.toUpperCase()} ${apiPath}`,
        method: method.toUpperCase(),
        path: apiPath,
        operation,
        firstPartyApi: apiPath.startsWith('/cloud/api/'),
        readShaped: !mutationRe.test(operation),
      });
    }
  }
  return rows;
}

function parseBody(body) {
  if (!body || typeof body !== 'string') return {};
  const params = new URLSearchParams(body);
  return redactParams(Object.fromEntries(params.entries()));
}

function redactParams(params) {
  const sensitive = /^(customerID|CustomerID|client_id|login|Login|account|office|player|agent|Agent|AgentID|agentID|agentOwner|parentId|MasterAgentID|MasterLogin|NameFirst|NameLast|name|Criterio|pass|password|Password|token|code|authorization)$/i;
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [
    key,
    sensitive.test(key) ? '__REDACTED__' : value,
  ]));
}

function repairSuggestion(sample, successfulByPath) {
  const operation = operationFromPath(sample.path);
  if (sample.path === '/cloud/api/Report/Pending') {
    return {
      disposition: successfulByPath.has(sample.path) ? 'repairable' : 'needs-live-validation',
      replacementPath: sample.path,
      replacementOperation: operation,
      paramMap: {
        customerID: 'discoveredPlayerCustomerID',
      },
      notes: [
        'The 400 sample used the agent/account customerID and returned Invalid CustomerID.',
        'The later repaired sample returned 200 after customerID was sourced from a player record discovered via searchCustomerAdmin/getPlayers.',
      ],
    };
  }

  if (sample.path === '/cloud/api/Report/getTicketDetailPrint') {
    return {
      disposition: 'manual-review',
      replacementCandidates: [
        '/cloud/api/Report/getPendingByTicket',
        '/cloud/api/Report/getWagerDetailTransaction',
        '/cloud/api/Manager/getWagaerDetailShort',
      ],
      notes: [
        'The API returned Invalid Method for Report/getTicketDetailPrint, so this is not a parameter-shape repair.',
        'Use one of the observed ticket/wager detail read endpoints for data retrieval; keep print-specific behavior out unless a valid backend print endpoint is discovered.',
      ],
    };
  }

  return {
    disposition: 'manual-review',
    notes: ['No deterministic safe repair rule is known for this call.'],
  };
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  const headers = ['requestId', 'method', 'path', 'operation', 'status', 'params', 'response', 'repairDisposition'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(
      header === 'params' || header === 'response'
        ? JSON.stringify(row[header])
        : header === 'repairDisposition'
          ? row.repair?.disposition
          : row[header]
    )).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const maxRows = endpointSet(readJson(maxSpecPath));
  const latestRows = endpointSet(readJson(latestSpecPath));
  const maxKeys = new Set(maxRows.map((row) => row.key));
  const latestKeys = new Set(latestRows.map((row) => row.key));

  const addedSinceMax = latestRows.filter((row) => !maxKeys.has(row.key));
  const missingFromLatest = maxRows.filter((row) => !latestKeys.has(row.key));
  const missingReadShaped = missingFromLatest.filter((row) => row.firstPartyApi && row.readShaped);
  const missingMutationShaped = missingFromLatest.filter((row) => !row.readShaped);

  const endpointSamples = readJsonl(latestSamplesPath);
  const flatSamples = endpointSamples.flatMap((endpoint) => endpoint.samples || []);
  const successfulByPath = new Set(flatSamples.filter((sample) => sample.status >= 200 && sample.status < 300).map((sample) => sample.path));

  const badReportCalls = flatSamples
    .filter((sample) => sample.path.startsWith('/cloud/api/Report/') && sample.status >= 400)
    .map((sample) => ({
      requestId: sample.requestId,
      method: sample.method,
      url: sample.url,
      path: sample.path,
      operation: operationFromPath(sample.path),
      status: sample.status,
      params: parseBody(sample.reqBody),
      response: sample.respBody,
      repair: repairSuggestion(sample, successfulByPath),
    }));

  const allBadCalls = flatSamples
    .filter((sample) => sample.status >= 400)
    .map((sample) => ({
      requestId: sample.requestId,
      method: sample.method,
      url: sample.url,
      path: sample.path,
      operation: operationFromPath(sample.path),
      status: sample.status,
      params: parseBody(sample.reqBody),
      response: sample.respBody,
    }));

  const summary = {
    compared: {
      maxSpec: path.relative(root, maxSpecPath),
      latestSpec: path.relative(root, latestSpecPath),
    },
    counts: {
      maxEndpoints: maxRows.length,
      latestEndpoints: latestRows.length,
      addedSinceMax: addedSinceMax.length,
      missingFromLatest: missingFromLatest.length,
      missingReadShaped: missingReadShaped.length,
      missingMutationShaped: missingMutationShaped.length,
      badReportCalls: badReportCalls.length,
      allBadCalls: allBadCalls.length,
    },
    addedSinceMax,
    missingReadShaped,
    missingMutationShaped,
  };

  const reportDefinitions = badReportCalls.map((call) => ({
    name: call.operation,
    endpoint: call.path,
    method: call.method,
    params: call.params,
  }));

  fs.writeFileSync(path.join(outDir, 'coverage-diff.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'bad-report-calls.json'), `${JSON.stringify(badReportCalls, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'bad-report-calls.csv'), toCsv(badReportCalls));
  fs.writeFileSync(path.join(outDir, 'bad-calls-all.json'), `${JSON.stringify(allBadCalls, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'report-call-definitions.json'), `${JSON.stringify(reportDefinitions, null, 2)}\n`);

  console.log(JSON.stringify({
    outDir: path.relative(root, outDir),
    counts: summary.counts,
    addedOperations: addedSinceMax.map((row) => row.operation),
    missingReadOperations: missingReadShaped.map((row) => row.operation),
    badReportOperations: badReportCalls.map((row) => `${row.operation}:${row.status}`),
  }, null, 2));
}

main();
