/**
 * index.ts — Public API exports for AgentSentry memory store.
 */

export { MemoryStore, MemoryStoreOptions } from './store';
export {
  OpsEvent,
  OpsEventInput,
  EventType,
  Severity,
  Skill,
  QueryOptions,
  VectorSearchOptions,
  SearchResult,
  AggregateOptions,
  OpsStats,
  ChainVerification,
  computeHash,
  validateEventInput,
  EVENT_TYPES,
  SEVERITIES,
  SKILLS,
} from './schema';
export { StorageProvider } from './providers/storage-provider';
export { SqliteProvider } from './providers/sqlite-provider';
export { SupabaseProvider } from './providers/supabase-provider';
export { createProvider, loadMemoryConfig, MemoryConfig } from './providers/provider-factory';
export {
  EmbeddingProvider,
  NoopEmbeddingProvider,
  OnnxEmbeddingProvider,
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
  VoyageEmbeddingProvider,
  detectEmbeddingProvider,
} from './embeddings';
export { registerEventSubscriber } from './event-subscriber';
