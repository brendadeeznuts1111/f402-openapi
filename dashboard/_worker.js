const DEFAULT_WORKER_ORIGIN = "https://fantasy402-ingestion.utahj4754.workers.dev";

function workerOrigin(env) {
  const fromEnv = (env.FANTASY402_WORKER_UPSTREAM || env.WORKER_ORIGIN || "").trim();
  return (fromEnv || DEFAULT_WORKER_ORIGIN).replace(/\/$/, "");
}

/** Routes the Worker exposes without bearer auth (must match worker/src/index.ts). */
function isPublicWorkerPath(pathname) {
  if (pathname === "/health") return true;
  if (pathname === "/auth/health") return true;
  if (pathname === "/live-wagers" || pathname.startsWith("/live-wagers/")) return true;
  return false;
}

function workerPathFromApiUrl(pathname) {
  const path = pathname.replace(/^\/api/, "") || "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function jsonError(status, message, extra = {}) {
  return new Response(JSON.stringify({ status: "failed", message, ...extra }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function buildUpstreamHeaders(request, token, pathname, hasBody) {
  const headers = new Headers();
  const isStream = pathname === "/live-wagers" || pathname.startsWith("/live-wagers/");

  if (isStream) {
    headers.set("Accept", "text/event-stream");
  } else {
    headers.set("Accept", request.headers.get("Accept") || "application/json");
  }

  if (hasBody) {
    headers.set("Content-Type", request.headers.get("Content-Type") || "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return { headers, isStream };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api")) {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
            "Access-Control-Max-Age": "86400",
          },
        });
      }

      const pathname = workerPathFromApiUrl(url.pathname);
      const token = env.INGESTION_TRIGGER_TOKEN;
      const isPublic = isPublicWorkerPath(pathname);

      if (!token && !isPublic) {
        return jsonError(500, "Server misconfigured: missing token", {
          code: "MISSING_PAGES_TOKEN",
          hint: "Set INGESTION_TRIGGER_TOKEN on Cloudflare Pages (production and preview), then redeploy.",
        });
      }

      const target = new URL(pathname, workerOrigin(env));
      target.search = url.search;

      const hasBody = request.method !== "GET" && request.method !== "HEAD";
      const reqBody = hasBody ? await request.text() : undefined;
      const { headers, isStream } = buildUpstreamHeaders(request, token, pathname, hasBody);

      let response;
      try {
        response = await fetch(target.toString(), {
          method: request.method,
          headers,
          body: reqBody,
        });
      } catch (err) {
        return jsonError(502, "Worker upstream unreachable", {
          code: "UPSTREAM_ERROR",
          detail: err?.message || String(err),
        });
      }

      const responseHeaders = new Headers({
        "Cache-Control": "no-store, max-age=0",
        "Access-Control-Allow-Origin": "*",
      });

      if (isStream) {
        responseHeaders.set("Content-Type", response.headers.get("Content-Type") || "text/event-stream");
        responseHeaders.set("Connection", "keep-alive");
        return new Response(response.body, {
          status: response.status,
          headers: responseHeaders,
        });
      }

      const resBody = await response.text();
      responseHeaders.set("Content-Type", response.headers.get("Content-Type") ?? "application/json");
      return new Response(resBody, {
        status: response.status,
        headers: responseHeaders,
      });
    }

    return env.ASSETS.fetch(request);
  },
};
