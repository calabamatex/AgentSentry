/**
 * store.ts — MemoryStore class: CRUD + vector search (provider-agnostic).
 */

import { v4 as uuidv4 } from 'uuid';
import { StorageProvider } from './providers/storage-provider';
import { createProvider, loadMemoryConfig, MemoryConfig } from './providers/provider-factory';
import { EmbeddingProvider, NoopEmbeddingProvider, detectEmbeddingProvider } from './embeddings';
import {
  OpsEvent,
  OpsEventInput,
  QueryOptions,
  SearchResult,
  AggregateOptions,
  OpsStats,
  ChainVerification,
  computeHash,
  validateEventInput,
  EventType,
  Severity,
  Skill,
} from './schema';

export interface MemoryStoreOptions {
  provider?: StorageProvider;
  embeddingProvider?: EmbeddingProvider;
  config?: MemoryConfig;
}

export class MemoryStore {
  private provider: StorageProvider;
  private embeddingProvider: EmbeddingProvider;
  private lastHash: string = '0'.repeat(64);
  private initialized = false;

  constructor(options: MemoryStoreOptions = {}) {
    const config = options.config ?? loadMemoryConfig();
    this.provider = options.provider ?? createProvider(config);
    this.embeddingProvider = options.embeddingProvider ?? new NoopEmbeddingProvider();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.provider.initialize();

    // Detect embedding provider if noop was default
    if (this.embeddingProvider instanceof NoopEmbeddingProvider) {
      try {
        this.embeddingProvider = await detectEmbeddingProvider();
      } catch {
        // Keep noop
      }
    }

    // Recover last hash from chain
    const chain = await this.provider.getChain();
    if (chain.length > 0) {
      this.lastHash = chain[chain.length - 1].hash;
    }

    this.initialized = true;
  }

  async capture(input: OpsEventInput): Promise<OpsEvent> {
    await this.ensureInitialized();

    const errors = validateEventInput(input);
    if (errors.length > 0) {
      throw new Error(`Invalid event: ${errors.join(', ')}`);
    }

    const id = uuidv4();
    const prev_hash = this.lastHash;

    // Generate embedding
    let embedding: number[] | undefined;
    try {
      if (this.embeddingProvider.dimension > 0) {
        const text = `${input.title} ${input.detail}`;
        embedding = await this.embeddingProvider.embed(text);
      }
    } catch {
      // Embedding failed — store without it
    }

    const eventBase = {
      ...input,
      id,
      prev_hash,
    };

    const hash = computeHash(eventBase);

    const event: OpsEvent = {
      ...eventBase,
      hash,
      embedding,
    };

    await this.provider.insert(event);
    this.lastHash = hash;

    return event;
  }

  async search(query: string, options?: {
    limit?: number;
    threshold?: number;
    event_type?: EventType;
    severity?: Severity;
    skill?: Skill;
    since?: string;
    session_id?: string;
  }): Promise<SearchResult[]> {
    await this.ensureInitialized();

    // Try vector search if embedding provider is available
    if (this.embeddingProvider.dimension > 0) {
      try {
        const embedding = await this.embeddingProvider.embed(query);
        if (embedding.length > 0) {
          return await this.provider.vectorSearch(embedding, {
            limit: options?.limit ?? 10,
            threshold: options?.threshold ?? 0.5,
            event_type: options?.event_type,
            severity: options?.severity,
            skill: options?.skill,
            since: options?.since,
            session_id: options?.session_id,
          });
        }
      } catch {
        // Fall through to structured search
      }
    }

    // Fallback: structured query with text matching
    const events = await this.provider.query({
      limit: options?.limit ?? 10,
      event_type: options?.event_type,
      severity: options?.severity,
      skill: options?.skill,
      since: options?.since,
      session_id: options?.session_id,
    });

    const lowerQuery = query.toLowerCase();
    return events
      .filter((e) => e.title.toLowerCase().includes(lowerQuery) || e.detail.toLowerCase().includes(lowerQuery))
      .map((event) => ({ event, score: 1.0 }));
  }

  async list(options?: {
    limit?: number;
    offset?: number;
    event_type?: EventType;
    severity?: Severity;
    skill?: Skill;
    since?: string;
    until?: string;
    session_id?: string;
    agent_id?: string;
    tag?: string;
  }): Promise<OpsEvent[]> {
    await this.ensureInitialized();
    return this.provider.query(options ?? {});
  }

  async stats(options?: {
    since?: string;
    until?: string;
    session_id?: string;
  }): Promise<OpsStats> {
    await this.ensureInitialized();
    return this.provider.aggregate(options ?? {});
  }

  async verifyChain(since?: string): Promise<ChainVerification> {
    await this.ensureInitialized();
    const chain = await this.provider.getChain(since);

    if (chain.length === 0) {
      return { valid: true, total_checked: 0 };
    }

    for (let i = 0; i < chain.length; i++) {
      const event = chain[i];
      const expected = computeHash({
        id: event.id,
        timestamp: event.timestamp,
        session_id: event.session_id,
        agent_id: event.agent_id,
        event_type: event.event_type,
        severity: event.severity,
        skill: event.skill,
        title: event.title,
        detail: event.detail,
        affected_files: event.affected_files,
        tags: event.tags,
        metadata: event.metadata,
        prev_hash: event.prev_hash,
      });

      if (event.hash !== expected) {
        return {
          valid: false,
          total_checked: i + 1,
          first_broken_at: event.timestamp,
          broken_event_id: event.id,
        };
      }

      // Verify chain link (skip first event)
      if (i > 0 && event.prev_hash !== chain[i - 1].hash) {
        return {
          valid: false,
          total_checked: i + 1,
          first_broken_at: event.timestamp,
          broken_event_id: event.id,
        };
      }
    }

    return { valid: true, total_checked: chain.length };
  }

  async close(): Promise<void> {
    await this.provider.close();
    this.initialized = false;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}
