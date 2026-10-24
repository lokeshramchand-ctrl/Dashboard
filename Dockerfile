# syntax=docker/dockerfile:1

# ---- web UI (real backend, mock off) ----
FROM node:22-alpine AS web
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build:prod

# ---- backend ----
FROM node:22-alpine AS api
WORKDIR /api
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime: backend serves the built UI from the same origin ----
FROM node:22-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SERVE_DIST=/app/dist
WORKDIR /app
COPY --from=api /api/package.json ./package.json
COPY --from=api /api/node_modules ./node_modules
COPY --from=api /api/build ./build
COPY --from=web /web/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1
CMD ["node", "build/index.js"]
