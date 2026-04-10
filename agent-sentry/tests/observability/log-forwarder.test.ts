import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LogForwarder, ForwardResult } from '../../src/observability/log-forwarder';

// Mock the logger
vi.mock('../../src/observability/logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('LogForwarder', () => {
  let tmpDir: string;
  const mockCapture = vi.fn().mockResolvedValue({});
  const mockStore = { capture: mockCapture } as any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-forwarder-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeLogFile(filename: string, entries: Record<string, unknown>[]) {
    const content = entries.map((e) => JSON.stringify(e)).join('\n');
    fs.writeFileSync(path.join(tmpDir, filename), content);
  }

  it('returns empty results when no log files exist', async () => {
    const forwarder = new LogForwarder(mockStore, tmpDir);
    const results = await forwarder.forward();
    expect(results).toHaveLength(4); // 4 known log sources
    for (const r of results) {
      expect(r.forwarded).toBe(0);
      expect(r.errors).toBe(0);
    }
  });

  it('forwards cost-log entries to the store', async () => {
    writeLogFile('cost-log.json', [
      { timestamp: '2025-01-01T00:00:00Z', call_cost: 0.05, model_tier: 'opus' },
      { timestamp: '2025-01-01T00:01:00Z', call_cost: 0.01, model_tier: 'haiku' },
    ]);

    const forwarder = new LogForwarder(mockStore, tmpDir);
    const results = await forwarder.forward({ sessionId: 'test-session' });

    const costResult = results.find((r) => r.file === 'cost-log.json');
    expect(costResult).toBeDefined();
    expect(costResult!.forwarded).toBe(2);
    expect(costResult!.errors).toBe(0);

    expect(mockCapture).toHaveBeenCalledTimes(2);
    const firstCall = mockCapture.mock.calls[0][0];
    expect(firstCall.event_type).toBe('cost_event');
    expect(firstCall.session_id).toBe('test-session');
    expect(firstCall.title).toContain('$0.05');
    expect(firstCall.tags).toContain('cost_event');
    expect(firstCall.tags).toContain('log-sync');
  });

  it('forwards permission-log entries', async () => {
    writeLogFile('permission-log.json', [
      { timestamp: '2025-01-01T00:00:00Z', decision: 'allow', tool: 'bash', agent_id: 'agent-1' },
    ]);

    const forwarder = new LogForwarder(mockStore, tmpDir);
    const results = await forwarder.forward();

    const permResult = results.find((r) => r.file === 'permission-log.json');
    expect(permResult!.forwarded).toBe(1);

    const captured = mockCapture.mock.calls[0][0];
    expect(captured.event_type).toBe('permission_event');
    expect(captured.agent_id).toBe('agent-1');
    expect(captured.title).toContain('allow');
    expect(captured.title).toContain('bash');
  });

  it('forwards delegation-log entries', async () => {
    writeLogFile('delegation-log.json', [
      { timestamp: '2025-01-01T00:00:00Z', decision: 'delegate', tool: 'code-review' },
    ]);

    const forwarder = new LogForwarder(mockStore, tmpDir);
    const results = await forwarder.forward();

    const delResult = results.find((r) => r.file === 'delegation-log.json');
    expect(delResult!.forwarded).toBe(1);
    expect(mockCapture.mock.calls[0][0].event_type).toBe('delegation_event');
  });

  it('forwards lifecycle entries', async () => {
    writeLogFile('lifecycle.json', [
      { timestamp: '2025-01-01T00:00:00Z', agent_id: 'agent-1', from: 'idle', to: 'active' },
    ]);

    const forwarder = new LogForwarder(mockStore, tmpDir);
    const results = await forwarder.forward();

    const lcResult = results.find((r) => r.file === 'lifecycle.json');
    expect(lcResult!.forwarded).toBe(1);
    const captured = mockCapture.mock.calls[0][0];
    expect(captured.title).toContain('idle');
    expect(captured.title).toContain('active');
  });

  it('uses cursor to avoid re-forwarding old entries', async () => {
    writeLogFile('cost-log.json', [
      { timestamp: '2025-01-01T00:00:00Z', call_cost: 0.01 },
    ]);

    const forwarder = new LogForwarder(mockStore, tmpDir);

    // First forward
    const results1 = await forwarder.forward();
    const costResult1 = results1.find((r) => r.file === 'cost-log.json');
    expect(costResult1!.forwarded).toBe(1);

    // Second forward without new entries
    mockCapture.mockClear();
    const results2 = await forwarder.forward();
    const costResult2 = results2.find((r) => r.file === 'cost-log.json');
    expect(costResult2!.forwarded).toBe(0);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('cursor advances and picks up only new entries', async () => {
    writeLogFile('cost-log.json', [
      { timestamp: '2025-01-01T00:00:00Z', call_cost: 0.01 },
    ]);

    const forwarder = new LogForwarder(mockStore, tmpDir);
    await forwarder.forward();

    // Append a new entry
    fs.appendFileSync(path.join(tmpDir, 'cost-log.json'), '\n' + JSON.stringify({ timestamp: '2025-01-02T00:00:00Z', call_cost: 0.02 }));

    mockCapture.mockClear();
    const results = await forwarder.forward();
    const costResult = results.find((r) => r.file === 'cost-log.json');
    expect(costResult!.forwarded).toBe(1);
    expect(mockCapture).toHaveBeenCalledOnce();
  });

  it('counts errors for malformed JSON lines', async () => {
    const filePath = path.join(tmpDir, 'cost-log.json');
    fs.writeFileSync(filePath, '{"valid":true}\nnot-json\n{"also_valid":true}');

    const forwarder = new LogForwarder(mockStore, tmpDir);
    const results = await forwarder.forward();

    const costResult = results.find((r) => r.file === 'cost-log.json');
    expect(costResult!.forwarded).toBe(2);
    expect(costResult!.errors).toBe(1);
  });

  it('counts errors when store.capture rejects', async () => {
    writeLogFile('cost-log.json', [
      { timestamp: '2025-01-01T00:00:00Z', call_cost: 0.01 },
    ]);
    mockCapture.mockRejectedValueOnce(new Error('db error'));

    const forwarder = new LogForwarder(mockStore, tmpDir);
    const results = await forwarder.forward();

    const costResult = results.find((r) => r.file === 'cost-log.json');
    expect(costResult!.forwarded).toBe(0);
    expect(costResult!.errors).toBe(1);
  });

  it('filters sources when options.sources is provided', async () => {
    writeLogFile('cost-log.json', [{ timestamp: '2025-01-01T00:00:00Z' }]);
    writeLogFile('permission-log.json', [{ timestamp: '2025-01-01T00:00:00Z' }]);

    const forwarder = new LogForwarder(mockStore, tmpDir);
    const results = await forwarder.forward({ sources: ['cost-log'] });

    // Only cost-log should be in results
    expect(results).toHaveLength(1);
    expect(results[0].file).toBe('cost-log.json');
  });

  it('defaults sessionId to log-sync when not provided', async () => {
    writeLogFile('cost-log.json', [
      { timestamp: '2025-01-01T00:00:00Z', call_cost: 0.01 },
    ]);

    const forwarder = new LogForwarder(mockStore, tmpDir);
    await forwarder.forward();

    expect(mockCapture.mock.calls[0][0].session_id).toBe('log-sync');
  });

  it('defaults agent_id to system when not in entry', async () => {
    writeLogFile('cost-log.json', [
      { timestamp: '2025-01-01T00:00:00Z' },
    ]);

    const forwarder = new LogForwarder(mockStore, tmpDir);
    await forwarder.forward();

    expect(mockCapture.mock.calls[0][0].agent_id).toBe('system');
  });

  it('creates cursor directory if it does not exist', async () => {
    const cursorDir = path.join(tmpDir, '.cursors');
    expect(fs.existsSync(cursorDir)).toBe(false);

    const forwarder = new LogForwarder(mockStore, tmpDir);
    await forwarder.forward();

    expect(fs.existsSync(cursorDir)).toBe(true);
  });
});
