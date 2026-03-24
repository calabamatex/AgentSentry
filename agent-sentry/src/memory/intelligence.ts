/**
 * intelligence.ts — Cross-session intelligence for AgentSentry.
 *
 * Provides:
 *  - Session summary generation (structured summary of a session's work)
 *  - Cross-session pattern detection (recurring patterns across sessions)
 *  - Context recall (find relevant prior context for a given task)
 *
 * All data is stored and queried via MemoryStore — no external dependencies.
 */

import { MemoryStore } from './store';
import type { OpsEvent } from './schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionSummary {
  session_id: string;
  generated_at: string;
  duration_minutes: number;
  event_count: number;
  files_touched: string[];
  errors: Array<{ title: string; detail: string }>;
  patterns_used: string[];
  decisions: Array<{ title: string; detail: string }>;
  key_learnings: string[];
  severity_breakdown: Record<string, number>;
}

export interface DetectedPattern {
  pattern_id: string;
  description: string;
  occurrences: number;
  sessions: string[];
  first_seen: string;
  last_seen: string;
  confidence: number;
  suggestion?: string;
}

export interface RecallResult {
  query: string;
  results: Array<{
    session_id: string;
    summary?: string;
    relevant_events: OpsEvent[];
    relevance_score: number;
  }>;
}

// ---------------------------------------------------------------------------
// Session Summary Generator
// ---------------------------------------------------------------------------

export class SessionSummarizer {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Generate a structured summary for a given session.
   * Fetches all events from the session and synthesizes a summary.
   */
  async summarize(sessionId: string): Promise<SessionSummary> {
    await this.store.initialize();

    const events = await this.store.list({
      session_id: sessionId,
      limit: 10000,
    });

    if (events.length === 0) {
      return this.emptySummary(sessionId);
    }

    // Time range
    const timestamps = events.map((e) => new Date(e.timestamp).getTime());
    const earliest = Math.min(...timestamps);
    const latest = Math.max(...timestamps);
    const durationMinutes = Math.round((latest - earliest) / 60_000);

    // Files touched (deduplicated)
    const filesSet = new Set<string>();
    for (const e of events) {
      for (const f of e.affected_files) filesSet.add(f);
    }

    // Errors and incidents
    const errors = events
      .filter((e) => e.event_type === 'incident' || e.event_type === 'violation')
      .map((e) => ({ title: e.title, detail: e.detail }));

    // Patterns
    const patterns = events
      .filter((e) => e.event_type === 'pattern')
      .map((e) => e.title);

    // Decisions
    const decisions = events
      .filter((e) => e.event_type === 'decision')
      .map((e) => ({ title: e.title, detail: e.detail }));

    // Severity breakdown
    const severityBreakdown: Record<string, number> = {};
    for (const e of events) {
      severityBreakdown[e.severity] = (severityBreakdown[e.severity] ?? 0) + 1;
    }

    // Key learnings from tags
    const learningTags = new Set<string>();
    for (const e of events) {
      for (const tag of e.tags) {
        if (tag.startsWith('pattern:') || tag.startsWith('learning:')) {
          learningTags.add(tag);
        }
      }
    }

    return {
      session_id: sessionId,
      generated_at: new Date().toISOString(),
      duration_minutes: durationMinutes,
      event_count: events.length,
      files_touched: Array.from(filesSet).sort(),
      errors: errors.slice(0, 20),
      patterns_used: [...new Set(patterns)].slice(0, 20),
      decisions: decisions.slice(0, 20),
      key_learnings: Array.from(learningTags).slice(0, 20),
      severity_breakdown: severityBreakdown,
    };
  }

  /**
   * Generate and store a session summary as a memory event.
   */
  async summarizeAndStore(sessionId: string): Promise<SessionSummary> {
    const summary = await this.summarize(sessionId);

    await this.store.capture({
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      agent_id: 'intelligence',
      event_type: 'handoff',
      severity: 'low',
      skill: 'system',
      title: `session-summary:${sessionId}`,
      detail: this.formatSummaryDetail(summary),
      affected_files: summary.files_touched,
      tags: ['intelligence', 'session-summary'],
      metadata: summary as unknown as Record<string, unknown>,
    });

    return summary;
  }

