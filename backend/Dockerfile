# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build && npm prune --omit=dev

# ---- run ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./
USER node
EXPOSE 3000
# migrations run automatically on start (see src/main.ts)
CMD ["node", "--enable-source-maps", "dist/main.js"]
