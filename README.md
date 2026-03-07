<div align="center">

<img src=".github/logo.svg" alt="Hooman" width="80" />

# Hooman

**A platform to create autonomous, virtual identities that can do things on their own.**

Hooman is an open-source platform for building and running your own 24×7 virtual agent. Give it MCP servers and skills for limitless capabilities. Chat from the web, Slack, or WhatsApp; let it run on its own; keep full control with an audit trail and approvals.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

</div>

<p align="center">
  <img src=".github/screenshot.png" alt="Hooman app screenshot" width="800" />
</p>

---

## What is Hooman?

Hooman is an **open-source platform** for creating autonomous, virtual identities that act on their own. Your identity runs 24×7, reasons over context, uses MCP tools and skills when it needs to, and shows you exactly what it did—all with one memory, one audit trail, and controls you own.

Think of it as **your AI identity hub**: one agent with limitless capabilities. No vendor lock-in, no black box—you host it, you configure it, you decide what it can do.

---

## Why Hooman?

| You want…             | Hooman gives you…                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One front door**    | Chat, schedule, audit, and capabilities in one web UI.                                                                                                |
| **Real capabilities** | MCP servers and **skills** (Cursor-style guides) so your identity can do things, not just talk.                                                       |
| **Your channels**     | Web chat, Slack (Socket Mode), and WhatsApp. Same identity, same memory, same audit—whether you type in the app or send a voice note on WhatsApp.     |
| **Your models**       | Pick the LLM (OpenAI, Azure, Anthropic, Bedrock, Google, Vertex, Mistral, DeepSeek) and transcription provider (OpenAI, Azure, Deepgram) in Settings. |
| **Control & safety**  | Kill switch, tool approval (allow everything or approve per call), allowlist/blocklist for tools, and a full audit log of decisions and actions.      |

---

## What can you use it for?

- **Research & writing** — “Summarize this URL,” “Draft a one-pager from these bullets.” Your identity uses fetch and memory.
- **Scheduling & reminders** — “Every Monday at 9am, remind me to review the board.” Cron-style or one-off; the same agent runs the task.
- **Slack & WhatsApp** — Ask questions, get summaries, or trigger tasks from DMs or channels; voice notes are transcribed and handled like text.
- **Coding & automation** — Attach filesystem and thinking MCPs; use skills for deploy, rules, or conventions. Human-in-the-loop approval for sensitive tools.
- **Personal knowledge** — Memory MCP (Chroma) gives your identity a searchable store so it can recall and reuse what you’ve shared.
- **Voice-first** — Real-time voice in the web UI and WhatsApp voice notes, with your choice of transcription provider.
- **APIs & integrations** — Expose an OpenAI-compatible `/v1/chat/completions` (e.g. via ngrok) so tools like ElevenLabs can talk to your Hooman instance.

One identity, one place to inspect and control it.

---

## First-party channels

| Channel      | What you get                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web**      | Main control panel: chat (text + real-time voice), schedule, audit, capabilities, settings. Draft kept in browser storage; logout and clear chat require confirmation. |
| **Slack**    | First-party adapter (Socket Mode). DMs, channels, and groups. Optional Slack MCP adds history, search, and post.                                                       |
| **WhatsApp** | First-party adapter (whatsapp-web.js). Text and voice notes; voice is transcribed with your chosen provider.                                                           |

Same identity, same memory, same audit trail everywhere.

---

## How it works

| Concept          | What it is                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hooman**       | The virtual identity. Reasons over chat history and memory, handles messages and scheduled tasks, and uses MCP tools and skills when relevant.                                                        |
| **Capabilities** | **MCP servers** and **skills** (markdown guides in `.agents/skills`). Configure in Capabilities and Settings; enable/disable connections and skills, and control which system MCPs are on by default. |
| **Memory**       | Chat history in SQLite (Prisma) plus optional vector memory via the memory MCP (Chroma) so the identity can recall and use past context.                                                              |

You chat or schedule; Hooman reasons, calls tools, and optionally asks for approval. You see everything in the audit log.

---

## Prerequisites

