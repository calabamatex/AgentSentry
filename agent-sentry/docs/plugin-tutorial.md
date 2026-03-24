# AgentSentry v4 Plugin Tutorial

## What Is an AgentSentry Plugin?

AgentSentry uses an event-driven architecture built on a central **EventBus**. Every
meaningful action -- tool use, session start, audit log, error -- emits an event.
A plugin subscribes to those events, reacts to them, and optionally enriches them
with additional metadata. Plugins are plain TypeScript modules; there is no special
registration framework.

The three primitives you will use:

| Primitive | Module | Purpose |
|-----------|--------|---------|
| `subscribe` / `emit` | `core/event-bus` | Listen for or fire events |
| `EnrichmentProvider` | `memory/enrichment` | Add cross-tags, root-cause hints |
| `MemoryStore` | `memory/store` | Persist and query `OpsEvent` records |

## Prerequisites

- Node.js 18+
- The `agent-sentry` package (local or installed)
- Basic familiarity with TypeScript and async/await

## Step 1: Scaffold the Plugin

Create a file at `src/plugins/commit-size-enforcer.ts`:

```typescript
import { subscribe, EventType, EventPayload } from '../../core/event-bus';
import { MemoryStore } from '../memory/store';
import { EnrichmentProvider, EnrichmentResult } from '../memory/enrichment';
import { OpsEvent } from '../memory/schema';

export interface PluginOptions {
  maxFilesPerCommit: number;
  store: MemoryStore;
}

export function activate(options: PluginOptions): void {
  // We will fill this in over the next steps.
}
```

Every plugin exports an `activate` function that receives its configuration and
wires up subscriptions. This keeps the module side-effect-free until explicitly
initialized.

## Step 2: Subscribe to Events

Inside `activate`, use `subscribe` to listen for `PostToolUse` events, which
fire after every tool invocation (including git commits):

```typescript
export function activate(options: PluginOptions): void {
  const { maxFilesPerCommit, store } = options;

  subscribe(EventType.PostToolUse, async (payload: EventPayload) => {
    const tool = payload.data.tool as string | undefined;
    if (tool !== 'git_commit') return; // only care about commits

    const files = (payload.data.affected_files as string[]) ?? [];

    if (files.length > maxFilesPerCommit) {
      await store.capture({
        timestamp: payload.timestamp,
        session_id: (payload.data.session_id as string) ?? 'unknown',
        agent_id: (payload.data.agent_id as string) ?? 'system',
        event_type: 'violation',
        severity: files.length > maxFilesPerCommit * 2 ? 'high' : 'medium',
        skill: 'small_bets',
        title: `Commit touches ${files.length} files (limit: ${maxFilesPerCommit})`,
        detail: `Files: ${files.slice(0, 10).join(', ')}${files.length > 10 ? '...' : ''}`,
        affected_files: files,
        tags: ['commit-size', 'plugin:commit-size-enforcer'],
        metadata: { maxFilesPerCommit, actualFiles: files.length },
      });
    }
  });
}
```

Key points:

- `subscribe` takes an `EventType` enum value and an async handler.
- The handler receives an `EventPayload` with `type`, `timestamp`, and `data`.
- Filter early (`if (tool !== 'git_commit') return`) to avoid unnecessary work.
- Use `store.capture()` to persist a new `OpsEvent` into the hash-chain.

## Step 3: Enrich Events

Implement `EnrichmentProvider` to add metadata to events after they are captured.
The enricher receives the event and a window of recent events:

```typescript
export class CommitSizeEnricher implements EnrichmentProvider {
  constructor(private maxFiles: number) {}

  async enrich(event: OpsEvent, recentEvents: OpsEvent[]): Promise<EnrichmentResult> {
    const result: EnrichmentResult = {
      cross_tags: [],
      related_events: [],
    };

    // Only act on our own violation events
    if (!event.tags.includes('commit-size')) return result;

    // Count how many commit-size violations happened recently
    const recent = recentEvents.filter((e) => e.tags.includes('commit-size'));

    if (recent.length >= 3) {
      result.root_cause_hint =
        'Repeated large commits — consider splitting work into smaller PRs';
      result.cross_tags.push('recurring-violation');
    }

    result.related_events = recent.slice(0, 5).map((e) => e.id);
    return result;
  }
}
```

## Step 4: Register the Plugin

Wire the plugin into your session startup code. This is typically where you
initialize the `MemoryStore` and `EventEnricher`:

```typescript
import { MemoryStore } from './memory/store';
import { EventEnricher } from './memory/enrichment';
import { activate, CommitSizeEnricher } from './plugins/commit-size-enforcer';

async function bootstrap(): Promise<void> {
  const store = new MemoryStore();
  await store.initialize();

  // 1. Register the enrichment provider
  const enricher = new EventEnricher(store, [
    new CommitSizeEnricher(10),
  ]);

  // 2. Activate the event subscription
  activate({ maxFilesPerCommit: 10, store });

  // The plugin is now live. Any PostToolUse event for git_commit
  // with more than 10 files will capture a violation.
}
```

