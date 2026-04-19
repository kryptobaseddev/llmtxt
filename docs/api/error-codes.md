# LLMtxt API Error Code Catalog

Generated from `apps/backend/src/routes/**/*.ts` and `apps/backend/src/middleware/**/*.ts`.
Last updated: 2026-04-19.

All error responses return JSON with at minimum an `error` string field. Many include an additional `message` field with human-readable context.

```json
{
  "error": "Not Found",
  "message": "Document not found"
}
```

---

## HTTP 400 — Bad Request

| Error Code | HTTP Status | Scenario | Fix |
|---|---|---|---|
| `Bad Request` | 400 | `slug` is required but missing | Supply a valid slug in the path or body |
| `Bad Request` | 400 | Invalid slug format (Zod validation) | Slugs must match `^[a-z0-9-]+$` pattern |
| `Invalid request body` | 400 | Request body fails Zod schema validation; `details` field contains issues array | Correct the request body per the `details` array |
| `Invalid params` | 400 | Query or path parameters fail Zod validation; `details` may contain issue list | Fix the offending parameters |
| `Invalid parameters` | 400 | Generic parameter validation failure | Review parameter types and required fields |
| `Invalid query parameters` | 400 | Query string parameter type or range mismatch | Check query param types (e.g. integers, enums) |
| `Missing query parameter "q"` | 400 | Full-text search called without `q` param | Add `?q=<search term>` to request |
| `Missing q parameter` | 400 | Semantic search called without `q` param | Add `?q=<search term>` to request |
| `path query parameter is required` | 400 | Export route called without `?path=` | Supply `?path=<document path>` |
| `versions array required` | 400 | Multi-version fetch called without versions list | Supply `versions` array in request body |
| `Maximum 10 versions per request` | 400 | More than 10 versions requested in single call | Paginate; fetch max 10 per request |
| `since must be a non-negative integer` | 400 | `?since=` value is negative or not an integer | Pass a non-negative integer for `since` |
| `tokenBudget must be a positive integer` | 400 | Disclosure route `tokenBudget` <= 0 | Pass a positive integer for `tokenBudget` |
| `'to' must be after 'from'` | 400 | Time range filter has `to` <= `from` | Ensure `to` timestamp is strictly after `from` |
| `leaseDurationSeconds must be between 1 and 300` | 400 | Lease duration outside allowed range | Use a value 1–300 seconds |
| `updateBase64 is required` | 400 | CRDT update route called without `updateBase64` | Supply the base64-encoded CRDT update bytes |
| `updateBase64 decodes to empty buffer` | 400 | `updateBase64` decodes to zero bytes | Encode a non-empty CRDT update |
| `Request body is required (raw binary)` | 400 | Blob upload called without a body | Send the blob bytes as raw binary in the request body |
| `Unexpected body type — send raw binary bytes` | 400 | Blob upload body is not binary (e.g. JSON or text) | Set `Content-Type: application/octet-stream` and send raw bytes |
| `Invalid blob name` | 400 | Blob name fails naming rules (length, characters) | Use a name matching `^[a-zA-Z0-9._-]{1,255}$` |
| `content is required` | 400 | Patch/create route called without `content` | Include `content` in request body |
| `A document cannot link to itself` | 400 | Cross-doc link source and target slugs are the same | Use different source and target document slugs |
| `Invalid agent id` / `Invalid agent ID` | 400 | Agent ID format is invalid | Use a valid Ed25519 agent ID (hex or base64url) |
| `Invalid secret name` | 400 | Secret rotation called with invalid secret name | Use a valid secret identifier |
| `Missing stripe-signature header` | 400 | Webhook endpoint called without Stripe signature | Ensure Stripe sends the `Stripe-Signature` header |
| `Webhook signature invalid` | 400 | Stripe webhook signature verification failed | Check webhook secret and Stripe signing key match |
| `Could not read raw body` | 400 | Webhook body read failed | Ensure body is sent correctly with correct Content-Type |
| `Invalid Transition` | 400 | Lifecycle state machine transition not allowed from current state | Check valid transitions: DRAFT→REVIEW, REVIEW→PUBLISHED/REJECTED/DRAFT |
| `result.error` (dynamic) | 400 | Lifecycle or BFT route internal validation error; value is dynamic | Inspect the `error` field for the specific constraint violated |

