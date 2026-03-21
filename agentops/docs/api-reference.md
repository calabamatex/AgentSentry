# AgentOps API Reference

## Memory Store

### `MemoryStore`

Core event store with CRUD, vector search, and hash-chain integrity verification.

```typescript
constructor(options?: MemoryStoreOptions)
```

| Option | Type | Description |
|--------|------|-------------|
| `provider` | `StorageProvider` | Storage backend (default: auto-detected via config) |
| `embeddingProvider` | `EmbeddingProvider` | Embedding backend (default: auto-detected) |
| `config` | `MemoryConfig` | Provider configuration |

**Methods:**

```typescript
initialize(): Promise<void>
capture(input: OpsEventInput): Promise<OpsEvent>
search(query: string, options?: {
  limit?: number; threshold?: number;
  event_type?: EventType; severity?: Severity;
  skill?: Skill; since?: string; session_id?: string;
}): Promise<SearchResult[]>
list(options?: {
  limit?: number; offset?: number;
  event_type?: EventType; severity?: Severity;
  skill?: Skill; since?: string; until?: string;
  session_id?: string; agent_id?: string; tag?: string;
}): Promise<OpsEvent[]>
stats(options?: { since?: string; until?: string; session_id?: string }): Promise<OpsStats>
prune(options?: { maxEvents?: number; maxAgeDays?: number }): Promise<{ deleted: number }>
verifyChain(since?: string): Promise<ChainVerification>
close(): Promise<void>
```

### `OpsEvent`

Immutable event record in the hash chain.

```typescript
interface OpsEvent {
  id: string;
  timestamp: string;
  session_id: string;
  agent_id: string;
  event_type: EventType;    // 'decision' | 'violation' | 'incident' | 'pattern' | 'handoff' | 'audit_finding'
  severity: Severity;       // 'low' | 'medium' | 'high' | 'critical'
  skill: Skill;             // 'save_points' | 'context_health' | 'standing_orders' | 'small_bets' | 'proactive_safety' | 'system'
  title: string;
  detail: string;
  affected_files: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  embedding?: number[];
  hash: string;
  prev_hash: string;
}
```

### `SearchResult`

```typescript
interface SearchResult {
  event: OpsEvent;
  score: number;
}
```

### `OpsStats`

```typescript
interface OpsStats {
  total_events: number;
  by_type: Record<EventType, number>;
  by_severity: Record<Severity, number>;
  by_skill: Record<Skill, number>;
  first_event?: string;
  last_event?: string;
}
```

### `ChainVerification`

```typescript
interface ChainVerification {
  valid: boolean;
  total_checked: number;
  first_broken_at?: string;
  broken_event_id?: string;
}
```

---

## Providers

### `StorageProvider` (interface)

Backend abstraction for event persistence.

```typescript
interface StorageProvider {
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
}
```

### `createProvider(config?: MemoryConfig): StorageProvider`

Factory that returns a `SqliteProvider` or `SupabaseProvider` based on configuration. Defaults to SQLite at `agentops/data/ops.db`.

### `loadMemoryConfig(configPath?: string): MemoryConfig`

Loads configuration from `agentops/agentops.config.json` (or the given path), merging with defaults.

```typescript
interface MemoryConfig {
  enabled: boolean;
  provider: 'sqlite' | 'supabase';
  embedding_provider: 'auto' | 'onnx' | 'ollama' | 'openai' | 'voyage' | 'noop';
  database_path: string;
  max_events: number;
  auto_prune_days: number;
}
```

### `detectEmbeddingProvider(preferred?: EmbeddingProviderChoice): Promise<EmbeddingProvider>`

Auto-detects or selects an embedding provider. Detection order: ONNX local, Ollama, OpenAI, Voyage, noop fallback.

### `EmbeddingProvider` (interface)

```typescript
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  readonly dimension: number;
  readonly name: string;
}
```

---

## Primitives

### `assessRisk(params): RiskAssessment`

Computes a risk score (0-15) for proposed changes based on file count, database changes, shared code, and branch.

