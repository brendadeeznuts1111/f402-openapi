/** Player customerID extraction — mirrors workers/fantasy402-ingestion/src/customer-id.ts */

export function extractPlayerCustomerId(data) {
  if (!data || typeof data !== 'object') return null;
  const list = data.LIST;
  if (!Array.isArray(list) || !list.length) return null;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    for (const field of ['customerID', 'CustomerID']) {
      const value = item[field];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed && trimmed !== '__REDACTED__') return trimmed;
      }
    }
  }
  return null;
}

export function planNeedsCustomerIdResolution(specs) {
  return Array.isArray(specs) && specs.some((spec) => spec.requiresCustomerIdResolution);
}

export function findGetPlayersSpec(specs) {
  return specs?.find((spec) => spec.key === 'getPlayers' && spec.body) ?? null;
}

/**
 * When plan has customer-scoped stubs, fetch getPlayers, upload to worker (caches ID), re-fetch plan.
 * @param {object} ctx dashboard context
 * @param {object} authPayload
 * @param {object} plan initial plan from GET /ingest/local/plan
 * @param {(auth: object, spec: object) => Promise<object>} fetchSpec
 */
export async function ensureCustomerIdInPlan(ctx, authPayload, plan, fetchSpec) {
  let specs = plan?.endpoints || [];
  if (!planNeedsCustomerIdResolution(specs)) {
    return { plan, specs, prefetchResults: [] };
  }

  let getPlayersSpec = findGetPlayersSpec(specs);
  if (!getPlayersSpec) {
    plan = await ctx.api('/ingest/local/plan');
    specs = plan?.endpoints || [];
    getPlayersSpec = findGetPlayersSpec(specs);
  }
  if (!getPlayersSpec) {
    throw new Error('Local ingest plan missing getPlayers spec for customer ID resolution');
  }

  const gpResult = await fetchSpec(authPayload, getPlayersSpec);
  await ctx.apiPost(
    '/ingest/local',
    { results: [gpResult], advanceCursor: false },
    { acceptStatuses: [202, 500] },
  );
  plan = await ctx.api('/ingest/local/plan');
  specs = plan?.endpoints || [];

  if (planNeedsCustomerIdResolution(specs)) {
    throw new Error('Customer ID still unresolved after getPlayers prefetch — check getPlayers response');
  }

  return { plan, specs, prefetchResults: [gpResult] };
}
