# API + Admin Dashboard in one image (Railway uses this from the repo root; see railway.json).
# backend/Dockerfile still builds the API alone.

# ---- admin dashboard (static files) ----
FROM node:22-alpine AS admin
WORKDIR /admin
COPY admin/package*.json ./
RUN npm ci
COPY admin/ ./
RUN npm run build

# ---- api ----
FROM node:22-alpine AS api
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig*.json backend/drizzle.config.ts ./
COPY backend/src ./src
COPY backend/drizzle ./drizzle
RUN npm run build && npm prune --omit=dev

# ---- run ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=api /app/node_modules ./node_modules
COPY --from=api /app/dist ./dist
COPY --from=api /app/drizzle ./drizzle
COPY --from=admin /admin/dist ./public/admin
COPY backend/package.json ./
# local file storage (STORAGE_DRIVER=local) writes here
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
# migrations run automatically on start (see backend/src/main.ts); the dashboard is served at /admin
CMD ["node", "--enable-source-maps", "dist/main.js"]
