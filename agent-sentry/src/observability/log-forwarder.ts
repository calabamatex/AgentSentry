/**
 * log-forwarder.ts — Forwards NDJSON hook log files into the MemoryStore.
 *
 * Reads cost-log, permission-log, delegation-log, and other NDJSON files,
 * normalizes entries into OpsEvents, and persists them via the MemoryStore.
 * Tracks a cursor per file to avoid re-sending on subsequent runs.
 *
 * Designed to run at session end (via session-checkpoint hook) or on-demand
 * via CLI. Works with both SQLite and Supabase providers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../memory/store';
import type { OpsEventInput } from '../memory/schema';
import { Logger } from './logger';

const logger = new Logger({ module: 'log-forwarder' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForwardResult {
  file: string;
  forwarded: number;
  errors: number;
}

export interface ForwardOptions {
  /** Session ID to tag forwarded events with. */
  sessionId?: string;
  /** Only forward specific log files. Default: all known. */
  sources?: string[];
}

interface LogSourceConfig {
  /** Filename (relative to dashboard/data/). */
  filename: string;
  /** OpsEvent event_type to use. */
  eventType: string;
  /** Extract a human-readable title from the log entry. */
  titleFn: (entry: Record<string, unknown>) => string;
}

// ---------------------------------------------------------------------------
// Known log sources
// ---------------------------------------------------------------------------

const LOG_SOURCES: LogSourceConfig[] = [
  {
    filename: 'cost-log.json',
    eventType: 'cost_event',
    titleFn: (e) => `Cost: $${e.call_cost ?? '?'} (${e.model_tier ?? 'unknown'})`,
  },
  {
    filename: 'permission-log.json',
    eventType: 'permission_event',
    titleFn: (e) => `Permission ${e.decision ?? '?'}: ${e.tool ?? '?'} (${e.agent_id ?? 'unknown'})`,
  },
  {
    filename: 'delegation-log.json',
    eventType: 'delegation_event',
    titleFn: (e) => `Delegation ${e.decision ?? '?'}: ${e.tool ?? '?'}`,
  },
  {
    filename: 'lifecycle.json',
    eventType: 'lifecycle_event',
    titleFn: (e) => `Agent ${e.agent_id ?? '?'}: ${e.from ?? '?'} → ${e.to ?? '?'}`,
  },
];

// ---------------------------------------------------------------------------
// LogForwarder
// ---------------------------------------------------------------------------

export class LogForwarder {
  private store: MemoryStore;
  private dataDir: string;
  private cursorDir: string;

  constructor(store: MemoryStore, dataDir: string) {
    this.store = store;
    this.dataDir = dataDir;
    this.cursorDir = path.join(dataDir, '.cursors');
  }

  /**
   * Forward all pending log entries to the MemoryStore.
   * Returns results per file.
   */
  async forward(options?: ForwardOptions): Promise<ForwardResult[]> {
    if (!fs.existsSync(this.cursorDir)) {
      fs.mkdirSync(this.cursorDir, { recursive: true });
    }

    const sources = options?.sources
      ? LOG_SOURCES.filter((s) => options.sources!.includes(s.filename.replace('.json', '')))
      : LOG_SOURCES;

    const results: ForwardResult[] = [];

    for (const source of sources) {
      const result = await this.forwardFile(source, options?.sessionId ?? 'log-sync');
      results.push(result);
    }

    return results;
  }

  private async forwardFile(source: LogSourceConfig, sessionId: string): Promise<ForwardResult> {
    const filePath = path.join(this.dataDir, source.filename);
    const result: ForwardResult = { file: source.filename, forwarded: 0, errors: 0 };

    if (!fs.existsSync(filePath)) {
      return result;
    }

    const cursor = this.readCursor(source.filename);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      logger.warn('Failed to read log file', { file: filePath, error: err instanceof Error ? err.message : String(err) });
      return result;
    }

    const lines = content.split('\n').filter(Boolean);
    const newLines = lines.slice(cursor);

    for (const line of newLines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const event: OpsEventInput = {
          timestamp: (entry.timestamp as string) ?? new Date().toISOString(),
          session_id: sessionId,
          agent_id: (entry.agent_id as string) ?? 'system',
          event_type: source.eventType,
          severity: 'low',
          skill: 'system',
          title: source.titleFn(entry),
          detail: line,
          affected_files: [],
          tags: ['log-sync', source.eventType],
          metadata: entry,
        };

        await this.store.capture(event);
        result.forwarded++;
      } catch (err) {
        result.errors++;
        logger.debug('Failed to forward log entry', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    this.writeCursor(source.filename, lines.length);
    return result;
  }

  private readCursor(filename: string): number {
    const cursorFile = path.join(this.cursorDir, filename + '.cursor');
    if (!fs.existsSync(cursorFile)) return 0;
    try {
      return parseInt(fs.readFileSync(cursorFile, 'utf-8').trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  private writeCursor(filename: string, value: number): void {
    const cursorFile = path.join(this.cursorDir, filename + '.cursor');
    fs.writeFileSync(cursorFile, String(value), 'utf-8');
  }
}
