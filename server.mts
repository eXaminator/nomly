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
  const { sessionOptions, isSessionLive } = await import("./src/lib/session.ts");
  type SessionData = import("./src/lib/session.ts").SessionData;
  const { extractBearer, verifyBearer } = await import("./src/lib/bearer.ts");
  const { sweepCheckedItems } = await import("./src/lib/shopping/sweeper.ts");
  const { onShoppingChanged, publishShoppingChanged } = await import(
    "./src/lib/shopping/realtime.ts"
  );

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

  // WebSocket hub on /ws. Connections that pass the auth gate subscribe to
  // known topics; on a shopping mutation we fan a lightweight "changed" event
  // out to subscribers, who then refetch the list (Epic 9 realtime sync).
  const wss = new WebSocketServer({ noServer: true });

  // `ws` emits socket-level failures as 'error' events, and an unhandled one
  // becomes an uncaughtException that takes the whole process down — the entire
  // app, for every user, because one client sent a frame it did not like (a
  // malformed or unmasked frame is enough, and it need not be deliberate). The
  // hub is a best-effort refetch nudge, so a broken socket is worth exactly one
  // log line.
  wss.on("error", (err) => {
    console.warn("[ws] server error", err);
  });

  // Sockets currently subscribed to the "shopping" topic.
  const shoppingSubscribers = new Set<WebSocket>();
  onShoppingChanged(() => {
    const frame = JSON.stringify({ op: "event", topic: "shopping" });
    for (const ws of shoppingSubscribers) {
      if (ws.readyState === ws.OPEN) ws.send(frame);
    }
  });

  server.on("upgrade", async (req, socket, head) => {
    const url = req.url ?? "";
    // Only handle our /ws endpoint. Next.js attaches its own upgrade listener
    // for /_next/webpack-hmr (and similar) in dev — we must not interfere by
    // destroying the socket, just let those listeners handle the request.
    if (!url.startsWith("/ws")) return;
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
    // Per-socket, for the same reason: without this a single bad frame from one
    // client is an uncaughtException, not a dropped connection.
    ws.on("error", (err) => {
      console.warn("[ws] connection error", err);
      shoppingSubscribers.delete(ws);
    });
    ws.on("message", (raw) => {
      let msg: { op?: string; topic?: string };
      try {
        msg = JSON.parse(raw.toString()) as typeof msg;
      } catch {
        return;
      }
      if (msg.op === "subscribe" && msg.topic && NOMLY_TOPICS.has(msg.topic)) {
        subscriptions.add(msg.topic);
        if (msg.topic === "shopping") shoppingSubscribers.add(ws);
        ws.send(JSON.stringify({ op: "subscribed", topic: msg.topic }));
      }
    });
    ws.on("close", () => shoppingSubscribers.delete(ws));
    ws.send(JSON.stringify({ op: "hello", version: 1 }));
  });

  server.listen(port, hostname, () => {
    const proto = process.env.BASE_URL?.startsWith("https") ? "https" : "http";
    console.log(`> nomly listening at ${proto}://${hostname}:${port}`);
  });

  // Shopping-list sweeper: removes items checked off > 24h ago. Runs once at
  // boot (so restarts catch up) and every 60 minutes thereafter. WS broadcast
  // for the deletions arrives with Epic 9; until then this just logs.
  const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
  function runSweep() {
    try {
      const { deletedIds } = sweepCheckedItems();
      if (deletedIds.length > 0) {
        console.log(
          `> shopping sweeper removed ${deletedIds.length} item(s):`,
          deletedIds,
        );
        // Push the removal to any connected clients so swept items vanish live.
        publishShoppingChanged();
      }
    } catch (err) {
      console.error("shopping sweeper failed", err);
    }
  }
  runSweep();
  const sweepHandle = setInterval(runSweep, SWEEP_INTERVAL_MS);
  // Don't keep the process alive just for the sweeper — the HTTP server is
  // the primary ref.
  sweepHandle.unref?.();
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
