<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { getAuth } from '$lib/stores/auth.svelte';

	let { children } = $props();

	let isLanding = $derived(page.url.pathname === '/');
	const auth = getAuth();

	// Auto-create anonymous session on app load
	onMount(async () => {
		await auth.init();
		if (!auth.isAuthenticated) {
			try {
				await auth.signInAnonymous();
			} catch (e) {
				console.warn('Anonymous auth failed:', e);
			}
		}
	});
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet" />
</svelte:head>

<div class="min-h-screen bg-base-100 flex flex-col" data-theme="night">
	<!-- Minimal header -->
	<header class="flex items-center justify-between px-6 py-4">
		<a href="/" class="font-display text-xl font-bold tracking-tight">
			<span class="text-primary">LLM</span><span class="text-base-content/70">txt</span>
		</a>
		<div class="flex items-center gap-3">
			{#if !isLanding}
				<a href="/" class="btn btn-primary btn-sm font-display">
					New
				</a>
			{/if}
			{#if auth.isAuthenticated && !auth.isAnonymous}
				<a href="/dashboard" class="btn btn-ghost btn-xs font-display text-base-content/60">My Txt</a>
			{:else}
				<a href="/auth?mode=signup" class="btn btn-ghost btn-xs font-display text-warning/80 gap-1">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
					Create account
				</a>
			{/if}
		</div>
	</header>

	<!-- Content -->
	<main class="flex-1 flex flex-col">
		{@render children()}
	</main>
</div>
