/**
 * LeaseManager SDK — T285.
 *
 * Wraps the REST endpoints for advisory section leases:
 *   POST   /api/v1/documents/:slug/sections/:sid/lease   acquire
 *   GET    /api/v1/documents/:slug/sections/:sid/lease   status
 *   DELETE /api/v1/documents/:slug/sections/:sid/lease   release
 *   PATCH  /api/v1/documents/:slug/sections/:sid/lease   renew
 *
 * Leases are ADVISORY — the CRDT layer still accepts writes from non-holders.
 * 409 is a social signal, not a hard lock.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface Lease {
  leaseId: string;
  holder: string;
  expiresAt: string; // ISO8601
}

export interface LeaseOptions {
  baseUrl: string;
  apiKey: string;
}

// ── Error class ───────────────────────────────────────────────────────────────

/**
 * Thrown by LeaseManager.acquire() when the section is already held.
 */
export class LeaseConflictError extends Error {
  readonly holder: string;
  readonly expiresAt: string;

  constructor(holder: string, expiresAt: string) {
    super(`Section is already leased by ${holder} until ${expiresAt}`);
    this.name = 'LeaseConflictError';
    this.holder = holder;
    this.expiresAt = expiresAt;
  }
}

// ── LeaseManager ──────────────────────────────────────────────────────────────

export class LeaseManager {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  // Active lease state (set after acquire)
  private _leaseId: string | null = null;
  private _expiresAt: string | null = null;
  private _slug: string | null = null;
  private _sectionId: string | null = null;
  private _autoRenewTimer: ReturnType<typeof setInterval> | null = null;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private leaseUrl(slug: string, sectionId: string): string {
    return `${this.baseUrl}/api/v1/documents/${encodeURIComponent(slug)}/sections/${encodeURIComponent(sectionId)}/lease`;
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Acquire an advisory lease on a section.
   *
   * @param slug            Document slug.
   * @param sectionId       Section identifier.
   * @param durationSeconds Lease TTL in seconds (1–300).
   * @param reason          Optional human-readable reason.
   * @returns               Acquired Lease.
   * @throws                LeaseConflictError if the section is already held.
   */
  async acquire(slug: string, sectionId: string, durationSeconds: number, reason?: string): Promise<Lease> {
    const url = this.leaseUrl(slug, sectionId);
    const body: Record<string, unknown> = { leaseDurationSeconds: durationSeconds };
    if (reason !== undefined) body.reason = reason;

    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (res.status === 409) {
      const data = await res.json() as { holder?: string; expiresAt?: string };
      throw new LeaseConflictError(data.holder ?? 'unknown', data.expiresAt ?? '');
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`acquire failed: ${res.status} ${text}`);
    }

    const data = await res.json() as Lease;
    this._leaseId = data.leaseId;
    this._expiresAt = data.expiresAt;
    this._slug = slug;
    this._sectionId = sectionId;
    return data;
  }

  /**
   * Release the currently held lease.
   */
  async release(): Promise<void> {
    if (!this._slug || !this._sectionId) return;
    this.stopAutoRenew();

    const url = this.leaseUrl(this._slug, this._sectionId);
    const res = await fetch(url, {
      method: 'DELETE',
      headers: this.headers(),
    });

    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`release failed: ${res.status} ${text}`);
    }

    this._leaseId = null;
    this._expiresAt = null;
    this._slug = null;
    this._sectionId = null;
  }

  /**
   * Renew the currently held lease.
   *
   * @param durationSeconds New TTL in seconds.
   * @returns               Updated Lease.
   */
  async renew(durationSeconds: number): Promise<Lease> {
    if (!this._slug || !this._sectionId) {
      throw new Error('No active lease to renew');
    }

    const url = this.leaseUrl(this._slug, this._sectionId);
    const res = await fetch(url, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({ leaseDurationSeconds: durationSeconds }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`renew failed: ${res.status} ${text}`);
    }

    const data = await res.json() as Lease;
    this._expiresAt = data.expiresAt;
    return data;
  }

  /**
   * Start an auto-renew loop. Renews the lease when time-to-expiry drops
   * below thresholdSeconds.
   *
   * @param thresholdSeconds  Renew when TTL < this value (default: 10s).
   */
  startAutoRenew(thresholdSeconds = 10): void {
    if (this._autoRenewTimer !== null) return;
    const durationSeconds = 60; // default renewal duration
    this._autoRenewTimer = setInterval(() => {
      if (!this._expiresAt) return;
      const expiresMs = new Date(this._expiresAt).getTime();
      const remainingMs = expiresMs - Date.now();
      if (remainingMs < thresholdSeconds * 1000) {
        this.renew(durationSeconds).catch(() => {
          // Non-fatal: caller is responsible for re-acquiring on expiry
        });
      }
    }, 1000);
  }

  /**
   * Stop the auto-renew loop.
   */
  stopAutoRenew(): void {
    if (this._autoRenewTimer !== null) {
      clearInterval(this._autoRenewTimer);
      this._autoRenewTimer = null;
    }
  }

  /** The current lease ID, or null if no lease is held. */
  get leaseId(): string | null {
    return this._leaseId;
  }

  /** The current expiry timestamp (ISO8601), or null. */
  get expiresAt(): string | null {
    return this._expiresAt;
  }
}
