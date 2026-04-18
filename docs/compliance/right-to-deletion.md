# Right-to-Deletion (GDPR Article 17)

**Status**: Implemented (T187)
**Date**: 2026-04-18

---

## Overview

This document describes how LLMtxt implements the GDPR right-to-erasure (Article 17), also known as "the right to be forgotten."

## How to Request Deletion

Send a `DELETE` request to `POST /api/v1/users/me` while authenticated.

This initiates a **30-day grace period**. During this period:

- All your documents are soft-deleted (inaccessible via the API).
- All your API keys are revoked.
- Your account shows as pending deletion.

You can cancel the deletion at any time during the 30-day window:

```
POST /api/v1/users/me/undo-deletion
```

## What Happens After 30 Days

After the 30-day grace period, the system permanently:

- Deletes all owned documents and their versions.
- Deletes all webhooks and API keys.
- Pseudonymises your name and email in the user record (the row itself is retained for audit-trail purposes).
- Pseudonymises your actor ID in audit log entries (entries are retained — see below).
- Issues a **deletion certificate** as proof of erasure.

## Audit Log Treatment

Audit log entries that reference your account are **not hard-deleted**. Instead, your actor ID is replaced with a pseudonym (`[deleted:<hash>]`). This preserves the tamper-evident hash chain integrity while removing your direct identifier.

This approach is consistent with GDPR recital 65, which permits retention of data when "necessary for the exercise of the right of freedom of expression and information, for compliance with a legal obligation, for reasons of public interest in the area of public health, for archiving purposes in the public interest, scientific or historical research purposes or statistical purposes, or for the establishment, exercise or defence of legal claims."

## Legal Hold

If your audit log entries are under a legal hold (placed by an administrator for a legal proceeding), those entries cannot be archived or deleted regardless of your deletion request. You will be notified if this applies.

## Deletion Certificate

After hard deletion, you receive a deletion certificate containing:

- Original user ID
- Deletion timestamp
- Count of each resource type deleted
- A SHA-256 integrity hash

The certificate is retained indefinitely as proof of erasure.

## Data Export Before Deletion

Before deleting your account, you can export all your data:

```
POST /api/v1/users/me/export
```

This returns a JSON archive containing your profile, documents (with content), API key metadata (hashes only — not raw keys), audit log entries, and webhook registrations.

Rate limit: 1 export request per day.

## Timeline

| Event | Timing |
|-------|--------|
| DELETE request received | Immediately: documents soft-deleted, API keys revoked |
| Undo window closes | 30 days after deletion request |
| Hard deletion runs | Background job (nightly), after 30-day window |
| Deletion certificate issued | Same time as hard deletion |

## Questions

For questions about data deletion or to request deletion via email (if you cannot authenticate), contact: privacy@llmtxt.my
