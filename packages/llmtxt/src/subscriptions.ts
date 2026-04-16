/**
 * Differential subscriptions SDK — T301 / T302.
 *
 * subscribe(): Open an SSE stream to GET /api/v1/subscribe?path=<pattern>
 *   and invoke onEvent for each matching event. Supports Last-Event-ID resume.
 *
 * fetchSectionDelta(): Poll GET /api/v1/documents/:slug/sections/:name?since=N
 *   and return a typed SectionDelta response.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Section-level delta returned by fetchSectionDelta and included in diff-mode SSE payloads.
 */
export interface SectionDelta {
  added: string[];
  modified: Array<{ name: string; content: string }>;
  deleted: string[];
  fromSeq: number;
  toSeq: number;
}

export interface SectionDeltaResponse {
  delta: SectionDelta | null;
  currentSeq: number;
}

export interface SubscribeOptions {
  /** Resume from a specific sequence number (sent as Last-Event-ID). */
  since?: number;
  /** 'events' = raw event payloads; 'diff' = payloads include computed content diffs. */
  mode?: 'events' | 'diff';
  /** Base URL of the API (no trailing slash). */
  baseUrl: string;
  /** Bearer API key. */
  apiKey: string;
}

export interface SubscriptionEvent {
  /** Monotonic sequence number (from Last-Event-ID). */
  seq: number;
  /** Event type string (e.g. 'version.published', 'SECTION_LEASED'). */
  type: string;
  /** The path pattern the subscription was opened with. */
  path: string;
  /** Raw event payload. */
  payload: unknown;
  /** Section-level delta, present when mode='diff' and the server computed one. */
  delta?: SectionDelta;
}

/** Call to close the SSE subscription. */
export type Unsubscribe = () => void;

// ── subscribe ─────────────────────────────────────────────────────────────────

/**
 * Open a differential SSE subscription.
 *
 * Compatible with both browser (EventSource) and Node.js (via the `eventsource`
 * npm polyfill, automatically detected).
 *
 * @param pathPattern  URL pattern to match (e.g. '/docs/:slug', '/docs/*').
 * @param options      Connection options including baseUrl, apiKey, and mode.
 * @param onEvent      Callback invoked for each matching event.
 * @returns            Unsubscribe function; call it to close the connection.
 */
export function subscribe(
  pathPattern: string,
  options: SubscribeOptions,
  onEvent: (event: SubscriptionEvent) => void,
): Unsubscribe {
  const { baseUrl, apiKey, mode, since } = options;

  // Build URL
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/api/v1/subscribe`);
  url.searchParams.set('path', pathPattern);
  if (since !== undefined) url.searchParams.set('since', String(since));

  // Determine Accept header
  const acceptHeader = mode === 'diff'
    ? 'application/vnd.llmtxt.diff+json'
    : 'application/json';

  // EventSource does not support custom headers in the browser. For now,
  // pass the API key as a query parameter (same pattern as WS auth).
  // In Node.js, we can use the eventsource package which supports headers.
  url.searchParams.set('token', apiKey);

  let es: EventSource | null = null;
  let closed = false;

  function open(): void {
    if (closed) return;

    // Try to use EventSource (browser-native or eventsource polyfill)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ESClass: typeof EventSource = (typeof EventSource !== 'undefined')
      ? EventSource
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : (globalThis as any).EventSource;

    if (!ESClass) {
      throw new Error('EventSource is not available. Install the eventsource npm package for Node.js.');
    }

    es = new ESClass(url.toString(), {
      // eventsource polyfill supports withCredentials
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headers: { Authorization: `Bearer ${apiKey}`, Accept: acceptHeader },
    } as EventSourceInit);

    es.onmessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data as string) as unknown;
        const seqStr = event.lastEventId;
        const seq = seqStr ? parseInt(seqStr, 10) : 0;
        const eventType = event.type !== 'message' ? event.type : 'message';

        // Extract delta if present in payload
        let delta: SectionDelta | undefined;
        if (payload && typeof payload === 'object' && 'delta' in payload) {
          delta = (payload as { delta?: SectionDelta }).delta;
        }

        onEvent({
          seq,
          type: eventType,
          path: pathPattern,
          payload,
          ...(delta !== undefined ? { delta } : {}),
        });
      } catch {
        // Malformed event — ignore
      }
    };

    // Also handle named events (the server emits 'event: <type>')
    // EventSource fires named events as separate event listeners.
    // Since we cannot enumerate all event types ahead of time, the server
    // should emit as `data:` only (default message event) for broadest compat.
  }

  open();

  return () => {
    closed = true;
    if (es) {
      es.close();
      es = null;
    }
  };
}

// ── fetchSectionDelta ─────────────────────────────────────────────────────────

/**
 * Fetch a section delta since a given sequence number.
 *
 * Calls GET /api/v1/documents/:slug/sections/:name?since=<since> and returns
 * a typed SectionDeltaResponse. Store currentSeq and pass it as `since` on
 * the next poll to achieve incremental updates.
 *
 * @param slug     Document slug.
 * @param name     Section name.
 * @param since    Last known sequence number (use 0 for the first fetch).
 * @param options  Connection options.
 */
export async function fetchSectionDelta(
  slug: string,
  name: string,
  since: number,
  options: { baseUrl: string; apiKey: string },
): Promise<SectionDeltaResponse> {
  const { baseUrl, apiKey } = options;
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/documents/${encodeURIComponent(slug)}/sections/${encodeURIComponent(name)}?since=${since}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fetchSectionDelta failed: ${res.status} ${text}`);
  }

  const data = await res.json() as SectionDeltaResponse;
  return data;
}
