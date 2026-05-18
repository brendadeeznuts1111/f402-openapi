import fs from "node:fs";
import { jwtExpiryDiagnostics, parseBrowserCurl, readBrowserCurlInput } from "./browser-auth-utils.mjs";

const inputPath = process.argv[2] ?? process.env.FANTASY402_BROWSER_CURL_FILE ?? "fantasy402/browser-request.curl";
const outputPath = process.env.FANTASY402_BROWSER_AUTH_FILE ?? "fantasy402/browser-auth.json";

try {
  const curl = readBrowserCurlInput(inputPath);
  const imported = parseBrowserCurl(curl);

  if (!imported.authorization && !imported.sessionCookie) {
    fail(`No Authorization header or Cookie header found in ${inputPath}`);
  }

  fs.mkdirSync(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true, mode: 0o700 });
  fs.writeFileSync(outputPath, `${JSON.stringify(imported, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(outputPath, 0o600);

  console.log(JSON.stringify({
    status: "ok",
    input: inputPath,
    output: outputPath,
    fields: Object.keys(imported),
    authorizationExpiry: jwtExpiryDiagnostics(imported.authorization),
    browserHeaderCount: Object.keys(imported.browserHeaders ?? {}).length,
  }, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

function fail(message) {
  console.error(JSON.stringify({ status: "failed", message }, null, 2));
  process.exit(1);
}
