import fs from "node:fs";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";
import { routeSchemas, settingsSchema } from "../src/schema";
import { assertMatchesSnapshot, describeZodSchema } from "./zod-utils";

test("OpenAPI schema names and component structures match checked-in snapshot", () => {
  const spec = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../openapi.worker.json", import.meta.url)), "utf8"));
  const schemas = spec.components.schemas;

  assertMatchesSnapshot("./__snapshots__/openapi-schemas.snap.json", {
    names: Object.keys(schemas).sort(),
    schemas,
  });
});

test("SettingsSchema definition matches checked-in harness snapshot", () => {
  assertMatchesSnapshot("./harness/snapshots/settings-schema.snap.json", describeZodSchema(settingsSchema));
});

test("Zod schema definitions match checked-in snapshot", () => {
  assertMatchesSnapshot(
    "./__snapshots__/zod-schemas.snap.json",
    Object.fromEntries(
      Object.entries(routeSchemas)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, schema]) => [name, describeZodSchema(schema)]),
    ),
  );
});
