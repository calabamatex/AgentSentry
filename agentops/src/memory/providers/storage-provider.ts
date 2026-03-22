/**
 * storage-provider.ts — StorageProvider interface for AgentOps memory backends.
 */

import {
  OpsEvent,
  QueryOptions,
  VectorSearchOptions,
  SearchResult,
  AggregateOptions,
  OpsStats,
} from '../schema';

export interface StorageProvider {
  readonly name: string;
  readonly mode: 'local' | 'remote';

  initialize(): Promise<void>;
  close(): Promise<void>;

  insert(event: OpsEvent): Promise<void>;

  getById(id: string): Promise<OpsEvent | null>;
  query(options: QueryOptions): Promise<OpsEvent[]>;
  count(options: QueryOptions): Promise<number>;

  vectorSearch(embedding: number[], options: VectorSearchOptions): Promise<SearchResult[]>;

  aggregate(options: AggregateOptions): Promise<OpsStats>;

  getChain(since?: string): Promise<OpsEvent[]>;

  prune(options: { maxEvents?: number; maxAgeDays?: number }): Promise<{ deleted: number }>;

  saveChainCheckpoint?(checkpoint: { lastEventId: string; lastEventHash: string; eventsVerified: number }): Promise<void>;
  getLastChainCheckpoint?(): Promise<{ lastEventId: string; lastEventHash: string; eventsVerified: number; verifiedAt: string } | null>;

  /** Optional: SQL/server-side text search on title+detail. Used as fallback when embeddings are unavailable. */
  textSearch?(query: string, options: QueryOptions): Promise<OpsEvent[]>;
}
