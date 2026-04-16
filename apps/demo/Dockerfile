# ── llmtxt-demo-agents service ───────────────────────────────────────────────
# Runs the 4 reference agents continuously against the production API.
# Deployed on Railway as a standalone service with cron restart capability.

FROM node:22-alpine AS base

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# ── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/llmtxt/package.json ./packages/llmtxt/
COPY apps/demo/package.json ./apps/demo/

# Install workspace deps (production only for runtime image)
RUN pnpm install --frozen-lockfile --filter demo... --prod

# ── Build SDK (compile TypeScript) ───────────────────────────────────────────
FROM deps AS build

COPY packages/llmtxt/ ./packages/llmtxt/
RUN pnpm --filter llmtxt build

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM base AS runtime

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/demo ./apps/demo

WORKDIR /app/apps/demo

# Demo agent identity storage
RUN mkdir -p /root/.llmtxt/demo-agents

# Health check: verify Node.js is responsive
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "console.log('ok')" || exit 1

# Environment variables (must be set in Railway service config):
# LLMTXT_API_KEY — LLMtxt API key for the demo agent account
# LLMTXT_API_BASE — defaults to https://api.llmtxt.my
# DEMO_DURATION_MS — how long each cycle runs (default: 60000 = 1 minute)
# DEMO_SLUG — if set, reuses an existing document instead of creating a new one

CMD ["node", "scripts/orchestrator.js"]
