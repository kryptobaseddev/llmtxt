<script lang="ts">
  import { goto } from '$app/navigation';
  import { getAuth } from '$lib/stores/auth.svelte';

  const auth = getAuth();

  let mode = $state<'signin' | 'signup'>('signin');
  let email = $state('');
  let password = $state('');
  let name = $state('');
  let error = $state('');
  let submitting = $state(false);

  async function handleSubmit() {
    error = '';
    submitting = true;
    try {
      if (mode === 'signin') {
        await auth.signIn(email, password);
      } else {
        await auth.signUp(email, password, name || undefined);
      }
      goto('/');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Authentication failed';
    } finally {
      submitting = false;
    }
  }

  async function handleAnonymous() {
    error = '';
    submitting = true;
    try {
      await auth.signInAnonymous();
      goto('/');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Anonymous session failed';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Sign in - llmtxt.my</title>
</svelte:head>

<div class="animate-fade-in container mx-auto px-4 py-16 flex justify-center">
  <div class="w-full max-w-sm">
    <div class="text-center mb-8">
      <h1 class="font-display text-2xl font-bold tracking-tight mb-2">
        {mode === 'signin' ? 'Welcome back' : 'Create account'}
      </h1>
      <p class="text-sm text-base-content/40">
        {mode === 'signin'
          ? 'Sign in to manage your documents'
          : 'Register for permanent document storage'}
      </p>
    </div>

    <!-- Mode tabs -->
    <div role="tablist" class="tabs tabs-bordered mb-6">
      <button
        role="tab"
        class="tab font-display text-xs flex-1 {mode === 'signin' ? 'tab-active' : ''}"
        onclick={() => { mode = 'signin'; error = ''; }}
      >Sign in</button>
      <button
        role="tab"
        class="tab font-display text-xs flex-1 {mode === 'signup' ? 'tab-active' : ''}"
        onclick={() => { mode = 'signup'; error = ''; }}
      >Register</button>
    </div>

    <!-- Form -->
    <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
      {#if mode === 'signup'}
        <label class="form-control w-full">
          <div class="label">
            <span class="label-text font-display text-xs">Name (optional)</span>
          </div>
          <input
            type="text"
            class="input input-bordered w-full font-display text-sm"
            placeholder="Agent or human name"
            bind:value={name}
          />
        </label>
      {/if}

      <label class="form-control w-full">
        <div class="label">
          <span class="label-text font-display text-xs">Email</span>
        </div>
        <input
          type="email"
          class="input input-bordered w-full font-display text-sm"
          placeholder="you@example.com"
          required
          bind:value={email}
        />
      </label>

      <label class="form-control w-full">
        <div class="label">
          <span class="label-text font-display text-xs">Password</span>
        </div>
        <input
          type="password"
          class="input input-bordered w-full font-display text-sm"
          placeholder="min 8 characters"
          required
          minlength={8}
          bind:value={password}
        />
      </label>

      {#if error}
        <div class="alert alert-error text-sm font-display">
          <span>{error}</span>
        </div>
      {/if}

      <button
        type="submit"
        class="btn btn-primary w-full font-display"
        disabled={submitting}
      >
        {#if submitting}
          <span class="loading loading-spinner loading-sm"></span>
        {:else}
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        {/if}
      </button>
    </form>

    <!-- Divider -->
    <div class="divider text-xs text-base-content/20 font-display my-6">or</div>

    <!-- Anonymous -->
    <button
      class="btn btn-ghost w-full font-display text-sm border border-base-content/10"
      onclick={handleAnonymous}
      disabled={submitting}
    >
      Continue anonymously
    </button>

    <div class="mt-4 p-3 rounded-lg bg-base-200/30 border border-base-content/5">
      <p class="text-xs text-base-content/40 font-display leading-relaxed">
        Anonymous sessions expire after 24 hours. Documents created anonymously will be deleted.
        Register to keep your documents permanently.
      </p>
    </div>
  </div>
</div>
