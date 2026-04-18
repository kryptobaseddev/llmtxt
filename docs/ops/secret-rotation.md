# Secret Rotation Runbook

**Applies to**: `SIGNING_SECRET`, `SIGNING_KEY_KEK`, webhook HMAC secrets  
**Last Updated**: 2026-04-18  
**Related**: T090 Secret Rotation and KMS Integration  

---

## Overview

This runbook describes the procedure for rotating secrets in the LLMtxt production environment. All rotations include a 1-hour grace window during which both the old and new secret are accepted.

**NEVER rotate a secret without following this runbook.**

---

## Prerequisites

- Access to Railway environment variable settings  
- (If Vault) Admin token for HashiCorp Vault  
- (If AWS KMS) IAM permission to update Secrets Manager secrets  

---

## 1. Rotate SIGNING_SECRET

This is the HMAC signing secret for signed URLs and webhooks.

### Step 1: Generate the new secret

```bash
openssl rand -hex 32
# Example output: a3f2e8c1d4b7...
```

### Step 2: Deploy the new secret alongside the old one

**Railway (env provider):**

In the Railway dashboard, add the new secret under a versioned name. If the current version is `1`, add `SIGNING_SECRET_V2`:

```
SIGNING_SECRET_V2 = <new-secret-value>
```

Then update `SIGNING_SECRET` to the new value:

```
SIGNING_SECRET = <new-secret-value>
```

**IMPORTANT**: Deploy both env changes at the same time. The old secret must remain reachable as `SIGNING_SECRET_V1` for the grace window to work.

### Step 3: Trigger the rotation via API

```bash
curl -X POST https://api.llmtxt.my/api/v1/admin/secrets/SIGNING_SECRET/rotate \
  -H "Authorization: Bearer <admin-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"grace_window_secs": 3600}'
```

Response:
```json
{
  "name": "SIGNING_SECRET",
  "current_version": 2,
  "previous_version": 1,
  "grace_window_secs": 3600,
  "grace_ends_at": "2026-04-18T20:00:00.000Z",
  "message": "Secret 'SIGNING_SECRET' rotated to v2..."
}
```

### Step 4: Verify grace window is active

```bash
curl https://api.llmtxt.my/api/v1/admin/secrets/SIGNING_SECRET/status \
  -H "Authorization: Bearer <admin-api-key>"
```

Confirm `grace_window_active: true` and note `grace_ends_at`.

### Step 5: Monitor for errors

Watch server logs for signature verification failures for 1 hour after rotation. If errors spike, roll back immediately (see Rollback section).

### Step 6: After grace window expires

After `grace_ends_at`, the old secret version is no longer accepted. You may optionally remove `SIGNING_SECRET_V1` from environment variables.

---

## 2. Rotate SIGNING_KEY_KEK (Agent Key KEK)

The KEK is used to wrap/unwrap agent private keys stored in the database.

**WARNING**: Rotating the KEK requires re-wrapping all stored private keys. This is a more complex procedure.

### Step 1: Generate new KEK

```bash
openssl rand -hex 32
```

### Step 2: Re-wrap all private keys

Currently, this requires a migration script. Until an automated re-wrap job is implemented, the recommended approach is:

1. Generate new KEK.
2. For each agent, run a key rotation (`POST /api/v1/agents/:id/keys/rotate`).
3. This generates a new keypair wrapped with the new KEK.
4. The old keypair remains accessible for 48 hours (grace window).

### Step 3: Update KEK in deployment

```
SIGNING_KEY_KEK = <new-kek-hex>
```

---

## 3. Rotate HMAC Webhook Secrets

Each webhook subscription has its own HMAC secret. To rotate:

1. Generate new secret: `openssl rand -hex 32`
2. Update the webhook subscription via the API.
3. Update the consumer webhook handler to accept both old and new secret for 1 hour.
4. After 1 hour, remove the old secret from the consumer.

---

## 4. Vault Provider

To use HashiCorp Vault instead of environment variables:

### Configuration

```
SECRETS_PROVIDER=vault
VAULT_ADDR=https://vault.internal.example.com:8200
VAULT_TOKEN=<vault-token>
VAULT_KV_MOUNT=secret
```

### Store a secret in Vault

```bash
vault kv put secret/llmtxt/SIGNING_SECRET value="<secret>"
# Versioned automatically by Vault KV v2
```

### Trigger rotation

```bash
# Write new version to Vault
vault kv put secret/llmtxt/SIGNING_SECRET value="<new-secret>"

# Trigger rotation via API (updates DB version metadata)
curl -X POST https://api.llmtxt.my/api/v1/admin/secrets/SIGNING_SECRET/rotate \
  -H "Authorization: Bearer <admin-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"grace_window_secs": 3600}'
```

The Vault provider reads the versioned secret using `?version=N` query parameter.

---

## 5. AWS Secrets Manager

To use AWS Secrets Manager:

### Configuration

```
SECRETS_PROVIDER=aws-kms
AWS_REGION=us-east-1
# IAM role or:
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

### Store a secret in AWS Secrets Manager

```bash
aws secretsmanager create-secret \
  --name llmtxt/SIGNING_SECRET \
  --secret-string '{"value":"<secret>"}'
```

### Rotate via AWS rotation mechanism

AWS Secrets Manager supports automatic rotation via Lambda. After rotation, trigger the API rotation as above to update the DB version metadata.

---

## 6. Rollback

If a rotation causes production errors:

### For SIGNING_SECRET

1. Revert `SIGNING_SECRET` env var to the previous value.
2. Call the rotation API again with the old secret (this will re-increment the version, but the old value will be used).

### For agent keys

If a key rotation causes signature verification failures:

1. Check the `agent_key_rotation_events` table for recent rotations.
2. If the new key was not distributed to the agent, revoke it immediately:
   ```bash
   curl -X POST https://api.llmtxt.my/api/v1/agents/<id>/keys/<key_id>/revoke \
     -H "Authorization: Bearer <admin-api-key>"
   ```
3. The previous (retiring) key will continue to work during its grace window.

---

## 7. Monitoring

Watch for these metrics/log patterns after any rotation:

- `401 SIGNATURE_MISMATCH` rate increase → agent still using old key
- `401 SIGNATURE_EXPIRED` → timestamp drift (unrelated to rotation)
- `agent_key_rotation_events` table — verify rotation events are logged
- `secrets_config.grace_window_active` → confirm grace window is working

---

## 8. Security Notes

- Never log, print, or commit secret values.
- Never store plaintext private keys in the database.
- The `agent_keys.privkey_wrapped` column contains AES-256-GCM ciphertext — it is safe to back up.
- The `SIGNING_KEY_KEK` is the root secret for all wrapped private keys — protect it accordingly.
- After a key is revoked, it takes effect immediately (no grace window for revocations).
