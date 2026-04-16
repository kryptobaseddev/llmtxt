<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  // ── Types ────────────────────────────────────────────────────────────────────

  interface AgentPresence {
    agentId: string;
    section: string;
    lastSeen: number;
    fingerprint: string;
  }

  interface DemoEvent {
    id: string;
    seq: string;
    event_type: string;
    actor_id: string;
    payload: Record<string, unknown>;
    created_at: string;
  }

  interface A2ALog {
    from: string;
    to: string;
    contentType: string;
    snippet: string;
    at: string;
  }

  interface BftVote {
    voter: string;
    status: 'approved' | 'changes-requested';
    at: string;
    sigHex: string;
  }

  // ── Config ───────────────────────────────────────────────────────────────────

  const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.llmtxt.my';
  const DEMO_SLUG_KEY = 'llmtxt:demo-slug';
  // Known demo agent IDs — used to show presence dots
  const DEMO_AGENTS = ['writerbot-demo', 'reviewerbot-demo', 'consensusbot-demo', 'summarizerbot-demo'];

  // ── State ────────────────────────────────────────────────────────────────────

  let slug = $state<string>('');
  let slugInput = $state<string>('');
  let docContent = $state<string>('');
  let docState = $state<string>('DRAFT');
  let docVersion = $state<number>(1);
  let loading = $state(false);
  let connected = $state(false);
  let events = $state<DemoEvent[]>([]);
  let agents = $state<Map<string, AgentPresence>>(new Map());
  let a2aLog = $state<A2ALog[]>([]);
  let bftVotes = $state<BftVote[]>([]);
  let bftQuorum = $state<number>(1);
  let bftApprovals = $state<number>(0);

  // Error / status
  let error = $state<string>('');
  let statusMsg = $state<string>('');

  // SSE controller
  let abortController: AbortController | null = null;
  let contentRefreshTimer: ReturnType<typeof setInterval> | null = null;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function agentColor(agentId: string): string {
    const colors: Record<string, string> = {
      'writerbot-demo':    'bg-primary',
      'reviewerbot-demo':  'bg-secondary',
      'consensusbot-demo': 'bg-accent',
      'summarizerbot-demo':'bg-warning',
    };
    return colors[agentId] ?? 'bg-base-300';
  }

  function agentLabel(agentId: string): string {
    const labels: Record<string, string> = {
      'writerbot-demo':    'Writer',
      'reviewerbot-demo':  'Reviewer',
      'consensusbot-demo': 'Consensus',
      'summarizerbot-demo':'Summarizer',
    };
    return labels[agentId] ?? agentId;
  }

  function isAgentActive(agentId: string): boolean {
    const presence = agents.get(agentId);
    if (!presence) return false;
    return Date.now() - presence.lastSeen < 30_000;
  }

  function formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  }

  function eventLabel(event_type: string): string {
    return event_type.replace(/_/g, ' ');
  }

  function eventBadgeClass(event_type: string): string {
    if (event_type.includes('version') || event_type.includes('update')) return 'badge-primary';
    if (event_type.includes('approve') || event_type.includes('bft')) return 'badge-success';
    if (event_type.includes('reject') || event_type.includes('transition')) return 'badge-warning';
    if (event_type.includes('a2a') || event_type.includes('message')) return 'badge-secondary';
    return 'badge-ghost';
  }

  // ── API helpers ───────────────────────────────────────────────────────────────

  async function fetchContent(s: string) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/documents/${s}/raw`, {
        credentials: 'include',
      });
      if (res.ok) {
        docContent = await res.text();
      }
    } catch {
      // Non-fatal
    }
  }

  async function fetchDocMeta(s: string) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/documents/${s}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const json = await res.json();
        const doc = json.result ?? json.data ?? json;
        docState = doc.state ?? 'DRAFT';
        docVersion = doc.currentVersion ?? doc.version ?? 1;
      }
    } catch {
      // Non-fatal
    }
  }

  async function fetchBftStatus(s: string) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/documents/${s}/bft/status`, {
        credentials: 'include',
      });
      if (res.ok) {
        const json = await res.json();
        const status = json.result ?? json.data ?? json;
        bftApprovals = status.approvalCount ?? status.approvals ?? 0;
        bftQuorum = status.quorum ?? 1;
        // Parse votes if available
        if (Array.isArray(status.votes)) {
          bftVotes = status.votes.map((v: any): BftVote => ({
            voter: v.agentId ?? v.voter ?? 'unknown',
            status: (v.status === 'changes-requested' ? 'changes-requested' : 'approved') as 'approved' | 'changes-requested',
            at: v.createdAt ?? v.at ?? new Date().toISOString(),
            sigHex: (v.signatureHex ?? '').slice(0, 16) + '...',
          }));
        }
      }
    } catch {
      // Non-fatal — BFT endpoint may not exist yet
    }
  }

  // ── SSE event stream ─────────────────────────────────────────────────────────

  async function connectEventStream(s: string) {
    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();
    connected = false;
    statusMsg = 'Connecting to event stream...';

    try {
      const url = `${API_BASE}/api/v1/documents/${s}/events/stream`;
      const res = await fetch(url, {
        credentials: 'include',
        signal: abortController.signal,
        headers: { Accept: 'text/event-stream' },
      });

      if (!res.ok) {
        error = `Event stream returned ${res.status}`;
        return;
      }

      connected = true;
      statusMsg = `Connected — watching ${s}`;
      error = '';

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let nlIdx: number;
        let frame: { id?: string; event?: string; data?: string } = {};
        while ((nlIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nlIdx).replace(/\r$/, '');
          buffer = buffer.slice(nlIdx + 1);

          if (line === '') {
            // Dispatch frame
            if (frame.data && frame.event !== 'heartbeat') {
              try {
                const evt: DemoEvent = JSON.parse(frame.data);
                handleEvent(evt);
              } catch {
                // Skip malformed frames
              }
            }
            frame = {};
          } else if (line.startsWith('id:')) {
            frame.id = line.slice(3).trim();
          } else if (line.startsWith('event:')) {
            frame.event = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            frame.data = line.slice(5).trim();
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        connected = false;
        statusMsg = 'Disconnected';
        error = `Stream error: ${err.message}`;
      }
    }
  }

  function handleEvent(evt: DemoEvent) {
    // Prepend to events list (newest first), cap at 20
    events = [evt, ...events].slice(0, 20);

    // Update agent presence
    if (evt.actor_id && DEMO_AGENTS.includes(evt.actor_id)) {
      const current = agents.get(evt.actor_id);
      agents.set(evt.actor_id, {
        agentId: evt.actor_id,
        section: (evt.payload?.section as string) ?? current?.section ?? '',
        lastSeen: Date.now(),
        fingerprint: (evt.payload?.pubkeyFingerprint as string) ?? current?.fingerprint ?? '',
      });
      // Trigger reactivity
      agents = new Map(agents);
    }

    // Capture A2A events
    if (evt.event_type === 'a2a_message_sent' || evt.event_type === 'agent_message') {
      a2aLog = [{
        from: evt.actor_id,
        to: (evt.payload?.to as string) ?? 'unknown',
        contentType: (evt.payload?.contentType as string) ?? 'application/json',
        snippet: JSON.stringify(evt.payload).slice(0, 60) + '...',
        at: evt.created_at,
      }, ...a2aLog].slice(0, 20);
    }

    // Capture BFT events
    if (evt.event_type === 'bft_approval' || evt.event_type === 'bft_vote') {
      bftVotes = [{
        voter: evt.actor_id,
        status: 'approved' as const,
        at: evt.created_at,
        sigHex: ((evt.payload?.signatureHex as string) ?? '').slice(0, 16) + '...',
      }, ...bftVotes].slice(0, 10);
      bftApprovals = bftVotes.length;
    }

    // Refresh content on new versions
    if (evt.event_type === 'version_created' || evt.event_type === 'document_updated') {
      fetchContent(slug);
      fetchDocMeta(slug);
      fetchBftStatus(slug);
    }
  }

  // ── Connect ───────────────────────────────────────────────────────────────────

  async function connect() {
    if (!slugInput.trim()) {
      error = 'Enter a document slug to observe.';
      return;
    }
    slug = slugInput.trim();
    localStorage.setItem(DEMO_SLUG_KEY, slug);
    events = [];
    a2aLog = [];
    bftVotes = [];
    bftApprovals = 0;
    agents = new Map();

    loading = true;
    await Promise.all([fetchContent(slug), fetchDocMeta(slug), fetchBftStatus(slug)]);
    loading = false;

    // Start content refresh every 10s
    if (contentRefreshTimer) clearInterval(contentRefreshTimer);
    contentRefreshTimer = setInterval(() => {
      if (slug) {
        fetchContent(slug);
        fetchDocMeta(slug);
        fetchBftStatus(slug);
      }
    }, 10_000);

    // Start SSE
    connectEventStream(slug);
  }

  function disconnect() {
    if (abortController) abortController.abort();
    if (contentRefreshTimer) clearInterval(contentRefreshTimer);
    connected = false;
    slug = '';
    statusMsg = '';
    error = '';
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  onMount(() => {
    const saved = localStorage.getItem(DEMO_SLUG_KEY);
    if (saved) slugInput = saved;
  });

  onDestroy(() => {
    if (abortController) abortController.abort();
    if (contentRefreshTimer) clearInterval(contentRefreshTimer);
  });
</script>

<svelte:head>
  <title>LLMtxt Live Demo — 4-Agent Collaboration</title>
  <meta name="description" content="Watch four AI agents collaborate on a document in real time using Ed25519 identity, CRDT merges, BFT consensus, and A2A messaging." />
</svelte:head>

<div class="min-h-screen bg-base-100 p-4 md:p-6" data-theme="night">

  <!-- Header -->
  <div class="mb-6">
    <h1 class="text-2xl font-bold font-display mb-1">
      <span class="text-primary">LLMtxt</span>
      <span class="text-base-content/70"> Live Demo</span>
    </h1>
    <p class="text-base-content/60 text-sm">
      Watch four AI agents — WriterBot, ReviewerBot, ConsensusBot, SummarizerBot — collaborate on a document in real time.
    </p>
  </div>

  <!-- Connection bar -->
  <div class="flex flex-wrap gap-2 items-center mb-6">
    <input
      class="input input-bordered input-sm flex-1 min-w-48 font-mono"
      placeholder="Document slug (e.g. abc123)"
      bind:value={slugInput}
      onkeydown={(e) => { if (e.key === 'Enter') connect(); }}
    />
    {#if !slug}
      <button class="btn btn-primary btn-sm" onclick={connect} disabled={loading}>
        {loading ? 'Connecting...' : 'Connect'}
      </button>
    {:else}
      <button class="btn btn-ghost btn-sm" onclick={disconnect}>
        Disconnect
      </button>
    {/if}

    {#if connected}
      <span class="flex items-center gap-1 text-success text-xs">
        <span class="w-2 h-2 rounded-full bg-success inline-block animate-pulse"></span>
        Live
      </span>
    {:else if slug}
      <span class="flex items-center gap-1 text-warning text-xs">
        <span class="w-2 h-2 rounded-full bg-warning inline-block"></span>
        Polling
      </span>
    {/if}

    {#if statusMsg}
      <span class="text-base-content/50 text-xs">{statusMsg}</span>
    {/if}
  </div>

  {#if error}
    <div class="alert alert-error mb-4 text-sm py-2">
      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01"/></svg>
      {error}
    </div>
  {/if}

  {#if !slug}
    <!-- Empty state -->
    <div class="text-center py-20">
      <div class="text-5xl mb-4">🤖</div>
      <h2 class="text-xl font-semibold mb-2">No document selected</h2>
      <p class="text-base-content/60 text-sm max-w-sm mx-auto">
        Enter a document slug above to observe agents collaborating, or run the demo agents locally:
      </p>
      <div class="mockup-code mt-4 text-left max-w-lg mx-auto text-xs">
        <pre data-prefix="$"><code>LLMTXT_API_KEY=your_key pnpm --filter demo start</code></pre>
      </div>
      <p class="text-base-content/50 text-xs mt-3">
        The orchestrator will print the slug to stdout.
      </p>
    </div>
  {:else}
    <!-- 5-panel grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

      <!-- Panel 1: Document content (spans 2 cols on xl) -->
      <div class="card bg-base-200 border border-base-300 xl:col-span-2">
        <div class="card-body p-4">
          <div class="flex items-center justify-between mb-3">
            <h2 class="card-title text-base font-display">
              Document
              <span class="text-base-content/50 font-mono text-xs">{slug}</span>
            </h2>
            <div class="flex items-center gap-2">
              <span class="badge badge-xs {docState === 'APPROVED' ? 'badge-success' : docState === 'REVIEW' ? 'badge-warning' : 'badge-ghost'}">
                {docState}
              </span>
              <span class="text-xs text-base-content/50">v{docVersion}</span>
            </div>
          </div>

          {#if loading}
            <div class="animate-pulse space-y-2">
              {#each [1,2,3,4] as _}
                <div class="h-3 bg-base-300 rounded"></div>
              {/each}
            </div>
          {:else if docContent}
            <pre class="text-xs font-mono bg-base-300 rounded p-3 overflow-auto max-h-80 whitespace-pre-wrap text-base-content/80">{docContent}</pre>
          {:else}
            <p class="text-base-content/40 text-sm italic">No content yet — agents are starting up.</p>
          {/if}
        </div>
      </div>

      <!-- Panel 2: Agent presence -->
      <div class="card bg-base-200 border border-base-300">
        <div class="card-body p-4">
          <h2 class="card-title text-base font-display mb-3">Agent Presence</h2>
          <div class="space-y-3">
            {#each DEMO_AGENTS as agentId}
              {@const active = isAgentActive(agentId)}
              {@const presence = agents.get(agentId)}
              <div class="flex items-center gap-3">
                <div class="relative">
                  <div class="w-9 h-9 rounded-full {agentColor(agentId)} flex items-center justify-center text-base-100 font-bold text-xs">
                    {agentLabel(agentId).slice(0, 2).toUpperCase()}
                  </div>
                  <span
                    class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-base-200
                      {active ? 'bg-success animate-pulse' : 'bg-base-300'}"
                  ></span>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium">{agentLabel(agentId)}</div>
                  <div class="text-xs text-base-content/50 truncate">
                    {#if presence}
                      {presence.section ? `editing: ${presence.section}` : 'idle'}
                      {#if presence.fingerprint}
                        · <span class="font-mono">{presence.fingerprint.slice(0, 8)}</span>
                      {/if}
                    {:else}
                      not yet seen
                    {/if}
                  </div>
                </div>
                <span class="badge badge-xs {active ? 'badge-success' : 'badge-ghost'}">
                  {active ? 'active' : 'offline'}
                </span>
              </div>
            {/each}
          </div>
        </div>
      </div>

      <!-- Panel 3: Event feed -->
      <div class="card bg-base-200 border border-base-300">
        <div class="card-body p-4">
          <h2 class="card-title text-base font-display mb-3">
            Event Feed
            {#if events.length > 0}
              <span class="badge badge-sm badge-primary">{events.length}</span>
            {/if}
          </h2>
          {#if events.length === 0}
            <p class="text-base-content/40 text-xs italic">No events yet. Waiting for agent activity...</p>
          {:else}
            <ul class="space-y-2 overflow-auto max-h-64">
              {#each events as evt (evt.id ?? evt.seq)}
                <li class="flex flex-col gap-0.5 border-b border-base-300 pb-2 last:border-0">
                  <div class="flex items-center gap-2">
                    <span class="badge badge-xs {eventBadgeClass(evt.event_type)}">{eventLabel(evt.event_type)}</span>
                    <span class="text-xs text-base-content/50">{formatTime(evt.created_at)}</span>
                  </div>
                  <div class="text-xs text-base-content/70">
                    <span class="font-mono">{evt.actor_id}</span>
                    {#if evt.payload?.section}
                      · section: {evt.payload.section}
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>

      <!-- Panel 4: BFT approval progress -->
      <div class="card bg-base-200 border border-base-300">
        <div class="card-body p-4">
          <h2 class="card-title text-base font-display mb-3">BFT Consensus</h2>

          <!-- Quorum progress bar -->
          <div class="mb-3">
            <div class="flex justify-between text-xs text-base-content/60 mb-1">
              <span>Approvals</span>
              <span>{bftApprovals} / {bftQuorum} quorum</span>
            </div>
            <progress
              class="progress progress-success w-full"
              value={bftApprovals}
              max={Math.max(bftQuorum, 1)}
            ></progress>
            {#if bftApprovals >= bftQuorum && bftQuorum > 0}
              <p class="text-success text-xs mt-1 font-semibold">Quorum reached!</p>
            {:else}
              <p class="text-base-content/50 text-xs mt-1">Waiting for {bftQuorum} approval(s)...</p>
            {/if}
          </div>

          <!-- Vote list -->
          {#if bftVotes.length === 0}
            <p class="text-base-content/40 text-xs italic">No votes yet.</p>
          {:else}
            <ul class="space-y-2 overflow-auto max-h-40">
              {#each bftVotes as vote}
                <li class="flex items-center gap-2 text-xs">
                  <span class="badge badge-xs badge-success">approved</span>
                  <span class="font-mono text-base-content/70">{vote.voter}</span>
                  <span class="text-base-content/40">{formatTime(vote.at)}</span>
                  {#if vote.sigHex}
                    <span class="font-mono text-base-content/30">{vote.sigHex}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>

      <!-- Panel 5: A2A message log -->
      <div class="card bg-base-200 border border-base-300">
        <div class="card-body p-4">
          <h2 class="card-title text-base font-display mb-3">
            A2A Messages
            {#if a2aLog.length > 0}
              <span class="badge badge-sm badge-secondary">{a2aLog.length}</span>
            {/if}
          </h2>
          {#if a2aLog.length === 0}
            <p class="text-base-content/40 text-xs italic">
              No A2A messages captured yet. Messages appear when agents send inter-agent requests.
            </p>
            <p class="text-base-content/30 text-xs mt-1">
              Note: A2A events are only emitted if the backend publishes them to the event stream.
            </p>
          {:else}
            <ul class="space-y-2 overflow-auto max-h-64">
              {#each a2aLog as msg}
                <li class="border-b border-base-300 pb-2 last:border-0">
                  <div class="flex items-center gap-1 text-xs mb-0.5">
                    <span class="font-mono text-primary">{agentLabel(msg.from) || msg.from}</span>
                    <span class="text-base-content/40">→</span>
                    <span class="font-mono text-secondary">{agentLabel(msg.to) || msg.to}</span>
                    <span class="text-base-content/40 ml-auto">{formatTime(msg.at)}</span>
                  </div>
                  <div class="text-xs text-base-content/60 font-mono truncate">{msg.snippet}</div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>

    </div>

    <!-- Footer link -->
    <div class="mt-6 text-center text-xs text-base-content/40">
      <a href="/doc/{slug}" class="hover:text-primary transition-colors">View full document page</a>
      ·
      <a href="https://docs.llmtxt.my/docs/multi-agent/live-demo" target="_blank" rel="noopener" class="hover:text-primary transition-colors">
        Read the docs
      </a>
    </div>
  {/if}
</div>
