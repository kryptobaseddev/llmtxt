FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm i -g pnpm@10.30.0

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/backend/package.json apps/backend/
COPY packages/llmtxt/package.json packages/llmtxt/
COPY apps/frontend/package.json apps/frontend/
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm --filter llmtxt --filter @llmtxt/backend --filter frontend build

FROM base AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/llmtxt ./packages/llmtxt
COPY --from=build /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/backend/package.json ./apps/backend/
COPY --from=build /app/apps/backend/public ./apps/backend/public
COPY --from=build /app/apps/backend/src/db/migrations ./apps/backend/src/db/migrations
COPY --from=build /app/apps/backend/drizzle.config.ts ./apps/backend/
COPY --from=build /app/apps/backend/scripts/run-migrations.ts ./apps/backend/scripts/

EXPOSE 8080
ENV PORT=8080
# run-migrations.ts exits 1 on any migration error — container will NOT start if migrations fail.
CMD ["sh", "-c", "cd apps/backend && node --import tsx/esm scripts/run-migrations.ts && node --import ./dist/instrumentation.js dist/index.js"]
