import manifest from "../upstream-endpoints.json";

export interface UpstreamManifestEndpoint {
  key: string;
  method: string;
  path: string;
  operationId: string;
  contentType: string;
  requiresCustomerId?: boolean;
}

export const UPSTREAM_MANIFEST = manifest as {
  spec: string;
  endpoints: UpstreamManifestEndpoint[];
};