```typescript
assessRisk(params: {
  files: string[];
  hasDatabaseChanges: boolean;
  touchesSharedCode: boolean;
  isMainBranch: boolean;
}): RiskAssessment

interface RiskAssessment {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors: RiskFactor[];
  recommendation: string;
}
```

### `validateRules(filePath, changeDescription, rulesFiles?): Promise<ValidationResult>`

Validates a file/change against project rules found in CLAUDE.md and AGENTS.md.

```typescript
interface ValidationResult {
  violations: RuleViolation[];
  compliant: boolean;
  rulesChecked: number;
}
```

### `scanForSecrets(content, filePath?): SecretFinding[]`

Scans text content for hardcoded secrets (AWS keys, GitHub tokens, OpenAI keys, passwords, private keys, etc.). Returns findings with redacted values.

```typescript
interface SecretFinding {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  line?: number;
  match: string;       // redacted
  description: string;
}
```

---

## Enablement

### `generateConfigForLevel(level: number): EnablementConfig`

Generates the canonical skill enablement config for levels 1-5. Throws `RangeError` for invalid levels.

### `isSkillEnabled(config: EnablementConfig, skill: string): boolean`

Returns whether a specific skill is enabled in the given config.

### `getActiveSkills(config: EnablementConfig): string[]`

Returns the list of currently active skill names.

### `getNextLevel(config): { level: number; name: string; unlocks: string[] } | null`

Returns info about the next level, or `null` if already at level 5.

### `validateEnablementConfig(config: unknown): { valid: boolean; errors: string[] }`

Validates an unknown value as a valid `EnablementConfig`.

### `LEVEL_NAMES`

```typescript
const LEVEL_NAMES: Record<number, string> = {
  1: 'Safe Ground',
  2: 'Clear Head',
  3: 'House Rules',
  4: 'Right Size',
  5: 'Full Guard',
};
```

---

## Enrichment

### `EventEnricher`

Applies enrichment providers (cross-tagging, root cause hints, related events) after event capture.

```typescript
constructor(store: MemoryStore, providers?: EnrichmentProvider[])
enrichEvent(event: OpsEvent): Promise<EnrichmentResult>
captureAndEnrich(input: OpsEventInput): Promise<{ event: OpsEvent; enrichment: EnrichmentResult }>
```

### `LocalPatternMatcher`

Built-in enrichment provider. Maps affected file paths to domain tags, detects root cause patterns from recent events, and adds severity context based on git branch.

```typescript
class LocalPatternMatcher implements EnrichmentProvider {
  enrich(event: OpsEvent, recentEvents: OpsEvent[]): Promise<EnrichmentResult>
}

interface EnrichmentResult {
  cross_tags: string[];
  root_cause_hint?: string;
  related_events: string[];
  severity_context?: string;
}
```

---

## Audit

### `AuditIndex`

Semantic audit search with summary generation, file audit trails, and session timelines.

```typescript
constructor(store: MemoryStore)
generateSummary(event: OpsEvent): string
indexEvent(event: OpsEvent): Promise<AuditSummary>
search(query: string, options?: { limit?: number; since?: string; event_type?: EventType }): Promise<AuditSearchResult[]>
getFileAuditTrail(filePath: string, options?: { limit?: number; since?: string }): Promise<AuditSearchResult[]>
getSessionTimeline(sessionId: string): Promise<AuditSearchResult[]>
```

---

## Coordination

### `AgentCoordinator`

Multi-agent coordination with agent registry, distributed locks, messaging, and task delegation.

```typescript
constructor(options: CoordinatorOptions)
```

```typescript
interface CoordinatorOptions {
  agentId: string;
  agentName: string;
  role?: string;
  capabilities?: string[];
  store: MemoryStore;
  heartbeatIntervalMs?: number;  // default 30000
  lockTimeoutMs?: number;        // default 60000
}
```

**Lifecycle:**

```typescript
start(): Promise<void>
stop(): Promise<void>
```

**Agent registry:**

