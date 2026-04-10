import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LeaseManager } from '../../src/coordination/lease';
import type { Lease } from '../../src/coordination/lease';
import type { OpsEvent, OpsEventInput } from '../../src/memory/schema';

function createMockStore() {
  const events: OpsEvent[] = [];
  return {
    events,
    capture: vi.fn(async (input: OpsEventInput): Promise<OpsEvent> => {
      const event: OpsEvent = {
        ...input,
        id: `evt-${events.length}`,
        hash: 'h' + events.length,
        prev_hash: events.length > 0 ? 'h' + (events.length - 1) : '0'.repeat(64),
      };
      events.push(event);
      return event;
    }),
    list: vi.fn(async () => [...events].reverse()),
    initialize: vi.fn(),
  };
}

describe('LeaseManager', () => {
  let store: ReturnType<typeof createMockStore>;
  let manager: LeaseManager;

  beforeEach(() => {
    store = createMockStore();
    manager = new LeaseManager({
      store: store as any,
      defaultTtlMs: 60_000,
      maxRenewals: 3,
    });
  });

  describe('acquire', () => {
    it('acquires a lease on an uncontested resource', async () => {
      const lease = await manager.acquire('file:main.ts', 'agent-1');

      expect(lease).not.toBeNull();
      expect(lease!.resource).toBe('file:main.ts');
      expect(lease!.holder).toBe('agent-1');
      expect(lease!.fencingToken).toBeGreaterThan(0);
      expect(lease!.renewCount).toBe(0);
    });

    it('returns null when resource is held by another agent', async () => {
      await manager.acquire('file:main.ts', 'agent-1');
      const lease = await manager.acquire('file:main.ts', 'agent-2');

      expect(lease).toBeNull();
    });

    it('treats re-acquisition by same holder as renewal', async () => {
      const first = await manager.acquire('file:main.ts', 'agent-1');
      const second = await manager.acquire('file:main.ts', 'agent-1');

      expect(second).not.toBeNull();
      expect(second!.renewCount).toBe(first!.renewCount + 1);
    });

    it('uses custom TTL when provided', async () => {
      const lease = await manager.acquire('res', 'agent-1', 5000);

      expect(lease).not.toBeNull();
      const expiresAt = new Date(lease!.expiresAt).getTime();
      const acquiredAt = new Date(lease!.acquiredAt).getTime();
      // TTL should be ~5000ms (allow some tolerance)
      expect(expiresAt - acquiredAt).toBeLessThanOrEqual(5100);
      expect(expiresAt - acquiredAt).toBeGreaterThanOrEqual(4900);
    });

    it('allows acquisition after previous lease expires', async () => {
      // Acquire with a very short TTL
      const mgr = new LeaseManager({
        store: store as any,
        defaultTtlMs: 1, // 1ms TTL
        maxRenewals: 3,
      });

      await mgr.acquire('res', 'agent-1');
      // Wait for expiry
      await new Promise((r) => setTimeout(r, 10));

      const lease = await mgr.acquire('res', 'agent-2');
      expect(lease).not.toBeNull();
      expect(lease!.holder).toBe('agent-2');
    });

    it('stores an acquire event in the memory store', async () => {
      await manager.acquire('file:a.ts', 'agent-1');

      expect(store.capture).toHaveBeenCalledTimes(1);
      const input = store.capture.mock.calls[0][0] as OpsEventInput;
      expect(input.tags).toContain('coordination:lease');
      expect((input.metadata as any).action).toBe('acquire');
    });

    it('generates unique lease IDs', async () => {
      const l1 = await manager.acquire('res-a', 'agent-1');
      const l2 = await manager.acquire('res-b', 'agent-1');

      expect(l1!.leaseId).not.toBe(l2!.leaseId);
    });
  });

  describe('renew', () => {
    it('extends the lease TTL', async () => {
      const original = await manager.acquire('res', 'agent-1');
      const renewed = await manager.renew('res', 'agent-1');

      expect(renewed).not.toBeNull();
      expect(renewed!.renewCount).toBe(1);
      expect(new Date(renewed!.expiresAt).getTime())
        .toBeGreaterThanOrEqual(new Date(original!.expiresAt).getTime());
    });

    it('returns null for non-existent lease', async () => {
      const result = await manager.renew('nonexistent', 'agent-1');
      expect(result).toBeNull();
    });

    it('returns null when holder does not match', async () => {
      await manager.acquire('res', 'agent-1');
      const result = await manager.renew('res', 'agent-2');
      expect(result).toBeNull();
    });

    it('returns null when max renewals exceeded', async () => {
      await manager.acquire('res', 'agent-1');

      // Renew 3 times (maxRenewals = 3)
      for (let i = 0; i < 3; i++) {
        const r = await manager.renew('res', 'agent-1');
        expect(r).not.toBeNull();
      }

      // 4th renewal should fail
      const result = await manager.renew('res', 'agent-1');
      expect(result).toBeNull();
    });

    it('increments renewCount on each renewal', async () => {
      await manager.acquire('res', 'agent-1');

      const r1 = await manager.renew('res', 'agent-1');
      expect(r1!.renewCount).toBe(1);

      const r2 = await manager.renew('res', 'agent-1');
      expect(r2!.renewCount).toBe(2);
    });
  });

  describe('release', () => {
    it('releases a held lease', async () => {
      await manager.acquire('res', 'agent-1');
      const released = await manager.release('res', 'agent-1');
      expect(released).toBe(true);
    });

    it('returns false when releasing a non-existent lease', async () => {
      const result = await manager.release('nonexistent', 'agent-1');
      expect(result).toBe(false);
    });

    it('returns false when holder does not match', async () => {
      await manager.acquire('res', 'agent-1');
      const result = await manager.release('res', 'agent-2');
      expect(result).toBe(false);
    });

    it('allows another agent to acquire after release', async () => {
      await manager.acquire('res', 'agent-1');
      await manager.release('res', 'agent-1');

      const lease = await manager.acquire('res', 'agent-2');
      expect(lease).not.toBeNull();
      expect(lease!.holder).toBe('agent-2');
    });
  });

  describe('get', () => {
    it('returns null for non-existent resource', async () => {
      const lease = await manager.get('nonexistent');
      expect(lease).toBeNull();
    });

    it('returns the active lease for a resource', async () => {
      await manager.acquire('res', 'agent-1');
      const lease = await manager.get('res');

      expect(lease).not.toBeNull();
      expect(lease!.holder).toBe('agent-1');
      expect(lease!.resource).toBe('res');
    });

    it('returns null for expired lease', async () => {
      const mgr = new LeaseManager({
        store: store as any,
        defaultTtlMs: 1,
        maxRenewals: 3,
      });

      await mgr.acquire('res', 'agent-1');
      await new Promise((r) => setTimeout(r, 10));

      const lease = await mgr.get('res');
      expect(lease).toBeNull();
    });

    it('returns null after lease is released', async () => {
      await manager.acquire('res', 'agent-1');
      await manager.release('res', 'agent-1');

      const lease = await manager.get('res');
      expect(lease).toBeNull();
    });
  });

  describe('validateFencingToken', () => {
    it('returns true when no active lease exists', async () => {
      const valid = await manager.validateFencingToken('res', 999);
      expect(valid).toBe(true);
    });

    it('returns true for current fencing token', async () => {
      const lease = await manager.acquire('res', 'agent-1');
      const valid = await manager.validateFencingToken('res', lease!.fencingToken);
      expect(valid).toBe(true);
    });

    it('returns true for newer fencing token', async () => {
      const lease = await manager.acquire('res', 'agent-1');
      const valid = await manager.validateFencingToken('res', lease!.fencingToken + 100);
      expect(valid).toBe(true);
    });

    it('returns false for stale fencing token', async () => {
      const lease = await manager.acquire('res', 'agent-1');
      const valid = await manager.validateFencingToken('res', lease!.fencingToken - 1);
      expect(valid).toBe(false);
    });
  });

  describe('listActive', () => {
    it('returns empty array when no leases exist', async () => {
      const active = await manager.listActive();
      expect(active).toEqual([]);
    });

    it('returns all active leases', async () => {
      await manager.acquire('res-a', 'agent-1');
      await manager.acquire('res-b', 'agent-2');

      const active = await manager.listActive();
      expect(active).toHaveLength(2);
      const resources = active.map((l) => l.resource).sort();
      expect(resources).toEqual(['res-a', 'res-b']);
    });

    it('excludes released leases', async () => {
      await manager.acquire('res-a', 'agent-1');
      await manager.acquire('res-b', 'agent-2');
      await manager.release('res-a', 'agent-1');

      const active = await manager.listActive();
      expect(active).toHaveLength(1);
      expect(active[0].resource).toBe('res-b');
    });

    it('excludes expired leases', async () => {
      const mgr = new LeaseManager({
        store: store as any,
        defaultTtlMs: 1,
        maxRenewals: 3,
      });

      await mgr.acquire('res-expired', 'agent-1');
      await new Promise((r) => setTimeout(r, 10));

      // Acquire one with long TTL
      const mgr2 = new LeaseManager({
        store: store as any,
        defaultTtlMs: 60_000,
        maxRenewals: 3,
      });
      await mgr2.acquire('res-active', 'agent-2');

      const active = await mgr2.listActive();
      expect(active).toHaveLength(1);
      expect(active[0].resource).toBe('res-active');
    });
  });
});
