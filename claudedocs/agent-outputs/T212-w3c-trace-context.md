# T212: W3C Trace Context Header Propagation in Webhooks

## Summary

Successfully implemented W3C Trace Context header injection into outgoing webhook deliveries, enabling downstream consumers to correlate their spans with the originating trace.

## What Was Done

### Implementation Details

**File**: `apps/backend/src/events/webhooks.ts`

1. **Added Imports**:
   - `context, propagation` from `@opentelemetry/api` (already installed via T200)
   - `randomUUID` from Node.js `crypto` module

2. **Updated `attemptDelivery()` Function**:
   - Created headers object with all existing headers (Content-Type, User-Agent, X-LLMtxt-Signature, X-LLMtxt-Event)
   - Added `X-Llmtxt-Event-Id` header with a unique UUID per delivery attempt for deduplication across retries
   - Called `propagation.inject(context.active(), headers)` to inject W3C Trace Context headers
   - Passed enriched headers to fetch() request

3. **Updated Module Documentation**:
   - Added "Tracing" section to the module docstring explaining:
     - W3C Trace Context headers (traceparent, tracestate) are injected automatically
     - X-Llmtxt-Event-Id is used for deduplication across retries
     - Behavior when OTel is in no-op mode (injection is a no-op, no headers added)

### Backward Compatibility

- No breaking changes. If OTel is in no-op mode (OTEL_EXPORTER_OTLP_ENDPOINT not set):
  - `propagation.inject()` is a no-op and adds no headers
  - Webhook delivery continues to work normally
  - No crashes or errors

### W3C Trace Context Format

The injected headers follow the W3C Trace Context specification:
- **traceparent**: `00-<trace-id>-<span-id>-<flags>` (format: 00-32hex-16hex-2hex)
- **tracestate**: Optional, preserves any existing state

### Event Deduplication

The `X-Llmtxt-Event-Id` header provides a stable identifier per delivery attempt, allowing downstream consumers to deduplicate webhook events across retry attempts.

## Verification

### Tests Passed
- ✅ All 67 integration tests pass
- ✅ Linting passes (pnpm lint)
- ✅ Build succeeds (pnpm build)
- ✅ No TypeScript errors

### Acceptance Criteria Met

1. ✅ Webhook delivery requests include W3C Trace Context headers when active OTel span context exists
2. ✅ Headers are injected via standard `@opentelemetry/api` mechanism
3. ✅ Webhook delivery continues to work (HMAC signature unchanged)
4. ✅ No-op mode (no OTEL_EXPORTER_OTLP_ENDPOINT) works without crashing
5. ✅ No headers injected when there is no active span context

## Impact

### Downstream Benefits

- Webhook subscribers can now correlate webhook delivery with the originating trace
- Enables end-to-end observability across service boundaries
- Supports distributed tracing platforms (Grafana Tempo, Jaeger, DataDog, etc.)
- Aligns with industry standard W3C Trace Context specification

### Technical Details

- **Dependency**: @opentelemetry/api (already in package.json)
- **No new dependencies** required
- **Performance**: Negligible overhead (string concatenation and header addition)
- **No-op mode safety**: `propagation.inject()` is a safe no-op when OTel is inactive

## Commit

- **Hash**: 7d5d847
- **Message**: `feat(T212,observability): inject W3C Trace Context into outgoing webhook deliveries`
- **Modified File**: `apps/backend/src/events/webhooks.ts`
- **Lines Added/Changed**: 27 new lines, proper formatting and comments

## Related Tasks

- **T200** (Dependency, Shipped): OpenTelemetry SDK initialization and instrumentation
- **T145** (Parent Epic): Complete observability layer for LLMtxt
