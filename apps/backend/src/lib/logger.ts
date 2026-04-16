/**
 * Structured Pino logger with optional pino-loki transport.
 *
 * Behaviour:
 * - LOKI_HOST set (production) → pino-loki transport; labels: { app, env }.
 *   Always keeps a stdout target alongside Loki so Railway logs stay visible.
 *   In Railway, set LOKI_HOST = ${{Loki.RAILWAY_PRIVATE_DOMAIN}}
 *   The self-hosted Loki service runs on port 3100 with no authentication
 *   (protected by Railway's private network — not exposed publicly).
 * - LOKI_HOST unset            → JSON to stdout (development or no-Loki prod).
 *
 * OTel trace correlation:
 * Request-scoped child loggers have trace_id and span_id injected via the
 * middleware/observability.ts hook. This module exports the base logger
 * passed to Fastify at startup.
 *
 * PII: Authorization, Cookie, and x-api-key values are redacted via pino's
 * redact option — they never appear in Loki or stdout.
 *
 * All logs are shipped to the self-hosted Loki service on Railway's private
 * network. No external SaaS (Grafana Cloud, etc.) is used.
 *
 * SPEC references: SPEC-T145 §6.1–6.5
 */
import pino from 'pino';
import type { FastifyBaseLogger } from 'fastify';

// ─── Configuration ────────────────────────────────────────────────────────────

const lokiHost = process.env.LOKI_HOST;
// Self-hosted Loki on Railway's private network requires no auth.
// LOKI_USER / LOKI_PASSWORD are retained for backward compatibility but
// are not needed with the self-hosted Railway setup.
const lokiUser = process.env.LOKI_USER ?? '';
const lokiPassword = process.env.LOKI_PASSWORD ?? '';
const nodeEnv = process.env.NODE_ENV ?? 'development';

/**
 * Fields that must never appear in structured logs — PII / secrets.
 * Uses pino's dot-path notation for nested fields.
 */
const redactPaths: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
];

// ─── Logger factory ───────────────────────────────────────────────────────────

function buildLokiTransportTarget(): pino.TransportSingleOptions {
  return {
    target: 'pino-loki',
    options: {
      host: lokiHost as string,
      basicAuth:
        lokiUser && lokiPassword
          ? { username: lokiUser, password: lokiPassword }
          : undefined,
      labels: {
        app: 'llmtxt-backend',
        env: nodeEnv,
      },
      // Batch up to flush every 5 seconds to reduce Loki write pressure.
      batching: true,
      interval: 5,
    },
  };
}

function buildLogger(): FastifyBaseLogger {
  const level = process.env.LOG_LEVEL ?? 'info';
  const baseOptions: pino.LoggerOptions = {
    level,
    redact: {
      paths: redactPaths,
      censor: '[REDACTED]',
    },
  };

  if (lokiHost) {
    // Multi-transport: Loki + stdout so Railway console always shows logs.
    return pino(
      baseOptions,
      pino.transport({
        targets: [
          buildLokiTransportTarget(),
          {
            target: 'pino/file',
            options: { destination: 1 }, // fd 1 = stdout
          },
        ],
      })
    ) as unknown as FastifyBaseLogger;
  }

  // No Loki configured — plain JSON to stdout.
  return pino(baseOptions) as unknown as FastifyBaseLogger;
}

export const logger: FastifyBaseLogger = buildLogger();

if (lokiHost) {
  console.log(`[logger] Pino shipping logs to self-hosted Loki at ${lokiHost}`);
} else {
  console.warn(
    '[logger] LOKI_HOST is not set — logs will not be shipped to Loki. ' +
      'Set LOKI_HOST=${{Loki.RAILWAY_PRIVATE_DOMAIN}} to enable self-hosted Loki transport.'
  );
}
