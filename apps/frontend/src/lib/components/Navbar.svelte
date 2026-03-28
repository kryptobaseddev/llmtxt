<script lang="ts">
  import { getTheme } from '$lib/stores/theme.svelte';
  import { getAuth } from '$lib/stores/auth.svelte';

  const theme = getTheme();
  const auth = getAuth();
</script>

<div class="navbar bg-base-100/80 backdrop-blur-md border-b border-base-content/5 sticky top-0 z-50">
  <div class="container mx-auto px-4">
    <div class="flex-1">
      <a href="/" class="font-display text-lg tracking-tight hover:opacity-80 transition-opacity">
        <span class="text-primary">llmtxt</span><span class="text-base-content/40">.my</span>
      </a>
    </div>
    <div class="flex-none flex items-center gap-2">
      <!-- Theme toggle -->
      <button
        class="btn btn-ghost btn-sm btn-square"
        onclick={() => theme.toggle()}
        aria-label="Toggle theme"
      >
        {#if theme.isDark}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clip-rule="evenodd" />
          </svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
          </svg>
        {/if}
      </button>

      <!-- Auth status -->
      {#if auth.isAuthenticated}
        <div class="dropdown dropdown-end">
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <div tabindex="0" role="button" class="btn btn-ghost btn-sm font-display text-xs">
            {#if auth.isAnonymous}
              anon
            {:else}
              {auth.session.user?.email?.split('@')[0] || 'user'}
            {/if}
          </div>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <ul tabindex="0" class="dropdown-content menu p-2 shadow-lg bg-base-200 rounded-lg w-40 z-50">
            <li>
              <button onclick={() => auth.signOut()} class="font-display text-xs">
                Sign out
              </button>
            </li>
          </ul>
        </div>
      {:else}
        <a href="/auth" class="btn btn-ghost btn-sm font-display text-xs">
          Sign in
        </a>
      {/if}
    </div>
  </div>
</div>
