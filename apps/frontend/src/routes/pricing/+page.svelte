<script lang="ts">
  import { onMount } from 'svelte';
  import { getAuth } from '$lib/stores/auth.svelte';
  import { goto } from '$app/navigation';

  const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.llmtxt.my';

  const auth = getAuth();

  let loading = $state(false);
  let error = $state('');

  const tiers = [
    {
      name: 'Free',
      price: '$0',
      description: 'For individuals and hobbyists exploring LLMtxt.',
      tier: 'free',
      cta: 'Get Started',
      ctaAction: 'signup',
      highlight: false,
      features: [
        '50 documents',
        '500 KB per document',
        '1,000 API calls / month',
        '500 CRDT operations / month',
        '3 agent seats',
        '25 MB storage',
        '90-day version history',
      ],
    },
    {
      name: 'Pro',
      price: '$19',
      description: 'For power users and active agent deployments.',
      tier: 'pro',
      cta: 'Upgrade to Pro',
      ctaAction: 'checkout',
      highlight: true,
      features: [
        '500 documents',
        '10 MB per document',
        '50,000 API calls / month',
        '25,000 CRDT operations / month',
        '25 agent seats',
        '5 GB storage',
        'Unlimited version history',
        'Priority support',
      ],
    },
    {
      name: 'Enterprise',
      price: '$199',
      description: 'For teams and pipelines at scale.',
      tier: 'enterprise',
      cta: 'Contact Us',
      ctaAction: 'contact',
      highlight: false,
      features: [
        'Unlimited documents',
        '100 MB per document',
        '500,000 API calls / month',
        '250,000 CRDT operations / month',
        'Unlimited agent seats',
        '100 GB storage',
        'Unlimited version history',
        'SLA, SSO, dedicated support',
        'Audit export',
      ],
    },
  ] as const;

  async function handleCta(tier: typeof tiers[number]) {
    if (tier.ctaAction === 'signup') {
      goto('/auth/sign-up');
      return;
    }

    if (tier.ctaAction === 'contact') {
      window.location.href = 'mailto:hello@llmtxt.my?subject=Enterprise%20Plan';
      return;
    }

    // checkout
    if (!auth.user) {
      goto('/auth/sign-in?redirect=/pricing');
      return;
    }

    loading = true;
    error = '';
    try {
      const res = await fetch(`${API_BASE}/billing/checkout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier: tier.tier,
          success_url: `${window.location.origin}/billing?upgraded=1`,
          cancel_url: `${window.location.origin}/pricing`,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      window.location.href = data.checkout_url;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Something went wrong';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Pricing — LLMtxt</title>
  <meta name="description" content="Simple, transparent pricing for LLMtxt. Free, Pro, and Enterprise plans for individuals, developers, and teams." />
</svelte:head>

<main class="pricing-page">
  <section class="hero">
    <h1>Simple, transparent pricing</h1>
    <p class="subtitle">Start free. Upgrade when you need more.</p>
  </section>

  {#if error}
    <div class="error-banner" role="alert">
      {error}
    </div>
  {/if}

  <section class="tiers">
    {#each tiers as tier}
      <article class="tier-card" class:highlight={tier.highlight}>
        {#if tier.highlight}
          <div class="badge">Most Popular</div>
        {/if}
        <header>
          <h2>{tier.name}</h2>
          <div class="price">
            <span class="amount">{tier.price}</span>
            {#if tier.price !== '$0'}
              <span class="period">/ month</span>
            {/if}
          </div>
          <p class="description">{tier.description}</p>
        </header>

        <button
          class="cta-button"
          class:primary={tier.highlight}
          disabled={loading}
          onclick={() => handleCta(tier)}
        >
          {loading && tier.ctaAction === 'checkout' ? 'Loading...' : tier.cta}
        </button>

        <ul class="features">
          {#each tier.features as feature}
            <li>
              <span class="check" aria-hidden="true">+</span>
              {feature}
            </li>
          {/each}
        </ul>
      </article>
    {/each}
  </section>

  <section class="faq">
    <h2>Common questions</h2>
    <dl>
      <dt>What counts as an API call?</dt>
      <dd>Any request to the LLMtxt API — reads, writes, compress, decompress, search, CRDT operations (counted separately), and blob uploads.</dd>

      <dt>What happens when I hit a limit?</dt>
      <dd>Requests that exceed your tier limit return HTTP 402 with an <code>upgrade_url</code>. Your existing documents and data are never deleted.</dd>

      <dt>Can I cancel anytime?</dt>
      <dd>Yes. Cancel in the billing portal at any time. You keep Pro access until the end of your billing period, then drop to Free.</dd>

      <dt>Is there a grace period for failed payments?</dt>
      <dd>Yes — 7 days. We send email reminders and keep your Pro access active during this period.</dd>

      <dt>Do you offer annual billing?</dt>
      <dd>Not yet. Monthly billing only for now.</dd>
    </dl>
  </section>
</main>

<style>
  .pricing-page {
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    font-family: system-ui, sans-serif;
  }

  .hero {
    text-align: center;
    padding: 3rem 0 2rem;
  }

  .hero h1 {
    font-size: 2.5rem;
    font-weight: 700;
    margin: 0 0 0.5rem;
    color: #111;
  }

  .subtitle {
    font-size: 1.1rem;
    color: #555;
    margin: 0;
  }

  .error-banner {
    background: #fff0f0;
    border: 1px solid #fca5a5;
    color: #b91c1c;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-bottom: 1.5rem;
    text-align: center;
  }

  .tiers {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
    margin: 2rem 0;
  }

  .tier-card {
    position: relative;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 2rem;
    background: #fff;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .tier-card.highlight {
    border-color: #2563eb;
    box-shadow: 0 0 0 2px #2563eb22;
  }

  .badge {
    position: absolute;
    top: -0.75rem;
    left: 50%;
    transform: translateX(-50%);
    background: #2563eb;
    color: #fff;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    white-space: nowrap;
  }

  .tier-card header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .tier-card h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
    color: #111;
  }

  .price {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
  }

  .amount {
    font-size: 2rem;
    font-weight: 700;
    color: #111;
  }

  .period {
    font-size: 0.9rem;
    color: #6b7280;
  }

  .description {
    font-size: 0.9rem;
    color: #6b7280;
    margin: 0;
  }

  .cta-button {
    width: 100%;
    padding: 0.65rem 1rem;
    border-radius: 8px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid #d1d5db;
    background: #fff;
    color: #111;
    transition: background 0.15s, border-color 0.15s;
  }

  .cta-button:hover:not(:disabled) {
    background: #f3f4f6;
  }

  .cta-button.primary {
    background: #2563eb;
    color: #fff;
    border-color: #2563eb;
  }

  .cta-button.primary:hover:not(:disabled) {
    background: #1d4ed8;
    border-color: #1d4ed8;
  }

  .cta-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .features {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .features li {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: #374151;
  }

  .check {
    color: #16a34a;
    font-weight: 700;
    flex-shrink: 0;
  }

  .faq {
    margin-top: 4rem;
    max-width: 680px;
    margin-left: auto;
    margin-right: auto;
  }

  .faq h2 {
    font-size: 1.5rem;
    font-weight: 600;
    text-align: center;
    margin-bottom: 1.5rem;
    color: #111;
  }

  .faq dl {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .faq dt {
    font-weight: 600;
    font-size: 0.95rem;
    color: #111;
    margin-bottom: 0.25rem;
  }

  .faq dd {
    margin: 0;
    font-size: 0.9rem;
    color: #6b7280;
    line-height: 1.6;
  }

  .faq code {
    background: #f3f4f6;
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-size: 0.85em;
  }
</style>
