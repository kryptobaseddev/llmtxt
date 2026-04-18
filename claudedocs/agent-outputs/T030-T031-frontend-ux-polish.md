# T030 + T031 Frontend UX Polish — Output

**Date**: 2026-04-18
**Status**: complete
**Commit**: af49a74822c9f8fca4a6122390585667b28e1f99

---

## T031: DiffViewer Rewrite

**File**: `apps/frontend/src/lib/components/DiffViewer.svelte`

### Acceptance Criteria Met

| Criterion | Status |
|-----------|--------|
| Line numbers in left gutter | DONE — dual old/new columns with `min-width: {gutterCh}ch` |
| Removed lines red | DONE — `oklch(var(--er) / 0.12)` bg + `oklch(var(--er) / 0.6)` 3px left border |
| Added lines green | DONE — `oklch(var(--su) / 0.12)` bg + `oklch(var(--su) / 0.6)` 3px left border |
| Context lines white/neutral | DONE — transparent bg, no colored border |
| Pairwise diff interleaves context with changes | DONE — renders `diff.lines` array from API verbatim |

### Implementation Notes

- Scoped `<style>` block for `.diff-removed`, `.diff-added`, `.diff-context` classes
- Color scheme uses DaisyUI OKLCH semantic tokens (`--er` error/red, `--su` success/green)
- Previously used very low opacity backgrounds (`/8`) which were barely visible
- Gutter cells use `tabular-nums` for alignment; line numbers colored on changed rows
- `+`/`-` indicator bold and full-opacity colored (not faded)
- ARIA: `role="region" aria-label="Diff viewer"`, `aria-hidden` on decorative `+`/`-` column
- Svelte 5 runes only: `$props()`, `$derived()`

---

## T030: Other UX Polish

### ContributorTable (`apps/frontend/src/lib/components/ContributorTable.svelte`)

- Added rank column (`#1`, `#2`...) sorted by versions authored descending
- Agent IDs shown as 12-char prefix with full ID in `title` tooltip
- Version count subtext beneath agent ID
- Improved empty state: two-line guidance ("first contributor appears when a version is written")
- Total contributors summary line at footer
- Token formatter handles M (millions), k (thousands)
- Full year in `lastActive` date display
- ARIA label on impact bar `<div>`
- Svelte 5 runes only

### Existing components that already meet T030 acceptance criteria

| Criterion | Component | Status |
|-----------|-----------|--------|
| Compact version list rows with expandable details | `+page.svelte` versions tab | ALREADY DONE (table rows + `showVersionDetail` expand) |
| Multi-version side-by-side (up to 5) | `MultiDiffViewer.svelte` | ALREADY DONE (2–5 version checkboxes, Compare Selected) |
| Approvals tab with SDK consensus state | `ApprovalPanel.svelte` | ALREADY DONE (consensus panel with APPROVED/REJECTED/PENDING badges) |
| Contributors tab populates from document creation | `ContributorTable.svelte` + backend | ALREADY DONE (pg-backend.createDocument inserts contributor row) |

---

## Quality Evidence

- **Build**: `pnpm --filter frontend run build` — exit 0, built in 3.54s
- **svelte-check**: 0 new errors in modified files (4 pre-existing errors in unrelated `+server.ts`)
- **Backend tests**: 257/257 pass (`pnpm --filter backend run test`)
- **Commit**: `af49a74` on main
- **Files changed**:
  - `apps/frontend/src/lib/components/DiffViewer.svelte`
  - `apps/frontend/src/lib/components/ContributorTable.svelte`
