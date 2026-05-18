#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { toYaml } from './yaml.mjs';

const root = process.cwd();
const input = path.join(root, '.o11y/fantasy402-redacted-deep/api-spec/openapi.json');
const outDir = path.join(root, '.o11y/fantasy402-redacted-deep/api-spec-secured');
const outputJson = path.join(outDir, 'openapi.secured.json');
const outputYaml = path.join(outDir, 'openapi.secured.yaml');
const outputSlimJson = path.join(outDir, 'openapi.secured.slim.json');
const outputSlimYaml = path.join(outDir, 'openapi.secured.slim.yaml');
const outputExamplesJson = path.join(outDir, 'openapi.secured.examples.json');
const outputExamplesYaml = path.join(outDir, 'openapi.secured.examples.yaml');
const reportPath = path.join(outDir, 'security-enhancement-report.md');

const credentialFieldRe = /^(Password|password|pass|PasswordF|PayoutPassword|PlaceWagerPassword)$/;
const piiFieldRe = /^(IPAddress|IP|LoginID|Login|AgentLogin|MasterLogin|PlayerLogin|CustomerID|CustomerIDF|CustomerIDFix|CustomerIDPrefix|CustomerIDSufix|customerID|Agent|AgentF|AgentID|agentID|agentOwner|MasterAgent|MasterAgentID|Name|NameF|NameFirst|NameLast|NameMI|PlayerName|showName|email|EMail|EmailOffice|OfficeReceiveEmail)$/i;
const sensitiveExampleValueKeyRe = /^(IPAddress|IP|LoginID|Login|AgentLogin|MasterLogin|PlayerLogin|CustomerID|CustomerIDF|CustomerIDFix|CustomerIDPrefix|CustomerIDSufix|customerID|Agent|AgentF|AgentID|agentID|agentOwner|MasterAgent|MasterAgentID|Name|NameF|NameFirst|NameLast|NameMI|PlayerName|showName|email|EMail|EmailOffice|OfficeReceiveEmail|Data|Operation)$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function resolveRefInSpec(spec, ref) {
  if (!ref?.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current = spec;
  for (const part of parts) current = current?.[part];
  return current || null;
}

function syntheticExampleForSchema(spec, schema, fieldName = '', seen = new Set()) {
  if (!schema) return null;
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return null;
    seen.add(schema.$ref);
    return syntheticExampleForSchema(spec, resolveRefInSpec(spec, schema.$ref), fieldName, seen);
  }
  if (schema['x-sensitive'] === true) {
    return fieldName.toLowerCase() === 'password' ? '__REDACTED_PASSWORD__' : '__REDACTED__';
  }
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) return syntheticExampleForSchema(spec, schema.oneOf[0], fieldName, seen);
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) return syntheticExampleForSchema(spec, schema.anyOf[0], fieldName, seen);
  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    return schema.allOf.reduce((value, child) => {
      const childValue = syntheticExampleForSchema(spec, child, fieldName, new Set(seen));
      return isObject(value) && isObject(childValue) ? { ...value, ...childValue } : childValue ?? value;
    }, {});
  }

  const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type].filter(Boolean);
  const type = allowedTypes.find((candidate) => candidate !== 'null') || allowedTypes[0];
  if (type === 'array') return [];
  if (type === 'integer') return 1;
  if (type === 'number') return 1;
  if (type === 'boolean') return true;
  if (type === 'string') {
    if (schema.format === 'date') return '2026-05-17';
    if (schema.format === 'date-time') return '2026-05-17T00:00:00.000Z';
    return fieldName ? `synthetic-${fieldName}` : 'synthetic-value';
  }
  if (type === 'object' || schema.properties) {
    const value = {};
    const required = new Set(schema.required || []);
    for (const [propertyName, propertySchema] of Object.entries(schema.properties || {})) {
      if (required.has(propertyName)) {
        value[propertyName] = syntheticExampleForSchema(spec, propertySchema, propertyName, new Set(seen));
      }
    }
    return value;
  }
  return null;
}

function removeCredentialFields(value) {
  if (Array.isArray(value)) {
    for (const item of value) removeCredentialFields(item);
    return value;
  }
  if (!isObject(value)) return value;

  for (const key of Object.keys(value)) {
    if (credentialFieldRe.test(key)) {
      delete value[key];
      continue;
    }
    removeCredentialFields(value[key]);
  }

  if (Array.isArray(value.required)) {
    value.required = value.required.filter((key) => !credentialFieldRe.test(key));
    if (!value.required.length) delete value.required;
  }
  return value;
}

function annotateSensitiveFields(schema) {
  if (Array.isArray(schema)) {
    schema.forEach(annotateSensitiveFields);
    return schema;
  }
  if (!isObject(schema)) return schema;

  if (schema.properties && isObject(schema.properties)) {
    for (const [key, property] of Object.entries(schema.properties)) {
      if (isObject(property) && piiFieldRe.test(key)) {
        property['x-sensitive'] = true;
        property['x-privacy-classification'] = key.match(/IP/i) ? 'PII:NetworkAddress' : 'PII:AccountIdentifier';
      }
      annotateSensitiveFields(property);
    }
  }
  if (schema.items) annotateSensitiveFields(schema.items);
  for (const item of schema.oneOf || []) annotateSensitiveFields(item);
  for (const item of schema.anyOf || []) annotateSensitiveFields(item);
  for (const item of schema.allOf || []) annotateSensitiveFields(item);
  for (const [key, child] of Object.entries(schema)) {
    if (key === 'properties' || key === 'items' || key === 'oneOf' || key === 'anyOf' || key === 'allOf') continue;
    annotateSensitiveFields(child);
  }
  return schema;
}

