// Reverse proxy in front of the app, with a switch for injecting failures.
//
// The reload loop only reproduces through something that sits in front of the
// container: while nomly is restarting, the *proxy* answers, with a 503 and an
// HTML body. Playwright's own route interception cannot stand in for that,
// because the service worker — the other half of the loop — has to see the same
// responses the browser does.
//
//   GET /__mode          → current mode
//   GET /__mode/fail     → every request answers 503 text/html
//   GET /__mode/pass     → proxy through to the app
import { createServer, request as httpRequest } from "node:http";

const PORT = Number(process.env.E2E_PROXY_PORT ?? 3100);
const UPSTREAM_PORT = Number(process.env.E2E_APP_PORT ?? 3000);

let mode = "pass";

const server = createServer((req, res) => {
  if (req.url === "/__mode") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(mode);
    return;
  }
  if (req.url === "/__mode/fail" || req.url === "/__mode/pass") {
    mode = req.url.endsWith("fail") ? "fail" : "pass";
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(mode);
    return;
  }

  if (mode === "fail") {
    // Exactly the shape that broke us: an error status with an HTML body, so
    // the router cannot read it as a flight payload.
    res.writeHead(503, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>503</title><h1>Service Unavailable</h1>");
    return;
  }

  const upstream = httpRequest(
    {
      host: "127.0.0.1",
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: `127.0.0.1:${PORT}` },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("bad gateway");
  });
  req.pipe(upstream);
});

// WebSocket upgrades are refused rather than forwarded. Relaying frames by
// hand corrupts them (client frames must stay masked), and a mangled frame is
// a bug in the harness masquerading as a bug in the app. The realtime hub is
// not what these specs measure, and a socket that never connects only makes the
// client retry — it cannot reload the page, which is the thing being asserted.
server.on("upgrade", (_req, socket) => {
  socket.destroy();
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`e2e fault proxy on http://127.0.0.1:${PORT}\n`);
});
