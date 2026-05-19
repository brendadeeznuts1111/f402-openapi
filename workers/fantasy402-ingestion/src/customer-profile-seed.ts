import { CUSTOMER_PROFILE_FACET_KEYS, type CustomerProfileFacetKey } from "./customer-profile";

export const CUSTOMER_PROFILE_SEED_FACETS: CustomerProfileFacetKey[] = [...CUSTOMER_PROFILE_FACET_KEYS];

export function buildCustomerFacetBody(
  agentId: string,
  customerId: string,
  operation: CustomerProfileFacetKey,
): Record<string, string | number> {
  const base = {
    agentID: agentId,
    agentOwner: agentId,
    customerID: customerId.trim(),
    operation,
  };
  if (operation === "getInfoPlayer") return { ...base, RRO: 0 };
  return { ...base, RRO: 1 };
}

export const CUSTOMER_FACET_PATHS: Record<CustomerProfileFacetKey, string> = {
  getInfoPlayer: "/cloud/api/Manager/getInfoPlayer",
  getCryptoInfo: "/cloud/api/Manager/getCryptoInfo",
  getMail: "/cloud/api/Manager/getMail",
  getTeaserProfile: "/cloud/api/Manager/getTeaserProfile",
};

export type SeedFacetPostResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; message: string; bodyPreview: string };

export type SeedFacetOutcome = {
  facet: CustomerProfileFacetKey;
  ok: boolean;
  error?: string;
  upstreamStatus?: number;
};
