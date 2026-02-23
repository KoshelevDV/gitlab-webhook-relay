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

---

# gitlab-webhook-relay (Русский)

Лёгкий Node.js-мост, который преобразует события GitLab webhook в запросы к агенту [OpenClaw](https://openclaw.ai).

Когда в GitLab открывается или переоткрывается Merge Request, relay получает вебхук, формирует промпт для code review и передаёт его в OpenClaw `/hooks/agent`. Изолированный AI-агент скачивает diff, проверяет код и оставляет комментарий прямо в МР.

```
GitLab  ──webhook──▶  nginx  ──proxy──▶  relay  ──agent──▶  OpenClaw
                                                                  │
                      комментарий  ◀─── GitLab API  ◀────────────┘
```

## Возможности

- **Нет зависимостей** — только stdlib (Node.js 18+)
- **Конфигурация через переменные окружения** — никаких секретов в коде
- **Health check** эндпоинт (`GET /health`)
- **Пример nginx** для запуска за reverse proxy
- **Systemd сервис** + **Docker / docker-compose**
- Легко расширяется: добавляй новые обработчики событий GitLab в `HANDLERS`

## Требования

- Node.js 18+ (ESM)
- [OpenClaw](https://openclaw.ai) с включённым `hooks.enabled: true`
- GitLab (self-hosted или cloud)

## Быстрый старт

### 1. Клонировать и настроить

```bash
git clone https://github.com/YOUR_ORG/gitlab-webhook-relay.git
cd gitlab-webhook-relay
cp .env.example .env
$EDITOR .env
```

Заполнить `.env`:

| Переменная | Описание |
|---|---|
| `GITLAB_WEBHOOK_SECRET` | Секрет, который будет задан в настройках вебхука GitLab |
| `OPENCLAW_HOOKS_URL` | URL эндпоинта OpenClaw, например `http://127.0.0.1:18789/hooks/agent` |
| `OPENCLAW_HOOKS_TOKEN` | Токен из `hooks.token` в `openclaw.json` |
| `TELEGRAM_CHAT_ID` | (Опционально) Telegram chat ID для доставки результатов ревью |
| `HOST` | Адрес для прослушивания (по умолчанию: `127.0.0.1`) |
| `PORT` | Порт (по умолчанию: `9091`) |

### 2. Настроить OpenClaw

В `openclaw.json` (или через `config.patch`):

```json
{
  "hooks": {
    "enabled": true,
    "token": "YOUR_OPENCLAW_HOOKS_TOKEN",
    "path": "/hooks"
  }
}
```

### 3. Запустить

```bash
node index.js
```

Проверить работу:

```bash
curl http://localhost:9091/health
# {"ok":true,"ts":1234567890}
```

## Деплой

### Вариант А: systemd (рекомендуется для bare-metal)

```bash
cp deploy/gitlab-webhook-relay.service /etc/systemd/system/
$EDITOR /etc/systemd/system/gitlab-webhook-relay.service  # указать User= и пути

systemctl daemon-reload
systemctl enable --now gitlab-webhook-relay
journalctl -u gitlab-webhook-relay -f
```

### Вариант Б: Docker

```bash
cp .env.example .env && $EDITOR .env
docker compose up -d
```

> **Важно:** Если OpenClaw запущен на хосте, раскомментируй `extra_hosts` в `docker-compose.yml`
> и используй `http://host.docker.internal:18789/hooks/agent` как `OPENCLAW_HOOKS_URL`.

### Nginx reverse proxy (рекомендуется)

Используй шаблон из `deploy/nginx.conf.example`. Он:
- Принимает соединения только на внутреннем сетевом интерфейсе
- Проверяет `X-Gitlab-Token` до проксирования
- Блокирует все остальные пути

```bash
cp deploy/nginx.conf.example /etc/nginx/conf.d/gitlab-webhook-relay.conf
$EDITOR /etc/nginx/conf.d/gitlab-webhook-relay.conf  # указать IP и секрет
nginx -t && systemctl reload nginx
```

**На Fedora / SELinux** разрешить nginx подключаться к localhost:

```bash
setsebool -P httpd_can_network_connect on
semanage port -a -t http_port_t -p tcp 9090  # или нужный порт
```

## Настройка вебхука в GitLab

1. Перейти в проект → **Settings → Webhooks**
2. Добавить новый вебхук:
   - **URL:** `http://YOUR_HOST:9090/webhook` (через nginx) или `http://YOUR_HOST:9091/webhook` (напрямую)
   - **Secret token:** значение `GITLAB_WEBHOOK_SECRET`
   - **Triggers:** ✅ Merge request events
   - **SSL verification:** отключить при использовании HTTP

> **Self-hosted GitLab:** если GitLab блокирует вебхуки на приватные IP, зайди в  
> **Admin Area → Settings → Network → Outbound requests** и добавь свой хост в allowlist.

## Как работает ревью

При открытии или переоткрытии МР:

1. Relay получает вебхук, проверяет секрет, извлекает метаданные МР
2. Формирует структурированный промпт с ID проекта, номером МР, ветками
3. Отправляет в OpenClaw `/hooks/agent` → запускается изолированная сессия агента
4. Агент скачивает diff через GitLab API с твоим токеном
5. Проверяет код: архитектура, безопасность, стиль, баги
6. Оставляет комментарий прямо в МРе через GitLab API
7. Отправляет краткое резюме в настроенный Telegram-чат (если задан)

## Расширение

Добавляй новые обработчики событий в `index.js`:

```js
// Обработка push событий
function buildPushMessage(payload) {
  if (payload.ref !== "refs/heads/main") return null;
  return `Новый push в main в ${payload.project.name}. Проверь на наличие проблем.`;
}

const HANDLERS = {
  merge_request: buildMrMessage,
  push:          buildPushMessage,  // ← добавить здесь
};
```

## Лицензия

MIT