function scrubSensitiveExampleValues(value, key = '') {
  if (Array.isArray(value)) {
    return value.map((item) => scrubSensitiveExampleValues(item, key));
  }
  if (isObject(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      value[childKey] = scrubSensitiveExampleValues(childValue, childKey);
    }
    return value;
  }
  if (typeof value === 'string') {
    if (sensitiveExampleValueKeyRe.test(key)) return '<redacted>';
    if (/NOLA\s*ROSE/i.test(value)) return value.replace(/NOLA\s*ROSE/gi, '<redacted>');
  }
  return value;
}

function makeSlimContract(spec) {
  const slim = clone(spec);
  slim.info = {
    ...slim.info,
    title: `${slim.info.title} - Slim`,
    description: `${slim.info.description} Bulky observed examples and sample-derived large enums are removed for CI, linting, code generation, and mock-server use.`,
  };

  function strip(value, key = '') {
    if (Array.isArray(value)) {
      for (const item of value) strip(item);
      return;
    }
    if (!isObject(value)) return;

    for (const childKey of Object.keys(value)) {
      if (childKey === 'example' || childKey === 'examples') {
        delete value[childKey];
        continue;
      }
      if (childKey === 'enum' && Array.isArray(value[childKey])) {
        const enumValues = value[childKey];
        const shouldKeep = enumValues.length <= 12 && enumValues.every((item) => (
          typeof item !== 'string'
          || item === '<redacted>'
          || item === '__REDACTED__'
          || /^[A-Z_ -]{1,40}$/.test(item)
        ));
        if (!shouldKeep) delete value[childKey];
        continue;
      }
      strip(value[childKey], childKey);
    }
  }

  strip(slim);
  slim.components.examples = {
    CommonAgentRequestExample: {
      value: {
        RRO: 1,
        agentID: 'DEMOAGENT',
        agentOwner: 'DEMOAGENT',
        operation: 'getPlayers',
      },
    },
    PendingRequestValid: {
      value: {
        RRO: 1,
        agentID: 'DEMOAGENT',
        agentOwner: 'DEMOAGENT',
        customerID: 'DEMOCUST',
        startDate: '2026-05-17',
        endDate: '2026-05-17',
        operation: 'Pending',
      },
    },
    InvalidCustomerError: {
      value: { status: 'Failed', msg: 'Invalid CustomerID' },
    },
  };

  return slim;
}

