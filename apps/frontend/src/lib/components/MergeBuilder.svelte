<script lang="ts">
  import { api } from '$lib/api/client';
  import type { MergeSource, MergeResult, MergeProvenanceLine } from '$lib/api/client';
  import type { Version } from '$lib/types';

  let {
    slug,
    versions,
    onMergeComplete,
  }: {
    slug: string;
    versions: Version[];
    onMergeComplete?: (result: MergeResult) => void;
  } = $props();

  // ── Internal types ────────────────────────────────────────────────────────

  interface LineRange {
    id: number;
    start: number | '';
    end: number | '';
  }

  interface SectionEntry {
    id: number;
    value: string;
  }

  interface SourceRow {
    id: number;
    version: number;
    lineRanges: LineRange[];
    sections: SectionEntry[];
  }

  // ── State ────────────────────────────────────────────────────────────────

  let nextId = 0;
  function uid() { return ++nextId; }

  // Available version numbers derived from the prop
  let versionNumbers = $derived(versions.map((v) => v.versionNumber).sort((a, b) => b - a));

  let fillFrom = $state<number>(1);
  let sources = $state<SourceRow[]>([]);
  let changelog = $state('');

  let previewing = $state(false);
  let previewResult = $state<MergeResult | null>(null);
  let previewError = $state('');

  let submitting = $state(false);
  let submitError = $state('');
  let submitSuccess = $state<MergeResult | null>(null);

  // Sync fillFrom to a valid version whenever the version list changes
  $effect(() => {
    if (versionNumbers.length && !versionNumbers.includes(fillFrom)) {
      fillFrom = versionNumbers[0];
    }
  });

  // ── Derived validation ────────────────────────────────────────────────────

  let validationErrors = $derived.by((): string[] => {
    const errs: string[] = [];

    if (sources.length === 0) {
      errs.push('Add at least one source version.');
      return errs;
    }

    const usedVersions = sources.map((s) => s.version);
    const dupVersions = usedVersions.filter((v, i) => usedVersions.indexOf(v) !== i);
    if (dupVersions.length) {
      errs.push(`Duplicate source version(s): ${[...new Set(dupVersions)].map((v) => `v${v}`).join(', ')}.`);
    }

    for (const src of sources) {
      const hasRanges = src.lineRanges.length > 0;
      const hasSections = src.sections.length > 0;

      if (!hasRanges && !hasSections) {
        errs.push(`v${src.version}: add at least one line range or section.`);
        continue;
      }

      for (const lr of src.lineRanges) {
        if (lr.start === '' || lr.end === '') {
          errs.push(`v${src.version}: fill in both start and end for each line range.`);
        } else if (Number(lr.start) < 1) {
          errs.push(`v${src.version}: line range start must be >= 1.`);
        } else if (Number(lr.end) < Number(lr.start)) {
          errs.push(`v${src.version}: line range end must be >= start.`);
        }
      }

      for (const sec of src.sections) {
        if (!sec.value.trim()) {
          errs.push(`v${src.version}: section name cannot be empty.`);
        }
      }
    }

    return errs;
  });

  let canPreview = $derived(validationErrors.length === 0 && sources.length > 0);

  // ── Helpers — build request body ─────────────────────────────────────────

  function buildSources(): MergeSource[] {
    return sources.map((src) => {
      const out: MergeSource = { version: src.version };
      if (src.lineRanges.length) {
        out.lineRanges = src.lineRanges.map((lr) => [Number(lr.start), Number(lr.end)]);
      }
      if (src.sections.length) {
        out.sections = src.sections.map((s) => s.value.trim()).filter(Boolean);
      }
      return out;
    });
  }

  // ── Source management ─────────────────────────────────────────────────────

  function addSource() {
    // Pick the first version not already used as a source
    const used = new Set(sources.map((s) => s.version));
    const available = versionNumbers.find((v) => !used.has(v)) ?? versionNumbers[0] ?? 1;
    sources = [
      ...sources,
      { id: uid(), version: available, lineRanges: [], sections: [] },
    ];
    // Reset preview when structure changes
    previewResult = null;
    previewError = '';
  }

  function removeSource(id: number) {
    sources = sources.filter((s) => s.id !== id);
    previewResult = null;
    previewError = '';
  }

  function changeSourceVersion(id: number, version: number) {
    sources = sources.map((s) => s.id === id ? { ...s, version } : s);
    previewResult = null;
  }

  // ── Line range management ─────────────────────────────────────────────────

  function addLineRange(sourceId: number) {
    sources = sources.map((s) =>
      s.id === sourceId
        ? { ...s, lineRanges: [...s.lineRanges, { id: uid(), start: '', end: '' }] }
        : s
    );
    previewResult = null;
  }

  function removeLineRange(sourceId: number, rangeId: number) {
    sources = sources.map((s) =>
      s.id === sourceId
        ? { ...s, lineRanges: s.lineRanges.filter((r) => r.id !== rangeId) }
        : s
    );
    previewResult = null;
  }

  function updateLineRange(sourceId: number, rangeId: number, field: 'start' | 'end', raw: string) {
    const val = raw === '' ? '' : parseInt(raw, 10);
    sources = sources.map((s) =>
      s.id === sourceId
        ? {
            ...s,
            lineRanges: s.lineRanges.map((r) =>
              r.id === rangeId ? { ...r, [field]: isNaN(val as number) ? '' : val } : r
            ),
          }
        : s
    );
    previewResult = null;
  }

  // ── Section management ────────────────────────────────────────────────────

  function addSection(sourceId: number) {
    sources = sources.map((s) =>
      s.id === sourceId
        ? { ...s, sections: [...s.sections, { id: uid(), value: '' }] }
        : s
    );
    previewResult = null;
  }

  function removeSection(sourceId: number, secId: number) {
    sources = sources.map((s) =>
      s.id === sourceId
        ? { ...s, sections: s.sections.filter((sec) => sec.id !== secId) }
        : s
    );
    previewResult = null;
  }

  function updateSection(sourceId: number, secId: number, value: string) {
    sources = sources.map((s) =>
      s.id === sourceId
        ? {
            ...s,
            sections: s.sections.map((sec) =>
              sec.id === secId ? { ...sec, value } : sec
            ),
          }
        : s
    );
    previewResult = null;
  }

  // ── Preview ───────────────────────────────────────────────────────────────

  async function handlePreview() {
    if (!canPreview) return;
    previewing = true;
    previewResult = null;
    previewError = '';
    try {
      const result = await api.previewMerge(slug, {
        sources: buildSources(),
        fillFrom,
        changelog: changelog || undefined,
        createdBy: 'user',
      });
      previewResult = result;
    } catch (e) {
      previewError = e instanceof Error ? e.message : 'Preview failed';
    } finally {
      previewing = false;
    }
  }

  // ── Create merge ──────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!canPreview) return;
    submitting = true;
    submitError = '';
    submitSuccess = null;
    try {
      const result = await api.createMerge(slug, {
        sources: buildSources(),
        fillFrom,
        changelog: changelog || undefined,
        createdBy: 'user',
      });
      submitSuccess = result;
      onMergeComplete?.(result);
    } catch (e) {
      submitError = e instanceof Error ? e.message : 'Merge failed';
    } finally {
      submitting = false;
    }
  }

  // ── Provenance colour palette ─────────────────────────────────────────────

  const PALETTE = [
    'bg-primary/15 border-primary/30 text-primary',
    'bg-secondary/15 border-secondary/30 text-secondary',
    'bg-accent/15 border-accent/30 text-accent',
    'bg-info/15 border-info/30 text-info',
    'bg-success/15 border-success/30 text-success',
  ];

  let provenanceVersions = $derived.by(() => {
    if (!previewResult) return new Map<number, string>();
    const unique = [...new Set(previewResult.provenance.map((p) => p.fromVersion))].sort((a, b) => a - b);
    return new Map(unique.map((v, i) => [v, PALETTE[i % PALETTE.length]]));
  });

  function provenanceClass(line: number, provenance: MergeProvenanceLine[]): string {
    const entry = provenance.find((p) => line >= p.lineStart && line <= p.lineEnd);
    if (!entry) return '';
    if (entry.fillFrom) return 'bg-base-200/40';
    return provenanceVersions.get(entry.fromVersion) ?? '';
  }

  function provenanceLabel(line: number, provenance: MergeProvenanceLine[]): string {
    const entry = provenance.find((p) => line >= p.lineStart && line <= p.lineEnd);
    if (!entry) return '';
    return entry.fillFrom ? `fill v${entry.fromVersion}` : `v${entry.fromVersion}`;
  }