```typescript
register(): Promise<void>
unregister(): Promise<void>
listAgents(filter?: { role?: string; status?: string }): Promise<AgentInfo[]>
getAgent(agentId: string): Promise<AgentInfo | null>
```

**Locking:**

```typescript
acquireLock(resource: string, ttlMs?: number): Promise<boolean>
releaseLock(resource: string): Promise<boolean>
isLocked(resource: string): Promise<LockInfo | null>
```

**Messaging:**

```typescript
send(to: string, channel: string, payload: Record<string, unknown>): Promise<void>
broadcast(channel: string, payload: Record<string, unknown>): Promise<void>
receive(channel: string, since?: string): Promise<CoordinationMessage[]>
onMessage(channel: string, handler: (msg: CoordinationMessage) => void | Promise<void>): void
offMessage(channel: string): void
```

**Task delegation:**

```typescript
delegateTask(toAgentId: string, task: { name: string; params: Record<string, unknown> }): Promise<string>
reportTaskComplete(taskId: string, result: Record<string, unknown>): Promise<void>
getTaskStatus(taskId: string): Promise<{ status: string; result?: Record<string, unknown> } | null>
```

### Types

```typescript
interface AgentInfo {
  id: string; name: string; role: string;
  status: 'active' | 'idle' | 'busy' | 'offline';
  lastSeen: string; capabilities: string[];
  metadata: Record<string, unknown>;
}

interface LockInfo {
  resource: string; holder: string;
  acquiredAt: string; expiresAt: string;
  metadata?: Record<string, unknown>;
}

interface CoordinationMessage {
  id: string; from: string; to: string | '*';
  type: 'request' | 'response' | 'notification' | 'heartbeat';
  channel: string; payload: Record<string, unknown>;
  timestamp: string; ttl?: number;
}
```

---

## Plugins

### `PluginRegistry`

Discovers, validates, installs, and manages plugins from `core/`, `community/`, and `marketplace/` directories.

```typescript
constructor(pluginsDir?: string)  // default: 'plugins'
scan(): Promise<InstalledPlugin[]>
list(options?: PluginSearchOptions): Promise<InstalledPlugin[]>
get(name: string): Promise<InstalledPlugin | null>
install(source: string, options?: { category?: string }): Promise<InstalledPlugin>
uninstall(name: string): Promise<boolean>
enable(name: string): Promise<boolean>
disable(name: string): Promise<boolean>
validate(pluginPath: string): Promise<{ valid: boolean; errors: string[] }>
validateManifest(manifest: unknown): { valid: boolean; errors: string[] }
getState(): Promise<{ installed: number; enabled: number; byCategory: Record<string, number> }>
```

### Types

```typescript
interface PluginManifest {
  name: string; description: string;
  category: 'monitor' | 'integration' | 'dashboard' | 'auditor';
  author: { name: string; github?: string };
  version: string;
  requires: { agentops: string; primitives?: string[] };
  hooks: string[]; tags: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  downloads?: number; rating?: number;
  repository?: string; homepage?: string;
}

interface InstalledPlugin {
  manifest: PluginManifest; path: string;
  enabled: boolean; installedAt: string;
  source: 'core' | 'community' | 'marketplace';
}

interface PluginSearchOptions {
  query?: string; category?: string; tags?: string[];
  difficulty?: string;
  sort?: 'name' | 'downloads' | 'rating' | 'newest';
  limit?: number;
}
```

---

## MCP Server

### `createMcpServer(): Server`

Creates and configures an MCP server with all AgentOps tools registered: `check-git`, `check-context`, `check-rules`, `size-task`, `scan-security`, `capture-event`, `search-history`, `health`.

Returns a `@modelcontextprotocol/sdk` `Server` instance ready for transport connection.

---

## Streaming

### `EventStream`

Real-time event streaming bridge. Subscribes to the internal event bus and fans out to connected clients with filter-based routing and a rolling replay buffer.

```typescript
constructor(options?: EventStreamOptions)
```

