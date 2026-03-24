/**
 * Distributed Tracing Module (Section 13)
 *
 * OpenTelemetry-compatible trace context propagation and span recording.
 * Generates W3C-compliant trace IDs (32 hex) and span IDs (16 hex),
 * records spans as NDJSON to agent-sentry/dashboard/data/traces.json.
 */

import { randomBytes } from "crypto";
import { appendFileSync, mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpanStatus = "ok" | "error" | "timeout" | "cancelled";

export interface Span {
  /** 32-char hex trace identifier (W3C / OpenTelemetry compatible) */
  traceId: string;
  /** 16-char hex span identifier */
  spanId: string;
  /** Parent span ID, or null for root spans */
  parentSpanId: string | null;
  /** Identifier of the agent that owns this span */
  agentId: string;
  /** High-level operation name (e.g. "llm.chat", "tool.invoke", "agent.delegate") */
  operation: string;
  /** The target resource or sub-agent the operation acts on */
  target: string;
  /** Input token count consumed during this span (0 if non-LLM) */
  input_tokens: number;
  /** Output token count produced during this span (0 if non-LLM) */
  output_tokens: number;
  /** Wall-clock latency in milliseconds */
  latency_ms: number;
  /** Terminal status of the span */
  status: SpanStatus;
  /** ISO-8601 timestamp when the span was created */
  ts: string;
}

export interface TraceContext {
  /** The trace this context belongs to */
  traceId: string;
  /** Current span acting as the parent for child spans */
  spanId: string;
  /** Agent that owns this context */
  agentId: string;
}

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

/**
 * Generate a 32-character hex trace ID using crypto.randomBytes.
 * Conforms to the W3C Trace Context specification (16 bytes / 128 bits).
 */
export function generateTraceId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Generate a 16-character hex span ID using crypto.randomBytes.
 * Conforms to the W3C Trace Context specification (8 bytes / 64 bits).
 */
export function generateSpanId(): string {
  return randomBytes(8).toString("hex");
}

// ---------------------------------------------------------------------------
// Span Factory
// ---------------------------------------------------------------------------

/**
 * Create a new Span record.
 *
 * Token counts, latency, and status default to zero / "ok" so that callers
 * can fill them in after the operation completes (e.g. via `finalizeSpan`).
 */
export function createSpan(
  traceId: string,
  parentSpanId: string | null,
  agentId: string,
  operation: string,
  target: string
): Span {
  return {
    traceId,
    spanId: generateSpanId(),
    parentSpanId,
    agentId,
    operation,
    target,
    input_tokens: 0,
    output_tokens: 0,
    latency_ms: 0,
    status: "ok",
    ts: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Trace Context Helpers
// ---------------------------------------------------------------------------

/**
 * Create a root TraceContext — the starting point for a new distributed trace.
 */
export function createTraceContext(agentId: string): TraceContext {
  return {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    agentId,
  };
}

/**
 * Derive a child TraceContext from an existing one, preserving the trace ID
 * while generating a fresh span ID.  Use this when delegating work to a
 * sub-agent so the entire call tree shares a single trace.
 */
export function childContext(
  parent: TraceContext,
  childAgentId: string
): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: generateSpanId(),
    agentId: childAgentId,
  };
}

// ---------------------------------------------------------------------------
// Span Finalization
// ---------------------------------------------------------------------------

/**
 * Finalize a span with measured values.  Returns a new Span (immutable update).
 */
export function finalizeSpan(
  span: Span,
  update: Partial<Pick<Span, "input_tokens" | "output_tokens" | "latency_ms" | "status">>
): Span {
  return { ...span, ...update };
}

// ---------------------------------------------------------------------------
// Persistence — NDJSON append
// ---------------------------------------------------------------------------

const DEFAULT_TRACES_PATH = resolve(
  __dirname,
  "..",
  "dashboard",
  "data",
  "traces.json"
);

/**
 * Append a span record as a single NDJSON line to the traces file.
 *
 * Creates the parent directory and file if they do not exist.
 *
 * @param span   - The span to persist.
 * @param path   - Override the default traces file location.
 */
export function appendSpan(
  span: Span,
  path: string = DEFAULT_TRACES_PATH
): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(path, JSON.stringify(span) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Convenience: create, finalize, and persist in one call
// ---------------------------------------------------------------------------

/**
 * Record a completed span in a single call.
 *
 * Useful for fire-and-forget instrumentation where you already have all
 * measurements available.
 */
export function recordSpan(
  traceId: string,
  parentSpanId: string | null,
  agentId: string,
  operation: string,
  target: string,
  metrics: {
    input_tokens?: number;
    output_tokens?: number;
    latency_ms?: number;
    status?: SpanStatus;
  } = {},
  path?: string
): Span {
  const span = finalizeSpan(
    createSpan(traceId, parentSpanId, agentId, operation, target),
    {
      input_tokens: metrics.input_tokens ?? 0,
      output_tokens: metrics.output_tokens ?? 0,
      latency_ms: metrics.latency_ms ?? 0,
      status: metrics.status ?? "ok",
    }
  );
  appendSpan(span, path);
  return span;
}