  private emptySummary(sessionId: string): SessionSummary {
    return {
      session_id: sessionId,
      generated_at: new Date().toISOString(),
      duration_minutes: 0,
      event_count: 0,
      files_touched: [],
      errors: [],
      patterns_used: [],
      decisions: [],
      key_learnings: [],
      severity_breakdown: {},
    };
  }

  private formatSummaryDetail(summary: SessionSummary): string {
    const parts: string[] = [
      `Session ${summary.session_id}: ${summary.event_count} events over ${summary.duration_minutes}min`,
      `Files: ${summary.files_touched.length}`,
      `Errors: ${summary.errors.length}`,
      `Patterns: ${summary.patterns_used.length}`,
    ];
    return parts.join(' | ');
  }
}

// ---------------------------------------------------------------------------
// Cross-Session Pattern Detector
// ---------------------------------------------------------------------------

export class PatternDetector {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Detect recurring patterns across recent sessions.
   *
   * Looks for:
   * - Files that repeatedly appear in error events
   * - Recurring violation types
   * - Common tag co-occurrences
   */
  async detect(options?: {
    lookbackDays?: number;
    minOccurrences?: number;
  }): Promise<DetectedPattern[]> {
    await this.store.initialize();

    const lookbackDays = options?.lookbackDays ?? 30;
    const minOccurrences = options?.minOccurrences ?? 3;
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

    const events = await this.store.list({ since, limit: 5000 });
    if (events.length === 0) return [];

    const patterns: DetectedPattern[] = [];

    // Pattern 1: Files that frequently appear in error/violation events
    patterns.push(...this.detectErrorHotspots(events, minOccurrences));

    // Pattern 2: Recurring violation types
    patterns.push(...this.detectRecurringViolations(events, minOccurrences));

    // Pattern 3: Session-level patterns (e.g., sessions that always end with errors)
    patterns.push(...this.detectSessionPatterns(events, minOccurrences));

    return patterns;
  }

  /**
   * Detect and store patterns, returning new patterns found.
   */
  async detectAndStore(options?: {
    lookbackDays?: number;
    minOccurrences?: number;
  }): Promise<DetectedPattern[]> {
    const patterns = await this.detect(options);

    for (const pattern of patterns) {
      await this.store.capture({
        timestamp: new Date().toISOString(),
        session_id: 'intelligence',
        agent_id: 'pattern-detector',
        event_type: 'pattern',
        severity: pattern.confidence >= 0.8 ? 'medium' : 'low',
        skill: 'system',
        title: `detected-pattern:${pattern.pattern_id}`,
        detail: pattern.description + (pattern.suggestion ? ` — ${pattern.suggestion}` : ''),
        affected_files: [],
        tags: ['intelligence', 'cross-session-pattern'],
        metadata: pattern as unknown as Record<string, unknown>,
      });
    }

    return patterns;
  }

  private detectErrorHotspots(events: OpsEvent[], minOccurrences: number): DetectedPattern[] {
    const errorEvents = events.filter(
      (e) => e.event_type === 'incident' || e.event_type === 'violation',
    );
    const fileCounts = new Map<string, { count: number; sessions: Set<string>; first: string; last: string }>();

    for (const e of errorEvents) {
      for (const f of e.affected_files) {
        const existing = fileCounts.get(f);
        if (existing) {
          existing.count++;
          existing.sessions.add(e.session_id);
          if (e.timestamp < existing.first) existing.first = e.timestamp;
          if (e.timestamp > existing.last) existing.last = e.timestamp;
        } else {
          fileCounts.set(f, {
            count: 1,
            sessions: new Set([e.session_id]),
            first: e.timestamp,
            last: e.timestamp,
          });
        }
      }
    }

    return Array.from(fileCounts.entries())
      .filter(([, v]) => v.count >= minOccurrences)
      .map(([file, v]) => ({
        pattern_id: `error-hotspot:${file}`,
        description: `${file} appears in ${v.count} error/violation events across ${v.sessions.size} sessions`,
        occurrences: v.count,
        sessions: Array.from(v.sessions),
        first_seen: v.first,
        last_seen: v.last,
        confidence: Math.min(v.count / 10, 1.0),
        suggestion: `Consider adding a standing order for ${file}`,
      }));
  }

