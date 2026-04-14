---
name: cluster-14
description: "Skill for the Cluster_14 area of llmtxt. 7 symbols across 1 files."
---

# Cluster_14

7 symbols | 1 files | Cohesion: 74%

## When to Use

- Working with code in `packages/`
- Understanding how verifySignedUrl, computeOrgSignatureWithLength, generateOrgSignedUrl work
- Modifying cluster_14-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/llmtxt/src/signed-url.ts` | verifySignedUrl, computeOrgSignatureWithLength, generateOrgSignedUrl, verifyOrgSignedUrl, buildSignedUrlPath (+2) |

## Entry Points

Start here when exploring this area:

- **`verifySignedUrl`** (Function) — `packages/llmtxt/src/signed-url.ts:107`
- **`computeOrgSignatureWithLength`** (Function) — `packages/llmtxt/src/signed-url.ts:171`
- **`generateOrgSignedUrl`** (Function) — `packages/llmtxt/src/signed-url.ts:191`
- **`verifyOrgSignedUrl`** (Function) — `packages/llmtxt/src/signed-url.ts:206`
- **`isExpired`** (Function) — `packages/llmtxt/src/signed-url.ts:280`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `verifySignedUrl` | Function | `packages/llmtxt/src/signed-url.ts` | 107 |
| `computeOrgSignatureWithLength` | Function | `packages/llmtxt/src/signed-url.ts` | 171 |
| `generateOrgSignedUrl` | Function | `packages/llmtxt/src/signed-url.ts` | 191 |
| `verifyOrgSignedUrl` | Function | `packages/llmtxt/src/signed-url.ts` | 206 |
| `isExpired` | Function | `packages/llmtxt/src/signed-url.ts` | 280 |
| `buildSignedUrlPath` | Function | `packages/llmtxt/src/signed-url.ts` | 264 |
| `getSignedUrlSlug` | Function | `packages/llmtxt/src/signed-url.ts` | 269 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `VerifySignedUrl → Delete` | cross_community | 4 |
| `VerifyOrgSignedUrl → Delete` | cross_community | 4 |
| `SignedUrlRoutes → BuildSignedUrlPath` | cross_community | 3 |
| `GenerateOrgSignedUrl → Delete` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Wasm | 4 calls |

## How to Explore

1. `gitnexus_context({name: "verifySignedUrl"})` — see callers and callees
2. `gitnexus_query({query: "cluster_14"})` — find related execution flows
3. Read key files listed above for implementation details
