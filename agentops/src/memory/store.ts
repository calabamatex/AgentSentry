/**
 * store.ts — MemoryStore class: CRUD + vector search (provider-agnostic).
 */

import { v4 as uuidv4 } from 'uuid';
import { StorageProvider } from './providers/storage-provider';
import { createProvider, loadMemoryConfig, MemoryConfig } from './providers/provider-factory';
import { EmbeddingProvider, NoopEmbeddingProvider, detectEmbeddingProvider } from './embeddings';
import { Logger } from '../observability/logger';

const logger = new Logger({ module: 'memory-store' });
import {
  OpsEvent,
  OpsEventInput,
  SearchResult,
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
  private autoDetectEmbedding: boolean;

  constructor(options: MemoryStoreOptions = {}) {
    const config = options.config ?? loadMemoryConfig();
    this.provider = options.provider ?? createProvider(config);
    this.embeddingProvider = options.embeddingProvider ?? new NoopEmbeddingProvider();
    this.autoDetectEmbedding = !options.embeddingProvider;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.provider.initialize();

    // Only auto-detect if no embedding provider was explicitly provided
    if (this.autoDetectEmbedding && this.embeddingProvider instanceof NoopEmbeddingProvider) {
      try {
        const config = loadMemoryConfig();
        this.embeddingProvider = await detectEmbeddingProvider(config.embedding_provider);
      } catch (e) {
        logger.debug('Embedding provider auto-detection failed, keeping noop', { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Recover last hash from chain
    const chain = await this.provider.getChain();
    if (chain.length > 0) {
      this.lastHash = chain[chain.length - 1].hash;
    }

    this.initialized = true;

    // Auto-prune if configured
    try {
      const config = loadMemoryConfig();
      if (config.max_events || config.auto_prune_days) {
        await this.provider.prune({
          maxEvents: config.max_events,
          maxAgeDays: config.auto_prune_days,
        });
      }
    } catch (e) {
      logger.debug('Auto-prune failed', { error: e instanceof Error ? e.message : String(e) });
    }
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
    } catch (e) {
      logger.debug('Embedding generation failed, storing event without embedding', { error: e instanceof Error ? e.message : String(e) });
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
      } catch (e) {
        logger.debug('Vector search failed, falling back to structured search', { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Fallback: use provider-side text search if available, else JS filter
    if (this.provider.textSearch) {
      const events = await this.provider.textSearch(query, {
        limit: options?.limit ?? 10,
        event_type: options?.event_type,
        severity: options?.severity,
        skill: options?.skill,
        since: options?.since,
        session_id: options?.session_id,
      });
      return events.map((event) => ({ event, score: 1.0 }));
    }

    // Last resort: fetch recent + JS filter (may miss older events)
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

  async prune(options?: { maxEvents?: number; maxAgeDays?: number }): Promise<{ deleted: number }> {
    await this.ensureInitialized();
    const config = loadMemoryConfig();
    const maxEvents = options?.maxEvents ?? config.max_events ?? 100000;
    const maxAgeDays = options?.maxAgeDays ?? config.auto_prune_days ?? 365;
    return this.provider.prune({ maxEvents, maxAgeDays });
  }

  async verifyChain(since?: string): Promise<ChainVerification> {
    await this.ensureInitialized();

    // Try incremental verification from last checkpoint
    let startHash: string | undefined;
    let previouslyVerified = 0;

    if (!since && this.provider.getLastChainCheckpoint) {
      try {
        const checkpoint = await this.provider.getLastChainCheckpoint();
        if (checkpoint) {
          startHash = checkpoint.lastEventHash;
          previouslyVerified = checkpoint.eventsVerified;
          // Get events after the checkpoint event's timestamp
          const checkpointEvent = await this.provider.getById(checkpoint.lastEventId);
          if (checkpointEvent) {
            since = checkpointEvent.timestamp;
          }
        }
      } catch (e) {
        logger.debug('Incremental chain verification failed, falling back to full verification', { error: e instanceof Error ? e.message : String(e) });
      }
    }

    const chain = await this.provider.getChain(since);

    if (chain.length === 0) {
      return { valid: true, total_checked: previouslyVerified };
    }

    // If incremental, verify first event links to checkpoint
    if (startHash && chain[0].prev_hash !== startHash) {
      // Chain broken at checkpoint boundary -- do full verification
      const fullChain = await this.provider.getChain();
      return this.verifyChainInternal(fullChain);
    }

    const result = this.verifyChainInternal(chain);

    // Save checkpoint if verification passed
    if (result.valid && chain.length > 0 && this.provider.saveChainCheckpoint) {
      const lastEvent = chain[chain.length - 1];
      try {
        await this.provider.saveChainCheckpoint({
          lastEventId: lastEvent.id,
          lastEventHash: lastEvent.hash,
          eventsVerified: previouslyVerified + chain.length,
        });
      } catch (e) {
        logger.debug('Chain checkpoint save failed', { error: e instanceof Error ? e.message : String(e) });
      }
    }

    return {
      ...result,
      total_checked: result.valid ? previouslyVerified + result.total_checked : result.total_checked,
    };
  }

  private verifyChainInternal(chain: OpsEvent[]): ChainVerification {
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
