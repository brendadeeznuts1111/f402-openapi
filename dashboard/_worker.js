const WORKER_ORIGIN = "https://fantasy402-ingestion.utahj4754.workers.dev";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const token = env.INGESTION_TRIGGER_TOKEN;
      if (!token) {
        return new Response(JSON.stringify({ status: "failed", message: "Server misconfigured: missing token" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      const target = new URL(url.pathname.replace("/api", ""), WORKER_ORIGIN);
      target.search = url.search;

      const contentType = request.headers.get("Content-Type") || "application/json";
      const reqBody = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();

      const response = await fetch(target, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": contentType,
          Accept: "application/json",
        },
        body: reqBody,
      });

      const isStream = response.headers.get("Content-Type")?.includes("text/event-stream");

      const responseHeaders = new Headers({
        "Cache-Control": "no-store, max-age=0",
        "Access-Control-Allow-Origin": "*",
      });

      if (isStream) {
        responseHeaders.set("Content-Type", "text/event-stream");
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
