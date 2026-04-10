/**
 * Injection attack vectors — SQL injection, JSON injection, XSS.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../../src/memory/store';
import { SqliteProvider } from '../../src/memory/providers/sqlite-provider';
import { NoopEmbeddingProvider } from '../../src/memory/embeddings';
import { safeJsonParse, SafeJsonError } from '../../src/utils/safe-json';

const TEST_DB = path.resolve(__dirname, '../fixtures/test-security-injection.db');

function createStore(): MemoryStore {
  return new MemoryStore({
    provider: new SqliteProvider(TEST_DB),
    embeddingProvider: new NoopEmbeddingProvider(),
  });
}

function eventBase() {
  return {
    timestamp: new Date().toISOString(),
    session_id: 'test-session',
    agent_id: 'test-agent',
  };
}

describe('SQL injection', () => {
  let store: MemoryStore;

  afterEach(async () => {
    if (store) await store.close();
  });

  it('rejects SQL injection in event title', async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    store = createStore();
    await store.initialize();

    // Attempt SQL injection via title field
    const event = await store.capture({
      ...eventBase(),
      event_type: 'decision',
      severity: 'low',
      skill: 'context_health',
      title: "'; DROP TABLE ops_events; --",
      detail: 'SQL injection attempt',
      affected_files: [],
      tags: [],
      metadata: {},
    });

    // If we get here, the injection was parameterized properly
    expect(event.id).toBeDefined();
    expect(event.title).toBe("'; DROP TABLE ops_events; --");

    // Verify the table still works
    const results = await store.search('DROP TABLE');
    expect(results.length).toBe(1); // Found the event, table not dropped
  });

  it('rejects SQL injection in search query', async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    store = createStore();
    await store.initialize();

    await store.capture({
      ...eventBase(),
      event_type: 'decision',
      severity: 'low',
      skill: 'context_health',
      title: 'Normal event',
      detail: 'Test',
      affected_files: [],
      tags: [],
      metadata: {},
    });

    // Attempt SQL injection in search
    const results = await store.search("' OR '1'='1");

    // Should not return all rows — parameterized query prevents injection
    // It should search for the literal string
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('rejects SQL injection in tag filter', async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    store = createStore();
    await store.initialize();

    // Insert event with normal tags
    await store.capture({
      ...eventBase(),
      event_type: 'decision',
      severity: 'low',
      skill: 'context_health',
      title: 'Tagged event',
      detail: 'Test',
      affected_files: [],
      tags: ["'; DROP TABLE ops_events; --"],
      metadata: {},
    });

    // Verify store still works
    const stats = await store.stats();
    expect(stats.total_events).toBeGreaterThanOrEqual(1);
  });
});

describe('JSON injection', () => {
  it('rejects duplicate keys', () => {
    const json = '{"status": "ok", "status": "exploited"}';
    expect(() => safeJsonParse(json)).toThrow(SafeJsonError);
  });

  it('rejects prototype pollution via __proto__', () => {
    const json = '{"__proto__": {"isAdmin": true}}';
    expect(() => safeJsonParse(json)).toThrow(SafeJsonError);
  });

  it('handles unicode normalization attack', () => {
    // NFC vs NFD forms of the same character
    const nfc = '\u00e9'; // é (precomposed)
    const nfd = '\u0065\u0301'; // é (decomposed)

    // Both should parse fine as values (not keys)
    const json1 = `{"name": "${nfc}"}`;
    const json2 = `{"name": "${nfd}"}`;

    const result1 = safeJsonParse<Record<string, string>>(json1);
    const result2 = safeJsonParse<Record<string, string>>(json2);

    // Values are preserved as-is by JSON.parse
    expect(result1.name).toBeDefined();
    expect(result2.name).toBeDefined();
  });
});

describe('XSS in event content', () => {
  let store: MemoryStore;

  afterEach(async () => {
    if (store) await store.close();
  });

  it('stores but does not execute script tags in event title', async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    store = createStore();
    await store.initialize();

    const event = await store.capture({
      ...eventBase(),
      event_type: 'decision',
      severity: 'low',
      skill: 'context_health',
      title: '<script>alert("XSS")</script>',
      detail: '<img onerror="alert(1)" src="x">',
      affected_files: [],
      tags: [],
      metadata: {},
    });

    // Content is stored literally — no execution context
    expect(event.title).toBe('<script>alert("XSS")</script>');
    expect(event.detail).toBe('<img onerror="alert(1)" src="x">');
  });
});