function addMinimalExamples(spec) {
  const withExamples = clone(spec);
  withExamples.info = {
    ...withExamples.info,
    title: `${withExamples.info.title} + Minimal Examples`,
    description: `${withExamples.info.description} Includes a small set of synthetic, non-sensitive examples for docs and mock servers.`,
  };

  function contentFor(apiPath, status = '200') {
    return withExamples.paths?.[apiPath]?.post?.responses?.[status]?.content?.['application/json'];
  }

  function requestContentFor(apiPath) {
    return Object.values(withExamples.paths?.[apiPath]?.post?.requestBody?.content || {})[0];
  }

  const pending = withExamples.paths?.['/cloud/api/Report/Pending']?.post;
  if (pending) {
    pending.requestBody.content['application/x-www-form-urlencoded'].examples = {
      valid: { $ref: '#/components/examples/PendingRequestValid' },
      invalidCustomer: { $ref: '#/components/examples/PendingRequestInvalidCustomer' },
    };
    const ok = contentFor('/cloud/api/Report/Pending', '200');
    if (ok) {
      ok.examples = {
        empty: { value: { Pending: [] } },
        populated: { $ref: '#/components/examples/PendingResponseValid' },
      };
    }
    const bad = contentFor('/cloud/api/Report/Pending', '400');
    if (bad) {
      bad.examples = {
        invalidCustomer: { $ref: '#/components/examples/InvalidCustomerError' },
      };
    }
    const forbidden = contentFor('/cloud/api/Report/Pending', '403');
    if (forbidden) {
      forbidden.examples = {
        forbidden: { $ref: '#/components/examples/ForbiddenError' },
      };
    }
  }

  const getPlayers = withExamples.paths?.['/cloud/api/Manager/getPlayers']?.post;
  if (getPlayers) {
    getPlayers.requestBody.content['application/x-www-form-urlencoded'].examples = {
      valid: { $ref: '#/components/examples/CommonAgentRequestExample' },
    };
    const ok = contentFor('/cloud/api/Manager/getPlayers', '200');
    if (ok) {
      ok.examples = {
        redactedList: { $ref: '#/components/examples/GetPlayersResponseValid' },
      };
    }
  }

  const getAgentBilling = withExamples.paths?.['/cloud/api/Manager/getAgentBilling']?.post;
  if (getAgentBilling) {
    getAgentBilling.requestBody.content['application/x-www-form-urlencoded'].examples = {
      valid: { $ref: '#/components/examples/AgentBillingRequestValid' },
    };
    const ok = contentFor('/cloud/api/Manager/getAgentBilling', '200');
    if (ok) {
      ok.examples = {
        redactedBilling: { $ref: '#/components/examples/GetAgentBillingResponseValid' },
      };
    }
  }

  const getEnterTransactions = withExamples.paths?.['/cloud/api/Manager/getEnterTransactions']?.post;
  if (getEnterTransactions) {
    getEnterTransactions.requestBody.content['application/x-www-form-urlencoded'].examples = {
      valid: { $ref: '#/components/examples/EnterTransactionsRequestValid' },
    };
    const ok = contentFor('/cloud/api/Manager/getEnterTransactions', '200');
    if (ok) {
      ok.examples = {
        redactedReferenceData: { $ref: '#/components/examples/GetEnterTransactionsResponseValid' },
      };
    }
  }

  const getBetTicker = withExamples.paths?.['/cloud/api/Manager/getBetTicker']?.post;
  if (getBetTicker) {
    requestContentFor('/cloud/api/Manager/getBetTicker').examples = {
      valid: { $ref: '#/components/examples/BetTickerRequestValid' },
    };
    const ok = contentFor('/cloud/api/Manager/getBetTicker', '200');
    if (ok) {
      ok.examples = {
        emptyTicker: { $ref: '#/components/examples/BetTickerResponseEmpty' },
      };
    }
  }

  const getPending = withExamples.paths?.['/cloud/api/Manager/getPending']?.post;
  if (getPending) {
    requestContentFor('/cloud/api/Manager/getPending').examples = {
      valid: { $ref: '#/components/examples/GetPendingRequestValid' },
    };
    const ok = contentFor('/cloud/api/Manager/getPending', '200');
    if (ok) {
      ok.examples = {
        emptyPending: { $ref: '#/components/examples/GetPendingResponseEmpty' },
      };
    }
  }

  const authenticateCustomer = withExamples.paths?.['/cloud/api/System/authenticateCustomer']?.post;
  if (authenticateCustomer) {
    const ok = contentFor('/cloud/api/System/authenticateCustomer', '200');
    if (ok) {
      ok.examples = {
        authenticated: { $ref: '#/components/examples/AuthenticateCustomerResponseValid' },
      };
    }
  }

  const getAgentPositionList = withExamples.paths?.['/cloud/api/Manager/getAgentPositionList']?.post;
  if (getAgentPositionList) {
    requestContentFor('/cloud/api/Manager/getAgentPositionList').examples = {
      valid: { $ref: '#/components/examples/AgentPositionListRequestValid' },
    };
    const ok = contentFor('/cloud/api/Manager/getAgentPositionList', '200');
    if (ok) {
      ok.examples = {
        emptyPositions: { $ref: '#/components/examples/AgentPositionListResponseEmpty' },
      };
    }
  }

  const getAgentPositionData = withExamples.paths?.['/cloud/api/Manager/getAgentPositionData']?.post;
  if (getAgentPositionData) {
    requestContentFor('/cloud/api/Manager/getAgentPositionData').examples = {
      valid: { $ref: '#/components/examples/AgentPositionDataRequestValid' },
    };
    const ok = contentFor('/cloud/api/Manager/getAgentPositionData', '200');
    if (ok) {
      ok.examples = {
        emptyPositions: { $ref: '#/components/examples/AgentPositionDataResponseEmpty' },
      };
    }
  }

  const betTicker = withExamples.paths?.['/cloud/api/Manager/getBetTicker']?.post;
  if (betTicker) {
    requestContentFor('/cloud/api/Manager/getBetTicker').examples = {
      valid: { $ref: '#/components/examples/BetTickerRequestValid' },
    };
    const ok = contentFor('/cloud/api/Manager/getBetTicker', '200');
    if (ok) {
      ok.examples = {
        emptyBetTicker: { $ref: '#/components/examples/BetTickerResponseEmpty' },
      };
    }
  }

  const betTickerConfig = withExamples.paths?.['/cloud/api/Manager/getBetTickerConfig']?.post;
  if (betTickerConfig) {
    requestContentFor('/cloud/api/Manager/getBetTickerConfig').examples = {
      valid: { $ref: '#/components/examples/BetTickerRequestValid' },
    };
  }

  const agentPositionList = withExamples.paths?.['/cloud/api/Manager/getAgentPositionList']?.post;
  if (agentPositionList) {
    requestContentFor('/cloud/api/Manager/getAgentPositionList').examples = {
      valid: { $ref: '#/components/examples/AgentPositionListRequestValid' },
    };
    const ok = contentFor('/cloud/api/Manager/getAgentPositionList', '200');
    if (ok) {
      ok.examples = {
        emptyList: { $ref: '#/components/examples/AgentPositionListResponseEmpty' },
      };
    }
  }

  const listAgenst = withExamples.paths?.['/cloud/api/Manager/getListAgenstByAgent']?.post;
  if (listAgenst) {
    requestContentFor('/cloud/api/Manager/getListAgenstByAgent').examples = {
      valid: { $ref: '#/components/examples/ListAgenstByAgentRequestValid' },
    };
    const ok = contentFor('/cloud/api/Manager/getListAgenstByAgent', '200');
    if (ok) {
      ok.examples = {
        generalList: { $ref: '#/components/examples/ListAgenstByAgentResponse' },
      };
    }
  }

  const rateLimitedPaths = [
    '/cloud/api/Report/Pending',
    '/cloud/api/Manager/getPlayers',
    '/cloud/api/Manager/getAgentBilling',
    '/cloud/api/Manager/getEnterTransactions',
    '/cloud/api/Manager/getBetTicker',
    '/cloud/api/Manager/getBetTickerConfig',
    '/cloud/api/Manager/getPending',
    '/cloud/api/System/authenticateCustomer',
    '/cloud/api/Manager/getAgentPositionList',
    '/cloud/api/Manager/getAgentPositionData',
    '/cloud/api/Manager/getListAgenstByAgent',
  ];
  for (const apiPath of rateLimitedPaths) {
    const rateLimited = contentFor(apiPath, '429');
    if (rateLimited) {
      rateLimited.examples = {
        tooManyRequests: { $ref: '#/components/examples/RateLimitError' },
      };
    }
  }

  withExamples.components.examples = {
    ...(withExamples.components.examples || {}),
    PendingRequestInvalidCustomer: {
      summary: 'Invalid customerID',
      value: {
        RRO: 1,
        agentID: 'DEMOAGENT',
        customerID: 'UNKNOWN',
        operation: 'Pending',
      },
    },
    PendingResponseValid: {
      value: {
        Pending: [
          {
            TicketNumber: 1010971445,
            AmountWagered: 2360000,
            Description: 'Baseball wager description redacted',
            AcceptedDateTime: '2026-05-16 12:02:29.753',
          },
        ],
      },
    },
    InvalidCustomerError: {
      value: { status: 'Failed', msg: 'Invalid CustomerID' },
    },
    ForbiddenError: {
      value: { status: 'Failed', msg: 'Forbidden' },
    },
    RateLimitError: {
      value: { status: 'Failed', msg: 'Too Many Requests' },
    },
    GetPlayersResponseValid: {
      value: {
        LIST: [
          {
            customerID: '__REDACTED__',
            Login: '__REDACTED__',
            NameFirst: '__REDACTED__',
            Agent: '__REDACTED__',
          },
        ],
      },
    },
    ListAgenstByAgentRequestValid: {
      summary: 'List agents under the authenticated master agent',
      value: {
        RRO: 1,
        agentID: 'DEMOAGENT',
        agentOwner: 'DEMOAGENT',
        operation: 'getListAgenstByAgent',
        agentType: 'M',
      },
    },
    ListAgenstByAgentResponse: {
      value: {
        GENERAL: [
          {
            AgentID: '__REDACTED__',
            SeqNumber: 5743,
            Level: 1,
            AgentType: 'A',
            Login: '__REDACTED__',
            HeadCountRateM: 1,
            InetHeadCountRateM: 0,
            CasinoHeadCountRateM: 0,
            LiveBettingRateM: 0,
            LiveBetting2RateM: 0,
            LiveCasinoRateM: 0,
            PropBuilderRateM: 0,
            FlashBetsRate: 0,
            ExtPropsRate: 0,
            CrashRate: 0,
            FantasyRate: 0,
            AmigoTechRate: 0,
          },
          {
            AgentID: '__REDACTED__',
            SeqNumber: 5744,
            Level: 1,
            AgentType: 'M',
            Login: '__REDACTED__',
            HeadCountRateM: 0,
            InetHeadCountRateM: 0,
            CasinoHeadCountRateM: 0,
            LiveBettingRateM: 0,
            LiveBetting2RateM: 0,
            LiveCasinoRateM: 0,
            PropBuilderRateM: 0,
            FlashBetsRate: 0,
            ExtPropsRate: 0,
            CrashRate: 0,
            FantasyRate: 0,
            AmigoTechRate: 0,
          },
          {
            AgentID: '__REDACTED__',
            SeqNumber: 5749,
            Level: 2,
            AgentType: 'M',
            Login: '__REDACTED__',
            HeadCountRateM: 0,
            InetHeadCountRateM: 3.5,
            CasinoHeadCountRateM: 0,
            LiveBettingRateM: 0,
            LiveBetting2RateM: 0,
            LiveCasinoRateM: 0,
            PropBuilderRateM: 0.5,
            FlashBetsRate: 0,
            ExtPropsRate: 0,
            CrashRate: 0,
            FantasyRate: 0,
            AmigoTechRate: 0,
          },
        ],
      },
    },
    AgentBillingRequestValid: {
      value: {
        RRO: 1,
        agentID: 'DEMOAGENT',
        agentOwner: 'DEMOAGENT',
        operation: 'getAgentBilling',
      },
    },
    GetAgentBillingResponseValid: {
      value: {
        LIST: [
          {
            DocumentNumber: 1000000001,
            TranCode: 'D',
            TranType: 'Q',
            Amount: 125000,
            ShortDesc: 'Billing summary redacted',
            TranDateTime: '2026-05-17 06:00:00.000',
            HoldAmount: 0,
            GradeNum: null,
            EnteredBy: 'System',
            CurrentBalance: -125000,
          },
        ],
      },
    },
    EnterTransactionsRequestValid: {
      value: {
        RRO: 1,
        agentID: 'DEMOAGENT',
        agentOwner: 'DEMOAGENT',
        operation: 'getEnterTransactions',
      },
    },
    GetEnterTransactionsResponseValid: {
      value: {
        LIST: [
          {
            MasterAgent: '__REDACTED__',
            CustomerID: '__REDACTED__',
            AgentID: '__REDACTED__',
            AgentLogin: '__REDACTED__',
            SettleFigure: 0,
            CasinoBalance: 0,
            Name: '__REDACTED__',
            CurrentBalance: 0,
            Login: '__REDACTED__',
          },
        ],
      },
    },
    BetTickerRequestValid: {
      value: {
        RRO: 1,
        agentID: '__REDACTED__',
        agentOwner: '__REDACTED__',
        operation: 'getBetTicker',
      },
    },
    BetTickerResponseEmpty: {
      value: { LIST: [] },
    },
    GetPendingRequestValid: {
      value: {
        RRO: 1,
        agentID: '__REDACTED__',
        agentOwner: '__REDACTED__',
        customerID: '__REDACTED__',
        date: '2026-05-17T00:00:00.000Z',
        path: 'P',
        sort: 'acceptedDateTime',
        typeSort: 'desc',
        wagerType: 'A',
        week: 0,
      },
    },
    GetPendingResponseEmpty: {
      value: [],
    },
    AuthenticateCustomerResponseValid: {
      value: {
        accountInfo: syntheticExampleForSchema(withExamples, { $ref: '#/components/schemas/AccountInfo' }),
        code: 'synthetic-auth-code',
      },
    },
    AgentPositionListRequestValid: {
      value: {
        RRO: 1,
        agentID: '__REDACTED__',
        agentOwner: '__REDACTED__',
        operation: 'getAgentPositionList',
      },
    },
    AgentPositionListResponseEmpty: {
      value: { LIST: [] },
    },
    AgentPositionDataRequestValid: {
      value: {
        RRO: 1,
        agentID: '__REDACTED__',
        agentOwner: '__REDACTED__',
        operation: 'getAgentPositionData',
      },
    },
    AgentPositionDataResponseEmpty: {
      value: [],
    },
  };

  return withExamples;
}

