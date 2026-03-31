<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { getAuth } from '$lib/stores/auth.svelte';
	import { api } from '$lib/api/client';

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
				<span class="text-xs font-display text-base-content/40">{auth.session.user?.email}</span>
				<button class="btn btn-ghost btn-xs font-display" onclick={() => auth.signOut()}>Sign out</button>
			{:else if auth.isAuthenticated && auth.isAnonymous}
				<a href="/auth" class="btn btn-ghost btn-xs font-display text-base-content/40">Sign in</a>
			{/if}
		</div>
	</header>

	<!-- Content -->
	<main class="flex-1 flex flex-col">
		{@render children()}
	</main>
</div>
