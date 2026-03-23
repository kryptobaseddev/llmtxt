# @codluv/llmtxt — Configuration Reference

## `SignedUrlConfig`

Configuration for generating and verifying signed URLs.

```typescript
import type { SignedUrlConfig } from "@codluv/llmtxt";

const config: Partial<SignedUrlConfig> = {
  // Shared HMAC-SHA256 secret used to sign and verify URLs.
  secret: "...",
  // Base URL for document access (e.g. `"https://llmtxt.my"`).
  baseUrl: "...",
};
```

| Property | Type | Description |
|----------|------|-------------|
| `secret` | `string` | Shared HMAC-SHA256 secret used to sign and verify URLs. |
| `baseUrl` | `string` | Base URL for document access (e.g. `"https://llmtxt.my"`). |
