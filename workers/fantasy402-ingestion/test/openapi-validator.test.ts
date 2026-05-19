import assert from "node:assert/strict";
import fs from "node:fs";
import { URL, fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import test from "node:test";
import { routeSchemas } from "../src/schema";
import { validFixture } from "./zod-utils";

const spec = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../openapi.worker.json", import.meta.url)), "utf8"));

function createOpenApiValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return {
    validateComponent(schemaName: string, payload: unknown): { valid: boolean; errors: unknown[] } {
      const validate = ajv.compile({
        $id: `https://worker.test/openapi/${schemaName}.json`,
        ...spec.components.schemas[schemaName],
        components: spec.components,
      });
      const valid = validate(payload);
      return { valid, errors: validate.errors ?? [] };
    },
  };
}

test("OpenAPI validator accepts runtime response fixtures derived from Zod schemas", () => {
  const validator = createOpenApiValidator();

  for (const [schemaName, schema] of Object.entries(routeSchemas)) {
    const result = validator.validateComponent(schemaName, validFixture(schema));
    assert.equal(result.valid, true, `${schemaName} should validate against OpenAPI: ${JSON.stringify(result.errors)}`);
  }
});

test("OpenAPI validator rejects malformed request and response payloads", () => {
  const validator = createOpenApiValidator();

  assert.equal(
    validator.validateComponent("ScanTriggerRequest", { url: "ftp://fantasy402.com" }).valid,
    false,
    "OpenAPI ScanTriggerRequest should reject non-http URLs via format/pattern contract",
  );
  assert.equal(validator.validateComponent("TriggerResponse", { status: "success" }).valid, false);
  assert.equal(validator.validateComponent("ArchiveListResponse", { objects: [], truncated: false }).valid, false);
});

test("OpenAPI validator confirms documented route response examples match snapshots", () => {
  const validator = createOpenApiValidator();
  const healthExample = spec.paths["/health"].get.responses["200"].content["application/json"].examples.ok.value;
  const triggerExample = spec.paths["/trigger"].post.responses["202"].content["application/json"].examples.accepted.value;
  const archiveExample = spec.paths["/archive"].get.responses["200"].content["application/json"].examples.listing.value;
  const scanExample = spec.paths["/scans"].get.responses["200"].content["application/json"].examples.recent.value;
  const scanTriggerExample = spec.paths["/scans/trigger"].post.responses["202"].content["application/json"].examples.accepted.value;

  assert.equal(validator.validateComponent("HealthResponse", healthExample).valid, true);
  assert.equal(validator.validateComponent("TriggerResponse", triggerExample).valid, true);
  assert.equal(validator.validateComponent("ArchiveListResponse", archiveExample).valid, true);
  assert.equal(validator.validateComponent("ScanListResponse", scanExample).valid, true);
  assert.equal(validator.validateComponent("ScanTriggerResponse", scanTriggerExample).valid, true);
});
