<script lang="ts">
	import './layout.css';

	let { children } = $props();
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
		<a href="/doc" class="btn btn-primary btn-sm font-display">
			Share
		</a>
	</header>

	<!-- Content -->
	<main class="flex-1 flex flex-col">
		{@render children()}
	</main>
</div>
