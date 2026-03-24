import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ShutdownManager,
  ShutdownReport,
  createShutdownHandler,
  httpServerShutdown,
  intervalShutdown,
  customShutdown,
} from '../../src/observability/shutdown';

describe('ShutdownManager', () => {
  let manager: ShutdownManager;

  beforeEach(() => {
    manager = new ShutdownManager();
  });

  // --- Registration ---

  it('should register a handler', () => {
    manager.register('db', async () => {});
    expect(manager.getRegistered()).toEqual(['db']);
  });

  it('should deregister a handler', () => {
    manager.register('db', async () => {});
    manager.register('cache', async () => {});
    manager.deregister('db');
    expect(manager.getRegistered()).toEqual(['cache']);
  });

  it('should return all registered handler names via getRegistered()', () => {
    manager.register('a', async () => {});
    manager.register('b', async () => {});
    manager.register('c', async () => {});
    expect(manager.getRegistered()).toEqual(['a', 'b', 'c']);
  });

  // --- Shutdown order ---

  it('should run handlers in priority order (lower number first)', async () => {
    const order: string[] = [];
    manager.register('low', async () => { order.push('low'); }, 20);
    manager.register('high', async () => { order.push('high'); }, 1);
    manager.register('mid', async () => { order.push('mid'); }, 10);

    await manager.shutdown('test');
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  // --- Success reporting ---

  it('should report success for handlers that complete normally', async () => {
    manager.register('ok', async () => {});
    const report = await manager.shutdown('test');

    expect(report.results).toHaveLength(1);
    expect(report.results[0].status).toBe('success');
    expect(report.results[0].name).toBe('ok');
    expect(report.results[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(report.results[0].error).toBeUndefined();
  });

  // --- Failure reporting ---

  it('should catch handler errors and report them as failed', async () => {
    manager.register('bad', async () => {
      throw new Error('boom');
    });
    const report = await manager.shutdown('test');

    expect(report.results[0].status).toBe('failed');
    expect(report.results[0].error).toBe('boom');
    expect(report.clean).toBe(false);
  });

  // --- Timeout detection ---

  it('should detect handler timeout and report it', async () => {
    vi.useFakeTimers();

    const mgr = new ShutdownManager({ timeoutMs: 1000 });
    // A handler that never resolves
    mgr.register('stuck', () => new Promise<void>(() => {}));

    const shutdownPromise = mgr.shutdown('timeout-test');

    // Advance time past the per-handler timeout (1000ms / 1 handler = 1000ms)
    await vi.advanceTimersByTimeAsync(1100);

    const report = await shutdownPromise;

    expect(report.results[0].status).toBe('timeout');
    expect(report.results[0].error).toContain('timed out');
    expect(report.clean).toBe(false);

    vi.useRealTimers();
  });

  // --- Idempotency ---

  it('should be idempotent — second shutdown() returns same report', async () => {
    manager.register('x', async () => {});
    const first = await manager.shutdown('first');
    const second = await manager.shutdown('second');
    expect(second).toBe(first);
    expect(second.reason).toBe('first');
  });

  // --- State ---

  it('should reflect shutting-down state via isShuttingDown()', async () => {
    expect(manager.isShuttingDown()).toBe(false);
    manager.register('x', async () => {});
    await manager.shutdown();
    expect(manager.isShuttingDown()).toBe(true);
  });

  // --- onShutdown callback ---

  it('should call onShutdown callback when shutdown starts', async () => {
    const cb = vi.fn();
    const mgr = new ShutdownManager({ onShutdown: cb });
    mgr.register('x', async () => {});
    await mgr.shutdown('test');
    expect(cb).toHaveBeenCalledOnce();
  });

  // --- Reason ---

  it('should record the reason in the report', async () => {
    const report = await manager.shutdown('SIGTERM');
    expect(report.reason).toBe('SIGTERM');
  });

  it('should default reason to "unknown" when none provided', async () => {
    const report = await manager.shutdown();
    expect(report.reason).toBe('unknown');
  });

  // --- clean flag ---

  it('should set clean=true when all handlers succeed', async () => {
    manager.register('a', async () => {});
    manager.register('b', async () => {});
    const report = await manager.shutdown();
    expect(report.clean).toBe(true);
  });

  it('should set clean=false when any handler fails', async () => {
    manager.register('ok', async () => {});
    manager.register('fail', async () => { throw new Error('nope'); });
    const report = await manager.shutdown();
    expect(report.clean).toBe(false);
  });

  // --- Empty handlers ---

  it('should produce a clean report with no handlers registered', async () => {
    const report = await manager.shutdown('empty');
    expect(report.results).toEqual([]);
    expect(report.clean).toBe(true);
    expect(report.reason).toBe('empty');
  });

  // --- Duration ---

  it('should calculate durationMs in the report', async () => {
    manager.register('x', async () => {});
    const report = await manager.shutdown();
    expect(typeof report.durationMs).toBe('number');
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  // --- Report timestamps ---

  it('should include startedAt and completedAt as ISO strings', async () => {
    const report = await manager.shutdown();
    expect(report.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('createShutdownHandler', () => {
  it('should return a function', () => {
    const mgr = new ShutdownManager();
    const handler = createShutdownHandler(mgr);
    expect(typeof handler).toBe('function');
  });

  it('should call manager.shutdown with the signal argument', async () => {
    const mgr = new ShutdownManager();
    const shutdownSpy = vi.spyOn(mgr, 'shutdown');
    const handler = createShutdownHandler(mgr);

    handler('SIGTERM');

    // Give the internal promise a tick to resolve
    await new Promise(r => setTimeout(r, 0));

    expect(shutdownSpy).toHaveBeenCalledWith('SIGTERM');
  });
});

describe('httpServerShutdown', () => {
  it('should call server.close and resolve on success', async () => {
    const server = {
      close: vi.fn((cb?: (err?: Error) => void) => { cb?.(); }),
    };
    const handler = httpServerShutdown(server);
    await handler();
    expect(server.close).toHaveBeenCalledOnce();
  });

  it('should reject when server.close passes an error', async () => {
    const server = {
      close: vi.fn((cb?: (err?: Error) => void) => {
        cb?.(new Error('close failed'));
      }),
    };
    const handler = httpServerShutdown(server);
    await expect(handler()).rejects.toThrow('close failed');
  });
});

describe('intervalShutdown', () => {
  it('should call clearInterval on the provided interval', async () => {
    const clearSpy = vi.spyOn(global, 'clearInterval');
    const interval = setInterval(() => {}, 1000);
    const handler = intervalShutdown(interval);
    await handler();
    expect(clearSpy).toHaveBeenCalledWith(interval);
    clearSpy.mockRestore();
    clearInterval(interval);
  });
});

describe('customShutdown', () => {
  it('should wrap an arbitrary async function as a shutdown handler', async () => {
    const fn = vi.fn(async () => {});
    const handler = customShutdown(fn);
    await handler();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('should propagate errors from the wrapped function', async () => {
    const handler = customShutdown(async () => {
      throw new Error('custom error');
    });
    await expect(handler()).rejects.toThrow('custom error');
  });
});