```typescript
interface EventStreamOptions {
  maxClients?: number;       // default 50
  bufferSize?: number;       // default 100
  heartbeatIntervalMs?: number; // default 30000
}
```

**Methods:**

```typescript
start(): void
stop(): void
addClient(client: StreamClient): boolean
removeClient(clientId: string): boolean
getClient(clientId: string): StreamClient | undefined
getClients(): StreamClient[]
getClientCount(): number
publish(event: StreamEvent): void
getBuffer(since?: string): StreamEvent[]
replay(clientId: string, since?: string): number
getStats(): { clientCount: number; bufferSize: number; eventsPublished: number; started: boolean }
```

### `SseTransport`

HTTP server that streams events via Server-Sent Events.

```typescript
constructor(stream: EventStream, options?: SseTransportOptions)
start(): Promise<{ port: number; host: string }>
stop(): Promise<void>
```

Options: `port` (default 9100), `host` (default `'127.0.0.1'`), `path` (default `'/events'`), `corsOrigin` (default `'*'`).

### `WsTransport`

HTTP server with raw RFC 6455 WebSocket upgrade support.

```typescript
constructor(stream: EventStream, options?: WsTransportOptions)
start(): Promise<{ port: number; host: string }>
stop(): Promise<void>
```

Options: `port` (default 9101), `host` (default `'127.0.0.1'`), `path` (default `'/ws'`).

### Types

```typescript
interface StreamFilter {
  eventTypes?: string[]; severities?: string[];
  skills?: string[]; sessionId?: string;
  agentId?: string; tags?: string[];
}

interface StreamClient {
  id: string; connectedAt: string;
  filter: StreamFilter; transport: 'sse' | 'websocket' | 'callback';
  send(event: StreamEvent): void;
  close(): void;
}

interface StreamEvent {
  id: string; type: string;
  timestamp: string; data: Record<string, unknown>;
}
```

---

## Observability

### `Logger`

Structured JSON-lines logger with correlation IDs.

```typescript
constructor(options: LoggerOptions)
```

```typescript
interface LoggerOptions {
  module: string;
  traceId?: string;        // auto-generated if omitted
  minLevel?: LogLevel;     // default 'info'
  sink?: OutputSink;       // default process.stderr.write
}
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
```

**Methods:**

```typescript
debug(msg: string, extra?: Record<string, unknown>): void
info(msg: string, extra?: Record<string, unknown>): void
warn(msg: string, extra?: Record<string, unknown>): void
error(msg: string, extra?: Record<string, unknown>): void
withTrace(traceId: string): Logger
child(module: string, traceId?: string): Logger
```

### `generateTraceId(): string`

Returns a UUID v4 trace ID via `crypto.randomUUID()`.

### `CircuitBreaker`

Prevents cascading failures by short-circuiting calls to unhealthy dependencies.

```typescript
constructor(options: CircuitBreakerOptions)
```

```typescript
interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;    // default 5
  resetTimeoutMs?: number;      // default 30000
  halfOpenMaxAttempts?: number;  // default 1
  onStateChange?: (from: CircuitState, to: CircuitState, name: string) => void;
}
type CircuitState = 'closed' | 'open' | 'half-open';
```

**Methods:**

```typescript
execute<T>(fn: () => Promise<T>): Promise<T>
getStats(): CircuitBreakerStats
reset(): void
```

### `CircuitOpenError`

Thrown when calling `execute()` on an open circuit.

### `retry<T>(fn, options?): Promise<T>`

Retry with exponential backoff and jitter.

```typescript
interface RetryOptions {
  maxRetries?: number;     // default 3
  baseDelayMs?: number;    // default 100
  maxDelayMs?: number;     // default 10000
  backoffFactor?: number;  // default 2
  retryOn?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}
```

### `withCircuitBreaker<T>(breaker, fn, retryOptions?): Promise<T>`

Combines circuit breaker with retry logic.

### `HealthChecker`

Manages named health checks and produces liveness/readiness results.

