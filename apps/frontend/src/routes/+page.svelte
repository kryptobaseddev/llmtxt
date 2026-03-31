<script lang="ts">
  import { api } from '$lib/api/client';
  import { goto } from '$app/navigation';
  import { getAuth } from '$lib/stores/auth.svelte';

  const auth = getAuth();

  let content = $state('');
  let submitting = $state(false);
  let menuOpen = $state(false);
  let sharedSlug = $state('');
  let copyFeedback = $state('');
  let shareError = $state('');
  let showAbout = $state(false);

  let shared = $derived(sharedSlug !== '');
  let shareUrl = $derived(sharedSlug ? `${window.location.origin}/doc/${sharedSlug}` : '');

  // Live stats
  let chars = $derived(content.length);
  let tokens = $derived(Math.ceil(new TextEncoder().encode(content).length / 4));
  let size = $derived(new TextEncoder().encode(content).length);
  let format = $derived(detectFormat(content));

  function detectFormat(text: string): string {
    if (!text.trim()) return 'text';
    try { JSON.parse(text); return 'json'; } catch {}
    const mdSignals = [/^#{1,6}\s/m, /^\s*[-*]\s/m, /```/m, /\[.*\]\(.*\)/m];
    if (mdSignals.filter(r => r.test(text)).length >= 2) return 'markdown';
    return 'text';
  }

  function formatBytes(b: number): string {
    if (b === 0) return '0 B';
    if (b < 1024) return `${b} B`;
    return `${(b / 1024).toFixed(1)} KB`;
  }

  async function share() {
    if (!content.trim()) return;
    submitting = true;
    shareError = '';
    try {
      const result = await api.createDocument(content, format);
      sharedSlug = result.slug;
      await copyToClipboard(`${window.location.origin}/doc/${result.slug}`);
    } catch (e) {
      shareError = e instanceof Error ? e.message : 'Failed to create document';
    } finally {
      submitting = false;
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copyFeedback = 'Copied!';
    } catch {
      copyFeedback = 'Select & copy manually';
    }
    setTimeout(() => { copyFeedback = ''; }, 2000);
  }

  function newDoc() {
    content = '';
    sharedSlug = '';
    shareError = '';
    menuOpen = false;
  }

  function viewShared() {
    if (sharedSlug) goto(`/doc/${sharedSlug}`);
  }
</script>

<svelte:head>
  <title>llmtxt — context sharing for AI agents</title>
</svelte:head>

<div class="h-[calc(100vh-4rem)] flex flex-col">
  <!-- Editor area — takes all available space -->
  <div class="flex-1 relative">
    {#if shared}
      <!-- Shared confirmation overlay -->
      <div class="absolute inset-0 flex items-center justify-center z-10 bg-base-100/80 backdrop-blur-sm animate-fade-in">
        <div class="text-center space-y-5 max-w-sm px-4">
          <div class="font-display text-4xl text-primary">{sharedSlug}</div>

          <!-- Copyable URL field -->
          <div class="flex items-center gap-1 bg-base-200 rounded-lg border border-base-content/10 px-3 py-2">
            <input
              type="text"
              readonly
              value={shareUrl}
              class="flex-1 bg-transparent text-sm font-display text-base-content/70 outline-none select-all min-w-0"
              onclick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              class="btn btn-ghost btn-xs font-display shrink-0"
              onclick={() => copyToClipboard(shareUrl)}
            >
              {copyFeedback || 'Copy'}
            </button>
          </div>

          <!-- QR Code -->
          <div class="flex justify-center">
            <img
              src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data={encodeURIComponent(shareUrl)}&bgcolor=1a1b2e&color=58c7f3&format=svg"
              alt="QR code for {sharedSlug}"
              width="120"
              height="120"
              class="rounded-lg"
            />
          </div>

          <div class="flex gap-2 justify-center">
            <button class="btn btn-primary btn-sm font-display" onclick={viewShared}>
              View document
            </button>
            <button class="btn btn-ghost btn-sm font-display" onclick={newDoc}>
              New document
            </button>
          </div>
        </div>
      </div>
    {/if}

    {#if shareError}
      <div class="absolute top-4 left-1/2 -translate-x-1/2 z-20 alert alert-error text-sm font-display max-w-sm animate-fade-in">
        <span>{shareError}</span>
        <button class="btn btn-ghost btn-xs" onclick={() => shareError = ''}>dismiss</button>
      </div>
    {/if}

    <textarea
      class="w-full h-full bg-transparent resize-none p-6 md:p-8 font-display text-sm leading-relaxed focus:outline-none placeholder:text-base-content/20"
      placeholder="Type or paste content here..."
      bind:value={content}
      spellcheck="false"
      autocomplete="off"
    ></textarea>
  </div>

  <!-- Stats bar — pinned to bottom -->
  <div class="flex items-center justify-between px-6 py-3 border-t border-base-content/10 text-xs font-display text-base-content/40 select-none">
    <div class="flex gap-6">
      <div>
        <span class="uppercase tracking-wider text-base-content/25 mr-2">Characters</span>
        <span class="text-base-content/60">{chars.toLocaleString()}</span>
      </div>
      <div>
        <span class="uppercase tracking-wider text-base-content/25 mr-2">Tokens</span>
        <span class="text-base-content/60">{tokens.toLocaleString()}</span>
      </div>
      <div>
        <span class="uppercase tracking-wider text-base-content/25 mr-2">Size</span>
        <span class="text-base-content/60">{formatBytes(size)}</span>
      </div>
      <div>
        <span class="uppercase tracking-wider text-base-content/25 mr-2">Format</span>
        <span class="text-base-content/60">{format}</span>
      </div>
    </div>
  </div>

  <!-- FAB menu -->
  <div class="fixed bottom-6 right-6 z-50">
    {#if menuOpen}
      <div class="mb-2 bg-base-200 rounded-lg border border-base-content/10 shadow-xl overflow-hidden animate-fade-in">
        <ul class="menu menu-sm w-56 font-display text-sm">
          <li><button onclick={newDoc}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
            New document
          </button></li>
          <li><button onclick={share} disabled={!content.trim() || submitting}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
            Share document
          </button></li>
          {#if sharedSlug}
            <li><button onclick={viewShared}>
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
              View document
            </button></li>
          {/if}
          <div class="divider my-0"></div>
          <!-- User profile -->
          {#if auth.isAuthenticated && !auth.isAnonymous}
            <li class="disabled">
              <span class="flex items-center gap-2 opacity-60">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                <span class="truncate">{auth.session.user?.email ?? 'User'}</span>
              </span>
            </li>
            <li><button onclick={() => { auth.signOut(); menuOpen = false; }}>
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              Sign out
            </button></li>
          {:else}
            <li class="disabled">
              <span class="flex items-center gap-2 opacity-60">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                Anonymous (24h)
              </span>
            </li>
            <li><a href="/auth" onclick={() => menuOpen = false}>
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>
              Create account
            </a></li>
          {/if}
          <div class="divider my-0"></div>
          <li><button onclick={() => { showAbout = true; menuOpen = false; }}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            About LLMtxt
          </button></li>
          <li><a href="https://github.com/kryptobaseddev/llmtxt" target="_blank" rel="noopener">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            GitHub
          </a></li>
        </ul>
      </div>
    {/if}

    <button
      class="btn btn-circle btn-primary shadow-lg"
      onclick={() => menuOpen = !menuOpen}
      aria-label="Menu"
    >
      {#if menuOpen}
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="18" r="2"/></svg>
      {/if}
    </button>
  </div>

  <!-- About overlay -->
  {#if showAbout}
    <div class="fixed inset-0 z-[60] bg-base-100/90 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onclick={() => showAbout = false} role="dialog">
      <div class="bg-base-200 rounded-xl border border-base-content/10 shadow-2xl max-w-md w-full p-8 space-y-4" onclick={(e) => e.stopPropagation()}>
        <div class="flex items-center justify-between">
          <h2 class="font-display text-xl font-bold"><span class="text-primary">LLM</span>txt</h2>
          <button class="btn btn-ghost btn-sm btn-square" onclick={() => showAbout = false}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <p class="text-sm text-base-content/60 leading-relaxed font-display">
          Context sharing for AI agents and humans. Create, version, and collaboratively edit text documents with built-in compression, diffing, and consensus workflows.
        </p>
        <div class="space-y-2 text-xs text-base-content/40 font-display">
          <div class="flex items-start gap-2">
            <span class="text-primary mt-0.5">*</span>
            <span><strong class="text-base-content/60">Anonymous users</strong> get 24-hour document retention. No sign-up required.</span>
          </div>
          <div class="flex items-start gap-2">
            <span class="text-primary mt-0.5">*</span>
            <span><strong class="text-base-content/60">Registered users</strong> get extended storage and collaboration features. Create a free account to keep your documents.</span>
          </div>
          <div class="flex items-start gap-2">
            <span class="text-primary mt-0.5">*</span>
            <span><strong class="text-base-content/60">For agents</strong>: API at api.llmtxt.my with progressive disclosure, versioning, consensus, and signed URLs.</span>
          </div>
        </div>
        <div class="pt-2 flex gap-2">
          <a href="https://github.com/kryptobaseddev/llmtxt" target="_blank" rel="noopener" class="btn btn-ghost btn-sm font-display text-xs">GitHub</a>
          <a href="https://api.llmtxt.my/llms.txt" target="_blank" rel="noopener" class="btn btn-ghost btn-sm font-display text-xs">API Docs</a>
        </div>
      </div>
    </div>
  {/if}
</div>
