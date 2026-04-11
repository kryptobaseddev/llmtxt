/**
 * API client for the llmtxt Fastify backend.
 */
const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.llmtxt.my';

async function request<T>(path: string, options?: RequestInit, responseType: 'json' | 'text' = 'json'): Promise<T> {
  const headers: Record<string, string> = { ...options?.headers as Record<string, string> };
  if (options?.body) {
    headers['Content-Type'] ??= 'application/json';
  }
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers,
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.message || err.error || `${res.status} ${res.statusText}`);
  }
  return responseType === 'text' ? res.text() as Promise<T> : res.json();
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
