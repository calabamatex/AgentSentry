import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(childProcess.execSync);

// Must import after mock is set up
import {
  activate,
  deactivate,
  onSessionStart,
  onPostToolUse,
  checkCommitHealth,
  getLastCommitTime,
  getUncommittedFileCount,
  _getState,
  _getConfig,
  name,
  version,
  category,
  hooks,
} from '../../plugins/core/commit-monitor/src/index';

describe('commit-monitor plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: git log returns a timestamp 10 minutes ago
    const tenMinutesAgoUnix = Math.floor((Date.now() - 10 * 60_000) / 1000);
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git log')) {
        return `${tenMinutesAgoUnix}\n`;
      }
      if (typeof cmd === 'string' && cmd.includes('git status')) {
        return 'M  file1.ts\nM  file2.ts\n';
      }
      return '';
    });
    activate();
  });

  afterEach(() => {
    deactivate();
  });

  it('exports correct plugin metadata', () => {
    expect(name).toBe('commit-monitor');
    expect(version).toBe('1.0.0');
    expect(category).toBe('monitor');
    expect(hooks).toEqual(['PostToolUse', 'SessionStart']);
  });

  it('activate initializes state and reads last commit time', () => {
    activate();
    const state = _getState();
    expect(state.sessionStartTime).toBeGreaterThan(0);
    expect(state.lastCheckTime).toBe(0);
    expect(state.lastCommitTime).not.toBeNull();
    expect(state.warnings).toEqual([]);
  });

  it('deactivate resets state', () => {
    deactivate();
    const state = _getState();
    expect(state.lastCommitTime).toBeNull();
    expect(state.lastCheckTime).toBe(0);
    expect(state.warnings).toEqual([]);
  });

  it('onSessionStart records session time and returns status', () => {
    const result = onSessionStart();
    expect(result.status).toBe('monitoring');
    expect(result.lastCommit).not.toBeNull();
    expect(typeof result.lastCommit).toBe('number');
  });

  it('returns no warnings when thresholds are not exceeded', () => {
    // Default mock: 10 min since commit, 2 uncommitted files - both under threshold
    const result = onPostToolUse();
    expect(result.warnings).toEqual([]);
    expect(result.metrics.uncommitted_files).toBe(2);
  });

  it('warns when too many minutes since last commit', () => {
    // Set last commit to 45 minutes ago
    const fortyFiveMinAgo = Math.floor((Date.now() - 45 * 60_000) / 1000);
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git log')) {
        return `${fortyFiveMinAgo}\n`;
      }
      if (typeof cmd === 'string' && cmd.includes('git status')) {
        return '';
      }
      return '';
    });
    activate();

    const result = onPostToolUse();
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]).toContain('minutes since last commit');
    expect(result.warnings[0]).toContain('threshold: 30');
  });

  it('warns when too many uncommitted files', () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git log')) {
        const recentUnix = Math.floor((Date.now() - 5 * 60_000) / 1000);
        return `${recentUnix}\n`;
      }
      if (typeof cmd === 'string' && cmd.includes('git status')) {
        return 'M  a.ts\nM  b.ts\nM  c.ts\nM  d.ts\nM  e.ts\nM  f.ts\nA  g.ts\n';
      }
      return '';
    });
    activate();

    const result = onPostToolUse();
    expect(result.warnings.some((w: string) => w.includes('uncommitted files'))).toBe(true);
    expect(result.metrics.uncommitted_files).toBe(7);
  });

  it('throttles checks within 10-second window', () => {
    // First call proceeds
    const first = onPostToolUse();
    expect(first.metrics).toHaveProperty('uncommitted_files');

    // Second call within 10s returns empty
    const second = onPostToolUse();
    expect(second.warnings).toEqual([]);
    expect(second.metrics).toEqual({});
  });

  it('accepts custom config via activate', () => {
    activate({ maxMinutesSinceCommit: 5, maxUncommittedFiles: 1 });
    const cfg = _getConfig();
    expect(cfg.maxMinutesSinceCommit).toBe(5);
    expect(cfg.maxUncommittedFiles).toBe(1);
    // With 10 min since commit and threshold of 5, should warn
    const result = onPostToolUse();
    expect(result.warnings.some((w: string) => w.includes('minutes since last commit'))).toBe(true);
    expect(result.warnings.some((w: string) => w.includes('uncommitted files'))).toBe(true);
  });

  it('handles git log failure gracefully (no commits)', () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git log')) {
        throw new Error('fatal: bad default revision');
      }
      if (typeof cmd === 'string' && cmd.includes('git status')) {
        return '';
      }
      return '';
    });

    expect(getLastCommitTime()).toBeNull();
    activate();
    const result = onPostToolUse();
    // No crash, no commit-time warning (since we can't determine it)
    expect(result.warnings.every((w: string) => !w.includes('minutes since last commit'))).toBe(true);
  });

  it('handles git status failure gracefully', () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git status')) {
        throw new Error('not a git repository');
      }
      if (typeof cmd === 'string' && cmd.includes('git log')) {
        const recent = Math.floor((Date.now() - 5 * 60_000) / 1000);
        return `${recent}\n`;
      }
      return '';
    });

    expect(getUncommittedFileCount()).toBe(0);
  });
});
