const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "7a470541a704caaf91e71efccc78fd36";

if (!token) {
  console.error(JSON.stringify({ status: "failed", message: "CLOUDFLARE_API_TOKEN is required in the shell environment" }, null, 2));
  process.exit(1);
}

const tokenShape = {
  length: token.length,
  trimmedLength: token.trim().length,
  asciiOnly: /^[\x20-\x7E]*$/.test(token),
  hasWhitespace: /\s/.test(token),
  hasLeadingOrTrailingWhitespace: token.length !== token.trim().length,
  looksLikeFormattedOutput: /[│┌┐└┘─]|Secret name|Value encrypted|Services|Workers/i.test(token),
};

const checks = [];

for (const check of [
  { stage: "token-verify", method: "GET", path: `/accounts/${accountId}/tokens/verify` },
  { stage: "url-scanner-access", method: "GET", path: `/accounts/${accountId}/urlscanner/v2/search?size=1&q=apikey:me` },
]) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${check.path}`, {
    method: check.method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { errors: [{ message: body.slice(0, 500) || "non-JSON Cloudflare response" }] };
  }
  checks.push({
    ...check,
    httpStatus: response.status,
    success: response.ok && parsed.success !== false,
    errors: parsed.errors ?? [],
    messages: parsed.messages ?? [],
  });
  if (!checks.at(-1).success) break;
}

const failed = checks.find((check) => !check.success);
console.log(
  JSON.stringify(
    {
      status: failed ? "degraded" : "ready",
      accountId,
      tokenShape,
      checks,
      failure: failed
        ? {
            stage: failed.stage,
            code: typeof failed.errors[0]?.code === "number" ? failed.errors[0].code : null,
            message: failed.errors[0]?.message ?? `${failed.stage} failed`,
          }
        : null,
    },
    null,
    2,
  ),
);

process.exit(failed ? 1 : 0);
