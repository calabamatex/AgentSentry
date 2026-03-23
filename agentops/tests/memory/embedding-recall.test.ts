/**
 * embedding-recall.test.ts — Semantic recall quality benchmarks.
 *
 * Tests that the memory search system returns relevant results for known queries.
 * Uses NoopEmbeddingProvider (keyword fallback) since ONNX is optional.
 * When a real embedding provider is available, these tests validate true semantic recall.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../../src/memory/store';
import { SqliteProvider } from '../../src/memory/providers/sqlite-provider';
import { NoopEmbeddingProvider } from '../../src/memory/embeddings';
import type { OpsEventInput, EventType, Severity, Skill } from '../../src/memory/schema';

const TEST_DB = ':memory:';
const FIXTURES_PATH = path.resolve(__dirname, '../fixtures/embedding-benchmark-fixtures.json');

interface FixtureEvent {
  event_type: string;
  severity: string;
  skill: string;
  title: string;
  detail: string;
}

interface FixtureQuery {
  query: string;
  expected_title: string;
  expected_rank: number;
  description: string;
}

interface Fixture {
  name: string;
  events: FixtureEvent[];
  queries: FixtureQuery[];
}

interface FixtureFile {
  description: string;
  fixtures: Fixture[];
}

function loadFixtures(): FixtureFile {
  return JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8'));
}

function toEventInput(event: FixtureEvent, index: number): OpsEventInput {
  return {
    timestamp: new Date(Date.now() - index * 60000).toISOString(),
    session_id: 'recall-bench',
    agent_id: 'fixture',
    event_type: event.event_type as EventType,
    severity: event.severity as Severity,
    skill: event.skill as Skill,
    title: event.title,
    detail: event.detail,
    affected_files: [],
    tags: ['benchmark', 'recall-fixture'],
    metadata: {},
  };
}

describe('Embedding Recall Quality', () => {
  let store: MemoryStore;
  const fixtureFile = loadFixtures();

  beforeEach(async () => {
    store = new MemoryStore({
      provider: new SqliteProvider(TEST_DB),
      embeddingProvider: new NoopEmbeddingProvider(),
    });
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it('fixture file loads and has valid structure', () => {
    expect(fixtureFile.fixtures.length).toBeGreaterThan(0);
    for (const fixture of fixtureFile.fixtures) {
      expect(fixture.name).toBeTruthy();
      expect(fixture.events.length).toBeGreaterThan(0);
      expect(fixture.queries.length).toBeGreaterThan(0);
    }
  });

  it('fixture events have valid schema fields', () => {
    const validTypes = ['decision', 'violation', 'incident', 'pattern', 'handoff', 'audit_finding'];
    const validSeverities = ['low', 'medium', 'high', 'critical'];
    const validSkills = ['save_points', 'context_health', 'standing_orders', 'small_bets', 'proactive_safety', 'system'];

    for (const fixture of fixtureFile.fixtures) {
      for (const event of fixture.events) {
        expect(validTypes).toContain(event.event_type);
        expect(validSeverities).toContain(event.severity);
        expect(validSkills).toContain(event.skill);
        expect(event.title.length).toBeGreaterThan(0);
        expect(event.detail.length).toBeGreaterThan(0);
      }
    }
  });

  for (const fixture of fixtureFile.fixtures) {
    describe(`Domain: ${fixture.name}`, () => {
      beforeEach(async () => {
        // Seed all events from this fixture
        for (let i = 0; i < fixture.events.length; i++) {
          await store.capture(toEventInput(fixture.events[i], i));
        }
      });

      it('all seeded events are retrievable', async () => {
        const results = await store.list({ limit: 100 });
        expect(results.length).toBe(fixture.events.length);
      });

      for (const query of fixture.queries) {
        it(`recall: ${query.description}`, async () => {
          const results = await store.search(query.query, { limit: 5 });

          // With NoopEmbeddingProvider, search falls back to keyword matching.
          // We verify the expected event appears in results (top-N recall).
          const titles = results.map((r) => r.event.title);
          expect(titles).toContain(query.expected_title);
        });
      }
    });
  }

  describe('Cross-domain recall', () => {
    beforeEach(async () => {
      // Seed ALL events from ALL fixtures
      let idx = 0;
      for (const fixture of fixtureFile.fixtures) {
        for (const event of fixture.events) {
          await store.capture(toEventInput(event, idx++));
        }
      }
    });

    it('returns results from correct domain when all events are mixed', async () => {
      // Query security domain — should find security event, not workflow
      const secResults = await store.search('SQL injection', { limit: 3 });
      const secTitles = secResults.map((r) => r.event.title);
      expect(secTitles).toContain('SQL injection detected in user login endpoint');
    });

    it('search returns non-empty results for all fixture queries', async () => {
      for (const fixture of fixtureFile.fixtures) {
        for (const query of fixture.queries) {
          const results = await store.search(query.query, { limit: 5 });
          expect(results.length).toBeGreaterThan(0);
        }
      }
    });

    it('total event count matches sum of all fixtures', async () => {
      const totalExpected = fixtureFile.fixtures.reduce((sum, f) => sum + f.events.length, 0);
      const all = await store.list({ limit: 1000 });
      expect(all.length).toBe(totalExpected);
    });
  });

  describe('Recall metrics summary', () => {
    it('computes recall@5 across all fixtures', async () => {
      let hits = 0;
      let total = 0;

      for (const fixture of fixtureFile.fixtures) {
        // Fresh store per fixture domain
        const domainStore = new MemoryStore({
          provider: new SqliteProvider(':memory:'),
          embeddingProvider: new NoopEmbeddingProvider(),
        });
        await domainStore.initialize();

        for (let i = 0; i < fixture.events.length; i++) {
          await domainStore.capture(toEventInput(fixture.events[i], i));
        }

        for (const query of fixture.queries) {
          total++;
          const results = await domainStore.search(query.query, { limit: 5 });
          const titles = results.map((r) => r.event.title);
          if (titles.includes(query.expected_title)) {
            hits++;
          }
        }

        await domainStore.close();
      }

      const recall = total > 0 ? hits / total : 0;
      // With keyword fallback, recall should be at least 50%
      // With real embeddings, expect > 80%
      expect(recall).toBeGreaterThanOrEqual(0.5);
    });
  });
});
