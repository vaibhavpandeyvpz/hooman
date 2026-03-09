<div align="center">

<img src=".github/logo.svg" alt="Hooman" width="80" />

# Hooman

**Your autonomous virtual identity—one agent, your channels, your control.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

</div>

<p align="center">
  <img src=".github/screenshot.png" alt="Hooman app screenshot" width="800" />
</p>

---

## What is Hooman?

Hooman is an **open-source platform** to run a single, always-on AI identity that can act on its own. One agent with one memory and one audit trail—chat from the web, Slack, or WhatsApp; give it tools and skills; keep full control.

---

## Highlights

- **One identity** — Same agent, memory, and audit across web chat, Slack, and WhatsApp (text + voice notes).
- **Real capabilities** — MCP servers and skills so your identity can do things, not just reply.
- **Your stack** — Choose LLM and transcription provider in Settings; self-host, no vendor lock-in.
- **Safety & visibility** — Kill switch, per-tool approval, and a full audit log of what it did.

---

## One-click install (Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/one710/hooman/main/setup-linux.sh | bash
```

Prompts for domain (optional), web auth username/password. Installs deps, builds, runs Valkey + Chroma, starts the app with PM2, and optionally configures nginx + TLS.

---

## Local run

**Prerequisites:** Node.js 20+, Yarn, [uv](https://docs.astral.sh/uv/) (for MCP), [Docker](https://docs.docker.com/get-docker/) (Valkey + Chroma).

```bash
git clone https://github.com/one710/hooman.git
cd hooman
cp .env.example .env
yarn install
yarn build
docker compose up -d valkey chroma
yarn start
```

- **API** → http://localhost:3000
- **Web UI** (when using dev): http://localhost:5173

Set your LLM provider and API key in **Settings**, then chat. Add MCP and skills under **Capabilities**.

---

## Development

Full stack (API, frontend, Slack, WhatsApp, cron, event-queue) with live reload:

```bash
yarn install
docker compose up -d valkey chroma
yarn dev
```

API only: `yarn dev:api` (port 3000). Frontend only: `yarn dev:frontend` (port 5173).

---

## Commands

| Command              | Description                         |
| -------------------- | ----------------------------------- |
| `yarn dev`           | Full stack dev (API + UI + workers) |
| `yarn dev:api`       | API only (3000)                     |
| `yarn dev:frontend`  | Web UI only (5173)                  |
| `yarn build`         | Build API and frontend              |
| `yarn start`         | Start all with PM2                  |
| `yarn stop`          | Stop PM2                            |
| `yarn restart`       | Restart PM2                         |
| `yarn hash-password` | Generate hash for web auth          |

---

## License

[Apache License 2.0](LICENSE).