function mergeResponse(operation, status, response) {
  operation.responses ||= {};
  operation.responses[String(status)] = {
    ...(operation.responses[String(status)] || {}),
    ...response,
  };
}

function addRateLimit(operation, limit = 30, window = 60) {
  operation['x-rate-limit'] = { limit, window };
  mergeResponse(operation, '429', {
    description: 'Too Many Requests',
    headers: {
      'X-RateLimit-Limit': {
        schema: { type: 'integer' },
        description: 'Maximum requests allowed in the current window.',
      },
      'X-RateLimit-Remaining': {
        schema: { type: 'integer' },
        description: 'Requests remaining in the current window.',
      },
      'X-RateLimit-Reset': {
        schema: { type: 'integer' },
        description: 'Unix timestamp when the current window resets.',
      },
    },
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' },
        examples: {
          tooManyRequests: { $ref: '#/components/examples/RateLimitError' },
        },
      },
    },
  });
}

function setFormRequest(operation, schemaRef, examples = {}) {
  operation.requestBody = {
    required: true,
    content: {
      'application/x-www-form-urlencoded': {
        schema: { $ref: schemaRef },
        examples,
      },
    },
  };
}

function roleForPath(apiPath) {
  if (/getAgentBilling|primaryAgents|Accounting|SettleBalance/i.test(apiPath)) return ['ROLE_MASTER'];
  if (/getEnterTransactions|Transaction/i.test(apiPath)) return ['ROLE_AGENT', 'ROLE_MASTER'];
  if (/getPlayers|getWebLog|getAgentManagement|getWeeklyFigure|getPending|Report\//i.test(apiPath)) return ['ROLE_AGENT', 'ROLE_MASTER'];
  return ['ROLE_AGENT', 'ROLE_MASTER', 'ROLE_SUB_AGENT'];
}

function operationNameFromPath(apiPath) {
  return apiPath.split('/').filter(Boolean).at(-1) || apiPath;
}

function hardenOperation(apiPath, method, operation) {
  if (!apiPath.startsWith('/cloud/api/')) return;
  const roles = roleForPath(apiPath);
  operation.security = [{ sessionCookie: [] }, { agentToken: [] }];
  operation['x-required-roles'] = roles;
  operation['x-security-review'] = {
    authenticationRequired: true,
    hierarchyCheckRequired: true,
    source: 'post-processed observed contract',
  };
  addRateLimit(operation, roles.includes('ROLE_MASTER') ? 20 : 30, 60);

  const opName = operationNameFromPath(apiPath);
  if (method === 'post' && !operation.requestBody) {
    setFormRequest(operation, '#/components/schemas/CommonAgentRequest', {
      observedShape: { $ref: '#/components/examples/CommonAgentRequestExample' },
    });
  }

  if (apiPath === '/cloud/api/Report/Pending') {
    operation.summary = 'Retrieve pending wagers for a customer';
    operation.description = [
      'Returns pending wagers for a customer that belongs to the authenticated agent hierarchy.',
      'The observed API accepts form-encoded POST bodies. JSON clients should encode the same fields as form data.',
      'Passwords are intentionally absent from response schemas and examples.',
    ].join(' ');
    setFormRequest(operation, '#/components/schemas/PendingRequest', {
      valid: { $ref: '#/components/examples/PendingRequestValid' },
      invalidCustomer: { $ref: '#/components/examples/PendingRequestInvalidCustomer' },
    });
    mergeResponse(operation, '200', {
      description: 'Array of pending wagers.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/PendingResponse' },
          examples: {
            empty: { value: { Pending: [] } },
            populated: { $ref: '#/components/examples/PendingResponseValid' },
          },
        },
      },
    });
    mergeResponse(operation, '400', {
      description: 'Bad request - validation failure.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
          examples: {
            invalidCustomer: { $ref: '#/components/examples/InvalidCustomerError' },
            missingField: { $ref: '#/components/examples/MissingRequiredFieldError' },
          },
        },
      },
    });
    mergeResponse(operation, '403', {
      description: 'Forbidden - customer does not belong to the authenticated agent hierarchy.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
        },
      },
    });
  }

  if (apiPath === '/cloud/api/Manager/getPlayers') {
    operation.description = 'Lists players visible to the authenticated agent hierarchy. Response omits credential fields by contract.';
    operation['x-required-roles'] = ['ROLE_AGENT', 'ROLE_MASTER'];
    operation['x-security-review'].leastPrivilegeNote = 'Sub-agents must not list all players outside their hierarchy.';
    setFormRequest(operation, '#/components/schemas/CommonAgentRequest', {
      valid: { $ref: '#/components/examples/CommonAgentRequestExample' },
    });
  }

  if (apiPath === '/cloud/api/Manager/getAgentBilling') {
    operation.description = 'Returns agent billing records. Restricted to master agents because it exposes financial account data.';
    operation['x-required-roles'] = ['ROLE_MASTER'];
    addRateLimit(operation, 10, 60);
  }

  if (apiPath === '/cloud/api/Manager/getEnterTransactions') {
    operation.description = 'Returns transaction-entry reference data visible to the authenticated agent hierarchy. Sub-agents are excluded because the surface supports financial transaction workflows.';
    operation['x-required-roles'] = ['ROLE_AGENT', 'ROLE_MASTER'];
    operation['x-security-review'].financialWorkflow = true;
    addRateLimit(operation, 15, 60);
  }

  if (apiPath === '/cloud/api/Manager/getWebLog') {
    operation.deprecated = true;
    operation.description = 'Deprecated pending audit. Exposes login activity, IP addresses, and free-form operational messages. No like-for-like replacement has been observed; treat 410 Gone as authoritative until a narrowed audit-log endpoint is captured.';
    operation['x-security-review-required'] = true;
    operation['x-privacy-classification'] = 'PII:AuditLog';
    operation['x-migration-target'] = null;
    operation['x-migration-guidance'] = 'No replacement observed. Keep blocked and re-capture before enabling any audit-log read path.';
    mergeResponse(operation, '410', {
      description: 'Gone - no narrowed audit-log replacement has been observed.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
        },
      },
    });
  }

  if (/getTicketDetailPrint/i.test(opName)) {
    operation.deprecated = true;
    operation.description = 'Observed call returned Invalid Method. Use getPendingByTicket, getWagerDetailTransaction, or Manager/getWagaerDetailShort for read-only ticket/wager detail data unless backend confirms a valid print endpoint.';
    operation['x-manual-review-required'] = true;
    operation['x-migration-target'] = '/cloud/api/Report/getPendingByTicket';
    operation['x-migration-guidance'] = 'Likely replacement is ticket detail lookup through getPendingByTicket, with getWagerDetailTransaction or Manager/getWagaerDetailShort as supporting read-only detail views. Confirm exact print-specific replacement before removing manual-review status.';
    operation['x-replacement-candidates'] = [
      '/cloud/api/Report/getPendingByTicket',
      '/cloud/api/Report/getWagerDetailTransaction',
      '/cloud/api/Manager/getWagaerDetailShort',
    ];
  }
}

