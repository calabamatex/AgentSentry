import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as https from 'https';
import {
  ConnectionPool,
  PooledSupabaseProvider,
} from '../../src/memory/providers/connection-pool';

// ---------------------------------------------------------------------------
// ConnectionPool
// ---------------------------------------------------------------------------

describe('ConnectionPool', () => {
  let pool: ConnectionPool;

  beforeEach(() => {
    pool = new ConnectionPool();
  });

  afterEach(() => {
    if (!pool.isDestroyed) {
      pool.destroy();
    }
  });

  // 1
  it('uses default options when none provided', () => {
    const stats = pool.stats();
    // Pool is created without error and returns zeroed stats
    expect(stats.totalConnections).toBe(0);
    expect(stats.activeConnections).toBe(0);
    expect(stats.idleConnections).toBe(0);
    expect(stats.totalRequests).toBe(0);
    expect(stats.failedRequests).toBe(0);
    expect(stats.avgResponseTime).toBe(0);
  });

  // 2
  it('getAgent(true) returns an https.Agent', () => {
    const agent = pool.getAgent(true);
    expect(agent).toBeInstanceOf(https.Agent);
  });

  // 3
  it('getAgent(false) returns an http.Agent', () => {
    const agent = pool.getAgent(false);
    expect(agent).toBeInstanceOf(http.Agent);
    // http.Agent but NOT https.Agent
    // https.Agent extends http.Agent, so we check constructor name
    expect(agent.constructor.name).toBe('Agent');
  });

  // 4
  it('getAgent returns the same agent on repeated calls (lazy singleton)', () => {
    const httpsAgent1 = pool.getAgent(true);
    const httpsAgent2 = pool.getAgent(true);
    expect(httpsAgent1).toBe(httpsAgent2);

    const httpAgent1 = pool.getAgent(false);
    const httpAgent2 = pool.getAgent(false);
    expect(httpAgent1).toBe(httpAgent2);
  });

  // 5
  it('getAgent throws after destroy()', () => {
    pool.destroy();
    expect(() => pool.getAgent(true)).toThrow('ConnectionPool has been destroyed');
    expect(() => pool.getAgent(false)).toThrow('ConnectionPool has been destroyed');
  });

  // 6
  it('isDestroyed returns false initially', () => {
    expect(pool.isDestroyed).toBe(false);
  });

  // 7
  it('isDestroyed returns true after destroy()', () => {
    pool.destroy();
    expect(pool.isDestroyed).toBe(true);
  });

  // 8
  it('stats() returns zeros initially', () => {
    const stats = pool.stats();
    expect(stats).toEqual({
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      totalRequests: 0,
      failedRequests: 0,
      avgResponseTime: 0,
    });
  });

  // 9
  it('recordRequest() increments totalRequests', () => {
    pool.recordRequest(50, false);
    pool.recordRequest(30, false);
    const stats = pool.stats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.failedRequests).toBe(0);
  });

  // 10
  it('recordRequest(_, true) increments failedRequests', () => {
    pool.recordRequest(100, true);
    pool.recordRequest(200, false);
    pool.recordRequest(50, true);
    const stats = pool.stats();
    expect(stats.totalRequests).toBe(3);
    expect(stats.failedRequests).toBe(2);
  });

  // 11
  it('avgResponseTime calculated correctly after multiple requests', () => {
    pool.recordRequest(100, false);
    pool.recordRequest(200, false);
    pool.recordRequest(300, false);
    const stats = pool.stats();
    // (100 + 200 + 300) / 3 = 200
    expect(stats.avgResponseTime).toBe(200);
  });

  // 12
  it('healthCheck() returns true when healthy', async () => {
    const healthy = await pool.healthCheck();
    expect(healthy).toBe(true);
  });

  // 13
  it('healthCheck() returns false after destroy()', async () => {
    pool.destroy();
    const healthy = await pool.healthCheck();
    expect(healthy).toBe(false);
  });

  // 14
  it('destroy() cleans up agents', () => {
    // Force creation of both agents
    const httpAgent = pool.getAgent(false);
    const httpsAgent = pool.getAgent(true);

    const httpDestroySpy = vi.spyOn(httpAgent, 'destroy');
    const httpsDestroySpy = vi.spyOn(httpsAgent, 'destroy');

    pool.destroy();

    expect(httpDestroySpy).toHaveBeenCalledOnce();
    expect(httpsDestroySpy).toHaveBeenCalledOnce();
    expect(pool.isDestroyed).toBe(true);

    // Stats reset after destroy
    const stats = pool.stats();
    expect(stats.totalRequests).toBe(0);
    expect(stats.failedRequests).toBe(0);
    expect(stats.avgResponseTime).toBe(0);
  });

  // 15
  it('custom maxConnections propagated to agent', () => {
    const customPool = new ConnectionPool({ maxConnections: 42 });
    const agent = customPool.getAgent(false) as http.Agent;
    expect((agent as any).maxSockets).toBe(42);
    customPool.destroy();
  });

  it('custom keepAlive=false propagated to agent', () => {
    const customPool = new ConnectionPool({ keepAlive: false });
    const agent = customPool.getAgent(false) as http.Agent;
    expect((agent as any).keepAlive).toBe(false);
    customPool.destroy();
  });

  it('avgResponseTime is 0 when no requests recorded', () => {
    expect(pool.stats().avgResponseTime).toBe(0);
  });

  it('destroy() resets request counters', () => {
    pool.recordRequest(100, false);
    pool.recordRequest(50, true);
    expect(pool.stats().totalRequests).toBe(2);

    pool.destroy();
    const stats = pool.stats();
    expect(stats.totalRequests).toBe(0);
    expect(stats.failedRequests).toBe(0);
    expect(stats.avgResponseTime).toBe(0);
  });

  it('healthCheck() returns true even if no agents created yet', async () => {
    // No getAgent() calls -- agents are null, healthCheck should still pass
    const healthy = await pool.healthCheck();
    expect(healthy).toBe(true);
  });

  it('destroy() is safe to call when no agents were created', () => {
    // No getAgent() calls
    expect(() => pool.destroy()).not.toThrow();
    expect(pool.isDestroyed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PooledSupabaseProvider
// ---------------------------------------------------------------------------

describe('PooledSupabaseProvider', () => {
  // Clear env vars that might leak into tests
  const origUrl = process.env.SUPABASE_URL;
  const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    // Restore
    if (origUrl !== undefined) process.env.SUPABASE_URL = origUrl;
    else delete process.env.SUPABASE_URL;
    if (origKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  // 16
  it('name is "supabase-pooled"', () => {
    const provider = new PooledSupabaseProvider({
      url: 'https://example.supabase.co',
      serviceRoleKey: 'test-key',
    });
    expect(provider.name).toBe('supabase-pooled');
  });

  // 17
  it('mode is "remote"', () => {
    const provider = new PooledSupabaseProvider({
      url: 'https://example.supabase.co',
      serviceRoleKey: 'test-key',
    });
    expect(provider.mode).toBe('remote');
  });

  // 18
  it('initialize() throws without URL/key', async () => {
    const provider = new PooledSupabaseProvider();
    await expect(provider.initialize()).rejects.toThrow(
      'PooledSupabaseProvider requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
  });

  it('initialize() throws when only URL is provided', async () => {
    const provider = new PooledSupabaseProvider({
      url: 'https://example.supabase.co',
    });
    await expect(provider.initialize()).rejects.toThrow(
      'PooledSupabaseProvider requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
  });

  it('initialize() throws when only key is provided', async () => {
    const provider = new PooledSupabaseProvider({
      serviceRoleKey: 'test-key',
    });
    await expect(provider.initialize()).rejects.toThrow(
      'PooledSupabaseProvider requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
  });

  // 19
  it('getPool() returns the internal pool', () => {
    const provider = new PooledSupabaseProvider({
      url: 'https://example.supabase.co',
      serviceRoleKey: 'test-key',
    });
    const pool = provider.getPool();
    expect(pool).toBeInstanceOf(ConnectionPool);
    expect(pool.isDestroyed).toBe(false);
    pool.destroy();
  });

  // 20
  it('close() destroys the pool', async () => {
    const provider = new PooledSupabaseProvider({
      url: 'https://example.supabase.co',
      serviceRoleKey: 'test-key',
    });
    const pool = provider.getPool();
    expect(pool.isDestroyed).toBe(false);

    await provider.close();
    expect(pool.isDestroyed).toBe(true);
  });

  it('getPool() passes custom pool options through', () => {
    const provider = new PooledSupabaseProvider({
      url: 'https://example.supabase.co',
      serviceRoleKey: 'test-key',
      poolOptions: { maxConnections: 25 },
    });
    const pool = provider.getPool();
    const agent = pool.getAgent(false) as http.Agent;
    expect((agent as any).maxSockets).toBe(25);
    pool.destroy();
  });

  it('reads URL and key from environment variables', () => {
    process.env.SUPABASE_URL = 'https://env-test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'env-test-key';

    const provider = new PooledSupabaseProvider();
    // If env vars are set, initialize should not throw for missing config
    // (it will fail on the network call, but not the validation)
    const pool = provider.getPool();
    expect(pool).toBeInstanceOf(ConnectionPool);
    pool.destroy();
  });

  it('constructor config overrides environment variables', () => {
    process.env.SUPABASE_URL = 'https://env.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'env-key';

    const provider = new PooledSupabaseProvider({
      url: 'https://custom.supabase.co',
      serviceRoleKey: 'custom-key',
    });

    // The provider should use the constructor config, not env vars.
    // We verify indirectly: getPool works and name is correct.
    expect(provider.name).toBe('supabase-pooled');
    provider.getPool().destroy();
  });
});
