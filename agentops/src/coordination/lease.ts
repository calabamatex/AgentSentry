/**
 * lease.ts — Lease-based resource management for AgentOps coordination.
 *
 * [experimental] Single-machine, event-sourced coordination primitives.
 *
 * Provides:
 *  - Lease acquisition with TTL and automatic expiry
 *  - Lease renewal (extend before expiry)
 *  - Fencing tokens for preventing stale operations
 *  - Consistency guarantees documented inline
 *
 * Consistency model:
 *   - Best-effort, single-machine, single-process
 *   - No distributed consensus — leases are stored as append-only events
 *   - Race conditions are possible under high concurrency (no CAS/compare-and-swap)
 *   - Fencing tokens allow downstream systems to reject stale operations
 *   - Lease expiry is checked at read time, not enforced by a background reaper
 *
 * Failure modes:
 *   - Process crash: all leases expire naturally via TTL
 *   - Clock skew: not handled (single machine assumption)
 *   - Memory store failure: lease operations throw, caller must handle
 */

import { MemoryStore } from '../memory/store';
import type { OpsEventInput } from '../memory/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Lease {
  /** Unique lease identifier. */
  leaseId: string;
  /** Resource being leased. */
  resource: string;
  /** Agent holding the lease. */
  holder: string;
  /** Monotonically increasing fencing token. */
  fencingToken: number;
  /** When the lease was acquired (ISO 8601). */
  acquiredAt: string;
  /** When the lease expires (ISO 8601). */
  expiresAt: string;
  /** Number of times this lease has been renewed. */
  renewCount: number;
}

export interface LeaseManagerOptions {
  store: MemoryStore;
  /** Default lease TTL in milliseconds (default: 60000). */
  defaultTtlMs?: number;
  /**
   * Maximum number of renewals before a lease must be re-acquired (default: 10).
   * A value of N allows exactly N successful renew() calls. The (N+1)th call returns null.
   */
  maxRenewals?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_ID = 'coordination';
const TAG_LEASE = 'coordination:lease';

// ---------------------------------------------------------------------------
// LeaseManager
// ---------------------------------------------------------------------------

export class LeaseManager {
  private store: MemoryStore;
  private defaultTtlMs: number;
  private maxRenewals: number;

  /**
   * Monotonic fencing token counter.
   * Starts at Date.now() to ensure tokens are globally ordered even across
   * process restarts (assuming no backward clock jumps).
   */
  private nextFencingToken: number;

  constructor(options: LeaseManagerOptions) {
    this.store = options.store;
    this.defaultTtlMs = options.defaultTtlMs ?? 60_000;
    this.maxRenewals = options.maxRenewals ?? 10;
    this.nextFencingToken = Date.now();
  }

  /**
   * Acquire a lease on a resource.
   *
   * If the resource is already leased by another holder and the lease
   * has not expired, acquisition fails (returns null).
   *
   * If the resource is leased by the same holder, this is treated as
   * a renewal (re-entrant).
   */
  async acquire(
    resource: string,
    holder: string,
    ttlMs?: number,
  ): Promise<Lease | null> {
    const existing = await this.get(resource);

    // Resource is held by someone else and not expired
    if (existing && existing.holder !== holder) {
      return null;
    }

    // Re-entrant: same holder, treat as renewal
    if (existing && existing.holder === holder) {
      return this.renew(resource, holder, ttlMs);
    }

    const now = new Date();
    const ttl = ttlMs ?? this.defaultTtlMs;
    const fencingToken = this.nextFencingToken++;

    const lease: Lease = {
      leaseId: `${resource}:${fencingToken}`,
      resource,
      holder,
      fencingToken,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl).toISOString(),
      renewCount: 0,
    };

    await this.store.capture(this.buildLeaseEvent(lease, 'acquire'));
    return lease;
  }

