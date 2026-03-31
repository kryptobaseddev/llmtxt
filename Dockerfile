FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm i -g pnpm@10.30.0

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/llmtxt/package.json packages/llmtxt/
COPY apps/frontend/package.json apps/frontend/
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm -r build

FROM base AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/llmtxt/package.json ./packages/llmtxt/
COPY --from=build /app/packages/llmtxt/dist ./packages/llmtxt/dist
COPY --from=build /app/packages/llmtxt/wasm ./packages/llmtxt/wasm
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/web/package.json ./apps/web/
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/src/db/migrations ./apps/web/src/db/migrations
COPY --from=build /app/apps/web/drizzle.config.ts ./apps/web/

EXPOSE 8080
ENV PORT=8080
CMD ["sh", "-c", "cd apps/web && npx drizzle-kit migrate && node dist/index.js"]
