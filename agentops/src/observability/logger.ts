/**
 * logger.ts — Structured logging with correlation IDs.
 * Zero external dependencies — uses only Node built-in crypto.
 */

import { randomUUID } from 'crypto';

/** Supported log levels ordered by severity. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Numeric priority for each level (higher = more severe). */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** A single structured log entry emitted as JSON-lines. */
export interface LogEntry {
  level: LogLevel;
  msg: string;
  traceId: string;
  timestamp: string;
  module: string;
  [key: string]: unknown;
}

/** Callback signature for the output sink. */
export type OutputSink = (line: string) => void;

/** Options for constructing a Logger. */
export interface LoggerOptions {
  /** Module name attached to every log entry. */
  module: string;
  /** Correlation / trace ID propagated through all entries. */
  traceId?: string;
  /** Minimum log level to emit (default: 'info'). */
  minLevel?: LogLevel;
  /** Output sink callback (default: process.stderr.write). */
  sink?: OutputSink;
}

/**
 * Generates a unique trace ID using Node's built-in crypto.randomUUID().
 */
export function generateTraceId(): string {
  return randomUUID();
}

/**
 * Structured logger that emits JSON-lines with correlation IDs.
 *
 * Every log call produces a single JSON line containing at minimum:
 * level, msg, traceId, timestamp, and module.
 */
export class Logger {
  private readonly _module: string;
  private readonly _traceId: string;
  private readonly _minLevel: LogLevel;
  private readonly _sink: OutputSink;

  /** Global default logger instance. */
  private static _default: Logger | undefined;

  constructor(options: LoggerOptions) {
    this._module = options.module;
    this._traceId = options.traceId ?? generateTraceId();
    this._minLevel = options.minLevel ?? 'info';
    this._sink = options.sink ?? ((line: string) => process.stderr.write(line));
  }

  /** Returns the current trace ID. */
  get traceId(): string {
    return this._traceId;
  }

  /** Returns the module name. */
  get module(): string {
    return this._module;
  }

  /** Returns the minimum log level. */
  get minLevel(): LogLevel {
    return this._minLevel;
  }

  /**
   * Creates a new Logger with the given traceId, preserving other settings.
   */
  withTrace(traceId: string): Logger {
    return new Logger({
      module: this._module,
      traceId,
      minLevel: this._minLevel,
      sink: this._sink,
    });
  }

  /**
   * Creates a child logger inheriting the parent's traceId (unless overridden)
   * and output settings, but with a different module name.
   */
  child(module: string, traceId?: string): Logger {
    return new Logger({
      module,
      traceId: traceId ?? this._traceId,
      minLevel: this._minLevel,
      sink: this._sink,
    });
  }

  /** Log at debug level. */
  debug(msg: string, extra?: Record<string, unknown>): void {
    this._emit('debug', msg, extra);
  }

  /** Log at info level. */
  info(msg: string, extra?: Record<string, unknown>): void {
    this._emit('info', msg, extra);
  }

  /** Log at warn level. */
  warn(msg: string, extra?: Record<string, unknown>): void {
    this._emit('warn', msg, extra);
  }

  /** Log at error level. */
  error(msg: string, extra?: Record<string, unknown>): void {
    this._emit('error', msg, extra);
  }

  /**
   * Returns the global default logger, creating one if needed.
   */
  static getDefault(): Logger {
    if (!Logger._default) {
      Logger._default = new Logger({ module: 'default' });
    }
    return Logger._default;
  }

  /**
   * Sets the global default logger instance.
   */
  static setDefault(logger: Logger): void {
    Logger._default = logger;
  }

  /**
   * Resets the global default logger (useful for testing).
   */
  static resetDefault(): void {
    Logger._default = undefined;
  }

  /**
   * Core emit method — builds a LogEntry, checks level, serializes, and writes.
   */
  private _emit(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this._minLevel]) {
      return;
    }

    const entry: LogEntry = {
      level,
      msg,
      traceId: this._traceId,
      timestamp: new Date().toISOString(),
      module: this._module,
      ...(extra ?? {}),
    };

    this._sink(JSON.stringify(entry) + '\n');
  }
}
