# gitlab-webhook-relay

A lightweight Node.js bridge that converts GitLab webhook events into [OpenClaw](https://openclaw.ai) agent prompts.

When a Merge Request is opened or reopened in GitLab, the relay receives the webhook, builds a structured code review prompt, and forwards it to OpenClaw's `/hooks/agent` endpoint — triggering an isolated AI agent to review the diff and post a comment back to the MR.

```
GitLab  ──webhook──▶  nginx  ──proxy──▶  relay  ──agent──▶  OpenClaw
                                                                  │
                      MR comment  ◀──── GitLab API  ◀────────────┘
```

## Features

- **Zero dependencies** — stdlib only (Node.js 18+)
- **Configurable via environment variables** — no secrets in code
- **Health check** endpoint (`GET /health`)
- **nginx example** for putting behind a reverse proxy
- **Systemd service** + **Docker / docker-compose** deployment options
- Easily extensible: add more GitLab event handlers in `HANDLERS`

## Requirements

- Node.js 18+ (ESM)
- [OpenClaw](https://openclaw.ai) with `hooks.enabled: true` configured
- GitLab (self-hosted or cloud) with webhook support

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/YOUR_ORG/gitlab-webhook-relay.git
cd gitlab-webhook-relay
cp .env.example .env
$EDITOR .env
```

Fill in your `.env`:

| Variable | Description |
|---|---|
| `GITLAB_WEBHOOK_SECRET` | Secret token you'll set in GitLab webhook settings |
| `OPENCLAW_HOOKS_URL` | Your OpenClaw endpoint, e.g. `http://127.0.0.1:18789/hooks/agent` |
| `OPENCLAW_HOOKS_TOKEN` | Token from `hooks.token` in `openclaw.json` |
| `TELEGRAM_CHAT_ID` | (Optional) Telegram chat ID for review delivery |
| `HOST` | Bind address (default: `127.0.0.1`) |
| `PORT` | Listen port (default: `9091`) |

### 2. Configure OpenClaw

In your `openclaw.json` (or via `config.patch`):

```json
{
  "hooks": {
    "enabled": true,
    "token": "YOUR_OPENCLAW_HOOKS_TOKEN",
    "path": "/hooks"
  }
}
```

### 3. Run

```bash
node index.js
```

Check it's up:

```bash
curl http://localhost:9091/health
# {"ok":true,"ts":1234567890}
```

## Deployment

### Option A: systemd (recommended for bare-metal)

```bash
# Copy and edit the service file
cp deploy/gitlab-webhook-relay.service /etc/systemd/system/
$EDITOR /etc/systemd/system/gitlab-webhook-relay.service  # set User= and paths

systemctl daemon-reload
systemctl enable --now gitlab-webhook-relay
journalctl -u gitlab-webhook-relay -f
```

### Option B: Docker

```bash
cp .env.example .env && $EDITOR .env
docker compose up -d
```

> **Note:** If OpenClaw runs on the host, uncomment `extra_hosts` in `docker-compose.yml`
> and use `http://host.docker.internal:18789/hooks/agent` as `OPENCLAW_HOOKS_URL`.

### Nginx reverse proxy (recommended)

Use the example at `deploy/nginx.conf.example`. It:
- Binds only to your internal network interface
- Validates `X-Gitlab-Token` before proxying
- Blocks all other paths

```bash
cp deploy/nginx.conf.example /etc/nginx/conf.d/gitlab-webhook-relay.conf
$EDITOR /etc/nginx/conf.d/gitlab-webhook-relay.conf  # set your IP and secret
nginx -t && systemctl reload nginx
```

**On Fedora / SELinux**, allow nginx to connect to localhost:

```bash
setsebool -P httpd_can_network_connect on
semanage port -a -t http_port_t -p tcp 9090  # or whichever port you use
```

## GitLab Webhook Setup

1. Go to your project → **Settings → Webhooks**
2. Add a new webhook:
   - **URL:** `http://YOUR_HOST:9090/webhook` (nginx) or `http://YOUR_HOST:9091/webhook` (direct)
   - **Secret token:** value of `GITLAB_WEBHOOK_SECRET`
   - **Triggers:** ✅ Merge request events
   - **SSL verification:** disable if using HTTP

> **Self-hosted GitLab:** If GitLab blocks webhooks to private IPs, go to  
> **Admin Area → Settings → Network → Outbound requests** and add your host to the allowlist.

## How the Review Works

When an MR is opened or reopened:

1. Relay receives the webhook, validates the secret, extracts MR metadata
2. Builds a structured prompt with project ID, MR IID, branch info
3. Forwards to OpenClaw `/hooks/agent` → isolated agent session starts
4. Agent fetches the diff via GitLab API using your configured token
5. Reviews the code: architecture, security, style, bugs
6. Posts a comment directly on the MR via GitLab API
7. Sends a summary to the configured Telegram chat (if set)

## Extending

Add more event handlers in `index.js`:

```js
// Handle push events
function buildPushMessage(payload) {
  if (payload.ref !== "refs/heads/main") return null;
  return `New push to main in ${payload.project.name}. Check for issues.`;
}

const HANDLERS = {
  merge_request: buildMrMessage,
  push:          buildPushMessage,  // ← add here
};
```

## License

MIT
