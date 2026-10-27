ARG NODE_IMAGE=node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
FROM ${NODE_IMAGE} AS trusted
USER root
COPY deploy/verify-system-trust.sh /usr/local/bin/suite-verify-trust
RUN apt-get update && apt-get install --no-install-recommends -y ca-certificates openssl \
    && update-ca-certificates && sh /usr/local/bin/suite-verify-trust \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_OPTIONS=--use-openssl-ca
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

FROM trusted AS build
WORKDIR /app
COPY components/aring/package.json components/aring/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY components/aring/web ./web
COPY components/aring/shared ./shared
COPY components/aring/assets ./assets
COPY components/aring/scripts/build.mjs ./scripts/build.mjs
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM trusted
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY components/aring/package.json ./package.json
COPY components/aring/server ./server
COPY components/aring/shared ./shared
COPY components/aring/scripts/account.mjs ./scripts/account.mjs
RUN mkdir /data && chown node:node /data && chmod 700 /data
USER node
EXPOSE 4387
CMD ["node", "server/main.mjs"]
