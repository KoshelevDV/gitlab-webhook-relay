/**
 * gitlab-webhook-relay
 * Bridges GitLab webhook events to OpenClaw /hooks/agent
 *
 * Configure via environment variables (see .env.example)
 */

import http from "http";
import https from "https";
import { readFileSync } from "fs";

// ─── Config ──────────────────────────────────────────────────────────────────

function required(key) {
  const val = process.env[key];
  if (!val) {
    console.error(`[config] Missing required env var: ${key}`);
    process.exit(1);
  }
  return val;
}

const config = {
  port:           parseInt(process.env.PORT || "9091"),
  host:           process.env.HOST || "127.0.0.1",
  gitlabSecret:   required("GITLAB_WEBHOOK_SECRET"),
  openclawUrl:    required("OPENCLAW_HOOKS_URL"),       // e.g. http://127.0.0.1:18789/hooks/agent
  openclawToken:  required("OPENCLAW_HOOKS_TOKEN"),
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",   // optional, for deliver routing
  timeoutSeconds: parseInt(process.env.TIMEOUT_SECONDS || "300"),
};

// ─── Message builder ─────────────────────────────────────────────────────────

const TRIGGER_ACTIONS = new Set(["open", "reopen"]);

function buildMrMessage(payload) {
  const mr      = payload.object_attributes;
  const project = payload.project;
  const author  = payload.user?.name || "Unknown";

  if (!TRIGGER_ACTIONS.has(mr.action)) return null;

  const gitlabBase = new URL(config.openclawUrl).origin !== "null"
    ? mr.url.replace(/\/merge_requests.*/, "")
    : "https://gitlab.example.com";

  const apiBase = `${new URL(mr.url).origin}/api/v4`;

  return `New Merge Request in GitLab — please do a code review.

Project: ${project.path_with_namespace} (id: ${project.id})
MR #${mr.iid}: ${mr.title}
Branch: ${mr.source_branch} → ${mr.target_branch}
Author: ${author}
URL: ${mr.url}
${mr.description ? `Description: ${mr.description}\n` : ""}
Instructions:
1. Fetch the diff via GitLab API:
   GET ${apiBase}/projects/${project.id}/merge_requests/${mr.iid}/diffs
   Header: PRIVATE-TOKEN: <your-gitlab-token>

2. Review the changes: architecture, security, code style, potential bugs.

3. Post a review comment:
   POST ${apiBase}/projects/${project.id}/merge_requests/${mr.iid}/notes
   Body: { "body": "<your review>" }

4. Send a brief summary to the user.`.trim();
}

const HANDLERS = {
  merge_request: buildMrMessage,
};

function buildMessage(payload) {
  const handler = HANDLERS[payload.object_kind];
  return handler ? handler(payload) : null;
}

// ─── OpenClaw forwarding ──────────────────────────────────────────────────────

function forwardToOpenClaw(message) {
  const body = JSON.stringify({
    message,
    name: "GitLab MR Review",
    deliver: true,
    ...(config.telegramChatId ? { channel: "telegram", to: config.telegramChatId } : {}),
    timeoutSeconds: config.timeoutSeconds,
  });

  return new Promise((resolve, reject) => {
    const url     = new URL(config.openclawUrl);
    const lib     = url.protocol === "https:" ? https : http;
    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === "https:" ? 443 : 80),
      path:     url.pathname,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Authorization":  `Bearer ${config.openclawToken}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = lib.request(options, (res) => resolve(res.statusCode));
    req.on("error", reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data",  (c) => { raw += c; if (raw.length > 1_000_000) req.destroy(); });
    req.on("end",   ()  => resolve(raw));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, ts: Date.now() }));
  }

  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404);
    return res.end("Not Found");
  }

  // Auth
  if (req.headers["x-gitlab-token"] !== config.gitlabSecret) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  const raw = await readBody(req).catch(() => null);
  if (!raw) {
    res.writeHead(400);
    return res.end("Bad Request");
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    res.writeHead(400);
    return res.end("Invalid JSON");
  }

  const message = buildMessage(payload);
  if (!message) {
    log("skip", payload.object_kind, payload.object_attributes?.action ?? "—");
    res.writeHead(200);
    return res.end("Skipped");
  }

  try {
    const status = await forwardToOpenClaw(message);
    log("forward", `${payload.object_kind} #${payload.object_attributes?.iid}`, `→ OpenClaw ${status}`);
    res.writeHead(status === 202 ? 202 : 200);
    res.end("OK");
  } catch (err) {
    log("error", err.message);
    res.writeHead(502);
    res.end("Upstream Error");
  }
});

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

server.listen(config.port, config.host, () => {
  log("ready", `listening on ${config.host}:${config.port}`);
});
