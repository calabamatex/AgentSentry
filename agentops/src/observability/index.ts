/**
 * Observability module — M5 Production Hardening & Observability.
 *
 * Re-exports structured logging, circuit breakers, health checks,
 * graceful shutdown, and metrics collection.
 */

// Logger
export { Logger, generateTraceId } from './logger';
export type { LogLevel, LogEntry, OutputSink, LoggerOptions } from './logger';

// Circuit Breaker & Retry
export { CircuitBreaker, CircuitOpenError, retry, withCircuitBreaker } from './circuit-breaker';
export type { CircuitState, CircuitBreakerOptions, CircuitBreakerStats, RetryOptions } from './circuit-breaker';

// Health & Readiness
export { HealthChecker, createHealthMiddleware, memoryUsageCheck, eventLoopCheck } from './health';
export type { ComponentCheck, HealthCheckResult, LivenessResult, HealthCheckerOptions, CheckerFn } from './health';

// Graceful Shutdown
export { ShutdownManager, createShutdownHandler, httpServerShutdown, intervalShutdown, customShutdown } from './shutdown';
export type { ShutdownOptions, ShutdownReport, HandlerResult } from './shutdown';

// Metrics
export { MetricsCollector, createMetricsMiddleware } from './metrics';
export type { HistogramSnapshot } from './metrics';
