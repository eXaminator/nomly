import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";

/**
 * `ws` reports socket-level failures as 'error' events, and an unhandled one is
 * an uncaughtException — which takes the whole Node process down. For nomly that
 * means one client sending a frame the parser rejects kills the app for
 * everyone, and the container restarts: the same outage as the crash loop, from
 * a different direction.
 *
 * A malformed frame is not exotic. Anything speaking the protocol slightly
 * wrong will do it, and an unmasked client frame — which the spec forbids and
 * `ws` rejects with WS_ERR_EXPECTED_MASK — is the shape our own e2e proxy
 * produced by accident.
 *
 * This pins the handler wiring from server.mts. It mirrors that setup rather
 * than importing it, because server.mts boots Next and binds a port.
 */
type Harness = {
  port: number;
  http: Server;
  wss: WebSocketServer;
  errors: unknown[];
};

let harness: Harness | null = null;

afterEach(async () => {
  if (!harness) return;
  const { http, wss } = harness;
  harness = null;
  await new Promise<void>((r) => wss.close(() => r()));
  await new Promise<void>((r) => http.close(() => r()));
});

/** The hub as server.mts wires it, with `guarded` toggling the error handlers. */
async function startHub(guarded: boolean): Promise<Harness> {
  const errors: unknown[] = [];
  const http = createServer();
  const wss = new WebSocketServer({ noServer: true });

  if (guarded) wss.on("error", (err) => errors.push(err));

  http.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws")) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });

  wss.on("connection", (ws: WebSocket) => {
    if (guarded) ws.on("error", (err) => errors.push(err));
    ws.on("message", () => undefined);
    ws.send(JSON.stringify({ op: "hello", version: 1 }));
  });

  const port: number = await new Promise((resolve) => {
    http.listen(0, "127.0.0.1", () => {
      const addr = http.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
  harness = { port, http, wss, errors };
  return harness;
}

/** Complete a WebSocket handshake, then send a frame with the mask bit clear. */
async function sendUnmaskedFrame(port: number): Promise<void> {
  const socket = connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
  socket.write(
    "GET /ws HTTP/1.1\r\n" +
      "Host: 127.0.0.1\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Version: 13\r\n\r\n",
  );
  // Wait for the 101 before writing a frame.
  await new Promise<void>((resolve) => {
    const onData = (chunk: Buffer) => {
      if (chunk.toString("latin1").includes("101")) {
        socket.off("data", onData);
        resolve();
      }
    };
    socket.on("data", onData);
    setTimeout(resolve, 1_000);
  });
  // FIN + text opcode, 1 byte payload, mask bit NOT set: illegal from a client.
  socket.write(Buffer.from([0x81, 0x01, 0x41]));
  await new Promise((r) => setTimeout(r, 150));
  socket.destroy();
}

describe("websocket hub resilience", () => {
  it("survives a malformed frame and reports it, instead of dying", async () => {
    const hub = await startHub(true);
    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => uncaught.push(err);
    process.on("uncaughtException", onUncaught);
    try {
      await sendUnmaskedFrame(hub.port);
    } finally {
      process.off("uncaughtException", onUncaught);
    }

    expect(uncaught, "a bad frame must not become an uncaughtException").toEqual(
      [],
    );
    // It is still noticed, not silently swallowed.
    expect(hub.errors.length).toBeGreaterThan(0);
    expect(String((hub.errors[0] as Error).message)).toMatch(/MASK|mask/);
    // And the hub is still serving.
    expect(hub.wss.clients.size).toBeLessThanOrEqual(1);
    expect(hub.http.listening).toBe(true);
  });

  it("would raise an uncaughtException without the handlers", async () => {
    // Guards the test itself: if `ws` ever stops surfacing this as an 'error',
    // the case above would pass for the wrong reason.
    const hub = await startHub(false);
    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => uncaught.push(err);
    // Vitest installs its own handler; capture and restore around the probe.
    const existing = process.listeners("uncaughtException");
    process.removeAllListeners("uncaughtException");
    process.on("uncaughtException", onUncaught);
    try {
      await sendUnmaskedFrame(hub.port);
    } finally {
      process.off("uncaughtException", onUncaught);
      for (const l of existing) {
        process.on("uncaughtException", l as (err: Error) => void);
      }
    }

    expect(
      uncaught.length,
      "unhandled ws errors are supposed to reach uncaughtException — " +
        "if this fails, the handlers in server.mts may no longer be load-bearing",
    ).toBeGreaterThan(0);
  });
});