</script>

<div class="space-y-5">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <h3 class="font-display text-sm font-bold tracking-tight">Cherry-Pick Merge</h3>
    {#if submitSuccess}
      <span class="badge badge-success badge-sm font-display">
        Created v{submitSuccess.version}
      </span>
    {/if}
  </div>

  <!-- Success banner -->
  {#if submitSuccess}
    <div class="p-4 rounded-lg bg-success/10 border border-success/25 animate-fade-in">
      <p class="font-display text-sm text-success font-bold mb-1">
        Merge complete — version {submitSuccess.version} created
      </p>
      <p class="text-xs text-base-content/50 font-display">
        {submitSuccess.stats.totalLines} lines from {submitSuccess.stats.sourcesUsed} source(s).
      </p>
    </div>
  {/if}

  <!-- Fill-from selector -->
  <div class="flex items-center gap-3">
    <label class="font-display text-xs text-base-content/50 shrink-0" for="fill-from">
      Fill unselected lines from:
    </label>
    <select
      id="fill-from"
      class="select select-bordered select-sm font-display text-sm"
      bind:value={fillFrom}
    >
      {#each versionNumbers as vn (vn)}
        <option value={vn}>v{vn}</option>
      {/each}
    </select>
  </div>

  <!-- Source rows -->
  <div class="space-y-3">
    <p class="font-display text-xs text-base-content/40 uppercase tracking-wider">
      Source Selections
    </p>

    {#if sources.length === 0}
      <p class="text-sm text-base-content/30 font-display py-4 text-center border border-dashed border-base-content/10 rounded-lg">
        No sources yet — add a version below.
      </p>
    {/if}

    {#each sources as src (src.id)}
      <div class="rounded-lg border border-base-content/10 bg-base-200/20 overflow-hidden">
        <!-- Source header -->
        <div class="flex items-center justify-between px-4 py-2.5 bg-base-200/40 border-b border-base-content/10">
          <div class="flex items-center gap-2">
            <span class="font-display text-xs text-base-content/40">From</span>
            <select
              class="select select-bordered select-xs font-display text-sm w-20"
              value={src.version}
              onchange={(e) => changeSourceVersion(src.id, parseInt((e.target as HTMLSelectElement).value, 10))}
            >
              {#each versionNumbers as vn (vn)}
                <option value={vn}>v{vn}</option>
              {/each}
            </select>
          </div>
          <button
            class="btn btn-ghost btn-xs btn-square text-base-content/30 hover:text-error"
            onclick={() => removeSource(src.id)}
            aria-label="Remove this source"
            type="button"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Selections body -->
        <div class="px-4 py-3 space-y-2">
          <!-- Line ranges -->
          {#each src.lineRanges as lr (lr.id)}
            <div class="flex items-center gap-2 group">
              <span class="font-display text-xs text-base-content/40 shrink-0">Lines</span>
              <input
                type="number"
                class="input input-bordered input-xs font-display text-sm w-20"
                placeholder="start"
                min="1"
                value={lr.start}
                oninput={(e) => updateLineRange(src.id, lr.id, 'start', (e.target as HTMLInputElement).value)}
              />
              <span class="text-base-content/30 font-display text-xs">–</span>
              <input
                type="number"
                class="input input-bordered input-xs font-display text-sm w-20"
                placeholder="end"
                min="1"
                value={lr.end}
                oninput={(e) => updateLineRange(src.id, lr.id, 'end', (e.target as HTMLInputElement).value)}
              />
              <button
                class="btn btn-ghost btn-xs btn-square text-base-content/20 hover:text-error ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
                onclick={() => removeLineRange(src.id, lr.id)}
                aria-label="Remove line range"
                type="button"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          {/each}

          <!-- Sections -->
          {#each src.sections as sec (sec.id)}
            <div class="flex items-center gap-2 group">
              <span class="font-display text-xs text-base-content/40 shrink-0">Section</span>
              <input
                type="text"
                class="input input-bordered input-xs font-display text-sm flex-1 min-w-0"
                placeholder='e.g. "## API Design"'
                value={sec.value}
                oninput={(e) => updateSection(src.id, sec.id, (e.target as HTMLInputElement).value)}
              />
              <button
                class="btn btn-ghost btn-xs btn-square text-base-content/20 hover:text-error opacity-0 group-hover:opacity-100 transition-opacity"
                onclick={() => removeSection(src.id, sec.id)}
                aria-label="Remove section"
                type="button"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          {/each}

          <!-- Add controls -->
          <div class="flex gap-2 pt-1">
            <button
              class="btn btn-ghost btn-xs font-display text-xs"
              onclick={() => addLineRange(src.id)}
              type="button"
            >
              + Line Range
            </button>
            <button
              class="btn btn-ghost btn-xs font-display text-xs"
              onclick={() => addSection(src.id)}
              type="button"
            >
              + Section
            </button>
          </div>
        </div>
      </div>
    {/each}

    <!-- Add version source button -->
    <button
      class="btn btn-outline btn-sm font-display text-xs w-full"
      onclick={addSource}
      disabled={sources.length >= versionNumbers.length}
      type="button"
    >
      + Add Version Source
    </button>
  </div>

  <!-- Changelog input -->
  <div>
    <label class="font-display text-xs text-base-content/40 block mb-1.5" for="merge-changelog">
      Changelog
    </label>
    <input
      id="merge-changelog"
      type="text"
      class="input input-bordered input-sm w-full font-display text-sm"
      placeholder="Merged best of v2 and v3..."
      bind:value={changelog}
    />
  </div>

  <!-- Validation errors -->
  {#if validationErrors.length > 0}
    <div class="space-y-1">
      {#each validationErrors as err}
        <p class="text-xs text-error font-display flex items-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {err}
        </p>
      {/each}
    </div>
  {/if}

  <!-- Action buttons -->
  <div class="flex gap-2">
    <button
      class="btn btn-outline btn-sm font-display"
      onclick={handlePreview}
      disabled={!canPreview || previewing}
      type="button"
    >
      {#if previewing}
        <span class="loading loading-spinner loading-xs"></span>
      {:else}
        Preview Merge
      {/if}
    </button>
    <button
      class="btn btn-primary btn-sm font-display"
      onclick={handleCreate}
      disabled={!canPreview || submitting || !!submitSuccess}
      type="button"
    >
      {#if submitting}
        <span class="loading loading-spinner loading-xs"></span>
      {:else if submitSuccess}
        Created v{submitSuccess.version}
      {:else}
        Create Merged Version
      {/if}
    </button>
  </div>

  <!-- API error banners -->
  {#if previewError}
    <div class="alert alert-error text-xs font-display py-2 px-3 rounded-lg">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      Preview error: {previewError}
    </div>
  {/if}

  {#if submitError}
    <div class="alert alert-error text-xs font-display py-2 px-3 rounded-lg">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      Merge error: {submitError}
    </div>
  {/if}

  <!-- Preview panel -->
  {#if previewResult}
    <div class="animate-fade-in space-y-3">
      <div class="flex items-center justify-between">
        <p class="font-display text-xs text-base-content/40 uppercase tracking-wider">
          Preview
        </p>
        <div class="flex gap-3 text-xs font-display text-base-content/40">
          <span>{previewResult.stats.totalLines} lines</span>
          <span>{previewResult.stats.sourcesUsed} source(s)</span>
        </div>
      </div>

      <!-- Provenance legend -->
      {#if provenanceVersions.size > 0}
        <div class="flex flex-wrap gap-2">
          {#each [...provenanceVersions.entries()] as [vn, cls]}
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-display {cls}">
              v{vn}
            </span>
          {/each}
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-base-content/10 bg-base-200/40 text-xs font-display text-base-content/40">
            fill
          </span>
        </div>
      {/if}

      <!-- Content with provenance annotations -->
      <div class="rounded-lg border border-base-content/10 overflow-hidden">
        <div class="max-h-96 overflow-y-auto overflow-x-auto">
          <table class="w-full text-xs font-display leading-relaxed border-collapse">
            <tbody>
              {#each previewResult.content.split('\n') as line, i}
                {@const lineNum = i + 1}
                {@const cls = provenanceClass(lineNum, previewResult.provenance)}
                {@const label = provenanceLabel(lineNum, previewResult.provenance)}
                <tr class="{cls} border-b border-base-content/5 last:border-0">
                  <!-- Line number -->
                  <td class="select-none text-right pr-2 pl-2 text-base-content/20 border-r border-base-content/5 w-0 whitespace-nowrap" style="min-width: 3ch">
                    {lineNum}
                  </td>
                  <!-- Provenance tag -->
                  <td class="select-none text-center px-1 border-r border-base-content/5 w-0 whitespace-nowrap">
                    {#if label}
                      <span class="text-[10px] opacity-60">{label}</span>
                    {/if}
                  </td>
                  <!-- Content -->
                  <td class="whitespace-pre-wrap break-all pr-4 py-px text-base-content/70">
                    {line}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  {/if}
</div>
