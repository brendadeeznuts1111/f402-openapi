import { z } from "zod";

const broadcastWagerSchema = z.object({
  id: z.string(),
  login: z.string(),
  wager_type: z.string(),
  amount_wagered: z.number(),
  captured_at: z.string(),
});

type BroadcastWager = z.infer<typeof broadcastWagerSchema>;

export class LiveWagerBroadcaster {
  private sessions: Map<string, WritableStreamDefaultWriter<Uint8Array>> = new Map();
  private encoder = new TextEncoder();

  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") {
      return this.handleSSE(request);
    }
    if (request.method === "POST") {
      return this.handleBroadcast(request);
    }
    if (request.method === "HEAD") {
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  }

  private handleSSE(request: Request): Response {
    const sessionId = crypto.randomUUID();
    const { readable, writable } = new TransformStream<Uint8Array>();
    const writer = writable.getWriter();
    const encoder = this.encoder;

    writer.write(encoder.encode(":ok\n\n")).catch(() => {});

    this.sessions.set(sessionId, writer);

    request.signal.addEventListener("abort", () => {
      this.sessions.delete(sessionId);
      writer.close().catch(() => {});
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  private async handleBroadcast(request: Request): Promise<Response> {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const parsed = broadcastWagerSchema.safeParse(raw);
    if (!parsed.success) {
      return new Response("Invalid wager payload", { status: 400 });
    }

    const wager = parsed.data;
    const data = `data: ${JSON.stringify(wager)}\n\n`;
    const encoded = this.encoder.encode(data);

    const dead: string[] = [];
    const writes: Promise<void>[] = [];
    for (const [id, writer] of this.sessions) {
      writes.push(
        writer.write(encoded).catch(() => {
          dead.push(id);
        })
      );
    }
    await Promise.all(writes);
    for (const id of dead) {
      this.sessions.delete(id);
    }

    return new Response("OK", { status: 200 });
  }
}