```typescript
constructor(options?: HealthCheckerOptions)
registerCheck(name: string, checker: () => Promise<ComponentCheck>): void
liveness(): LivenessResult
readiness(): Promise<HealthCheckResult>
```

### `createHealthMiddleware(checker: HealthChecker): (req, res) => void`

HTTP middleware for `/health/live` and `/health/ready` endpoints.

### `memoryUsageCheck(thresholdMb?: number): () => Promise<ComponentCheck>`

Built-in checker that warns when heap usage exceeds the threshold.

### `eventLoopCheck(thresholdMs?: number): () => Promise<ComponentCheck>`

Built-in checker that warns when event loop lag exceeds the threshold.

### `ShutdownManager`

Priority-ordered graceful shutdown handler.

```typescript
constructor(options?: ShutdownOptions)
register(name: string, handler: () => Promise<void>, priority?: number): void
shutdown(reason: string): Promise<ShutdownReport>
```

```typescript
interface ShutdownOptions {
  timeoutMs?: number;       // default 10000
  onShutdown?: () => void;
  signals?: string[];       // default ['SIGTERM', 'SIGINT']
}

interface ShutdownReport {
  reason: string; startedAt: string; completedAt: string;
  durationMs: number; results: HandlerResult[]; clean: boolean;
}
```

### `createShutdownHandler(manager): void`

Attaches signal listeners to the process for the configured signals.

### `httpServerShutdown(server): () => Promise<void>`

Returns a shutdown handler that closes an HTTP server.

### `intervalShutdown(interval): () => Promise<void>`

Returns a shutdown handler that clears an interval timer.

### `customShutdown(fn): () => Promise<void>`

Wraps a custom async function as a shutdown handler.

### `MetricsCollector`

Singleton that collects counters, gauges, and histograms. Exports Prometheus text format.

```typescript
static getInstance(): MetricsCollector
static reset(): void
counter(name: string, help: string): void
gauge(name: string, help: string): void
histogram(name: string, help: string, buckets?: number[]): void
inc(name: string, labels?: Record<string, string>, value?: number): void
dec(name: string, labels?: Record<string, string>, value?: number): void
set(name: string, value: number, labels?: Record<string, string>): void
observe(name: string, value: number, labels?: Record<string, string>): void
getHistogram(name: string): HistogramSnapshot | null
toPrometheus(): string
```

### `createMetricsMiddleware(collector): (req, res) => void`

HTTP middleware that serves Prometheus metrics at `/metrics`.

```typescript
interface HistogramSnapshot {
  count: number; sum: number; min: number; max: number;
  avg: number; p50: number; p90: number; p95: number; p99: number;
  buckets: Array<{ le: number; count: number }>;
}
```

---

## Dashboard

### `DashboardServer`

HTTP server hosting a single-page dashboard with SSE event stream, health, metrics, plugins, and stats API endpoints.

```typescript
constructor(options?: DashboardServerOptions)
start(): Promise<DashboardServerInfo>
stop(): Promise<void>
```

```typescript
interface DashboardServerOptions {
  port?: number;           // default 9200
  host?: string;           // default '127.0.0.1'
  corsOrigin?: string;     // default '*'
  eventStream?: EventStream;
  healthChecker?: HealthChecker;
  pluginRegistry?: PluginRegistry;
}

interface DashboardServerInfo {
  port: number;
  host: string;
  url: string;
}
```

**Endpoints:**

| Path | Description |
|------|-------------|
| `/` | Dashboard HTML SPA |
| `/events` | SSE event stream |
| `/api/health` | Health check readiness |
| `/api/metrics` | Prometheus text metrics |
| `/api/plugins` | Plugin list |
| `/api/stats` | Memory store stats |

---

## Performance

### `LRUCache<T>`

Generic LRU cache with TTL expiration.

```typescript
constructor(options?: LRUCacheOptions)
```

```typescript
interface LRUCacheOptions {
  maxSize?: number;     // default 1000
  defaultTtl?: number;  // default 300000 (5 min)
}
```

**Methods:**

