import http from "node:http";

const defaultOrigin = "https://fantasy402-ingestion.utahj4754.workers.dev";
const targetOrigin = new URL(process.env.WORKER_ORIGIN ?? defaultOrigin);
const port = Number(process.env.PORT ?? 8790);
const proxyPrefixes = ["/archive", "/scans", "/diagnostics", "/health"];

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (proxyPrefixes.some((prefix) => requestUrl.pathname === prefix || requestUrl.pathname.startsWith(`${prefix}/`))) {
      await proxyRequest(request, response, requestUrl);
      return;
    }

    response.writeHead(302, { Location: "/archive/viewer" });
    response.end();
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ status: "failed", message: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Fantasy402 viewer proxy: http://127.0.0.1:${port}/archive/viewer`);
  console.log(`Proxying API requests to: ${targetOrigin.origin}`);
});

async function proxyRequest(request, response, requestUrl) {
  const upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, targetOrigin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else if (value) {
      headers.set(key, value);
    }
  }
  headers.set("host", targetOrigin.host);

  const method = request.method ?? "GET";
  const hasBody = !["GET", "HEAD"].includes(method);
  const upstream = await fetch(upstreamUrl, {
    method,
    headers,
    body: hasBody ? request : undefined,
    duplex: hasBody ? "half" : undefined,
    redirect: "manual",
  });

  const responseHeaders = {};
  upstream.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  response.writeHead(upstream.status, responseHeaders);
  if (upstream.body) {
    for await (const chunk of upstream.body) response.write(chunk);
  }
  response.end();
}
