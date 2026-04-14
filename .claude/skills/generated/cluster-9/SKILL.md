---
name: cluster-9
description: "Skill for the Cluster_9 area of llmtxt. 10 symbols across 2 files."
---

# Cluster_9

10 symbols | 2 files | Cohesion: 87%

## When to Use

- Working with code in `packages/`
- Understanding how validateJson, validateText, detectFormat work
- Modifying cluster_9-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/llmtxt/src/validation.ts` | formatZodErrors, validateJson, validateText, detectFormat, containsBinaryContent (+3) |
| `packages/llmtxt/src/schemas.ts` | isPredefinedSchema, getPredefinedSchema |

## Entry Points

Start here when exploring this area:

- **`validateJson`** (Function) — `packages/llmtxt/src/validation.ts:83`
- **`validateText`** (Function) — `packages/llmtxt/src/validation.ts:147`
- **`detectFormat`** (Function) — `packages/llmtxt/src/validation.ts:183`
- **`validateContent`** (Function) — `packages/llmtxt/src/validation.ts:260`
- **`autoValidate`** (Function) — `packages/llmtxt/src/validation.ts:354`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `validateJson` | Function | `packages/llmtxt/src/validation.ts` | 83 |
| `validateText` | Function | `packages/llmtxt/src/validation.ts` | 147 |
| `detectFormat` | Function | `packages/llmtxt/src/validation.ts` | 183 |
| `validateContent` | Function | `packages/llmtxt/src/validation.ts` | 260 |
| `autoValidate` | Function | `packages/llmtxt/src/validation.ts` | 354 |
| `isPredefinedSchema` | Function | `packages/llmtxt/src/schemas.ts` | 114 |
| `getPredefinedSchema` | Function | `packages/llmtxt/src/schemas.ts` | 134 |
| `formatZodErrors` | Function | `packages/llmtxt/src/validation.ts` | 54 |
| `containsBinaryContent` | Function | `packages/llmtxt/src/validation.ts` | 215 |
| `findOverlongLine` | Function | `packages/llmtxt/src/validation.ts` | 227 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `ApiRoutes → FormatZodErrors` | cross_community | 4 |
| `ApiRoutes → IsPredefinedSchema` | cross_community | 4 |
| `ApiRoutes → GetPredefinedSchema` | cross_community | 4 |
| `AutoValidate → FormatZodErrors` | intra_community | 4 |
| `AutoValidate → IsPredefinedSchema` | intra_community | 4 |
| `AutoValidate → GetPredefinedSchema` | intra_community | 4 |
| `ApiRoutes → ContainsBinaryContent` | cross_community | 3 |
| `ApiRoutes → FindOverlongLine` | cross_community | 3 |
| `AutoValidate → ContainsBinaryContent` | intra_community | 3 |
| `AutoValidate → FindOverlongLine` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "validateJson"})` — see callers and callees
2. `gitnexus_query({query: "cluster_9"})` — find related execution flows
3. Read key files listed above for implementation details