```typescript
get(key: string): T | undefined
set(key: string, value: T, ttl?: number): void
has(key: string): boolean
delete(key: string): boolean
clear(): void
stats(): CacheStats
resetStats(): void
get size(): number
```

```typescript
interface CacheStats {
  hits: number; misses: number; hitRate: number;
  size: number; maxSize: number; evictions: number;
}
```

### `CachedStorageProvider`

Wraps a `StorageProvider` with LRU caching on `getById`, `query`, `count`, and `aggregate`. Invalidates caches on `insert`.

```typescript
constructor(options: { provider: StorageProvider; cache?: LRUCacheOptions })
```

Implements the full `StorageProvider` interface with cache pass-through.

### `BatchProcessor`

Bulk capture and search over a `MemoryStore`, processing in configurable chunk sizes.

```typescript
constructor(options: { store: MemoryStore; batchSize?: number })
captureBatch(inputs: OpsEventInput[]): Promise<BatchResult>
searchBatch(queries: string[], options?: SearchOptions): Promise<BatchSearchResult>
```

```typescript
interface BatchResult {
  captured: OpsEvent[]; errors: Array<{ index: number; error: string }>; totalTime: number;
}
interface BatchSearchResult {
  results: Array<{ query: string; results: SearchResult[] }>; totalTime: number;
}
```

### `batchInsert(provider, events): Promise<void>`

Inserts multiple pre-built `OpsEvent` objects into a `StorageProvider` sequentially.

### `ConnectionPool`

HTTP keep-alive connection pool for Supabase REST API.

```typescript
constructor(options?: ConnectionPoolOptions)
getHttpAgent(): http.Agent
getHttpsAgent(): https.Agent
getStats(): PoolStats
destroy(): void
```

```typescript
interface ConnectionPoolOptions {
  maxConnections?: number; idleTimeout?: number;
  healthCheckInterval?: number;
  keepAlive?: boolean; keepAliveMsecs?: number;
}
```

### `PooledSupabaseProvider`

`StorageProvider` implementation using pooled HTTP connections to Supabase.

```typescript
constructor(config?: PooledSupabaseProviderConfig)
```

```typescript
interface PooledSupabaseProviderConfig {
  url?: string;            // default: SUPABASE_URL env
  serviceRoleKey?: string; // default: SUPABASE_SERVICE_ROLE_KEY env
  poolOptions?: ConnectionPoolOptions;
}
```

### `QueryOptimizer`

Analyzes and optimizes SQLite queries. Requires a `better-sqlite3` database handle.

```typescript
constructor(options: { db: Database.Database })
addCompositeIndexes(): void
explain(sql: string, params?: any[]): QueryPlan
analyzeTable(table: string): TableStats
optimizeConnection(db: Database.Database): void
```

```typescript
interface QueryPlan {
  steps: Array<{ id: number; parent: number; detail: string }>;
  usesIndex: boolean; indexName?: string; isFullScan: boolean;
}
interface TableStats {
  table: string; rowCount: number; indexCount: number;
  indexes: string[]; sizeEstimate: string;
}
```

### `PreparedStatementCache`

LRU cache for prepared SQLite statements.

```typescript
constructor(options: { db: Database.Database; maxStatements?: number })
prepare(sql: string): Database.Statement
clear(): void
```

### `BenchmarkSuite`

Runs insert, search, batch, cache, and concurrent read/write benchmarks.

```typescript
constructor(options: { store: MemoryStore; iterations?: number })
runAll(): Promise<BenchmarkReport>
```

```typescript
interface BenchmarkResult {
  name: string; iterations: number; totalTimeMs: number;
  avgTimeMs: number; opsPerSecond: number;
  p50Ms?: number; p95Ms?: number; p99Ms?: number;
  metadata?: Record<string, unknown>;
}
interface BenchmarkReport {
  timestamp: string;
  system: { nodeVersion: string; platform: string; arch: string; cpus: number; memoryMb: number };
  results: BenchmarkResult[];
  totalTimeMs: number;
}
```
