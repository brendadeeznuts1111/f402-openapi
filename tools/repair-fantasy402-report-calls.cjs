const fs = require('fs');
const path = require('path');

const root = process.cwd();
const defaultInput = path.join(root, '.o11y/fantasy402-redacted-deep/gap-analysis/report-call-definitions.json');
const defaultOutput = path.join(root, '.o11y/fantasy402-redacted-deep/gap-analysis/repaired-report-call-definitions.json');

const input = path.resolve(process.argv[2] || defaultInput);
const output = path.resolve(process.argv[3] || defaultOutput);

const mapping = {
  Pending: {
    operation: 'Pending',
    endpoint: '/cloud/api/Report/Pending',
    paramMap: {
      customerID: '<player-customer-id-from-searchCustomerAdmin-or-getPlayers>',
    },
    status: 'repairable',
    note: 'Use a player CustomerID discovered from Manager/searchCustomerAdmin or Manager/getPlayers, not the agent/account CustomerID.',
  },
  getTicketDetailPrint: {
    status: 'manual-review',
    replacementCandidates: [
      {
        operation: 'getPendingByTicket',
        endpoint: '/cloud/api/Report/getPendingByTicket',
      },
      {
        operation: 'getWagerDetailTransaction',
        endpoint: '/cloud/api/Report/getWagerDetailTransaction',
      },
      {
        operation: 'getWagaerDetailShort',
        endpoint: '/cloud/api/Manager/getWagaerDetailShort',
      },
    ],
    note: 'Report/getTicketDetailPrint returned Invalid Method. Replace print-specific data reads with an observed ticket/wager detail helper, or leave for backend/manual review.',
  },
};

function applyParamMap(params, paramMap) {
  const next = { ...params };
  for (const [key, value] of Object.entries(paramMap || {})) {
    next[key] = value;
  }
  return next;
}

const definitions = JSON.parse(fs.readFileSync(input, 'utf8'));
const repaired = definitions.map((definition) => {
  const rule = mapping[definition.name] || mapping[definition.params?.operation];
  if (!rule) {
    return {
      ...definition,
      repairStatus: 'manual-review',
      repairNote: 'No known read-only repair mapping.',
    };
  }

  if (rule.status !== 'repairable') {
    return {
      ...definition,
      repairStatus: rule.status,
      replacementCandidates: rule.replacementCandidates,
      repairNote: rule.note,
    };
  }

  return {
    ...definition,
    name: rule.operation,
    endpoint: rule.endpoint,
    params: applyParamMap({ ...definition.params, operation: rule.operation }, rule.paramMap),
    repairStatus: rule.status,
    repairNote: rule.note,
  };
});

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(repaired, null, 2)}\n`);
console.log(JSON.stringify({
  input: path.relative(root, input),
  output: path.relative(root, output),
  repaired: repaired.filter((item) => item.repairStatus === 'repairable').length,
  manualReview: repaired.filter((item) => item.repairStatus !== 'repairable').length,
}, null, 2));
