/**
 * batch.ts — Batch operations for MemoryStore: bulk capture, search, and list.
 */

import { performance } from 'perf_hooks';
import {
  OpsEvent,
  OpsEventInput,
  QueryOptions,
  SearchResult,
  EventType,
  Severity,
  Skill,
} from './schema';
import { MemoryStore } from './store';
import { StorageProvider } from './providers/storage-provider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchResult {
  captured: OpsEvent[];
  errors: Array<{ index: number; error: string }>;
  totalTime: number;
}

export interface SearchOptions {
  limit?: number;
  threshold?: number;
  event_type?: EventType;
  severity?: Severity;
  skill?: Skill;
  since?: string;
  session_id?: string;
}

export interface BatchSearchResult {
  results: Array<{ query: string; results: SearchResult[] }>;
  totalTime: number;
}

export interface BatchOptions {
  batchSize?: number;
  continueOnError?: boolean;
}

// ---------------------------------------------------------------------------
// BatchProcessor
// ---------------------------------------------------------------------------

export class BatchProcessor {
  private readonly store: MemoryStore;
  private readonly batchSize: number;

  constructor(options: { store: MemoryStore; batchSize?: number }) {
    this.store = options.store;
    this.batchSize = options.batchSize ?? 100;
  }

  /**
   * Captures multiple events sequentially to maintain hash chain integrity,
   * processing them in chunks of `batchSize`.
   */
  async captureBatch(inputs: OpsEventInput[]): Promise<BatchResult> {
    const start = performance.now();
    const captured: OpsEvent[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    for (let offset = 0; offset < inputs.length; offset += this.batchSize) {
      const chunk = inputs.slice(offset, offset + this.batchSize);

      for (let i = 0; i < chunk.length; i++) {
        const globalIndex = offset + i;
        try {
          const event = await this.store.capture(chunk[i]);
          captured.push(event);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ index: globalIndex, error: message });
        }
      }
    }

    const totalTime = performance.now() - start;
    return { captured, errors, totalTime };
  }

  /**
   * Runs multiple search queries in parallel using Promise.all.
   */
  async searchBatch(
    queries: Array<{ query: string; options?: SearchOptions }>,
  ): Promise<BatchSearchResult> {
    const start = performance.now();

    const settled = await Promise.all(
      queries.map(async ({ query, options }) => {
        const results = await this.store.search(query, options);
        return { query, results };
      }),
    );

    const totalTime = performance.now() - start;
    return { results: settled, totalTime };
  }

  /**
   * Runs multiple list queries in parallel using Promise.all.
   */
  async listBatch(optionsList: QueryOptions[]): Promise<OpsEvent[][]> {
    return Promise.all(
      optionsList.map((options) => this.store.list(options)),
    );
  }
}

// ---------------------------------------------------------------------------
// batchInsert utility
// ---------------------------------------------------------------------------

/**
 * Inserts multiple pre-built OpsEvent objects into a StorageProvider
 * sequentially. Since StorageProvider does not expose transaction semantics,
 * each event is inserted via the standard `insert` method.
 */
export async function batchInsert(
  provider: StorageProvider,
  events: OpsEvent[],
): Promise<void> {
  for (const event of events) {
    await provider.insert(event);
  }
}
