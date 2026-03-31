# llmtxt — Configuration Reference

## `LlmtxtClientConfig`

```typescript
import type { LlmtxtClientConfig } from "llmtxt";

const config: Partial<LlmtxtClientConfig> = {
  apiBase: "...",
  apiKey: "...",
  agentId: "...",
};
```

| Property | Type | Description |
|----------|------|-------------|
| `apiBase` | `string` |  |
| `apiKey` | `string` |  |
| `agentId` | `string` |  |

## `SignedUrlConfig`

Configuration for generating and verifying signed URLs.

```typescript
import type { SignedUrlConfig } from "llmtxt";

const config: Partial<SignedUrlConfig> = {
  secret: "...",
  baseUrl: "...",
  // Optional path prefix like `/attachments`. Default: root path.
  pathPrefix: "...",
  // Signature length in hex chars. Default: 16.
  signatureLength: 0,
};
```

| Property | Type | Description |
|----------|------|-------------|
| `secret` | `string` |  |
| `baseUrl` | `string` |  |
| `pathPrefix` | `string | undefined` | Optional path prefix like `/attachments`. Default: root path. |
| `signatureLength` | `number | undefined` | Signature length in hex chars. Default: 16. |
