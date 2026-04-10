import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MemoryStore before importing the module under test
const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/memory/store', () => ({
  MemoryStore: vi.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    close: mockClose,
  })),
}));

vi.mock('../../src/observability/logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('shared-store', () => {
  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    // Reset module state between tests by re-importing
    vi.resetModules();
  });

  it('getSharedStore returns a MemoryStore after initialization', async () => {
    const { getSharedStore } = await import('../../src/mcp/shared-store');
    const store = await getSharedStore();
    expect(store).toBeDefined();
    expect(mockInitialize).toHaveBeenCalledOnce();
  });

  it('getSharedStore returns the same instance on subsequent calls', async () => {
    const { getSharedStore } = await import('../../src/mcp/shared-store');
    const store1 = await getSharedStore();
    const store2 = await getSharedStore();
    expect(store1).toBe(store2);
    // initialize should only be called once
    expect(mockInitialize).toHaveBeenCalledOnce();
  });

  it('concurrent calls to getSharedStore share the same initialization promise', async () => {
    const { getSharedStore } = await import('../../src/mcp/shared-store');
    const [store1, store2, store3] = await Promise.all([
      getSharedStore(),
      getSharedStore(),
      getSharedStore(),
    ]);
    expect(store1).toBe(store2);
    expect(store2).toBe(store3);
    expect(mockInitialize).toHaveBeenCalledOnce();
  });

  it('shutdownSharedStore closes and nullifies the store', async () => {
    const { getSharedStore, shutdownSharedStore } = await import('../../src/mcp/shared-store');
    await getSharedStore();
    await shutdownSharedStore();
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it('shutdownSharedStore is a no-op when no store exists', async () => {
    const { shutdownSharedStore } = await import('../../src/mcp/shared-store');
    // Should not throw
    await shutdownSharedStore();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('getSharedStore creates a new instance after shutdown', async () => {
    const { getSharedStore, shutdownSharedStore } = await import('../../src/mcp/shared-store');
    const store1 = await getSharedStore();
    await shutdownSharedStore();
    const store2 = await getSharedStore();
    // After shutdown and re-init, initialize is called twice
    expect(mockInitialize).toHaveBeenCalledTimes(2);
    // They are different objects because MemoryStore constructor is called again
    expect(store2).toBeDefined();
  });

  it('shutdownSharedStore handles close errors gracefully', async () => {
    mockClose.mockRejectedValueOnce(new Error('close failed'));
    const { getSharedStore, shutdownSharedStore } = await import('../../src/mcp/shared-store');
    await getSharedStore();
    // Should not throw even when close rejects
    await expect(shutdownSharedStore()).resolves.toBeUndefined();
  });
});
