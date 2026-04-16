/**
 * Admin store — holds admin auth state and observability config.
 *
 * Responsibilities:
 *   - Verify the current user has admin access (GET /api/v1/admin/me)
 *   - Fetch observability tool URLs (GET /api/v1/admin/config)
 *
 * This store is initialised on-demand in /admin/+layout.svelte.
 */
const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.llmtxt.my';

export interface AdminConfig {
  grafana: string | null;
  prometheus: string | null;
  glitchtip: string | null;
  loki: string | null;
  tempo: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

let adminUser = $state<AdminUser | null>(null);
let adminConfig = $state<AdminConfig | null>(null);
let adminLoading = $state(true);
let adminError = $state<string | null>(null);

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.message || err.error || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function getAdmin() {
  return {
    get user() { return adminUser; },
    get config() { return adminConfig; },
    get loading() { return adminLoading; },
    get error() { return adminError; },
    get isAdmin() { return adminUser?.isAdmin === true; },

    async init() {
      adminLoading = true;
      adminError = null;
      try {
        const [me, cfg] = await Promise.all([
          apiFetch<AdminUser>('/v1/admin/me'),
          apiFetch<AdminConfig>('/v1/admin/config'),
        ]);
        adminUser = me;
        adminConfig = cfg;
      } catch (e) {
        adminError = e instanceof Error ? e.message : 'Admin access denied';
        adminUser = null;
      } finally {
        adminLoading = false;
      }
    },

    reset() {
      adminUser = null;
      adminConfig = null;
      adminLoading = true;
      adminError = null;
    },
  };
}
