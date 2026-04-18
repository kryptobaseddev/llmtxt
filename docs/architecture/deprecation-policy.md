# Deprecation Policy

> This document defines the formal deprecation lifecycle for all `llmtxt`
> subpath exports.  It supplements `packages/llmtxt/STABILITY.md`.

---

## Guiding principles

1. **No surprise removals.** Consumers MUST receive at least one full release
   cycle of advance warning before a stable export is removed.
2. **Explicit, auditable trail.** Every deprecation MUST be recorded in
   STABILITY.md, CHANGELOG.md, and — where feasible — as a TypeScript
   `@deprecated` JSDoc tag on the symbol itself.
3. **Minimal blast radius.** Deprecated exports continue to work during the
   warning period.  Runtime warnings (console warnings) MAY be emitted but
   are NOT required.
4. **Clear migration path.** Every deprecation MUST include a replacement
   or an explanation of why no replacement exists.

---

## Stability tiers and deprecation eligibility

| Tier | May be deprecated? | Notes |
|---|---|---|
| stable | Yes — follow full lifecycle below | Cannot skip warning period |
| experimental | Yes — shorter timeline permitted | One PATCH-bump warning sufficient |
| internal | No formal deprecation required | May be removed without notice |

---

## Deprecation lifecycle (stable subpaths)

```
Phase 1: Deprecate    Phase 2: Remove
─────────────────     ──────────────
YYYY.M.x  ──────────► YYYY.(M+2).x  or later
  ^                        ^
  |                        |
  Announce in               Removal commit
  CHANGELOG + STABILITY.md  lands here
```

### Minimum timeline

| Rule | Requirement |
|---|---|
| **Warning window** | At least **two calendar months** (= two minor CalVer steps) between the deprecation release and the removal release. |
| **Example** | Deprecated in `2026.5.x` → may not be removed before `2026.7.0`. |
| **Hard minimum** | Deprecated in `2026.M.x` → removal target is `2026.(M+2).0` at earliest. |
| **Freeze** | No removal is permitted within the same CalVer month as the deprecation announcement, regardless of the PATCH counter. |

### Phase 1 — Announce deprecation

1. Add a row to the **"Currently deprecated exports"** table in
   `packages/llmtxt/STABILITY.md`.
2. Add a `@deprecated` TSDoc comment on the affected symbol(s):
   ```ts
   /**
    * @deprecated since 2026.5.0 — use `newFunction` instead.
    * Will be removed no earlier than 2026.7.0.
    */
   export function oldFunction(...) { ... }
   ```
3. Add a CHANGELOG entry under `### Deprecated`:
   ```md
   ### Deprecated
   - `oldFunction` in `llmtxt/similarity` — use `newFunction`.
     Removal target: 2026.7.0.
   ```
4. Open a tracking issue (or CLEO task) titled
   `"Remove deprecated: <symbol> [target: YYYY.M.0]"`.

### Phase 2 — Remove

1. Remove the symbol from the source file and its subpath `index.ts`.
2. Remove it from `packages/llmtxt/STABILITY.md` deprecated table (move to
   a "Removed" section with the removal version).
3. Add a CHANGELOG entry under `### Removed`:
   ```md
   ### Removed
   - `oldFunction` from `llmtxt/similarity` (deprecated since 2026.5.0).
   ```
4. Bump the `.dts-snapshots/` baseline by running
   `./scripts/snapshot-subpath-types.sh` and committing the result.
5. Close the tracking issue / CLEO task.

---

## Deprecation lifecycle (experimental subpaths)

Experimental subpaths may be deprecated and removed within a single CalVer
**PATCH** bump provided:

- The deprecation is announced in the CHANGELOG.
- At least one tag (`vX.Y.Z`) carrying the deprecation notice is published
  before the removal tag.

---

## Subpath-level deprecation (removing an entire subpath)

Removing an entire subpath (`./graph`, `./embeddings`, etc.) from the
`package.json` `"exports"` map follows the same timeline rules as symbol-level
deprecation but MUST additionally:

1. Add a `console.warn` in the subpath `index.ts` during the warning period:
   ```ts
   console.warn('[llmtxt] llmtxt/graph is deprecated and will be removed in 2026.7.0. ' +
                'Use the replacement API documented at https://docs.llmtxt.my/migration/graph.');
   ```
2. Keep the subpath entry in `package.json` `"exports"` until the removal
   release.
3. Mention the subpath explicitly in both STABILITY.md and CHANGELOG.md.

---

## Example: full deprecation record

```md
## packages/llmtxt/STABILITY.md — Currently deprecated exports

| Symbol / Subpath | Deprecated in | Removal target | Replacement |
|---|---|---|---|
| `textSimilarity` (llmtxt/similarity) | 2026.4.6 | 2026.7.0 | `jaccardSimilarity` |
```

```md
## CHANGELOG.md (2026.4.6)

### Deprecated
- `textSimilarity` in `llmtxt/similarity` — this alias for `jaccardSimilarity`
  will be removed in 2026.7.0. Switch to `jaccardSimilarity` directly.
```

---

## Enforcing the policy

The subpath-contract CI workflow (`.github/workflows/subpath-contract.yml`)
validates that:

- No stable export is silently removed between the PR branch and `main`.
- Every removal commit for a stable symbol references an open CLEO task /
  GitHub issue with a deprecation notice from a prior release.

Violation of this policy blocks PR merge.

---

_Last updated: 2026-04-18_
