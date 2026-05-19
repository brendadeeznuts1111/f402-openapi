import manifest from "../upstream-endpoints.json";

export interface UpstreamManifestEndpoint {
  key: string;
  method: string;
  path: string;
  operationId: string;
  contentType: string;
  requiresCustomerId?: boolean;
  /** OpenAPI x-customer-id-source: upstream route that supplies player customerID. */
  customerIdSource?: string;
}

export const UPSTREAM_MANIFEST = manifest as {
  spec: string;
  endpoints: UpstreamManifestEndpoint[];
};
