/**
 * shared-store.ts — Singleton MemoryStore for MCP tool handlers.
 *
 * Prevents opening/closing SQLite on every tool invocation.
 * The store is lazily initialized on first use and shared across all tools.
 * Call shutdown() during server teardown to close gracefully.
 */

import { MemoryStore } from '../memory/store';
import { Logger } from '../observability/logger';

const logger = new Logger({ module: 'mcp-shared-store' });

let sharedStore: MemoryStore | null = null;
let initPromise: Promise<MemoryStore> | null = null;

/**
 * Get (or create) the shared MemoryStore singleton.
 * Thread-safe: concurrent calls will await the same initialization promise.
 */
export async function getSharedStore(): Promise<MemoryStore> {
  if (sharedStore) return sharedStore;

  if (!initPromise) {
    initPromise = (async () => {
      const store = new MemoryStore();
      await store.initialize();
      sharedStore = store;
      logger.info('Shared MemoryStore initialized');
      return store;
    })();
  }

  return initPromise;
}

/**
 * Shut down the shared store. Call during server teardown.
 */
export async function shutdownSharedStore(): Promise<void> {
  if (sharedStore) {
    await sharedStore.close().catch((err) => {
      logger.warn('Error closing shared store', { error: err instanceof Error ? err.message : String(err) });
    });
    sharedStore = null;
    initPromise = null;
    logger.info('Shared MemoryStore closed');
  }
}
