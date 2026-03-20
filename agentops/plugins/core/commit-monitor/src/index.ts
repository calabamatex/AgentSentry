/**
 * commit-monitor — Monitors git commit frequency and alerts on inactivity.
 */

import { execSync } from 'child_process';

export const name = 'commit-monitor';
export const version = '1.0.0';
export const category = 'monitor';
export const hooks = ['PostToolUse', 'SessionStart'];

export interface MonitorConfig {
  maxMinutesSinceCommit: number;
  maxUncommittedFiles: number;
  sessionCommitIntervalMinutes: number;
}

export interface MonitorState {
  sessionStartTime: number;
  lastCheckTime: number;
  lastCommitTime: number | null;
  warnings: string[];
}

const DEFAULT_CONFIG: MonitorConfig = {
  maxMinutesSinceCommit: 30,
  maxUncommittedFiles: 5,
  sessionCommitIntervalMinutes: 60,
};

let state: MonitorState = {
  sessionStartTime: Date.now(),
  lastCheckTime: 0,
  lastCommitTime: null,
  warnings: [],
};

let config: MonitorConfig = { ...DEFAULT_CONFIG };

export function getLastCommitTime(): number | null {
  try {
    const output = execSync('git log -1 --format=%ct 2>/dev/null', { encoding: 'utf-8' }).trim();
    return parseInt(output, 10) * 1000; // Convert to ms
  } catch {
    return null;
  }
}

export function getUncommittedFileCount(): number {
  try {
    const output = execSync('git status --porcelain 2>/dev/null', { encoding: 'utf-8' });
    return output.trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

export function checkCommitHealth(): { warnings: string[]; metrics: Record<string, number> } {
  const now = Date.now();
  const warnings: string[] = [];
  const metrics: Record<string, number> = {};

  // Throttle checks to every 10 seconds
  if (now - state.lastCheckTime < 10_000) {
    return { warnings: [], metrics: {} };
  }
  state.lastCheckTime = now;

  // Check time since last commit
  const lastCommit = getLastCommitTime();
  if (lastCommit !== null) {
    const minutesSinceCommit = (now - lastCommit) / 60_000;
    metrics.minutes_since_commit = Math.round(minutesSinceCommit);

    if (minutesSinceCommit > config.maxMinutesSinceCommit) {
      warnings.push(
        `${Math.round(minutesSinceCommit)} minutes since last commit (threshold: ${config.maxMinutesSinceCommit})`
      );
    }
  }

  // Check uncommitted file count
  const uncommitted = getUncommittedFileCount();
  metrics.uncommitted_files = uncommitted;

  if (uncommitted > config.maxUncommittedFiles) {
    warnings.push(
      `${uncommitted} uncommitted files (threshold: ${config.maxUncommittedFiles})`
    );
  }

  // Check session duration without commit
  const sessionMinutes = (now - state.sessionStartTime) / 60_000;
  metrics.session_minutes = Math.round(sessionMinutes);

  if (lastCommit !== null && lastCommit < state.sessionStartTime) {
    // No commits during this session
    if (sessionMinutes > config.sessionCommitIntervalMinutes) {
      warnings.push(
        `Session active for ${Math.round(sessionMinutes)} minutes with no commits`
      );
    }
  }

  return { warnings, metrics };
}

export function activate(pluginConfig?: Partial<MonitorConfig>): void {
  config = { ...DEFAULT_CONFIG, ...pluginConfig };
  state = {
    sessionStartTime: Date.now(),
    lastCheckTime: 0,
    lastCommitTime: getLastCommitTime(),
    warnings: [],
  };
}

export function deactivate(): void {
  state = {
    sessionStartTime: Date.now(),
    lastCheckTime: 0,
    lastCommitTime: null,
    warnings: [],
  };
}

export function onSessionStart(): { status: string; lastCommit: number | null } {
  state.sessionStartTime = Date.now();
  state.lastCommitTime = getLastCommitTime();
  return {
    status: 'monitoring',
    lastCommit: state.lastCommitTime,
  };
}

export function onPostToolUse(): { warnings: string[]; metrics: Record<string, number> } {
  return checkCommitHealth();
}

/** Exposed for testing — returns current internal state. */
export function _getState(): MonitorState {
  return { ...state };
}

/** Exposed for testing — returns current config. */
export function _getConfig(): MonitorConfig {
  return { ...config };
}
