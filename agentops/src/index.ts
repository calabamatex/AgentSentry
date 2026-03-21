/**
 * AgentOps v4.0 — Public API
 *
 * Re-exports the core modules for programmatic use.
 * This barrel file prepares the codebase for future npm packaging.
 */

// Memory Store
export { MemoryStore } from './memory/store';
export type { OpsEvent, EventType, Severity, Skill, SearchResult, OpsStats, ChainVerification } from './memory/schema';

// Providers
export type { StorageProvider } from './memory/providers/storage-provider';
export { createProvider, loadMemoryConfig } from './memory/providers/provider-factory';
export { detectEmbeddingProvider } from './memory/embeddings';
export type { EmbeddingProvider } from './memory/embeddings';

// Primitives
export { assessRisk } from './primitives/risk-scoring';
export { validateRules } from './primitives/rules-validation';
export { scanForSecrets } from './primitives/secret-detection';

// Enablement
export { generateConfigForLevel, isSkillEnabled, getActiveSkills, getNextLevel, validateEnablementConfig, LEVEL_NAMES } from './enablement/engine';

// Enrichment
export { EventEnricher, LocalPatternMatcher } from './memory/enrichment';

// Intelligence (cross-session)
export { SessionSummarizer, PatternDetector, ContextRecaller } from './memory/intelligence';
export type { SessionSummary, DetectedPattern, RecallResult } from './memory/intelligence';

// Audit
export { AuditIndex } from './memory/audit-index';

// Coordination [experimental]
export { AgentCoordinator } from './coordination/coordinator';
export type { AgentInfo, LockInfo, CoordinationMessage, CoordinatorOptions } from './coordination/coordinator';

// Plugin Registry
export { PluginRegistry } from './plugins/registry';
export type { PluginManifest, InstalledPlugin, PluginSearchOptions } from './plugins/registry';

// MCP Server
export { createMcpServer } from './mcp/server';

// Streaming [beta]
export { EventStream } from './streaming/event-stream';
export { SseTransport } from './streaming/sse-transport';
export { WsTransport } from './streaming/ws-transport';
export type { StreamFilter, StreamClient, StreamEvent, EventStreamOptions } from './streaming/event-stream';

// Observability (M5)
export { Logger, generateTraceId } from './observability/logger';
export type { LogLevel, LogEntry, OutputSink, LoggerOptions } from './observability/logger';
export { CircuitBreaker, CircuitOpenError, retry, withCircuitBreaker } from './observability/circuit-breaker';
export type { CircuitState, CircuitBreakerOptions, CircuitBreakerStats, RetryOptions } from './observability/circuit-breaker';
export { HealthChecker, createHealthMiddleware, memoryUsageCheck, eventLoopCheck } from './observability/health';
export type { ComponentCheck, HealthCheckResult, HealthCheckerOptions } from './observability/health';
export { ShutdownManager, createShutdownHandler, httpServerShutdown, intervalShutdown, customShutdown } from './observability/shutdown';
export type { ShutdownOptions, ShutdownReport } from './observability/shutdown';
export { MetricsCollector, createMetricsMiddleware } from './observability/metrics';
export type { HistogramSnapshot } from './observability/metrics';

// Dashboard (M7)
export { DashboardServer } from './dashboard/server';
export type { DashboardServerOptions, DashboardServerInfo } from './dashboard/server';

// Performance Optimization (M8)
export { LRUCache, CachedStorageProvider } from './memory/cache';
export type { LRUCacheOptions, CacheStats } from './memory/cache';
export { BatchProcessor, batchInsert } from './memory/batch';
export type { BatchResult, BatchSearchResult, BatchOptions } from './memory/batch';
export { ConnectionPool, PooledSupabaseProvider } from './memory/providers/connection-pool';
export type { ConnectionPoolOptions, PoolStats, PooledSupabaseProviderConfig } from './memory/providers/connection-pool';
export { QueryOptimizer, PreparedStatementCache } from './memory/query-optimizer';
export type { QueryPlan, TableStats } from './memory/query-optimizer';
export { BenchmarkSuite } from './memory/benchmark';
export type { BenchmarkResult, BenchmarkReport } from './memory/benchmark';