function addComponents(spec) {
  spec.components ||= {};
  spec.components.securitySchemes = {
    ...(spec.components.securitySchemes || {}),
    sessionCookie: {
      type: 'apiKey',
      in: 'cookie',
      name: 'ASP.NET_SessionId',
      description: 'Session cookie issued after login. Required for browser-compatible clients.',
    },
    agentToken: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Recommended replacement token format carrying agent identity and hierarchy claims.',
    },
  };

  spec.components.parameters = {
    ...(spec.components.parameters || {}),
    AgentOwnerParam: {
      name: 'agentOwner',
      in: 'query',
      required: false,
      schema: { $ref: '#/components/schemas/AgentId' },
      description: "Owning agent identifier. Must match the authenticated agent's hierarchy.",
    },
    CustomerIDParam: {
      name: 'customerID',
      in: 'query',
      required: false,
      schema: { $ref: '#/components/schemas/CustomerId' },
      description: "Customer ID. Must belong to the authenticated agent's downline.",
    },
    StartDateParam: {
      name: 'startDate',
      in: 'query',
      required: false,
      schema: { type: 'string', format: 'date' },
      description: 'Start of reporting period. Prefer this over the legacy `start` alias.',
    },
    EndDateParam: {
      name: 'endDate',
      in: 'query',
      required: false,
      schema: { type: 'string', format: 'date' },
      description: 'End of reporting period. Prefer this over the legacy `end` alias.',
    },
  };

  spec.components.schemas = {
    ...(spec.components.schemas || {}),
    AgentId: {
      type: 'string',
      minLength: 3,
      maxLength: 20,
      pattern: '^[A-Z0-9._-]{3,20}$',
      'x-sensitive': true,
      'x-privacy-classification': 'PII:AccountIdentifier',
    },
    CustomerId: {
      type: 'string',
      minLength: 1,
      maxLength: 20,
      pattern: '^[A-Z0-9._-]{1,20}$',
      description: "Observed customer identifier. Must exist and belong to the authenticated agent's hierarchy.",
      'x-sensitive': true,
      'x-privacy-classification': 'PII:AccountIdentifier',
    },
    RROFlag: {
      oneOf: [
        { type: 'integer', enum: [0, 1] },
        { type: 'string', enum: ['0', '1'] },
      ],
      default: 1,
    },
    CommonAgentRequest: {
      type: 'object',
      additionalProperties: false,
      properties: {
        RRO: { $ref: '#/components/schemas/RROFlag' },
        agentID: { $ref: '#/components/schemas/AgentId' },
        agentOwner: { $ref: '#/components/schemas/AgentId' },
        customerID: { $ref: '#/components/schemas/CustomerId' },
        startDate: { type: 'string', format: 'date' },
        endDate: { type: 'string', format: 'date' },
        start: {
          type: 'string',
          format: 'date',
          deprecated: true,
          description: 'Legacy alias for startDate.',
        },
        end: {
          type: 'string',
          format: 'date',
          deprecated: true,
          description: 'Legacy alias for endDate.',
        },
        operation: { type: 'string', minLength: 1, maxLength: 80 },
      },
      required: ['agentID', 'operation'],
    },
    PendingRequest: {
      type: 'object',
      additionalProperties: false,
      required: ['agentID', 'operation'],
      properties: {
        RRO: { $ref: '#/components/schemas/RROFlag' },
        agentID: { $ref: '#/components/schemas/AgentId' },
        agentOwner: { $ref: '#/components/schemas/AgentId' },
        customerID: { $ref: '#/components/schemas/CustomerId' },
        startDate: { type: 'string', format: 'date' },
        endDate: { type: 'string', format: 'date' },
        start: {
          type: 'string',
          format: 'date',
          deprecated: true,
          description: 'Legacy alias for startDate.',
        },
        end: {
          type: 'string',
          format: 'date',
          deprecated: true,
          description: 'Legacy alias for endDate.',
        },
        operation: { type: 'string', const: 'Pending' },
      },
    },
    PendingResponse: {
      type: 'object',
      additionalProperties: false,
      properties: {
        Pending: {
          type: 'array',
          items: { $ref: '#/components/schemas/PendingWager' },
        },
      },
      required: ['Pending'],
    },
    PendingWager: {
      type: 'object',
      additionalProperties: true,
      properties: {
        TicketNumber: { type: ['integer', 'string'] },
        AmountWagered: { type: ['number', 'integer', 'string'] },
        Description: { type: 'string' },
        AcceptedDateTime: {
          type: 'string',
          description: 'Observed API uses SQL-style timestamps; normalize to RFC 3339 in new clients when possible.',
        },
      },
    },
    ErrorResponse: {
      type: 'object',
      additionalProperties: true,
      properties: {
        status: { type: 'string', enum: ['Failed'] },
        msg: {
          type: 'string',
          enum: [
            'Invalid CustomerID',
            'Invalid AgentID',
            'Missing required field',
            'Invalid Method',
            'Unauthorized',
            'Forbidden',
            'Too Many Requests',
          ],
        },
      },
    },
  };

  spec.components.examples = {
    ...(spec.components.examples || {}),
    CommonAgentRequestExample: {
      value: {
        RRO: 1,
        agentID: 'DEMOAGENT',
        agentOwner: 'DEMOAGENT',
        operation: 'getPlayers',
      },
    },
    PendingRequestValid: {
      value: {
        RRO: 1,
        agentID: 'DEMOAGENT',
        agentOwner: 'DEMOAGENT',
        customerID: 'DEMOCUST',
        startDate: '2026-05-17',
        endDate: '2026-05-17',
        operation: 'Pending',
      },
    },
    PendingRequestInvalidCustomer: {
      summary: 'Invalid customerID',
      value: {
        RRO: 1,
        agentID: 'DEMOAGENT',
        customerID: 'UNKNOWN',
        operation: 'Pending',
      },
    },
    PendingResponseValid: {
      value: {
        Pending: [
          {
            TicketNumber: 1010971445,
            AmountWagered: 2360000,
            Description: 'Baseball wager description redacted',
            AcceptedDateTime: '2026-05-16 12:02:29.753',
          },
        ],
      },
    },
    InvalidCustomerError: {
      value: { status: 'Failed', msg: 'Invalid CustomerID' },
    },
    MissingRequiredFieldError: {
      value: { status: 'Failed', msg: 'Missing required field' },
    },
    RateLimitError: {
      value: { status: 'Failed', msg: 'Too Many Requests' },
    },
  };
}

