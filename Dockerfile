# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24.6.0-bookworm-slim@sha256:9b741b28148b0195d62fa456ed84dd6c953c1f17a3761f3e6e6797a754d9edff AS build
WORKDIR /srv/soulbound
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/package.json ./app/package.json
COPY agent/package.json ./agent/package.json
RUN pnpm install --frozen-lockfile
COPY app ./app
COPY agent ./agent
RUN pnpm --filter agent build && pnpm --filter app build

FROM node:24.6.0-bookworm-slim@sha256:527e3f1e925c5727a98b17575e68d0bb0b577965bf3b60330790bfcf8a0b3035 AS runtime
WORKDIR /srv/soulbound
RUN apt-get update -qq && apt-get install -y --no-install-recommends ca-certificates tini && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/package.json ./app/package.json
COPY agent/package.json ./agent/package.json
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /srv/soulbound/app/.next ./app/.next
COPY --from=build /srv/soulbound/app/next.config.mjs ./app/next.config.mjs
COPY --from=build /srv/soulbound/agent/dist ./agent/dist
COPY akash/runtime ./akash/runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "akash/runtime/launch.mjs"]
