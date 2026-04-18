<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { getAuth } from '$lib/stores/auth.svelte';

  const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.llmtxt.my';
  const auth = getAuth();

  interface UsageData {
    tier: string;
    status: string;
    period: { start: string; end: string };
    usage: {
      api_calls: { used: number; limit: number | null };
      crdt_ops: { used: number; limit: number | null };
      documents: { used: number; limit: number | null };
      storage_bytes: { used: number; limit: number | null };
    };
    upgrade_url: string;
  }

  interface SubscriptionData {
    tier: string;
    status: string;
    stripe_customer_id: string | null;
    current_period_end: string | null;
    grace_period_end: string | null;
    upgrade_url: string | null;
    manage_url: string | null;
  }

  let usageData = $state<UsageData | null>(null);
  let subData = $state<SubscriptionData | null>(null);
  let loading = $state(true);
  let error = $state('');
  let portalLoading = $state(false);

  const upgraded = $derived(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('upgraded') === '1'
      : false
  );

  onMount(async () => {
    if (!auth.user) {
      goto('/auth/sign-in?redirect=/billing');
      return;
    }

    try {
      const [usageRes, subRes] = await Promise.all([
        fetch(`${API_BASE}/me/usage`, { credentials: 'include' }),
        fetch(`${API_BASE}/me/subscription`, { credentials: 'include' }),
      ]);

      if (usageRes.ok) usageData = await usageRes.json();
      if (subRes.ok) subData = await subRes.json();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load billing data';
    } finally {
      loading = false;
    }
  });

  async function openPortal() {
    portalLoading = true;
    error = '';
    try {
      const res = await fetch(`${API_BASE}/billing/portal`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ return_url: window.location.href }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      const data = await res.json();
      window.location.href = data.portal_url;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to open billing portal';
    } finally {
      portalLoading = false;
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function pct(used: number, limit: number | null): number {
    if (!limit) return 0;
    return Math.min((used / limit) * 100, 100);
  }

  function tierLabel(tier: string): string {
    return tier.charAt(0).toUpperCase() + tier.slice(1);
  }
</script>

<svelte:head>
  <title>Billing — LLMtxt</title>
</svelte:head>

<main class="billing-page">
  <h1>Billing & Usage</h1>

  {#if upgraded}
    <div class="success-banner" role="status">
      Your plan has been upgraded. Welcome to {tierLabel(subData?.tier ?? 'Pro')}!
    </div>
  {/if}

  {#if error}
    <div class="error-banner" role="alert">{error}</div>
  {/if}

  {#if loading}
    <p class="loading">Loading your billing data...</p>
  {:else if usageData && subData}
    <!-- Plan overview -->
    <section class="section">
      <h2>Current plan</h2>
      <div class="plan-card">
        <div class="plan-info">
          <span class="tier-badge tier-{subData.tier}">{tierLabel(subData.tier)}</span>
          <span class="status-badge status-{subData.status}">{subData.status}</span>
        </div>

        {#if subData.current_period_end}
          <p class="period-info">
            Renews on {new Date(subData.current_period_end).toLocaleDateString()}
          </p>
        {/if}

        {#if subData.grace_period_end}
          <p class="grace-warning">
            Payment past due — access until {new Date(subData.grace_period_end).toLocaleDateString()}
          </p>
        {/if}

        <div class="plan-actions">
          {#if subData.tier === 'free'}
            <a href="/pricing" class="button primary">Upgrade to Pro</a>
          {:else if subData.manage_url}
            <button class="button secondary" disabled={portalLoading} onclick={openPortal}>
              {portalLoading ? 'Loading...' : 'Manage Subscription'}
            </button>
          {/if}
        </div>
      </div>
    </section>

    <!-- Usage overview -->
    <section class="section">
      <h2>Usage this month <span class="period-tag">{usageData.period.start} – {usageData.period.end}</span></h2>

      <div class="usage-grid">
        <!-- API Calls -->
        <div class="usage-item">
          <div class="usage-header">
            <span class="usage-label">API calls</span>
            <span class="usage-value">
              {usageData.usage.api_calls.used.toLocaleString()}
              {#if usageData.usage.api_calls.limit !== null}
                / {usageData.usage.api_calls.limit.toLocaleString()}
              {:else}
                <span class="unlimited">unlimited</span>
              {/if}
            </span>
          </div>
          {#if usageData.usage.api_calls.limit !== null}
            <div class="progress-bar">
              <div
                class="progress-fill"
                class:warning={pct(usageData.usage.api_calls.used, usageData.usage.api_calls.limit) > 80}
                style="width: {pct(usageData.usage.api_calls.used, usageData.usage.api_calls.limit)}%"
              ></div>
            </div>
          {/if}
        </div>

        <!-- CRDT Ops -->
        <div class="usage-item">
          <div class="usage-header">
            <span class="usage-label">CRDT operations</span>
            <span class="usage-value">
              {usageData.usage.crdt_ops.used.toLocaleString()}
              {#if usageData.usage.crdt_ops.limit !== null}
                / {usageData.usage.crdt_ops.limit.toLocaleString()}
              {:else}
                <span class="unlimited">unlimited</span>
              {/if}
            </span>
          </div>
          {#if usageData.usage.crdt_ops.limit !== null}
            <div class="progress-bar">
              <div
                class="progress-fill"
                class:warning={pct(usageData.usage.crdt_ops.used, usageData.usage.crdt_ops.limit) > 80}
                style="width: {pct(usageData.usage.crdt_ops.used, usageData.usage.crdt_ops.limit)}%"
              ></div>
            </div>
          {/if}
        </div>

        <!-- Documents -->
        <div class="usage-item">
          <div class="usage-header">
            <span class="usage-label">Documents</span>
            <span class="usage-value">
              {usageData.usage.documents.used.toLocaleString()}
              {#if usageData.usage.documents.limit !== null}
                / {usageData.usage.documents.limit.toLocaleString()}
              {:else}
                <span class="unlimited">unlimited</span>
              {/if}
            </span>
          </div>
          {#if usageData.usage.documents.limit !== null}
            <div class="progress-bar">
              <div
                class="progress-fill"
                class:warning={pct(usageData.usage.documents.used, usageData.usage.documents.limit) > 80}
                style="width: {pct(usageData.usage.documents.used, usageData.usage.documents.limit)}%"
              ></div>
            </div>
          {/if}
        </div>

        <!-- Storage -->
        <div class="usage-item">
          <div class="usage-header">
            <span class="usage-label">Storage</span>
            <span class="usage-value">
              {formatBytes(usageData.usage.storage_bytes.used)}
              {#if usageData.usage.storage_bytes.limit !== null}
                / {formatBytes(usageData.usage.storage_bytes.limit)}
              {:else}
                <span class="unlimited">unlimited</span>
              {/if}
            </span>
          </div>
          {#if usageData.usage.storage_bytes.limit !== null}
            <div class="progress-bar">
              <div
                class="progress-fill"
                class:warning={pct(usageData.usage.storage_bytes.used, usageData.usage.storage_bytes.limit) > 80}
                style="width: {pct(usageData.usage.storage_bytes.used, usageData.usage.storage_bytes.limit)}%"
              ></div>
            </div>
          {/if}
        </div>
      </div>

      {#if subData.tier === 'free'}
        <p class="upgrade-cta">
          Need more?
          <a href="/pricing">Compare plans</a>
        </p>
      {/if}
    </section>
  {:else if !loading}
    <p class="empty">No billing data available. <a href="/auth/sign-in">Sign in</a> to view your usage.</p>
  {/if}
</main>

<style>
  .billing-page {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    font-family: system-ui, sans-serif;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0 0 1.5rem;
    color: #111;
  }

  .success-banner {
    background: #f0fdf4;
    border: 1px solid #86efac;
    color: #166534;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-bottom: 1.5rem;
  }

  .error-banner {
    background: #fff0f0;
    border: 1px solid #fca5a5;
    color: #b91c1c;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-bottom: 1.5rem;
  }

  .loading, .empty {
    color: #6b7280;
    font-size: 0.95rem;
  }

  .section {
    margin-bottom: 2.5rem;
  }

  .section h2 {
    font-size: 1.1rem;
    font-weight: 600;
    color: #111;
    margin: 0 0 1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .period-tag {
    font-size: 0.8rem;
    font-weight: 400;
    color: #6b7280;
  }

  .plan-card {
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: #fff;
  }

  .plan-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .tier-badge {
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .tier-free { background: #f3f4f6; color: #374151; }
  .tier-pro { background: #dbeafe; color: #1d4ed8; }
  .tier-enterprise { background: #faf5ff; color: #7c3aed; }

  .status-badge {
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
  }

  .status-active { background: #dcfce7; color: #166534; }
  .status-past_due { background: #fef9c3; color: #854d0e; }
  .status-canceled { background: #fee2e2; color: #991b1b; }
  .status-trialing { background: #ede9fe; color: #5b21b6; }

  .period-info {
    font-size: 0.875rem;
    color: #6b7280;
    margin: 0;
  }

  .grace-warning {
    font-size: 0.875rem;
    color: #92400e;
    background: #fef3c7;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    margin: 0;
  }

  .plan-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.25rem;
  }

  .button {
    padding: 0.5rem 1rem;
    border-radius: 7px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
    border: 1px solid transparent;
    transition: background 0.15s;
  }

  .button.primary {
    background: #2563eb;
    color: #fff;
    border-color: #2563eb;
  }

  .button.primary:hover {
    background: #1d4ed8;
  }

  .button.secondary {
    background: #fff;
    color: #374151;
    border-color: #d1d5db;
  }

  .button.secondary:hover:not(:disabled) {
    background: #f3f4f6;
  }

  .button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .usage-grid {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .usage-item {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .usage-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .usage-label {
    font-size: 0.875rem;
    color: #374151;
    font-weight: 500;
  }

  .usage-value {
    font-size: 0.875rem;
    color: #111;
    font-variant-numeric: tabular-nums;
  }

  .unlimited {
    color: #6b7280;
    font-weight: 400;
  }

  .progress-bar {
    height: 6px;
    background: #f3f4f6;
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #2563eb;
    border-radius: 3px;
    transition: width 0.3s;
  }

  .progress-fill.warning {
    background: #f59e0b;
  }

  .upgrade-cta {
    margin-top: 1.25rem;
    font-size: 0.875rem;
    color: #6b7280;
  }

  .upgrade-cta a {
    color: #2563eb;
    text-decoration: none;
    font-weight: 500;
  }

  .upgrade-cta a:hover {
    text-decoration: underline;
  }
</style>
