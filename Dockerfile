# Dev image: deps only, no build. Used by api-dev and web-dev (different commands).
FROM node:20-alpine AS dev
WORKDIR /app
# uv for default MCP servers (fetch, time) via uvx; pre-install Python for faster uvx startup
RUN apk add --no-cache curl && curl -LsSf https://astral.sh/uv/install.sh | sh && apk del curl
ENV PATH="/root/.local/bin:$PATH"
RUN uv python install --default
RUN apk add --no-cache coreutils
# Pre-cache default MCP server tools (fetch, time, filesystem) for faster first connection
RUN timeout 30 uvx mcp-server-fetch || true \
  && timeout 30 uvx mcp-server-time || true \
  && timeout 30 npx -y @modelcontextprotocol/server-filesystem /tmp || true
COPY package.json yarn.lock* ./
COPY tsconfig.base.json ./
COPY apps/api apps/api/
COPY apps/web apps/web/
RUN corepack enable && yarn install --frozen-lockfile 2>/dev/null || yarn install
RUN mkdir -p /app/mcp-cwd
ENV MCP_STDIO_DEFAULT_CWD=/app/mcp-cwd

# Build for production
FROM dev AS builder
RUN yarn build:api && yarn build:web

# Production API (profile: prod)
FROM node:20-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
# uv for default MCP servers (fetch, time) via uvx; pre-install Python for faster uvx startup
RUN apk add --no-cache curl && curl -LsSf https://astral.sh/uv/install.sh | sh && apk del curl
ENV PATH="/root/.local/bin:$PATH"
RUN uv python install --default
RUN apk add --no-cache coreutils
# Pre-cache default MCP server tools (fetch, time, filesystem) for faster first connection
RUN timeout 30 uvx mcp-server-fetch || true \
  && timeout 30 uvx mcp-server-time || true \
  && timeout 30 npx -y @modelcontextprotocol/server-filesystem /tmp || true
COPY package.json yarn.lock* ./
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/apps/api/dist apps/api/dist/
RUN mkdir -p /app/mcp-cwd
ENV MCP_STDIO_DEFAULT_CWD=/app/mcp-cwd
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/index.js"]

# Production web (profile: prod): nginx serving built static + proxy to api
FROM nginx:alpine AS web
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
