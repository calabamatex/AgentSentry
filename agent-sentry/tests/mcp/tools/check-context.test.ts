/**
 * check-context.test.ts — Tests for agent_sentry_check_context tool.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// Mock fs.readFileSync so state file reads are controlled
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

import { handler } from '../../../src/mcp/tools/check-context';

const mockedReadFileSync = vi.mocked(fs.readFileSync);

describe('agent_sentry_check_context', () => {
  beforeEach(() => {
    // Default: state file does not exist (readFileSync throws)
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return continue for low message count', async () => {
    const result = await handler({ message_count: 5 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.messages).toBe(5);
    expect(parsed.estimated_tokens).toBe(20000);
    expect(parsed.percent_used).toBe(10);
    expect(parsed.recommendation).toBe('continue');
  });

  it('should return caution for medium message count', async () => {
    const result = await handler({ message_count: 30 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.messages).toBe(30);
    expect(parsed.estimated_tokens).toBe(120000);
    expect(parsed.percent_used).toBe(60);
    expect(parsed.recommendation).toBe('caution');
  });

  it('should return refresh for high message count', async () => {
    const result = await handler({ message_count: 45 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.messages).toBe(45);
    expect(parsed.estimated_tokens).toBe(180000);
    expect(parsed.percent_used).toBe(90);
    expect(parsed.recommendation).toBe('refresh');
  });

  it('should handle zero messages', async () => {
    const result = await handler({ message_count: 0 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.messages).toBe(0);
    expect(parsed.estimated_tokens).toBe(0);
    expect(parsed.percent_used).toBe(0);
    expect(parsed.recommendation).toBe('continue');
  });

  it('should default to 0 messages when not provided', async () => {
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.messages).toBe(0);
    expect(parsed.estimated_tokens).toBe(0);
    expect(parsed.recommendation).toBe('continue');
  });

  it('should cap percent_used at 100', async () => {
    const result = await handler({ message_count: 100 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.percent_used).toBeLessThanOrEqual(100);
  });

  it('should hit the 50% boundary exactly', async () => {
    // 25 messages * 4000 = 100000 tokens = 50% of 200k
    const result = await handler({ message_count: 25 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.percent_used).toBe(50);
    expect(parsed.recommendation).toBe('caution');
  });

  it('should hit the 80% boundary exactly', async () => {
    // 40 messages * 4000 = 160000 tokens = 80% of 200k
    const result = await handler({ message_count: 40 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.percent_used).toBe(80);
    expect(parsed.recommendation).toBe('refresh');
  });

  // ── State file integration tests ──────────────────────────────────

  it('should read message count from state file when arg omitted and file exists', async () => {
    mockedReadFileSync.mockReturnValue('message_count=15\nsession_id=123\nstop_hook_count=0\n');

    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.messages).toBe(15);
    expect(parsed.estimated_tokens).toBe(60000);
    expect(parsed.percent_used).toBe(30);
    expect(parsed.recommendation).toBe('continue');
    expect(parsed.message_count_source).toBe('state_file');
  });

  it('should return 0 messages when arg omitted and state file does not exist', async () => {
    // Default mock already throws ENOENT
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.messages).toBe(0);
    expect(parsed.estimated_tokens).toBe(0);
    expect(parsed.message_count_source).toBe('state_file');
  });

  it('should report message_count_source as provided when arg is supplied', async () => {
    const result = await handler({ message_count: 10 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.messages).toBe(10);
    expect(parsed.message_count_source).toBe('provided');
  });

  it('should prefer explicit arg over state file value', async () => {
    mockedReadFileSync.mockReturnValue('message_count=15\nsession_id=123\n');

    const result = await handler({ message_count: 10 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.messages).toBe(10);
    expect(parsed.estimated_tokens).toBe(40000);
    expect(parsed.message_count_source).toBe('provided');
  });
});