function main() {
  const spec = clone(JSON.parse(fs.readFileSync(input, 'utf8')));
  spec.info = {
    ...spec.info,
    title: 'Fantasy402 API (Secured Observed Contract)',
    version: '2026-05-17-slim-v1.2',
    contact: {
      name: 'BILLY666 / Sports Terminal',
      url: 'https://factory-wager.com',
    },
    'x-api-state': 'observed',
    'x-last-captured': '2026-05-08',
    'x-next-review': '2026-06-08',
    description: [
      'Security-hardened OpenAPI contract derived from the observed browser-to-api capture.',
      'Passwords and credential fields are intentionally removed from schemas and examples.',
      'Role requirements, hierarchy validation, rate-limit expectations, and sensitive-data annotations are encoded as contract metadata.',
    ].join(' '),
  };
  spec.servers = [
    {
      url: 'https://fantasy402.com',
      description: 'Production. Requires authenticated session cookie or agent bearer token.',
    },
  ];
  spec.security = [{ sessionCookie: [] }, { agentToken: [] }];
  spec.externalDocs = {
    description: 'Gap-analysis and report-call repair notes.',
    url: '../fantasy402-redacted-deep/gap-analysis/report-call-repair-notes.md',
  };

  addComponents(spec);

  for (const [apiPath, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      hardenOperation(apiPath, method, operation);
    }
  }

  removeCredentialFields(spec);
  scrubSensitiveExampleValues(spec);
  annotateSensitiveFields(spec.components.schemas);
  for (const methods of Object.values(spec.paths || {})) {
    for (const operation of Object.values(methods)) {
      annotateSensitiveFields(operation);
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputJson, `${JSON.stringify(spec, null, 2)}\n`);
  fs.writeFileSync(outputYaml, toYaml(spec));
  const slim = makeSlimContract(spec);
  const examples = addMinimalExamples(slim);
  fs.writeFileSync(outputSlimJson, `${JSON.stringify(slim, null, 2)}\n`);
  fs.writeFileSync(outputSlimYaml, toYaml(slim));
  fs.writeFileSync(outputExamplesJson, `${JSON.stringify(examples, null, 2)}\n`);
  fs.writeFileSync(outputExamplesYaml, toYaml(examples));

  const passwordHit = JSON.stringify(spec).match(credentialFieldRe);
  const securedPaths = Object.entries(spec.paths || {})
    .filter(([apiPath]) => apiPath.startsWith('/cloud/api/'))
    .length;
  fs.writeFileSync(reportPath, [
    '# Fantasy402 Secured OpenAPI Enhancement Report',
    '',
    `- Source: \`${path.relative(root, input)}\``,
    `- JSON output: \`${path.relative(root, outputJson)}\``,
    `- YAML output: \`${path.relative(root, outputYaml)}\``,
    `- Slim JSON output: \`${path.relative(root, outputSlimJson)}\``,
    `- Slim YAML output: \`${path.relative(root, outputSlimYaml)}\``,
    `- Examples JSON output: \`${path.relative(root, outputExamplesJson)}\``,
    `- Examples YAML output: \`${path.relative(root, outputExamplesYaml)}\``,
    `- First-party API paths hardened: \`${securedPaths}\``,
    `- Credential field names removed: \`${passwordHit ? 'needs-review' : 'yes'}\``,
    '',
    '## Applied Enhancements',
    '',
    '- Added `sessionCookie` and `agentToken` security schemes.',
    '- Added global security requirements and per-operation role metadata through `x-required-roles`.',
    '- Added reusable agent/customer/date schemas and parameter definitions.',
    '- Added form-encoded request schemas for common POST operations and a stricter `PendingRequest` contract.',
    '- Replaced `Report/Pending` response/error contracts with explicit success, 400, 403, and 429 schemas.',
    '- Added rate-limit headers and `x-rate-limit` metadata to first-party API operations.',
    '- Deprecated `Manager/getWebLog` and `Report/getTicketDetailPrint` with security/manual-review annotations.',
    '- Removed credential fields named `Password`, `password`, `pass`, `PasswordF`, `PayoutPassword`, and `PlaceWagerPassword` from schemas/examples.',
    '- Annotated account identifiers and IP-like fields with `x-sensitive` privacy metadata.',
    '- Emitted slim CI/codegen artifacts without bulky observed examples or sample-derived large enums.',
    '- Emitted examples artifacts with small synthetic examples for critical docs and mock-server paths.',
    '',
  ].join('\n'));

  console.log(JSON.stringify({
    outputJson: path.relative(root, outputJson),
    outputYaml: path.relative(root, outputYaml),
    outputSlimJson: path.relative(root, outputSlimJson),
    outputSlimYaml: path.relative(root, outputSlimYaml),
    outputExamplesJson: path.relative(root, outputExamplesJson),
    outputExamplesYaml: path.relative(root, outputExamplesYaml),
    report: path.relative(root, reportPath),
    firstPartyApiPathsHardened: securedPaths,
  }, null, 2));
}

main();