---

## HTTP 401 — Unauthorized

| Error Code | HTTP Status | Scenario | Fix |
|---|---|---|---|
| `Unauthorized` | 401 | No API key or session cookie provided | Add `Authorization: Bearer <key>` header or authenticate first |
| `Unauthorized` | 401 | Authentication required (route-level check) | Provide a valid API key or session |
| `Unauthorized` | 401 | Invalid API key format | API key must begin with `llmtxt_` or the correct prefix |
| `Unauthorized` | 401 | API key not found | Use a valid, existing API key |
| `Unauthorized` | 401 | API key has been revoked | Rotate to a new key via `POST /api/api-keys/{id}/rotate` |
| `Unauthorized` | 401 | API key has expired | Generate a new non-expiring key or renew expiry |
| `Unauthorized` | 401 | API key owner not found (user deleted) | Re-authenticate with a valid user account |
| `Authentication required` | 401 | Compression route requires auth (public keys excluded) | Authenticate before compressing documents |
| `Authentication required to compress documents` | 401 | Compression called anonymously | Provide auth credentials |

---

## HTTP 403 — Forbidden

| Error Code | HTTP Status | Scenario | Fix |
|---|---|---|---|
| `Forbidden` | 403 | Caller does not have `editor` role on the document | Request editor access from the document owner |
| `Forbidden` | 403 | Editor role required for CRDT writes | Caller must have at minimum `editor` role |
| `Forbidden` | 403 | Caller is not the document owner (owner-only operation) | Only the document owner can perform this action |
| `Forbidden` | 403 | Access denied (general authorization failure) | Verify you have the required role on the target resource |
| `Forbidden` | 403 | Caller is not a member of this organization | Join the organization or have an admin invite you |
| `Forbidden` | 403 | Only org admins can add members | Requires `admin` org role |
| `Forbidden` | 403 | Only org admins can remove members | Requires `admin` org role |
| `Forbidden` | 403 | Only org admins can associate documents | Requires `admin` org role |
| `Forbidden` | 403 | Only the collection owner can add documents | Use the collection owner's credentials |
| `Forbidden` | 403 | Only the collection owner can remove documents | Use the collection owner's credentials |
| `Forbidden` | 403 | Only the collection owner can reorder documents | Use the collection owner's credentials |
| `Forbidden` | 403 | Write access required on source document | Requester needs `editor` role on the source document |
| `Forbidden` | 403 | Lease not held by caller (`lease_token_mismatch`) | Acquire the lease first with the correct token |
| `Forbidden` | 403 | Admin route requires admin privileges | Use an account with `admin` system role |

---

## HTTP 404 — Not Found

| Error Code | HTTP Status | Scenario | Fix |
|---|---|---|---|
| `Not Found` | 404 | Document not found by slug | Verify the slug exists and you have read access |
| `Not Found` | 404 | Version not found (e.g. `Version 42 not found`) | Check version number against `GET /api/{slug}/versions` |
| `Not Found` | 404 | Document has no versions yet | Create a version first via `POST /api/{slug}/versions` |
| `Not Found` | 404 | Base version not found (merge/diff operation) | Verify the `base` version number exists |
| `Not Found` | 404 | Ours version not found (3-way merge) | Verify the `ours` version number exists |
| `Not Found` | 404 | Source document not found (cross-doc) | Verify source slug exists |
| `Not Found` | 404 | Target document not found (cross-doc) | Verify target slug exists |
| `Not Found` | 404 | Collection not found | Verify the collection slug exists |
| `Not Found` | 404 | Document is not in this collection | The document was never added to this collection |
| `Not Found` | 404 | Link not found | The cross-doc link ID does not exist |
| `Not Found` | 404 | Organization not found | Verify the org slug exists |
| `Not Found` | 404 | User not found | The user ID or email does not correspond to any account |
| `Not Found` | 404 | User is not a member of this organization | User must be added to the org first |
| `Not Found` | 404 | No role grant found for this user | User has no explicit ACL entry on this document |
| `Not Found` | 404 | API key not found | The key ID does not exist |
| `Not Found` | 404 | Key not found | Agent key or rotation key does not exist |
| `Not Found` | 404 | Key not found or already revoked | Key was previously revoked or never existed |
| `Not Found` | 404 | Blob not found | No blob with this name on the document |
| `Not Found` | 404 | Blob not found or already detached | Blob was detached or never attached |
| `Not Found` | 404 | Blob bytes not found in store | Blob metadata exists but raw bytes missing in S3/store |
| `Not Found` | 404 | No blob with this hash found | Hash-addressed blob lookup failed |
| `Not Found` | 404 | Webhook not found | Webhook ID does not exist |
| `Not Found` | 404 | Webhook not found or not owned by you | Webhook exists but belongs to another user |
| `Not Found` | 404 | Message not found or already deleted | A2A message was deleted or never sent |
| `Not Found` | 404 | DLQ entry not found | Dead letter queue entry ID does not exist |
| `NO_ACTIVE_LEASE` | 404 | No active lease on this document/section | Acquire a lease first via `POST /api/{slug}/leases` |

