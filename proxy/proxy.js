/**
 * Minimal HTTP proxy for assistant-2api-worker.
 * Deploy on a VPS to give your CF Worker a dedicated egress IP.
 *
 * Usage:
 *   node proxy.js                    # listens on :3100
 *   PORT=8080 node proxy.js          # custom port
 *
 * Then set PROXY_URL in wrangler.toml:
 *   PROXY_URL = "http://your-vps-ip:3100/proxy"
 *
 * How it works:
 *   CF Worker POSTs to this proxy with header X-Target-URL = real upstream.
 *   Proxy forwards the request body/headers to X-Target-URL and streams back.
 */

const http = require("http");
const https = require("https");

const PORT = parseInt(process.env.PORT || "3100", 10);
const PROXY_SECRET = process.env.PROXY_SECRET || ""; // optional auth

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Target-URL, X-Proxy-Secret");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/proxy") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  // Optional auth
  if (PROXY_SECRET && req.headers["x-proxy-secret"] !== PROXY_SECRET) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const targetUrl = req.headers["x-target-url"];
  if (!targetUrl) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing X-Target-URL header" }));
    return;
  }

  // Read request body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  // Forward to target
  const url = new URL(targetUrl);
  const mod = url.protocol === "https:" ? https : http;

  const forwardHeaders = {
    "content-type": req.headers["content-type"] || "application/json",
    "user-agent": req.headers["user-agent"] || "ai-sdk/6.1.0 runtime/browser",
    "origin": req.headers["origin"] || "https://www.assistant-ui.com",
    "referer": req.headers["referer"] || "https://www.assistant-ui.com/docs",
  };

  const proxyReq = mod.request(
    targetUrl,
    {
      method: "POST",
      headers: { ...forwardHeaders, "content-length": body.length },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    console.error("Proxy error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
  });

  proxyReq.write(body);
  proxyReq.end();
});

server.listen(PORT, () => {
  console.log(`Proxy listening on :${PORT}`);
  console.log(`Set PROXY_URL = "http://<your-vps-ip>:${PORT}/proxy" in wrangler.toml`);
});
