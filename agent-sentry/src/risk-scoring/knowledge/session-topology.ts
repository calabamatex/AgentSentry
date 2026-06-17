/**
 * session-topology.ts — In-memory, per-session state for risk scoring.
 *
 * Built incrementally from captured events. No DB access during updates. All
 * time math goes through an injectable clock so tests are deterministic (no
 * wall-clock flakiness — see the coordinator de-flake lesson).
 */

import type {
  FileState,
  IncidentSummary,
  SessionOutcome,
  SessionTopologyState,
} from '../types';

/** Returns the current time in epoch milliseconds. */
export type Clock = () => number;

export class SessionTopology {
  private readonly sessionId: string;
  private readonly clock: Clock;
  private readonly startedAtMs: number;

  private files = new Map<string, FileState>();
  private contextUtilization = 0;
  private toolCalls = 0;
  private toolCallErrors = 0;
  private lastCommitMs: number | null = null;
  private uncommittedDiffSize = 0;
  private uncommittedFileCount = 0;
  private estimatedCost = 0;
  private budgetRemaining = 0;

  private moduleHistory = new Map<string, IncidentSummary[]>();
  private recentOutcomes: SessionOutcome[] = [];

  constructor(sessionId: string, clock: Clock = () => Date.now()) {
    this.sessionId = sessionId;
    this.clock = clock;
    this.startedAtMs = clock();
  }

  // --- incremental updates -------------------------------------------------

  recordFileTouch(path: string, inScope: boolean): void {
    const now = this.clock();
    const existing = this.files.get(path);
    if (existing) {
      existing.last_touched_ms = now;
      existing.edit_count += 1;
      // scope can only tighten to false if ever observed out of scope
      existing.in_declared_scope = existing.in_declared_scope && inScope;
    } else {
      this.files.set(path, {
        path,
        first_touched_ms: now,
        last_touched_ms: now,
        edit_count: 1,
        in_declared_scope: inScope,
        active_risks: [],
      });
    }
  }

  recordToolCall(success: boolean): void {
    this.toolCalls += 1;
    if (!success) this.toolCallErrors += 1;
  }

  recordCommit(): void {
    this.lastCommitMs = this.clock();
    this.uncommittedDiffSize = 0;
    this.uncommittedFileCount = 0;
  }

  updateContextUtilization(utilization: number): void {
    this.contextUtilization = clamp01(utilization);
  }

  updateUncommitted(diffSize: number, fileCount: number): void {
    this.uncommittedDiffSize = Math.max(0, diffSize);
    this.uncommittedFileCount = Math.max(0, fileCount);
  }

  updateCost(cost: number, budgetRemaining: number): void {
    this.estimatedCost = Math.max(0, cost);
    this.budgetRemaining = budgetRemaining;
  }

  recordRiskDetection(filePath: string, patternId: string): void {
    const f = this.files.get(filePath);
    if (f) {
      if (!f.active_risks.includes(patternId)) f.active_risks.push(patternId);
    } else {
      this.recordFileTouch(filePath, true);
      this.files.get(filePath)!.active_risks.push(patternId);
    }
  }

  // --- historical context loading ------------------------------------------

  loadModuleHistory(history: Map<string, IncidentSummary[]>): void {
    this.moduleHistory = new Map(history);
  }

  loadRecentOutcomes(outcomes: SessionOutcome[]): void {
    this.recentOutcomes = [...outcomes];
  }

  getRecentOutcomes(): SessionOutcome[] {
    return [...this.recentOutcomes];
  }

  // --- derived queries -----------------------------------------------------

  getSessionDurationMinutes(): number {
    return (this.clock() - this.startedAtMs) / 60000;
  }

  getMinutesSinceLastCommit(): number {
    if (this.lastCommitMs === null) return Infinity;
    return (this.clock() - this.lastCommitMs) / 60000;
  }

  getErrorRate(): number {
    return this.toolCalls === 0 ? 0 : this.toolCallErrors / this.toolCalls;
  }

  getUniqueDirectories(): string[] {
    const dirs = new Set<string>();
    for (const path of this.files.keys()) {
      const slash = path.lastIndexOf('/');
      dirs.add(slash === -1 ? '.' : path.slice(0, slash));
    }
    return [...dirs].sort();
  }

  getFilesWithActiveRisks(): FileState[] {
    return [...this.files.values()].filter((f) => f.active_risks.length > 0);
  }

  private moduleHasIncidentHistory(): boolean {
    if (this.moduleHistory.size === 0) return false;
    const dirs = new Set(this.getUniqueDirectories());
    for (const [module, incidents] of this.moduleHistory) {
      if (incidents.length > 0 && dirs.has(module)) return true;
    }
    return false;
  }

  // --- snapshot ------------------------------------------------------------

  getState(): SessionTopologyState {
    const files_touched: Record<string, FileState> = {};
    for (const [k, v] of this.files) files_touched[k] = { ...v, active_risks: [...v.active_risks] };

    return {
      session_id: this.sessionId,
      started_at_ms: this.startedAtMs,
      files_touched,
      context_utilization: this.contextUtilization,
      tool_calls_count: this.toolCalls,
      tool_call_errors: this.toolCallErrors,
      last_commit_ms: this.lastCommitMs,
      uncommitted_diff_size: this.uncommittedDiffSize,
      uncommitted_file_count: this.uncommittedFileCount,
      estimated_session_cost: this.estimatedCost,
      budget_remaining: this.budgetRemaining,
      session_duration_minutes: this.getSessionDurationMinutes(),
      minutes_since_last_commit: this.getMinutesSinceLastCommit(),
      unique_directories: this.getUniqueDirectories(),
      error_rate: this.getErrorRate(),
      module_has_incident_history: this.moduleHasIncidentHistory(),
    };
  }
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
