/**
 * Observability middleware: injects OTel trace_id / span_id into
 * the per-request Pino child logger.
 *
 * When an active OTel span exists on the current request, the Fastify
 * request logger is replaced with a child that has trace_id and span_id
 * bound as extra fields. This makes every subsequent log call from route
 * handlers automatically include the trace correlation identifiers, so
 * Loki queries like `{app="llmtxt-backend"} | json | trace_id="abc123"`
 * return all log lines for the distributed trace.
 *
 * When OTel is in no-op mode (no OTEL_EXPORTER_OTLP_ENDPOINT), the
 * active span context is invalid — trace_id and span_id are omitted.
 *
 * SPEC references: SPEC-T145 §6.3–6.5
 */
import type { FastifyInstance } from 'fastify';
import { context, trace } from '@opentelemetry/api';

export async function registerObservabilityHooks(
  app: FastifyInstance
): Promise<void> {
  app.addHook('onRequest', async (request, _reply) => {
    // Get the active span from the OTel context.
    const span = trace.getActiveSpan();

    if (span && span.isRecording()) {
      const ctx = span.spanContext();
      // Attach trace / span IDs to the request-scoped logger child.
      // Fastify exposes request.log as a pino child logger; we rebind it
      // with the additional fields.
      request.log = request.log.child({
        trace_id: ctx.traceId,
        span_id: ctx.spanId,
      });
    }
  });
}
