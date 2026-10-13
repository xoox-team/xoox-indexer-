# syntax=docker/dockerfile:1
# The xoox-one Envio indexer image: Node 24, this repository's pnpm project, and psql. It starts only through
# scripts/launch.sh, which runs the launch guard and then `envio start` in one process tree.
ARG NODE_BASE=node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
FROM ${NODE_BASE} AS base
RUN npm install --global pnpm@10.17.0 && rm -rf /root/.npm
WORKDIR /workspace

FROM base AS build
# Install from the manifest first so source-only releases reuse the dependency layer.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy only the runnable project. The adjacent .dockerignore removes credentials, local databases, generated caches
# and dependency directories.
COPY tsconfig.json envio-env.d.ts schema.graphql config.xoox-one.json config.xoox-one.breakglass.json config.codegen.yaml config.test.yaml ./
COPY src/ src/
COPY scripts/ scripts/
COPY deployments/10143.json deployments/10143.json
COPY output/ output/
COPY test-fixtures/ test-fixtures/

FROM base AS indexer
LABEL io.xoox.release.independent="true" io.xoox.release.service="indexer"
# Envio restores .envio/cache/*.tsv into the effect cache tables by running psql (PgStorage.res restoreEffectCache) and,
# without it, silently replays with no cache.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates postgresql-client \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build --chown=node:node /workspace /workspace
RUN mkdir -p /workspace/.envio/cache && chown -R node:node /workspace/.envio
USER node
CMD ["sh", "/workspace/scripts/launch.sh"]
