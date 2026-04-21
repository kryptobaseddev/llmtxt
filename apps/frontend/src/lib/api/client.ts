/**
 * API client for the llmtxt Fastify backend.
 */
// API_BASE is sourced from Vite at build time, with a Node-safe fallback so
// the module can be imported under node:test without `import.meta.env` being
// defined. Order: Vite env > Node env > production default.
const API_BASE: string =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta & { env?: { VITE_API_BASE?: string } }).env
      ?.VITE_API_BASE) ||
  (typeof process !== 'undefined' && process.env?.VITE_API_BASE) ||
  'https://api.llmtxt.my';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// CSRF token cache. The backend (@fastify/csrf-protection) sets an httpOnly
// secret cookie when GET /api/csrf-token is hit, and returns the matching
// token in the body. We must echo that token in the `x-csrf-token` header on
// every cookie-authenticated state-changing request, otherwise the backend
// rejects with FST_CSRF_MISSING_SECRET.
let csrfToken: string | null = null;
let csrfTokenInflight: Promise<string> | null = null;

/** Test-only: clears the cached CSRF token. Not exported from the package barrel. */
export function __resetCsrfCacheForTesting(): void {
  csrfToken = null;
  csrfTokenInflight = null;
}

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/csrf-token`, { credentials: 'include' });
  if (!res.ok) throw new Error(`CSRF token fetch failed: ${res.status}`);
  const data = (await res.json()) as { csrfToken: string };
  return data.csrfToken;
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (!csrfTokenInflight) {
    csrfTokenInflight = fetchCsrfToken()
      .then((t) => {
        csrfToken = t;
        return t;
      })
      .finally(() => {
        csrfTokenInflight = null;
      });
  }
  return csrfTokenInflight;
}

function isCsrfError(status: number, body: { code?: string; message?: string } | null): boolean {
  if (status !== 403) return false;
  if (body?.code && body.code.startsWith('FST_CSRF')) return true;
  return /csrf/i.test(body?.message ?? '');
}

async function request<T>(path: string, options?: RequestInit, responseType: 'json' | 'text' = 'json'): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase();
  const needsCsrf = STATE_CHANGING_METHODS.has(method) && !path.startsWith('/auth/');

  const buildHeaders = async (): Promise<Record<string, string>> => {
    const h: Record<string, string> = { ...(options?.headers as Record<string, string>) };
    if (options?.body) h['Content-Type'] ??= 'application/json';
    if (needsCsrf) {
      try {
        h['x-csrf-token'] ??= await getCsrfToken();
      } catch {
        // fall through — backend will respond 403 if it really required it,
        // and we'll surface that error normally.
      }
    }
    return h;
  };

  const send = async (headers: Record<string, string>) =>
    fetch(`${API_BASE}${path}`, { credentials: 'include', headers, ...options });

  let res = await send(await buildHeaders());

  // If CSRF rejected (e.g., backend rotated the secret or our cache is stale),
  // drop the cached token, fetch a fresh one, and retry exactly once.
  if (needsCsrf && res.status === 403) {
    const errBody = await res.clone().json().catch(() => null);
    if (isCsrfError(res.status, errBody)) {
      csrfToken = null;
      const retryHeaders = await buildHeaders();
      if (retryHeaders['x-csrf-token']) {
        res = await send(retryHeaders);
      }
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.message || err.error || `${res.status} ${res.statusText}`);
  }
  return responseType === 'text' ? (res.text() as Promise<T>) : res.json();
}

// Merge types
export interface MergeSource {
  version: number;
  lineRanges?: Array<[number, number]>;
  sections?: string[];
}

export interface MergeRequest {
  sources: MergeSource[];
  fillFrom: number;
  changelog?: string;
  createdBy?: string;
  preview?: boolean;
}

export interface MergeProvenanceLine {
  lineStart: number;
  lineEnd: number;
  fromVersion: number;
  fillFrom?: boolean;
}

export interface MergeResult {
  slug: string;
  version?: number;
  content: string;
  provenance: MergeProvenanceLine[];
  stats: { totalLines: number; sourcesUsed: number };
  preview?: boolean;
}

// Documents
export const api = {
  // Core
  createDocument: (content: string, format = 'text') =>
    request<any>('/compress', { method: 'POST', body: JSON.stringify({ content, format }) }),
  getDocument: (slug: string) => request<any>(`/documents/${slug}`),
  getRawContent: (slug: string) =>
    request<string>(`/documents/${slug}/raw`, undefined, 'text'),
  getStats: (slug: string) => request<any>(`/documents/${slug}/stats`),

  // Progressive Disclosure
  getOverview: (slug: string) => request<any>(`/documents/${slug}/overview`),
  getSection: (slug: string, name: string) =>
    request<any>(`/documents/${slug}/sections/${encodeURIComponent(name)}`),
  search: (slug: string, q: string) =>
    request<any>(`/documents/${slug}/search?q=${encodeURIComponent(q)}`),
  getToc: (slug: string) => request<any>(`/documents/${slug}/toc`),

  // Versioning
  getVersions: (slug: string) => request<any>(`/documents/${slug}/versions`),
  getVersion: (slug: string, num: number) => request<any>(`/documents/${slug}/versions/${num}`),
  getDiff: (slug: string, from: number, to: number) =>
    request<any>(`/documents/${slug}/diff?from=${from}&to=${to}`),
  submitPatch: (slug: string, patchText: string, changelog: string) =>
    request<any>(`/documents/${slug}/patch`, {
      method: 'POST',
      body: JSON.stringify({ patchText, changelog }),
    }),
  updateDocument: (slug: string, content: string, changelog: string) =>
    request<any>(`/documents/${slug}`, {
      method: 'PUT',
      body: JSON.stringify({ content, changelog }),
    }),
  getBatchVersions: (slug: string, versionNumbers: number[]) =>
    request<any>(`/documents/${slug}/batch-versions`, {
      method: 'POST',
      body: JSON.stringify({ versions: versionNumbers }),
    }),
  getMultiDiff: (slug: string, versions: number[]) =>
    request<any>(`/documents/${slug}/multi-diff?versions=${versions.join(',')}`),

  // Lifecycle
  transition: (slug: string, state: string, reason?: string) =>
    request<any>(`/documents/${slug}/transition`, {
      method: 'POST',
      body: JSON.stringify({ state, reason }),
    }),

  // Consensus
  approve: (slug: string, comment?: string) =>
    request<any>(`/documents/${slug}/approve`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }),
  reject: (slug: string, comment: string) =>
    request<any>(`/documents/${slug}/reject`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }),
  getApprovals: (slug: string) => request<any>(`/documents/${slug}/approvals`),

  // Attribution
  getContributors: (slug: string) => request<any>(`/documents/${slug}/contributors`),

  // Similarity
  findSimilar: (slug: string, q: string) =>
    request<any>(`/documents/${slug}/similar?q=${encodeURIComponent(q)}`),

  // Graph
  getGraph: (slug: string) => request<any>(`/documents/${slug}/graph`),

  // Retrieval Planning
  planRetrieval: (slug: string, tokenBudget: number, query?: string) =>
    request<any>(`/documents/${slug}/plan-retrieval`, {
      method: 'POST',
      body: JSON.stringify({ tokenBudget, query }),
    }),

  // Merge (cherry-pick)
  previewMerge: (slug: string, body: MergeRequest) =>
    request<MergeResult>(`/documents/${slug}/merge`, {
      method: 'POST',
      body: JSON.stringify({ ...body, preview: true }),
    }),
  createMerge: (slug: string, body: MergeRequest) =>
    request<MergeResult>(`/documents/${slug}/merge`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Dashboard
  getMyDocuments: () => request<any>('/documents/mine'),

  // Auth
  getSession: () => request<any>('/auth/get-session').catch(() => null),
  signInAnonymous: () => request<any>('/auth/sign-in/anonymous', { method: 'POST', body: '{}' }),
  signUp: (email: string, password: string, name?: string) =>
    request<any>('/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),
  signIn: (email: string, password: string) =>
    request<any>('/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  signOut: () => request<any>('/auth/sign-out', { method: 'POST' }),
};
