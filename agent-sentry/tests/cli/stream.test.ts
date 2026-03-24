import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamCommand } from '../../src/cli/commands/stream';
import type { ParsedArgs } from '../../src/cli/parser';

// Mock the EventStream to avoid needing the event bus
vi.mock('../../src/streaming/event-stream', () => {
  const clients = new Map<string, any>();

  class MockEventStream {
    start() {}
    stop() {}
    addClient(client: any) {
      clients.set(client.id, client);
      return true;
    }
    removeClient(id: string) {
      clients.delete(id);
      return true;
    }
  }

  return {
    EventStream: MockEventStream,
    __clients: clients,
  };
});

describe('CLI stream command', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let processOnSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    // Prevent actual process listeners from accumulating
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    processOnSpy.mockRestore();
    exitSpy.mockRestore();
    vi.restoreAllMocks();
  });

  function args(positionals: string[] = [], flags: Record<string, string | boolean> = {}): ParsedArgs {
    return { command: 'stream', positionals, flags };
  }

  it('has correct name and description', () => {
    expect(streamCommand.name).toBe('stream');
    expect(streamCommand.description).toBeTruthy();
  });

  it('starts listening and registers SIGINT handler', async () => {
    await streamCommand.run(args([]));
    const sigintCalls = processOnSpy.mock.calls.filter((c) => c[0] === 'SIGINT');
    expect(sigintCalls.length).toBeGreaterThan(0);
  });

  it('registers SIGTERM handler', async () => {
    await streamCommand.run(args([]));
    const sigtermCalls = processOnSpy.mock.calls.filter((c) => c[0] === 'SIGTERM');
    expect(sigtermCalls.length).toBeGreaterThan(0);
  });

  it('accepts --pretty flag without error', async () => {
    await streamCommand.run(args([], { pretty: true }));
    // Should not throw
  });

  it('accepts filter positionals', async () => {
    await streamCommand.run(args(['type=error']));
    // Should not throw
  });
});
