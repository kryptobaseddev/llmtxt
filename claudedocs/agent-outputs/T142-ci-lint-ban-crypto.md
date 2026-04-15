# T142: Add CI Lint Rule — Ban node:crypto createHash/createHmac and CRDT libs

**Status**: COMPLETE  
**Date**: 2026-04-15  
**Commit**: 37f02da916f63f4f3e2d0ddd40ef3e731e0e182b  

## Summary

Added an ESLint rule to prevent regression of cryptographic primitives and CRDT libraries in `apps/backend`. This enforces the SSoT (Single Source of Truth) principle by requiring all crypto operations to use the WASM-backed `crates/llmtxt-core` via `packages/llmtxt` instead of node:crypto, and all CRDT work to use Yrs (Rust) via WASM instead of JavaScript CRDT libraries.

## Scope

**Banned patterns**:
1. `from 'node:crypto'` with `createHash`, `createHmac` — forces use of `@llmtxt` hash_content / sign_webhook_payload
2. `from 'yjs'` — forces use of Yrs (Rust) via WASM
3. `from 'automerge'` — forces use of Yrs (Rust) via WASM

**Allowed patterns**:
- Other node:crypto imports like `randomBytes` remain allowed (verified in webhooks.ts, api-keys.ts)

## Implementation

### Files Changed

1. **apps/backend/.eslintrc.json** (new)
   - Root-level ESLint configuration
   - Configures `@typescript-eslint/parser` for TypeScript support
   - `no-restricted-imports` rule with three banned paths (node:crypto createHash/createHmac, yjs, automerge)
   - Clear error messages with reference to docs/SSOT.md

2. **apps/backend/package.json**
   - Added `pnpm lint` script: `eslint 'src/**/*.ts' --max-warnings 0`
   - Added devDependencies:
     - `eslint@^8.57.0`
     - `@typescript-eslint/parser@^7.0.0`
     - `@typescript-eslint/eslint-plugin@^7.0.0`

3. **.github/workflows/ci.yml**
   - Added "Lint (backend)" step in TypeScript job
   - Runs `pnpm run lint` from `apps/backend` directory
   - Positioned after typecheck, before CalVer validation

4. **pnpm-lock.yaml**
   - Auto-updated by pnpm install

## Verification

### Local Testing

✅ `pnpm install` — eslint + @typescript-eslint deps installed successfully  
✅ `pnpm run lint` — passes cleanly with no warnings (rule enforced)  
✅ **Intentional violations**: each banned pattern properly caught with helpful error message:
   - createHmac import → Error: "Use @llmtxt hash_content / sign_webhook_payload via packages/llmtxt instead of node:crypto createHash/createHmac (see docs/SSOT.md)"
   - yjs import → Error: "CRDT work uses Yrs (Rust) via WASM, not JS CRDT libs. Import Y from packages/llmtxt instead (see docs/SSOT.md)"
   - automerge import → Error: "CRDT work uses Yrs (Rust) via WASM, not JS CRDT libs. Import Y from packages/llmtxt instead (see docs/SSOT.md)"

✅ `pnpm run test` — all 67 backend tests pass  
✅ Existing valid usages preserved: `randomBytes` from node:crypto still allowed in webhooks.ts and api-keys.ts

### CI Ready

The linting step is wired into `.github/workflows/ci.yml` and will run on all PRs and pushes to main, preventing any regression of the banned imports.

## Design Decisions

- **Option Selected**: ESLint no-restricted-imports rule (Option A from T142 spec)
  - Cleanest approach for TypeScript projects
  - Provides IDE feedback in real-time
  - Industry-standard linting tool
  - Integrates naturally into existing backend build pipeline

- **Why not grep-based CI step**: ESLint provides better DX (IDE warnings), more precise matching (handles import variants), and is extensible for future rules

- **Rule scope**: Backend-only. Frontend and crates/llmtxt-core are not linted by this rule (they have their own standards)

## Key Findings

1. **No pre-existing ESLint config** — apps/backend had no linting before T142. Created new .eslintrc.json from scratch.

2. **Existing crypto usage**: Only two files use node:crypto, both in allowed ways:
   - `src/routes/webhooks.ts`: uses `randomBytes` (allowed) — not affected by rule
   - `src/utils/api-keys.ts`: uses `randomBytes` (allowed) — not affected by rule
   
   No existing `createHash` or `createHmac` usage (already migrated in bfac086).

3. **No yjs/automerge in codebase** — grep found zero existing imports, so no conflicts

4. **Error messages are helpful** — Each restriction includes clear guidance on what to use instead and a reference to the SSoT documentation

## Testing

Run the following to verify locally:

```bash
cd apps/backend

# Lint should pass (green)
pnpm run lint

# All tests should pass
pnpm run test

# Intentional violation test (creates temporary file):
echo "import { createHmac } from 'node:crypto';" > src/test-violation.ts
pnpm run lint  # Should fail with helpful message
rm src/test-violation.ts
pnpm run lint  # Should pass again
```

## Regression Guards

- CI runs `pnpm run lint` on every PR/push to main → prevents any re-introduction of banned imports
- Rule is code-based (not config-based) → reviewable in git history
- Error messages include reference to docs/SSOT.md → drives context about why the rule exists
- No false positives → only bans the specific importNames, not the entire module

## Notes

- No Rust changes (cargo fmt N/A, ferrous-forge N/A)
- No breaking changes to existing functionality
- All 67 backend tests passing
- CI workflow now enforces the rule on every build