There is no plugin registry to manage. Activation is just a function call.
To deactivate, use `unsubscribe` with the same handler reference.

## Step 5: Test the Plugin

Create a test at `tests/plugins/commit-size-enforcer.test.ts`:

```typescript
import { emit, EventType, getEventBus } from '../../core/event-bus';
import { MemoryStore } from '../../src/memory/store';
import { activate } from '../../src/plugins/commit-size-enforcer';

describe('commit-size-enforcer plugin', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    getEventBus().reset(); // clean slate
    store = new MemoryStore({ config: { provider: 'memory' } as any });
    await store.initialize();
    activate({ maxFilesPerCommit: 5, store });
  });

  afterEach(async () => {
    await store.close();
  });

  it('captures a violation when commit exceeds file limit', async () => {
    const files = Array.from({ length: 8 }, (_, i) => `src/file-${i}.ts`);

    await emit(EventType.PostToolUse, {
      tool: 'git_commit',
      affected_files: files,
      session_id: 'test-session',
      agent_id: 'test-agent',
    });

    // Give the async handler time to complete
    await new Promise((r) => setTimeout(r, 50));

    const events = await store.list({ event_type: 'violation' });
    expect(events).toHaveLength(1);
    expect(events[0].title).toContain('8 files');
    expect(events[0].severity).toBe('medium');
  });

  it('ignores commits under the limit', async () => {
    await emit(EventType.PostToolUse, {
      tool: 'git_commit',
      affected_files: ['src/index.ts'],
      session_id: 'test-session',
      agent_id: 'test-agent',
    });

    await new Promise((r) => setTimeout(r, 50));

    const events = await store.list({ event_type: 'violation' });
    expect(events).toHaveLength(0);
  });

  it('ignores non-commit tool events', async () => {
    await emit(EventType.PostToolUse, {
      tool: 'file_read',
      affected_files: Array.from({ length: 20 }, (_, i) => `f${i}.ts`),
      session_id: 'test-session',
      agent_id: 'test-agent',
    });

    await new Promise((r) => setTimeout(r, 50));

    const events = await store.list({ event_type: 'violation' });
    expect(events).toHaveLength(0);
  });
});
```

Run the tests with `npm test`.

## Full Example: commit-size-enforcer.ts

Here is the complete plugin file for reference:

```typescript
import { subscribe, EventType, EventPayload } from '../../core/event-bus';
import { MemoryStore } from '../memory/store';
import { EnrichmentProvider, EnrichmentResult } from '../memory/enrichment';
import { OpsEvent } from '../memory/schema';

export interface PluginOptions {
  maxFilesPerCommit: number;
  store: MemoryStore;
}

export class CommitSizeEnricher implements EnrichmentProvider {
  constructor(private maxFiles: number) {}

  async enrich(event: OpsEvent, recentEvents: OpsEvent[]): Promise<EnrichmentResult> {
    const result: EnrichmentResult = { cross_tags: [], related_events: [] };
    if (!event.tags.includes('commit-size')) return result;

    const recent = recentEvents.filter((e) => e.tags.includes('commit-size'));
    if (recent.length >= 3) {
      result.root_cause_hint = 'Repeated large commits — split into smaller PRs';
      result.cross_tags.push('recurring-violation');
    }
    result.related_events = recent.slice(0, 5).map((e) => e.id);
    return result;
  }
}

export function activate({ maxFilesPerCommit, store }: PluginOptions): void {
  subscribe(EventType.PostToolUse, async (payload: EventPayload) => {
    const tool = payload.data.tool as string | undefined;
    if (tool !== 'git_commit') return;

    const files = (payload.data.affected_files as string[]) ?? [];
    if (files.length <= maxFilesPerCommit) return;

    await store.capture({
      timestamp: payload.timestamp,
      session_id: (payload.data.session_id as string) ?? 'unknown',
      agent_id: (payload.data.agent_id as string) ?? 'system',
      event_type: 'violation',
      severity: files.length > maxFilesPerCommit * 2 ? 'high' : 'medium',
      skill: 'small_bets',
      title: `Commit touches ${files.length} files (limit: ${maxFilesPerCommit})`,
      detail: `Files: ${files.slice(0, 10).join(', ')}${files.length > 10 ? '...' : ''}`,
      affected_files: files,
      tags: ['commit-size', 'plugin:commit-size-enforcer'],
      metadata: { maxFilesPerCommit, actualFiles: files.length },
    });
  });
}
```

## Summary

| Step | What you do | API used |
|------|-------------|----------|
| Scaffold | Export an `activate` function | -- |
| Subscribe | Call `subscribe(EventType, handler)` | `core/event-bus` |
| Enrich | Implement `EnrichmentProvider.enrich()` | `memory/enrichment` |
| Register | Call `activate()` + pass enricher to `EventEnricher` | `memory/store`, `memory/enrichment` |
| Test | Emit events with `emit()`, assert on `store.list()` | `core/event-bus`, `memory/store` |
