# Build context is the repo root:
#   docker build -f mcp_servers/mcp-gateway/Dockerfile -t mcp-gateway .
#
# Stage 1: build the gateway's TypeScript into dist/.
FROM node:22-bookworm-slim AS build
WORKDIR /app/gateway
COPY mcp_servers/mcp-gateway/package.json mcp_servers/mcp-gateway/package-lock.json ./
RUN npm install --no-audit --no-fund
COPY mcp_servers/mcp-gateway/tsconfig.json ./
COPY mcp_servers/mcp-gateway/src ./src
RUN npm run build
RUN npm prune --omit=dev

# Stage 2: runtime - node for the gateway + vendor node backends, python/uv
# for the falcon backend (a Python venv), non-root user throughout.
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Vendor MCP server bundles, spawned as stdio children by the gateway.
COPY plugins/atlas/mcp/ /app/mcp/
RUN cd /app/mcp/falcon && uv sync --frozen --no-dev

# The gateway itself.
COPY --from=build /app/gateway/dist /app/gateway/dist
COPY --from=build /app/gateway/node_modules /app/gateway/node_modules
COPY mcp_servers/mcp-gateway/package.json /app/gateway/package.json

RUN chown -R node:node /app
USER node

ENV BACKENDS_ROOT=/app/mcp
ENV PORT=8080

EXPOSE 8080

CMD ["node", "/app/gateway/dist/index.js"]