  /**
   * Renew an existing lease, extending its TTL.
   *
   * Returns null if:
   *  - No active lease exists for this resource
   *  - The holder doesn't match
   *  - Max renewals exceeded (must release and re-acquire)
   */
  async renew(
    resource: string,
    holder: string,
    ttlMs?: number,
  ): Promise<Lease | null> {
    const existing = await this.get(resource);
    if (!existing || existing.holder !== holder) {
      return null;
    }

    if (existing.renewCount >= this.maxRenewals) {
      return null;
    }

    const now = new Date();
    const ttl = ttlMs ?? this.defaultTtlMs;

    const renewed: Lease = {
      ...existing,
      expiresAt: new Date(now.getTime() + ttl).toISOString(),
      renewCount: existing.renewCount + 1,
    };

    await this.store.capture(this.buildLeaseEvent(renewed, 'renew'));
    return renewed;
  }

  /**
   * Release a lease. Only the holder can release their own lease.
   */
  async release(resource: string, holder: string): Promise<boolean> {
    const existing = await this.get(resource);
    if (!existing || existing.holder !== holder) {
      return false;
    }

    await this.store.capture(this.buildLeaseEvent(existing, 'release'));
    return true;
  }

  /**
   * Get the current active lease for a resource, or null if none/expired.
   */
  async get(resource: string): Promise<Lease | null> {
    const events = await this.store.list({
      tag: TAG_LEASE,
      event_type: 'decision',
      skill: 'system',
      limit: 500,
    });

    let latest: { lease: Lease; action: string; ts: string } | null = null;

    for (const evt of events) {
      const meta = evt.metadata as Record<string, unknown>;
      const lease = meta.lease as Lease | undefined;
      const action = meta.action as string | undefined;
      if (!lease || lease.resource !== resource) continue;

      if (
        !latest ||
        evt.timestamp > latest.ts ||
        (evt.timestamp === latest.ts && action === 'release')
      ) {
        latest = { lease, action: action ?? '', ts: evt.timestamp };
      }
    }

    if (!latest || latest.action === 'release') return null;

    // Check expiry
    if (new Date(latest.lease.expiresAt).getTime() < Date.now()) {
      return null;
    }

    return latest.lease;
  }

  /**
   * Validate a fencing token against the current lease.
   *
   * Returns true if the token is >= the current lease's fencing token,
   * meaning the operation is not stale. Returns false if a newer lease
   * has been issued (the token is outdated).
   *
   * This enables downstream systems to reject operations from holders
   * whose lease has been superseded.
   */
  async validateFencingToken(resource: string, token: number): Promise<boolean> {
    const current = await this.get(resource);
    if (!current) {
      // No active lease — token is acceptable
      return true;
    }
    return token >= current.fencingToken;
  }

  /**
   * List all active (non-expired, non-released) leases.
   */
  async listActive(): Promise<Lease[]> {
    const events = await this.store.list({
      tag: TAG_LEASE,
      event_type: 'decision',
      skill: 'system',
      limit: 1000,
    });

    const byResource = new Map<string, { lease: Lease; action: string; ts: string }>();
    const now = Date.now();

    for (const evt of events) {
      const meta = evt.metadata as Record<string, unknown>;
      const lease = meta.lease as Lease | undefined;
      const action = meta.action as string | undefined;
      if (!lease) continue;

      const existing = byResource.get(lease.resource);
      if (
        !existing ||
        evt.timestamp > existing.ts ||
        (evt.timestamp === existing.ts && action === 'release')
      ) {
        byResource.set(lease.resource, { lease, action: action ?? '', ts: evt.timestamp });
      }
    }

    const active: Lease[] = [];
    for (const { lease, action } of byResource.values()) {
      if (action === 'release') continue;
      if (new Date(lease.expiresAt).getTime() < now) continue;
      active.push(lease);
    }

    return active;
  }

  private buildLeaseEvent(
    lease: Lease,
    action: 'acquire' | 'renew' | 'release',
  ): OpsEventInput {
    return {
      timestamp: new Date().toISOString(),
      session_id: SESSION_ID,
      agent_id: lease.holder,
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: `lease:${action}:${lease.resource}`,
      detail: `Lease ${action} on ${lease.resource} by ${lease.holder} (fence=${lease.fencingToken})`,
      affected_files: [],
      tags: [TAG_LEASE],
      metadata: { lease, action },
    };
  }
}
