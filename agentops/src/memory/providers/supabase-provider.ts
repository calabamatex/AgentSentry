/**
 * supabase-provider.ts — STUB: Supabase storage backend for AgentOps memory store.
 * Not implemented in Phase 1. Throws NotImplementedError for all operations.
 */

import { StorageProvider } from './storage-provider';
import {
  OpsEvent,
  QueryOptions,
  VectorSearchOptions,
  SearchResult,
  AggregateOptions,
  OpsStats,
} from '../schema';

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`SupabaseProvider.${method}() is not implemented. Supabase support is planned for a future release.`);
    this.name = 'NotImplementedError';
  }
}

export class SupabaseProvider implements StorageProvider {
  readonly name = 'supabase';
  readonly mode = 'remote' as const;

  async initialize(): Promise<void> {
    throw new NotImplementedError('initialize');
  }

  async close(): Promise<void> {
    throw new NotImplementedError('close');
  }

  async insert(_event: OpsEvent): Promise<void> {
    throw new NotImplementedError('insert');
  }

  async getById(_id: string): Promise<OpsEvent | null> {
    throw new NotImplementedError('getById');
  }

  async query(_options: QueryOptions): Promise<OpsEvent[]> {
    throw new NotImplementedError('query');
  }

  async count(_options: QueryOptions): Promise<number> {
    throw new NotImplementedError('count');
  }

  async vectorSearch(_embedding: number[], _options: VectorSearchOptions): Promise<SearchResult[]> {
    throw new NotImplementedError('vectorSearch');
  }

  async aggregate(_options: AggregateOptions): Promise<OpsStats> {
    throw new NotImplementedError('aggregate');
  }

  async getChain(_since?: string): Promise<OpsEvent[]> {
    throw new NotImplementedError('getChain');
  }
}
