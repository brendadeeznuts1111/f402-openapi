/** Shared customer ID helpers for local-browser-ingest.mjs */

export function extractPlayerCustomerId(data) {
  if (!data || typeof data !== "object") return null;
  const list = data.LIST;
  if (!Array.isArray(list) || !list.length) return null;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    for (const field of ["customerID", "CustomerID"]) {
      const value = item[field];
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed && trimmed !== "__REDACTED__") return trimmed;
      }
    }
  }
  return null;
}

export function planNeedsCustomerIdResolution(specs) {
  return Array.isArray(specs) && specs.some((spec) => spec.requiresCustomerIdResolution);
}

export function findGetPlayersSpec(specs) {
  return specs?.find((spec) => spec.key === "getPlayers" && spec.body) ?? null;
}