- **Node.js** — [Latest LTS](https://nodejs.org/) (v20 or v22). Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm).
- **Yarn** — `corepack enable` then `corepack prepare yarn@stable --activate`, or install from [yarnpkg.com](https://yarnpkg.com/).
- **uv + Python** — For default MCP servers (fetch, time, filesystem). Install [uv](https://docs.astral.sh/uv/) then:
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  uv python install --default
  ```
  Ensure `uv` and `python` are on your `PATH`.
- **Go** — Optional. Only if you use the **Slack** channel and want the default Slack MCP (history, search, post):
  ```bash
  go install github.com/korotovsky/slack-mcp-server@latest
  ```
  Ensure the Go bin directory (e.g. `$HOME/go/bin`) is on your `PATH`.
- **Docker** — Required for **Valkey** (event queue, kill switch) and **Chroma** (memory). Run both with `docker compose up -d valkey chroma`. Also used for isolation (e.g. desktop-commander MCP). [Get Docker](https://docs.docker.com/get-docker/).

No separate database server: Prisma + SQLite. Both **Valkey** and **Chroma** are required for Hooman to function.

---

## Quick start

```bash
git clone https://github.com/vaibhavpandeyvpz/hooman.git
cd hooman
yarn install
yarn build
docker compose up -d valkey chroma
yarn start
```

- **API** → http://localhost:3000
- With `yarn dev`: **Web UI** → http://localhost:5173

`yarn start` runs the API and workers only (no process on 5173). For the web UI locally, use `yarn dev` or serve the built `apps/frontend/dist` yourself.

1. Set your **LLM provider** and API key (or credentials) in **Settings**.
2. Chat with your identity.
3. Add **MCP connections** and **skills** under **Capabilities**.

To stop: `yarn stop` (or `npx pm2 stop ecosystem.config.cjs`).

---

## Development

Full stack with live reload (API, frontend, Slack worker, WhatsApp worker, cron, event-queue):

```bash
yarn install
yarn dev
```

API and web UI only (two terminals):

```bash
yarn dev:api       # API on port 3000
yarn dev:frontend  # UI on port 5173
```

Copy `.env.example` to `.env` to override defaults. Ensure Valkey and Chroma are running: `docker compose up -d valkey chroma`.

---

## Exposing completions (optional)

Use this only when you want to expose the OpenAI-compatible chat completions API to external apps (e.g. ElevenLabs). Normal use does not require ngrok.

1. Run the API (e.g. `yarn dev:api` or `yarn start`) on port 3000.
2. Copy the example config and add your [ngrok authtoken](https://dashboard.ngrok.com/get-started/your-authtoken):
   ```bash
   cp ngrok.example.yml ngrok.yml
   ```
   Set `NGROK_AUTHTOKEN` in `.env`. In `ngrok.yml`, set a reserved `domain` or remove it for a random URL.
3. Start the tunnel (uses the `remote` profile):
   ```bash
   docker compose --profile remote up -d ngrok
   ```
   Tunnel forwards to `host.docker.internal:3000`. Ngrok UI: http://localhost:4040.
4. In Hooman **Settings**, set **Completions API key**. Then:
   ```bash
   curl -X POST https://<your-ngrok-domain>/v1/chat/completions \
     -H "Authorization: Bearer YOUR_COMPLETIONS_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"Hello"}]}'
   ```

Only `/v1/chat/completions` and `/chat/completions` are reachable over the tunnel; other paths return 403 when requested via the public URL.

---

## Exposing the web app (optional)

By default, the API restricts non-localhost access to the completions paths. To use the web UI from another machine (e.g. your laptop or a server), enable **web auth** so login is required and the API accepts requests from any host.

1. In `.env`, set all three:
   - `WEB_AUTH_USERNAME` — login username.
   - `WEB_AUTH_PASSWORD_HASH` — argon2id hash. Run `yarn hash-password` (or `yarn hash-password --password=yourpassword`) and paste the output into `.env`.
   - `JWT_SECRET` — strong secret for signing JWTs (e.g. 32+ random bytes).
2. Restart the API. The web UI will show a login page; after sign-in, the JWT is sent with every request and Socket.IO connection.
3. Use HTTPS in production.

Without these, only localhost can access the web UI and API (except completions when using ngrok).

---

## Deployment (server behind nginx)

Run these on the server. Replace `hooman.example.com` and `api.hooman.example.com` with your domains.

**1. Install Node, Yarn, Python (uv), Go, Docker**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install 24
corepack enable && corepack prepare yarn@stable --activate

curl -LsSf https://astral.sh/uv/install.sh | sh
uv python install --default

# Go (for Slack MCP)
wget https://go.dev/dl/go1.26.0.linux-amd64.tar.gz
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.26.0.linux-amd64.tar.gz

# Docker (required for Valkey and Chroma)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

Both **Valkey** (event queue) and **Chroma** (memory) are required. Start them before `yarn start`:

```bash
docker compose up -d valkey chroma
```

**2. Clone, build, and run Hooman**

```bash
git clone https://github.com/vaibhavpandeyvpz/hooman.git
cd hooman
docker compose up -d valkey chroma   # required before yarn start
yarn install
cp .env.example .env
# Edit .env: VITE_API_BASE, WEB_AUTH_*, JWT_SECRET
yarn hash-password   # add output to .env as WEB_AUTH_PASSWORD_HASH
yarn build
yarn start
npx pm2 startup
npx pm2 save
```

Set `VITE_API_BASE` (e.g. `https://api.hooman.example.com`) before `yarn build`.

**3. Serve frontend and proxy API with nginx**

```bash
mkdir -p /var/www/hooman/apps/frontend
sudo cp -r apps/frontend/dist /var/www/hooman/apps/frontend/
sudo cp deploy/hooman-frontend.conf /etc/nginx/sites-available/
sudo cp deploy/hooman-api.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/hooman-frontend.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/hooman-api.conf /etc/nginx/sites-enabled/
# Edit server_name in the conf files, then:
sudo nginx -t && sudo systemctl reload nginx
```

**4. TLS with Certbot**

```bash
sudo apt install python3-certbot-nginx
sudo certbot --nginx -d hooman.example.com -d api.hooman.example.com
```

Then open `https://hooman.example.com` and sign in.

---

## Environment

Create `.env` from `.env.example`. Key variables:

| Variable                    | Required | Description                                                                                       |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | No       | Prisma SQLite URL (default: `workspace/hooman.db` at project root).                               |
| `PORT`                      | No       | API port (default 3000).                                                                          |
| `REDIS_URL`                 | Yes      | Valkey/Redis URL for event queue and kill switch (e.g. `redis://localhost:6379`).                 |
| `API_BASE_URL`              | No       | API base URL for capabilities (default `http://localhost:3000`).                                  |
| `VITE_API_BASE`             | No       | Set when building for production so the web app can call the API.                                 |
| `MCP_STDIO_DEFAULT_CWD`     | No       | Working directory for stdio MCP (default: `workspace/mcpcwd`).                                    |
| `SKILLS_CWD`                | No       | Override project root for skills (default: repo root). Skills live in `<project>/.agents/skills`. |
| `WEB_AUTH_USERNAME`         | No       | With `WEB_AUTH_PASSWORD_HASH` and `JWT_SECRET`, enables login; API reachable from any host.       |
| `WEB_AUTH_PASSWORD_HASH`    | No       | Argon2id hash from `yarn hash-password`.                                                          |
| `JWT_SECRET`                | No       | Secret for signing JWTs when web auth is enabled.                                                 |
| `MCP_CONNECT_TIMEOUT_MS`    | No       | Max ms to build shared MCP session (default 300000).                                              |
| `MCP_CLOSE_TIMEOUT_MS`      | No       | Max ms to close session on reload (default 10000).                                                |
| `PUPPETEER_EXECUTABLE_PATH` | No       | Chrome/Chromium path for whatsapp-web.js.                                                         |
| `CHROMA_URL`                | Yes      | ChromaDB URL for memory (default `http://localhost:8000`). Both Valkey and Chroma are required.   |
| `CHROMA_COLLECTION`         | No       | ChromaDB collection name (default `hooman-memory`).                                               |
| `ALLOW_REMOTE_ACCESS`       | No       | Set to `true` to bypass localhost-only check in Docker/remote setups.                             |

Runtime data lives under **`workspace/`**: `hooman.db`, `config.json`, `attachments/`. LLM and transcription provider, API keys, and models are configured in the **Settings** UI, not via env.

---

## Scripts

| Command              | Description                                                                       |
| -------------------- | --------------------------------------------------------------------------------- |
| `yarn dev`           | Full stack: API, frontend, Slack, WhatsApp, cron, event-queue (ports 3000, 5173). |
| `yarn dev:api`       | API only (port 3000).                                                             |
| `yarn dev:frontend`  | Web UI only (port 5173).                                                          |
| `yarn dev:slack`     | Slack worker only.                                                                |
| `yarn dev:whatsapp`  | WhatsApp worker only.                                                             |
| `yarn build`         | Build API and web app.                                                            |
| `yarn start`         | Start API and workers with PM2.                                                   |
| `yarn stop`          | Stop PM2 processes.                                                               |
| `yarn restart`       | Restart PM2 processes.                                                            |
| `yarn hash-password` | Generate argon2id hash for `WEB_AUTH_PASSWORD_HASH`.                              |

After code or config changes in production: `yarn build` then `yarn restart`.

---

## License

[Apache License 2.0](LICENSE).

---

**Hooman** — one identity, your control, your stack.
