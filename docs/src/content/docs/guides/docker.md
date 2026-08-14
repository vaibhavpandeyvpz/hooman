---
title: Docker
description: Run Hooman in Docker with persistent configuration, project mounts, MCP runtimes, and GHCR images for amd64 and arm64.
---

Hooman publishes a multi-architecture image to the GitHub Container Registry:

```text
ghcr.io/vaibhavpandeyvpz/hooman
```

The image supports Linux `amd64` and `arm64`, runs as the non-root `hooman` user, and starts [`hooman chat`](/hooman/guides/cli/#hooman-chat) by default. It includes Node.js 24, the latest npm, Bun/`bunx`, uv/`uvx`, Go, Python, Git, ripgrep, native build tools, and Playwright Chromium. These runtimes cover JavaScript, Python, and Go-based [MCP servers](/hooman/guides/mcp/) without installing them on the host.

## Set up Hooman

Create a named volume for configuration, credentials, sessions, skills, and other Hooman state, then run the setup wizard once:

```bash
docker volume create hooman-data

docker run --rm -it \
  -v hooman-data:/home/hooman/.hooman \
  ghcr.io/vaibhavpandeyvpz/hooman:latest setup
```

Hooman stores its home configuration under `/home/hooman/.hooman` in the container. Reuse the same volume on later runs so configuration and sessions survive container replacement.

If Hooman is already configured on the host, mount the existing directory instead:

```bash
docker run --rm -it \
  -v "$HOME/.hooman:/home/hooman/.hooman" \
  ghcr.io/vaibhavpandeyvpz/hooman:latest
```

This mount is read-write because Hooman updates configuration, sessions, OAuth state, approvals, and downloaded assets. Do not bake API keys or `config.json` into a derived image.

## Work on a project

The container's working directory is `/workspace`. Mount the project there so Hooman can discover its Git repository, `AGENTS.md`, `.hooman` overlays, and source files:

```bash
docker run --rm -it \
  --ipc=host \
  -v hooman-data:/home/hooman/.hooman \
  -v "$PWD:/workspace" \
  ghcr.io/vaibhavpandeyvpz/hooman:latest
```

`--ipc=host` is recommended for Chromium workloads to avoid shared-memory crashes. It is optional if browser and Design mode features are not used.

The image runs as `hooman` with UID/GID `1000`. On Linux, ensure the mounted project is writable by UID 1000 if you want Hooman to edit files. Alternatively, override the runtime identity to match the host user:

```bash
docker run --rm -it \
  --user "$(id -u):$(id -g)" \
  -e HOME=/home/hooman \
  -v "$HOME/.hooman:/home/hooman/.hooman" \
  -v "$PWD:/workspace" \
  ghcr.io/vaibhavpandeyvpz/hooman:latest
```

When overriding the user, the mounted Hooman home and project must be writable by that UID/GID.

## Run other commands

Arguments after the image name are passed to the `hooman` CLI:

```bash
# Print the installed version
docker run --rm ghcr.io/vaibhavpandeyvpz/hooman:latest --version

# Run a one-shot prompt against the mounted project
docker run --rm -i \
  -v hooman-data:/home/hooman/.hooman \
  -v "$PWD:/workspace" \
  ghcr.io/vaibhavpandeyvpz/hooman:latest \
  exec "Summarize this repository"

# Open a shell for troubleshooting
docker run --rm -it \
  --entrypoint bash \
  ghcr.io/vaibhavpandeyvpz/hooman:latest
```

See the [CLI guide](/hooman/guides/cli/) for all commands and flags.

## Connect to services on the host

Inside a container, `localhost` refers to the container itself. If an inference provider, Ollama server, custom endpoint, or MCP server runs on the host, use `host.docker.internal` instead of `localhost` in its URL.

On Docker Desktop for macOS and Windows, that hostname is available automatically. On Linux, add the host-gateway mapping:

```bash
docker run --rm -it \
  --add-host=host.docker.internal:host-gateway \
  -v hooman-data:/home/hooman/.hooman \
  -v "$PWD:/workspace" \
  ghcr.io/vaibhavpandeyvpz/hooman:latest
```

The host service must listen on an interface reachable from Docker, not only an inaccessible loopback socket. Keep authentication enabled when broadening a service's bind address.

## MCP and browser workloads

`npx`, `bunx`, `uvx`, and `go` are all on `PATH` for stdio MCP configurations. Packages fetched at runtime live in the container's normal user caches and are discarded with an ephemeral container unless those cache directories are mounted separately. Hooman's MCP configuration itself persists in `/home/hooman/.hooman/mcp.json`.

Playwright Chromium and its Linux libraries are preinstalled. Browser processes in a container must run headlessly unless you separately provide a display server. For browser-heavy runs, retain `--ipc=host`; do not expose a browser debugging port publicly without authentication.

## Run the daemon

For long-running channel automation, give the container a stable name, persist Hooman state, and use the daemon's plain-log mode:

```bash
docker run -d \
  --name hooman-daemon \
  --restart unless-stopped \
  -v hooman-data:/home/hooman/.hooman \
  -v "$PWD:/workspace" \
  ghcr.io/vaibhavpandeyvpz/hooman:latest \
  daemon --no-dashboard

docker logs -f hooman-daemon
```

Add the ports, environment variables, or network configuration required by your [MCP channels](/hooman/guides/mcp/channels/). Avoid `--yolo` for containers processing untrusted inbound messages.

## Image tags

| Tag       | Meaning                              |
| --------- | ------------------------------------ |
| `latest`  | Latest stable version-tagged release |
| `1.61.0`  | Exact Hooman release                 |
| `1.61`    | Latest patch in a minor release      |
| `1`       | Latest release in a major version    |
| `edge`    | Current `main` branch build          |
| `sha-...` | Build for a specific Git commit      |

Use an exact version or digest in production. `edge` and the bundled latest toolchains can change when a new image is built.

## Build locally

From the repository root:

```bash
docker build -t hooman:local .
docker run --rm hooman:local --version
```

For a multi-platform build with Buildx:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/your-account/hooman:local \
  .
```

A multi-platform build must be pushed to a registry or exported as an OCI result; Docker cannot load a multi-platform manifest into the classic local image store in one operation.
