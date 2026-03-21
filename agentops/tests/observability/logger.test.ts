/**
 * Tests for observability/logger — structured logging with correlation IDs.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Logger,
  generateTraceId,
  type LogEntry,
  type LogLevel,
} from '../../src/observability/logger';

/** Helper: collects lines written by the logger into an array. */
function createCollector(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

/** Helper: parse the first collected line as a LogEntry. */
function parseFirst(lines: string[]): LogEntry {
  expect(lines.length).toBeGreaterThanOrEqual(1);
  return JSON.parse(lines[0]) as LogEntry;
}

describe('generateTraceId', () => {
  it('should return a valid UUID string', () => {
    const id = generateTraceId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should return unique values on successive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
    expect(ids.size).toBe(100);
  });
});

describe('Logger', () => {
  let collector: ReturnType<typeof createCollector>;

  beforeEach(() => {
    collector = createCollector();
    Logger.resetDefault();
  });

  // --- Log level output ---

  it('should output correct JSON for debug level', () => {
    const logger = new Logger({ module: 'test', minLevel: 'debug', sink: collector.sink });
    logger.debug('debug message');
    const entry = parseFirst(collector.lines);
    expect(entry.level).toBe('debug');
    expect(entry.msg).toBe('debug message');
  });

  it('should output correct JSON for info level', () => {
    const logger = new Logger({ module: 'test', sink: collector.sink });
    logger.info('info message');
    const entry = parseFirst(collector.lines);
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('info message');
  });

  it('should output correct JSON for warn level', () => {
    const logger = new Logger({ module: 'test', sink: collector.sink });
    logger.warn('warn message');
    const entry = parseFirst(collector.lines);
    expect(entry.level).toBe('warn');
    expect(entry.msg).toBe('warn message');
  });

  it('should output correct JSON for error level', () => {
    const logger = new Logger({ module: 'test', sink: collector.sink });
    logger.error('error message');
    const entry = parseFirst(collector.lines);
    expect(entry.level).toBe('error');
    expect(entry.msg).toBe('error message');
  });

  // --- JSON structure ---

  it('should include all required fields in the log entry', () => {
    const logger = new Logger({ module: 'mymod', traceId: 'trace-123', sink: collector.sink });
    logger.info('hello');
    const entry = parseFirst(collector.lines);
    expect(entry).toHaveProperty('level', 'info');
    expect(entry).toHaveProperty('msg', 'hello');
    expect(entry).toHaveProperty('traceId', 'trace-123');
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('module', 'mymod');
  });

  it('should emit each line terminated with a newline', () => {
    const logger = new Logger({ module: 'test', sink: collector.sink });
    logger.info('line');
    expect(collector.lines[0]).toMatch(/\n$/);
  });

  // --- Timestamp ---

  it('should produce ISO-8601 timestamps', () => {
    const logger = new Logger({ module: 'test', sink: collector.sink });
    logger.info('ts check');
    const entry = parseFirst(collector.lines);
    // ISO-8601 pattern: YYYY-MM-DDTHH:MM:SS.sssZ
    expect(entry.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    // Should also parse as a valid date
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
  });

  // --- TraceId propagation ---

  it('should propagate the traceId set via constructor', () => {
    const logger = new Logger({ module: 'test', traceId: 'abc-123', sink: collector.sink });
    logger.info('first');
    logger.warn('second');
    const e1 = JSON.parse(collector.lines[0]) as LogEntry;
    const e2 = JSON.parse(collector.lines[1]) as LogEntry;
    expect(e1.traceId).toBe('abc-123');
    expect(e2.traceId).toBe('abc-123');
  });

  it('should auto-generate a traceId when none is provided', () => {
    const logger = new Logger({ module: 'test', sink: collector.sink });
    expect(logger.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should create a new logger with a different traceId via withTrace()', () => {
    const logger = new Logger({ module: 'test', traceId: 'old', sink: collector.sink });
    const derived = logger.withTrace('new-trace');
    derived.info('derived msg');
    const entry = parseFirst(collector.lines);
    expect(entry.traceId).toBe('new-trace');
    expect(derived.module).toBe('test');
  });

  // --- Child logger ---

  it('should create a child logger inheriting parent traceId', () => {
    const parent = new Logger({ module: 'parent', traceId: 'parent-trace', sink: collector.sink });
    const child = parent.child('child-mod');
    child.info('from child');
    const entry = parseFirst(collector.lines);
    expect(entry.module).toBe('child-mod');
    expect(entry.traceId).toBe('parent-trace');
  });

  it('should allow child logger to override traceId', () => {
    const parent = new Logger({ module: 'parent', traceId: 'parent-trace', sink: collector.sink });
    const child = parent.child('child-mod', 'child-trace');
    child.info('from child');
    const entry = parseFirst(collector.lines);
    expect(entry.traceId).toBe('child-trace');
  });

  it('should inherit minLevel in child logger', () => {
    const parent = new Logger({ module: 'parent', minLevel: 'warn', sink: collector.sink });
    const child = parent.child('child-mod');
    child.info('should be suppressed');
    child.warn('should appear');
    expect(collector.lines).toHaveLength(1);
    const entry = parseFirst(collector.lines);
    expect(entry.level).toBe('warn');
  });

  // --- Minimum log level filtering ---

  it('should suppress debug when minLevel is info (default)', () => {
    const logger = new Logger({ module: 'test', sink: collector.sink });
    logger.debug('hidden');
    expect(collector.lines).toHaveLength(0);
  });

  it('should suppress info and debug when minLevel is warn', () => {
    const logger = new Logger({ module: 'test', minLevel: 'warn', sink: collector.sink });
    logger.debug('no');
    logger.info('no');
    logger.warn('yes');
    logger.error('yes');
    expect(collector.lines).toHaveLength(2);
    expect((JSON.parse(collector.lines[0]) as LogEntry).level).toBe('warn');
    expect((JSON.parse(collector.lines[1]) as LogEntry).level).toBe('error');
  });

  it('should emit all levels when minLevel is debug', () => {
    const logger = new Logger({ module: 'test', minLevel: 'debug', sink: collector.sink });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(collector.lines).toHaveLength(4);
  });

  // --- Custom output sink ---

  it('should call the custom sink with serialized JSON', () => {
    const mockSink = vi.fn();
    const logger = new Logger({ module: 'test', sink: mockSink });
    logger.info('test message');
    expect(mockSink).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(mockSink.mock.calls[0][0]) as LogEntry;
    expect(parsed.msg).toBe('test message');
  });

  // --- Extra fields ---

  it('should include extra fields in the log entry', () => {
    const logger = new Logger({ module: 'test', sink: collector.sink });
    logger.info('with extras', { userId: 42, action: 'login' });
    const entry = parseFirst(collector.lines);
    expect(entry.userId).toBe(42);
    expect(entry.action).toBe('login');
  });

  it('should not include extra fields when none are provided', () => {
    const logger = new Logger({ module: 'test', traceId: 'tid', sink: collector.sink });
    logger.info('no extras');
    const entry = parseFirst(collector.lines);
    // Only the standard keys should be present
    expect(Object.keys(entry).sort()).toEqual(
      ['level', 'module', 'msg', 'timestamp', 'traceId'].sort(),
    );
  });

  // --- Default singleton ---

  it('should return a default logger via getDefault()', () => {
    const logger = Logger.getDefault();
    expect(logger).toBeInstanceOf(Logger);
    expect(logger.module).toBe('default');
  });

  it('should return the same instance on repeated getDefault() calls', () => {
    const a = Logger.getDefault();
    const b = Logger.getDefault();
    expect(a).toBe(b);
  });

  it('should allow overriding the default logger via setDefault()', () => {
    const custom = new Logger({ module: 'custom', sink: collector.sink });
    Logger.setDefault(custom);
    const retrieved = Logger.getDefault();
    expect(retrieved).toBe(custom);
    expect(retrieved.module).toBe('custom');
  });

  // --- Accessor properties ---

  it('should expose module and minLevel via getters', () => {
    const logger = new Logger({ module: 'mymod', minLevel: 'error', sink: collector.sink });
    expect(logger.module).toBe('mymod');
    expect(logger.minLevel).toBe('error');
  });
});
