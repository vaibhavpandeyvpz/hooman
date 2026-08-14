# syntax=docker/dockerfile:1.7

FROM golang:latest AS go
FROM oven/bun:latest AS bun
FROM ghcr.io/astral-sh/uv:latest AS uv

FROM node:24-bookworm-slim AS build

WORKDIR /opt/hooman

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS production-dependencies

WORKDIR /opt/hooman

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime

ARG VERSION=dev
ARG REVISION=unknown

LABEL org.opencontainers.image.title="Hooman" \
      org.opencontainers.image.description="Local-first AI agent toolkit with Node.js, Bun, uv, and Go MCP runtimes" \
      org.opencontainers.image.source="https://github.com/vaibhavpandeyvpz/hooman" \
      org.opencontainers.image.url="https://vaibhavpandey.com/hooman/" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$REVISION"

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/home/hooman \
    HOOMAN_HOME=/home/hooman/.hooman \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    BUN_INSTALL=/home/hooman/.bun \
    UV_TOOL_BIN_DIR=/home/hooman/.local/bin \
    UV_TOOL_DIR=/home/hooman/.local/share/uv/tools \
    GOBIN=/home/hooman/go/bin \
    GOPATH=/home/hooman/go \
    PATH=/home/hooman/.bun/bin:/home/hooman/.local/bin:/home/hooman/go/bin:/usr/local/go/bin:$PATH

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      bash \
      build-essential \
      ca-certificates \
      curl \
      git \
      jq \
      openssh-client \
      pkg-config \
      python3 \
      ripgrep \
      tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupmod --new-name hooman node \
    && usermod --login hooman --home /home/hooman --move-home node \
    && npm install --global npm@latest --no-audit --no-fund

COPY --from=go /usr/local/go /usr/local/go
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=uv /uv /uvx /usr/local/bin/
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

WORKDIR /opt/hooman
COPY --from=production-dependencies /opt/hooman/node_modules ./node_modules
COPY --from=build /opt/hooman/dist ./dist
COPY package.json LICENSE README.md ./

RUN ./node_modules/.bin/playwright install --with-deps chromium \
    && mkdir -p \
      /home/hooman/.bun/install/cache \
      /home/hooman/.cache \
      /home/hooman/.hooman \
      /home/hooman/.local/bin \
      /home/hooman/.local/share/uv/tools \
      /home/hooman/go/bin \
      /workspace \
    && chown -R hooman:hooman /home/hooman /ms-playwright /workspace \
    && chmod +x /opt/hooman/dist/cli.js \
    && ln -s /opt/hooman/dist/cli.js /usr/local/bin/hooman \
    && hooman --version \
    && node --version \
    && npm --version \
    && bun --version \
    && uv --version \
    && uvx --version \
    && go version

USER hooman
WORKDIR /workspace

VOLUME ["/home/hooman/.hooman", "/workspace"]

ENTRYPOINT ["/usr/bin/tini", "--", "hooman"]
CMD ["chat"]
