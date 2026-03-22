import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteProvider } from '../../../src/memory/providers/sqlite-provider';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { computeHash } from '../../../src/memory/schema';
import path from 'path';
import fs from 'fs';

describe('SqliteProvider robustness', () => {
  let provider: SqliteProvider;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = path.join(__dirname, `test-robustness-${Date.now()}.db`);
    provider = new SqliteProvider(dbPath);
    await provider.initialize();
  });

  afterEach(async () => {
    await provider.close();
    try { fs.unlinkSync(dbPath); } catch {}
  });

  it('should handle corrupted affected_files JSON gracefully', async () => {
    // Insert a valid event first
    const event = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      session_id: 'test-session',
      agent_id: 'test-agent',
      event_type: 'tool_call' as const,
      severity: 'info' as const,
      skill: 'save_points' as const,
      title: 'Test event',
      detail: 'Testing corrupted data handling',
      affected_files: ['file.ts'],
      tags: ['test'],
      metadata: {},
      hash: 'test-hash',
      prev_hash: '0'.repeat(64),
    };
    await provider.insert(event);

    // Now corrupt the affected_files column directly via SQLite
    const db = new Database(dbPath);
    db.prepare('UPDATE ops_events SET affected_files = ? WHERE id = ?').run('not-valid-json{{{', event.id);
    db.close();

    // Query should return the event with empty array fallback, not crash
    const result = await provider.getById(event.id);
    expect(result).toBeDefined();
    expect(result!.affected_files).toEqual([]);
  });

  it('should handle corrupted tags JSON gracefully', async () => {
    const event = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      session_id: 'test-session',
      agent_id: 'test-agent',
      event_type: 'tool_call' as const,
      severity: 'info' as const,
      skill: 'save_points' as const,
      title: 'Test event',
      detail: 'Testing corrupted tags',
      affected_files: [],
      tags: ['tag1'],
      metadata: {},
      hash: 'test-hash-2',
      prev_hash: '0'.repeat(64),
    };
    await provider.insert(event);

    const db = new Database(dbPath);
    db.prepare('UPDATE ops_events SET tags = ? WHERE id = ?').run('broken]]]', event.id);
    db.close();

    const result = await provider.getById(event.id);
    expect(result).toBeDefined();
    expect(result!.tags).toEqual([]);
  });

  it('should handle corrupted metadata JSON gracefully', async () => {
    const event = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      session_id: 'test-session',
      agent_id: 'test-agent',
      event_type: 'tool_call' as const,
      severity: 'info' as const,
      skill: 'save_points' as const,
      title: 'Test event',
      detail: 'Testing corrupted metadata',
      affected_files: [],
      tags: [],
      metadata: { key: 'value' },
      hash: 'test-hash-3',
      prev_hash: '0'.repeat(64),
    };
    await provider.insert(event);

    const db = new Database(dbPath);
    db.prepare('UPDATE ops_events SET metadata = ? WHERE id = ?').run('{invalid', event.id);
    db.close();

    const result = await provider.getById(event.id);
    expect(result).toBeDefined();
    expect(result!.metadata).toEqual({});
  });

  it('should handle empty-string JSON fields gracefully', async () => {
    const event = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      session_id: 'test-session',
      agent_id: 'test-agent',
      event_type: 'tool_call' as const,
      severity: 'info' as const,
      skill: 'save_points' as const,
      title: 'Test event',
      detail: 'Testing empty string fields',
      affected_files: [],
      tags: [],
      metadata: {},
      hash: 'test-hash-4',
      prev_hash: '0'.repeat(64),
    };
    await provider.insert(event);

    // Set columns to empty strings (falsy values that safeJsonParse should handle)
    const db = new Database(dbPath);
    db.prepare("UPDATE ops_events SET affected_files = '', tags = '', metadata = '' WHERE id = ?").run(event.id);
    db.close();

    const result = await provider.getById(event.id);
    expect(result).toBeDefined();
    expect(result!.affected_files).toEqual([]);
    expect(result!.tags).toEqual([]);
    expect(result!.metadata).toEqual({});
  });
});
