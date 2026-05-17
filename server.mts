import nextEnv from "@next/env";
import { AsyncLocalStorage } from "node:async_hooks";

// Next.js expects AsyncLocalStorage on globalThis (its own CLI sets this up
// before loading the app). When booting from a custom server entry point we
// have to do it ourselves.
(globalThis as unknown as { AsyncLocalStorage: typeof AsyncLocalStorage }).AsyncLocalStorage =
  AsyncLocalStorage;

const dev = process.env.NODE_ENV !== "production";
nextEnv.loadEnvConfig(process.cwd(), dev);

async function main() {
  const { createServer } = await import("node:http");
  type IncomingMessage = import("node:http").IncomingMessage;
  type ServerResponse = import("node:http").ServerResponse;
  const { default: next } = await import("next");
  const { WebSocketServer } = await import("ws");
  type WebSocket = import("ws").WebSocket;
  const { getIronSession } = await import("iron-session");
  const { sessionOptions, isSessionLive } = await import("./src/lib/session");
  type SessionData = import("./src/lib/session").SessionData;
  const { extractBearer, verifyBearer } = await import("./src/lib/bearer");

  const port = parseInt(process.env.PORT ?? "3000", 10);
  const hostname = process.env.HOSTNAME ?? "0.0.0.0";

  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  async function isUpgradeAuthorized(req: IncomingMessage): Promise<boolean> {
    // Bearer takes precedence — non-browser clients pass Authorization or ?token=
    const headerToken = extractBearer(req.headers["authorization"]);
    let queryToken: string | null = null;
    if (req.url) {
      try {
        const u = new URL(req.url, "http://x");
        queryToken = u.searchParams.get("token");
      } catch {
        // ignored
      }
    }
    const rawToken = headerToken ?? queryToken;
    if (rawToken && verifyBearer(rawToken)) return true;

    const fakeRes = {
      getHeader: () => undefined,
      setHeader: () => fakeRes,
      headersSent: false,
    } as unknown as ServerResponse;
    try {
      const session = await getIronSession<Partial<SessionData>>(
        req,
        fakeRes,
        sessionOptions(),
      );
      return isSessionLive(session);
    } catch {
      return false;
    }
  }

  const NOMLY_TOPICS = new Set(["shopping"]);

  await app.prepare();

  const server = createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      console.error("Request handling error", err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  // WebSocket hub on /ws — Epic 1 wires the upgrade + auth gate; mutation
  // consumers arrive with Epic 9. Connections that pass the gate may subscribe
  // to known topics; mutate frames are not yet handled.
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    const url = req.url ?? "";
    if (!url.startsWith("/ws")) {
      socket.destroy();
      return;
    }
    const authorized = await isUpgradeAuthorized(req);
    if (!authorized) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    const subscriptions = new Set<string>();
    ws.on("message", (raw) => {
      let msg: { op?: string; topic?: string };
      try {
        msg = JSON.parse(raw.toString()) as typeof msg;
      } catch {
        return;
      }
      if (msg.op === "subscribe" && msg.topic && NOMLY_TOPICS.has(msg.topic)) {
        subscriptions.add(msg.topic);
        ws.send(JSON.stringify({ op: "subscribed", topic: msg.topic }));
      }
    });
    ws.send(JSON.stringify({ op: "hello", version: 1 }));
  });

  server.listen(port, hostname, () => {
    const proto = process.env.BASE_URL?.startsWith("https") ? "https" : "http";
    console.log(`> nomly listening at ${proto}://${hostname}:${port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
