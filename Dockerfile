FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV npm_config_fetch_timeout=600000
ENV npm_config_fetch_retries=8
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

FROM base AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/server ./packages/server/
COPY packages/client ./packages/client/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter "@excalidraw-persist/server" build
RUN pnpm --filter "@excalidraw-persist/client" exec vite build

FROM base AS server
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/server/package.json ./packages/server/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/server/dist ./packages/server/dist

RUN mkdir -p /app/src/lib
COPY --from=builder /app/packages/server/src/lib/schema.sql ./src/lib/
RUN mkdir -p /app/data

FROM nginx:1.27-bookworm AS client
COPY --from=builder /app/packages/client/dist /usr/share/nginx/html
COPY packages/client/nginx.conf /etc/nginx/conf.d/default.conf

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx supervisor curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/data /var/log/supervisor /run/nginx

COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY --from=server /app /app
COPY --from=client /usr/share/nginx/html /usr/share/nginx/html
COPY --from=client /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf

ENV PORT=4000
ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV DB_PATH=/app/data/database.sqlite

EXPOSE 80 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:4000/api/health" || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