  private detectRecurringViolations(events: OpsEvent[], minOccurrences: number): DetectedPattern[] {
    const violations = events.filter((e) => e.event_type === 'violation');
    const titleCounts = new Map<string, { count: number; sessions: Set<string>; first: string; last: string }>();

    for (const e of violations) {
      // Normalize title by removing session-specific identifiers
      const normalized = e.title.replace(/:[a-f0-9-]{36}/g, ':*');
      const existing = titleCounts.get(normalized);
      if (existing) {
        existing.count++;
        existing.sessions.add(e.session_id);
        if (e.timestamp < existing.first) existing.first = e.timestamp;
        if (e.timestamp > existing.last) existing.last = e.timestamp;
      } else {
        titleCounts.set(normalized, {
          count: 1,
          sessions: new Set([e.session_id]),
          first: e.timestamp,
          last: e.timestamp,
        });
      }
    }

    return Array.from(titleCounts.entries())
      .filter(([, v]) => v.count >= minOccurrences)
      .map(([title, v]) => ({
        pattern_id: `recurring-violation:${title}`,
        description: `Violation "${title}" recurs ${v.count} times across ${v.sessions.size} sessions`,
        occurrences: v.count,
        sessions: Array.from(v.sessions),
        first_seen: v.first,
        last_seen: v.last,
        confidence: Math.min(v.count / 5, 1.0),
        suggestion: `This violation keeps happening — consider a rule or automation to prevent it`,
      }));
  }

  private detectSessionPatterns(events: OpsEvent[], minOccurrences: number): DetectedPattern[] {
    // Group events by session
    const sessions = new Map<string, OpsEvent[]>();
    for (const e of events) {
      if (!sessions.has(e.session_id)) sessions.set(e.session_id, []);
      sessions.get(e.session_id)!.push(e);
    }

    // Check for sessions that end with high-severity events
    let sessionsEndingWithErrors = 0;
    const errorEndingSessions: string[] = [];
    for (const [sid, sessionEvents] of sessions) {
      if (sessionEvents.length === 0) continue;
      const sorted = sessionEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const lastFew = sorted.slice(-3);
      const hasError = lastFew.some(
        (e) => e.severity === 'high' || e.severity === 'critical',
      );
      if (hasError) {
        sessionsEndingWithErrors++;
        errorEndingSessions.push(sid);
      }
    }

    const patterns: DetectedPattern[] = [];

    if (sessionsEndingWithErrors >= minOccurrences) {
      patterns.push({
        pattern_id: 'session-ends-with-errors',
        description: `${sessionsEndingWithErrors} of ${sessions.size} sessions end with high/critical severity events`,
        occurrences: sessionsEndingWithErrors,
        sessions: errorEndingSessions,
        first_seen: events[events.length - 1]?.timestamp ?? '',
        last_seen: events[0]?.timestamp ?? '',
        confidence: Math.min(sessionsEndingWithErrors / sessions.size, 1.0),
        suggestion: 'Consider adding pre-commit checks or end-of-session validation',
      });
    }

    return patterns;
  }
}

// ---------------------------------------------------------------------------
// Context Recall
// ---------------------------------------------------------------------------

export class ContextRecaller {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Given a task description, search memory for relevant prior context.
   * Searches session summaries, patterns, and relevant events.
   */
  async recall(query: string, options?: {
    maxResults?: number;
    lookbackDays?: number;
  }): Promise<RecallResult> {
    await this.store.initialize();

    const maxResults = options?.maxResults ?? 5;
    const lookbackDays = options?.lookbackDays ?? 90;
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

    // Search via MemoryStore's search (uses vector search if available, falls back to text)
    const searchResults = await this.store.search(query, {
      limit: maxResults * 3,
      since,
    });

    // Group results by session
    const bySession = new Map<string, { events: OpsEvent[]; totalScore: number }>();
    for (const { event, score } of searchResults) {
      const sid = event.session_id;
      if (!bySession.has(sid)) {
        bySession.set(sid, { events: [], totalScore: 0 });
      }
      const entry = bySession.get(sid)!;
      entry.events.push(event);
      entry.totalScore += score;
    }

    // Rank sessions by aggregate score
    const ranked = Array.from(bySession.entries())
      .map(([session_id, { events, totalScore }]) => {
        // Check if there's a session summary
        const summaryEvent = events.find((e) => e.title.startsWith('session-summary:'));
        return {
          session_id,
          summary: summaryEvent?.detail,
          relevant_events: events.slice(0, 5),
          relevance_score: totalScore / events.length,
        };
      })
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, maxResults);

    return { query, results: ranked };
  }
}