---

## HTTP 409 — Conflict

| Error Code | HTTP Status | Scenario | Fix |
|---|---|---|---|
| `Conflict` | 409 | API key is already revoked | No action needed; key is already invalid |
| `Conflict` | 409 | Cannot rotate a revoked API key | Create a new key instead of rotating a revoked one |
| `Key is already revoked` | 409 | Agent or rotation key is already revoked | Create a new key |
| `Document must be in REVIEW state to approve` | 409 | Approval called on a document not in `REVIEW` state | Transition document to `REVIEW` first |
| `Document must be in REVIEW state to reject` | 409 | Rejection called on a document not in `REVIEW` state | Transition document to `REVIEW` first |
| `lease_held` | 409 | Another agent already holds a lease on this document | Wait for the existing lease to expire or be released |
| `lease_token_mismatch` | 409 | Lease renewal attempted with wrong token | Use the token returned when the lease was granted |
| `SECTION_LEASED` | 409 | Attempt to write to a section currently leased by another agent | Wait for the section lease to expire |
| `Invalid Transition` | 409 | CRDT version conflict — seq mismatch on concurrent update | Fetch the latest seq and retry the update |
| `AlreadyPendingDeletion` | 409 | Account deletion already requested | Cancel the existing deletion request before re-requesting |
| `NotPendingDeletion` | 409 | Cancel-deletion called when no deletion is pending | No action; account is not scheduled for deletion |
| `result.error` (dynamic) | 409 | Lifecycle transition rejected by state machine | Read the `error` field; check valid transitions for current state |

---

## HTTP 410 — Gone

| Error Code | HTTP Status | Scenario | Fix |
|---|---|---|---|
| `Gone` | 410 | Account deletion completed; resource no longer exists | User data has been purged; create a new account |

---

## HTTP 413 — Payload Too Large

| Error Code | HTTP Status | Scenario | Fix |
|---|---|---|---|
| `Payload Too Large` | 413 | Blob upload exceeds maximum allowed size | Reduce blob size or split into multiple attachments |
| `Payload Too Large` | 413 | Disclosure request graph traversal limit exceeded | Reduce depth or scope of the disclosure request |
| `Payload Too Large` | 413 | Graph link traversal response too large | Add filters to limit returned links |

---

## HTTP 422 — Unprocessable Entity

| Error Code | HTTP Status | Scenario | Fix |
|---|---|---|---|
| `Unprocessable Entity` | 422 | Agent key payload structurally invalid (e.g. bad public key encoding) | Ensure the Ed25519 public key is valid base64url |

---

## HTTP 423 — Locked

| Error Code | HTTP Status | Scenario | Fix |
|---|---|---|---|
| `Locked` | 423 | Document is in a non-editable state (e.g. `REVIEW`, `PUBLISHED`, `ARCHIVED`) and cannot be modified | Transition document to `DRAFT` state first |
| `Locked` | 423 | Patch apply rejected — document locked | Transition to DRAFT before applying patches |
| `Locked` | 423 | Version create rejected — document locked | Transition to DRAFT before creating new versions |
| `Locked` | 423 | Merge rejected — document locked | Transition to DRAFT before merging |

