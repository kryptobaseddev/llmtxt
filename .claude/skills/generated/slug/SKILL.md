---
name: slug
description: "Skill for the [[...slug]] area of llmtxt. 9 symbols across 5 files."
---

# [[...slug]]

9 symbols | 5 files | Cohesion: 100%

## When to Use

- Working with code in `apps/`
- Understanding how getPageMarkdownUrl, getMDXComponents, Page work
- Modifying [[...slug]]-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `apps/docs/src/lib/source.ts` | getPageMarkdownUrl, getPageImage, getLLMText |
| `apps/docs/src/app/[[...slug]]/page.tsx` | Page, generateMetadata |
| `apps/docs/src/app/llms.mdx/docs/[[...slug]]/route.ts` | generateStaticParams, GET |
| `apps/docs/src/components/mdx.tsx` | getMDXComponents |
| `apps/docs/src/app/og/docs/[...slug]/route.tsx` | generateStaticParams |

## Entry Points

Start here when exploring this area:

- **`getPageMarkdownUrl`** (Function) — `apps/docs/src/lib/source.ts:21`
- **`getMDXComponents`** (Function) — `apps/docs/src/components/mdx.tsx:3`
- **`Page`** (Function) — `apps/docs/src/app/[[...slug]]/page.tsx:15`
- **`generateStaticParams`** (Function) — `apps/docs/src/app/llms.mdx/docs/[[...slug]]/route.ts:17`
- **`getPageImage`** (Function) — `apps/docs/src/lib/source.ts:12`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `getPageMarkdownUrl` | Function | `apps/docs/src/lib/source.ts` | 21 |
| `getMDXComponents` | Function | `apps/docs/src/components/mdx.tsx` | 3 |
| `Page` | Function | `apps/docs/src/app/[[...slug]]/page.tsx` | 15 |
| `generateStaticParams` | Function | `apps/docs/src/app/llms.mdx/docs/[[...slug]]/route.ts` | 17 |
| `getPageImage` | Function | `apps/docs/src/lib/source.ts` | 12 |
| `generateMetadata` | Function | `apps/docs/src/app/[[...slug]]/page.tsx` | 49 |
| `generateStaticParams` | Function | `apps/docs/src/app/og/docs/[...slug]/route.tsx` | 21 |
| `getLLMText` | Function | `apps/docs/src/lib/source.ts` | 30 |
| `GET` | Function | `apps/docs/src/app/llms.mdx/docs/[[...slug]]/route.ts` | 5 |

## How to Explore

1. `gitnexus_context({name: "getPageMarkdownUrl"})` — see callers and callees
2. `gitnexus_query({query: "[[...slug]]"})` — find related execution flows
3. Read key files listed above for implementation details
