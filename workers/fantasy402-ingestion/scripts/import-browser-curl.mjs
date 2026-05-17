import fs from "node:fs";
import { execFileSync } from "node:child_process";

const inputPath = process.argv[2] ?? process.env.FANTASY402_BROWSER_CURL_FILE ?? "fantasy402/browser-request.curl";
const outputPath = process.env.FANTASY402_BROWSER_AUTH_FILE ?? "fantasy402/browser-auth.json";

const curl = readInput(inputPath);
const imported = parseBrowserCurl(curl);

if (!imported.authorization && !imported.sessionCookie) {
  fail(`No Authorization header or Cookie header found in ${inputPath}`);
}

fs.mkdirSync(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(imported, null, 2)}\n`);

console.log(JSON.stringify({
  status: "ok",
  input: inputPath,
  output: outputPath,
  fields: Object.keys(imported),
  browserHeaderCount: Object.keys(imported.browserHeaders ?? {}).length,
}, null, 2));

function parseBrowserCurl(text) {
  const headers = {};
  const headerMatches = text.matchAll(/(?:^|\s)(?:-H|--header)\s+(["'])(.*?)\1/gms);
  for (const match of headerMatches) {
    const raw = unescapeShell(match[2]).trim();
    const index = raw.indexOf(":");
    if (index <= 0) continue;
    headers[raw.slice(0, index).trim().toLowerCase()] = raw.slice(index + 1).trim();
  }

  const cookie = parseCookieFlag(text) || headers.cookie || "";
  const cookies = parseCookies(cookie);
  const bodyText = parseDataRaw(text);
  const form = parseFormBody(bodyText);

  const browserHeaders = {};
  for (const name of [
    "accept",
    "accept-language",
    "origin",
    "priority",
    "referer",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "user-agent",
    "x-requested-with",
  ]) {
    if (headers[name]) browserHeaders[name] = headers[name];
  }

  const result = {
    sourcePath: parseCurlUrl(text)?.pathname || "",
    sourceOperation: form.operation || "",
    sourceContentType: headers["content-type"] || "",
    agentId: form.agentID || form.agentOwner || form.customerID || "",
    customerId: form.customerID || "",
    authorization: headers.authorization || "",
    sessionCookie: cookieWithoutCloudflare(cookies),
    cfClearance: cookies.cf_clearance || "",
    cfBm: cookies.__cf_bm || "",
    browserHeaders,
    expiresInSeconds: 3600,
  };

  for (const key of Object.keys(result)) {
    if (result[key] === "" || (key === "browserHeaders" && Object.keys(result[key]).length === 0)) {
      delete result[key];
    }
  }
  return result;
}

function parseCurlUrl(text) {
  const match = text.match(/curl\s+(["'])(.*?)\1/ms) || text.match(/curl\s+(\S+)/m);
  const raw = match?.[2] || match?.[1] || "";
  try {
    return new URL(unescapeShell(raw));
  } catch {
    return null;
  }
}

function parseCookieFlag(text) {
  const match = text.match(/(?:^|\s)(?:-b|--cookie)\s+(["'])(.*?)\1/ms);
  return match ? unescapeShell(match[2]).trim() : "";
}

function parseDataRaw(text) {
  const match = text.match(/(?:^|\s)(?:--data-raw|--data)\s+(["'])(.*?)\1/ms);
  return match ? unescapeShell(match[2]).trim() : "";
}

function parseFormBody(text) {
  if (!text) return {};
  if (text.startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
  const output = {};
  const params = new URLSearchParams(text);
  for (const [key, value] of params.entries()) output[key] = value;
  return output;
}

function parseCookies(value) {
  const output = {};
  for (const part of value.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    output[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return output;
}

function cookieWithoutCloudflare(cookies) {
  return Object.entries(cookies)
    .filter(([name]) => !["cf_clearance", "__cf_bm"].includes(name))
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function unescapeShell(value) {
  return value.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function readInput(path) {
  if (path === "-") {
    return fs.readFileSync(0, "utf8");
  }
  try {
    return fs.readFileSync(path, "utf8");
  } catch (error) {
    if (path === "fantasy402/browser-request.curl") {
      const pasted = readMacClipboard();
      if (pasted) return pasted;
      fail(
        `Could not read ${path}, and the macOS clipboard did not contain a curl command. Copy a successful browser request as cURL, then rerun this command, or pipe it with: pbpaste | npm run auth:import-curl -- -`,
      );
    }
    fail(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readMacClipboard() {
  try {
    const pasted = execFileSync("pbpaste", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return pasted.includes("curl ") ? pasted : "";
  } catch {
    return "";
  }
}

function fail(message) {
  console.error(JSON.stringify({ status: "failed", message }, null, 2));
  process.exit(1);
}