---

## HTTP 429 — Too Many Requests

| Error Code | HTTP Status | Scenario | Fix |
|---|---|---|---|
| `Limit Exceeded` | 429 | Per-user document quota reached (default: 1000 documents) | Delete unused documents |
| `Too Many Requests` (via @fastify/rate-limit) | 429 | Per-session or per-IP rate limit exceeded | Back off and retry after `Retry-After` header interval |

---

## HTTP 500 — Internal Server Error

| Error Code | HTTP Status | Scenario | Fix |
|---|---|---|---|
| `Internal server error` | 500 | Unhandled exception in conflict resolution | Check server logs; retry or report if persistent |
| `Internal Server Error` | 500 | Failed to attach blob | Blob store write failed; check S3/storage availability |
| `Internal Server Error` | 500 | Failed to list blobs | Blob store read failed |
| `Internal Server Error` | 500 | Failed to retrieve blob | Blob store fetch failed |
| `Internal Server Error` | 500 | Failed to detach blob | Blob store delete failed |
| `Internal Server Error` | 500 | Failed to check blob access | Blob ACL check threw an unexpected error |
| `Internal Server Error` | 500 | Failed to fetch blob | S3 presigned URL generation failed |
| `Search failed` | 500 | Full-text search query threw an internal error | Retry; if persistent, check search index health |
| `Similar documents lookup failed` | 500 | Vector similarity search failed | Check pgvector index availability |
| `Webhook secret not configured` | 500 | Stripe webhook route used but `WEBHOOK_SECRET` env var not set | Set `STRIPE_WEBHOOK_SECRET` in environment |
| `A2A handler threw` | 500 | A2A message handler threw an exception | Check agent logic; message is acknowledged to avoid retry loops |
| `Admin operation failed` | 500 | Admin-only DBA operation failed | Check server logs for SQL error |
| `Compression failed` | 500 | Document compression pipeline threw | Check Rust WASM module is loaded correctly |
| `Embeddings failed` | 500 | pgvector embedding generation threw | Check `pgvector` extension and embeddings job health |

---

## HTTP 503 — Service Unavailable

| Error Code | HTTP Status | Scenario | Fix |
|---|---|---|---|
| `Stripe not configured` | 503 | Billing endpoint called without Stripe credentials | Set `STRIPE_SECRET_KEY` in environment |
| `Billing service unavailable` | 503 | Stripe API unreachable or returned error | Retry; check Stripe status at status.stripe.com |

---

## Global Error Shape

All error responses share this envelope:

```typescript
interface ErrorResponse {
  error: string;       // Short error code (always present)
  message?: string;    // Human-readable description (often present)
  details?: unknown;   // Zod issue array or additional structured context (sometimes present)
  limit?: number;      // Quota limit (only on 429 quota errors)
  current?: number;    // Current usage count (only on 429 quota errors)
}
```

## Auth Error Headers

Rate-limited responses from `@fastify/rate-limit` include:

```
X-RateLimit-Limit: <max requests per window>
X-RateLimit-Remaining: <requests remaining>
X-RateLimit-Reset: <unix timestamp when window resets>
Retry-After: <seconds to wait>
```

## Notes

- **`slug` errors** — All document-scoped endpoints validate slugs via Zod. Invalid slugs return 400 with a `details` field.
- **Lease errors** — Lease-related 404 (`NO_ACTIVE_LEASE`) and 409 (`lease_held`) are normal control flow for agent coordination. Agents should retry with exponential backoff.
- **Lifecycle state machine** — Invalid transitions (e.g. `PUBLISHED → REVIEW`) return 409 `Invalid Transition`. See `docs/spec/lifecycle-states.md` for the valid state graph.
- **Blob errors** — 500 blob errors indicate S3/object-store degradation, not client error. Retry after a delay.
- **`error` vs `message`** — `error` is the machine-readable code; `message` is human-readable context. SDKs should key on `error`.
