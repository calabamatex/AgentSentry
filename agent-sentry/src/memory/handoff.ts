/**
 * handoff.ts — Auto-generated handoff message builder.
 *
 * When AgentSentry detects context is critically full, this module generates
 * a structured handoff message summarizing the session's work, remaining
 * tasks, and key patterns learned. The user can copy/paste it into a new
 * session to maintain continuity.
 */

import { execSync } from 'child_process';
import { MemoryStore } from './store';
import { SessionSummarizer, PatternDetector } from './intelligence';
import { Logger } from '../observability/logger';

const logger = new Logger({ module: 'handoff' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HandoffMessage {
  generated_at: string;
  session_id: string;
  summary: string;
  git_diff_stat: string;
  recent_commits: string[];
  files_changed: string[];
  errors_encountered: Array<{ title: string; detail: string }>;
  patterns_learned: string[];
  remaining_work: string[];
  formatted: string;
}

// ---------------------------------------------------------------------------
// Handoff Generator
// ---------------------------------------------------------------------------

export class HandoffGenerator {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Generate a handoff message for the given session.
   * Combines MemoryStore session data with git state.
   */
  async generate(sessionId: string, options?: {
    projectPath?: string;
    remainingWork?: string[];
  }): Promise<HandoffMessage> {
    await this.store.initialize();

    // Generate session summary
    const summarizer = new SessionSummarizer(this.store);
    const summary = await summarizer.summarize(sessionId);

    // Git state
    const gitDiffStat = this.getGitDiffStat(options?.projectPath);
    const recentCommits = this.getRecentCommits(options?.projectPath);

    // Detect patterns
    const detector = new PatternDetector(this.store);
    const patterns = await detector.detect({ lookbackDays: 1, minOccurrences: 1 });
    const patternDescriptions = patterns.map((p) => p.description).slice(0, 10);

    // Build formatted message
    const handoff: HandoffMessage = {
      generated_at: new Date().toISOString(),
      session_id: sessionId,
      summary: `${summary.event_count} events over ${summary.duration_minutes}min. ` +
        `${summary.files_touched.length} files touched, ${summary.errors.length} errors.`,
      git_diff_stat: gitDiffStat,
      recent_commits: recentCommits,
      files_changed: summary.files_touched,
      errors_encountered: summary.errors.slice(0, 10),
      patterns_learned: patternDescriptions,
      remaining_work: options?.remainingWork ?? [],
      formatted: '',
    };

    handoff.formatted = this.format(handoff);
    return handoff;
  }

  /**
   * Generate and store the handoff as a memory event.
   */
  async generateAndStore(sessionId: string, options?: {
    projectPath?: string;
    remainingWork?: string[];
  }): Promise<HandoffMessage> {
    const handoff = await this.generate(sessionId, options);

    await this.store.capture({
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      agent_id: 'handoff-generator',
      event_type: 'handoff',
      severity: 'low',
      skill: 'system',
      title: `handoff:${sessionId}`,
      detail: handoff.formatted.slice(0, 500),
      affected_files: handoff.files_changed,
      tags: ['handoff', 'auto-generated'],
      metadata: {
        session_id: sessionId,
        event_count: handoff.files_changed.length,
        error_count: handoff.errors_encountered.length,
        pattern_count: handoff.patterns_learned.length,
      },
    });

    return handoff;
  }

  private format(handoff: HandoffMessage): string {
    const sections: string[] = [];

    sections.push(`HANDOFF: Session ${handoff.session_id}`);
    sections.push(`Generated: ${handoff.generated_at}`);
    sections.push('');
    sections.push(`Summary: ${handoff.summary}`);

    if (handoff.git_diff_stat) {
      sections.push('');
      sections.push('Git changes since session start:');
      sections.push(handoff.git_diff_stat);
    }

    if (handoff.recent_commits.length > 0) {
      sections.push('');
      sections.push('Recent commits:');
      for (const commit of handoff.recent_commits) {
        sections.push(`  ${commit}`);
      }
    }

    if (handoff.files_changed.length > 0) {
      sections.push('');
      sections.push(`Files touched (${handoff.files_changed.length}):`);
      for (const f of handoff.files_changed.slice(0, 20)) {
        sections.push(`  ${f}`);
      }
      if (handoff.files_changed.length > 20) {
        sections.push(`  ... and ${handoff.files_changed.length - 20} more`);
      }
    }

    if (handoff.errors_encountered.length > 0) {
      sections.push('');
      sections.push('Errors encountered:');
      for (const e of handoff.errors_encountered) {
        sections.push(`  - ${e.title}: ${e.detail.slice(0, 150)}`);
      }
    }

    if (handoff.patterns_learned.length > 0) {
      sections.push('');
      sections.push('Patterns learned:');
      for (const p of handoff.patterns_learned) {
        sections.push(`  * ${p}`);
      }
    }

    if (handoff.remaining_work.length > 0) {
      sections.push('');
      sections.push('Remaining work:');
      for (const w of handoff.remaining_work) {
        sections.push(`  - ${w}`);
      }
    }

    return sections.join('\n');
  }

  private getGitDiffStat(projectPath?: string): string {
    try {
      const cwd = projectPath ?? process.cwd();
      return execSync('git diff --stat HEAD~5 HEAD', {
        encoding: 'utf-8',
        timeout: 5000,
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch (e) {
      logger.debug('Failed to get git diff stat', { error: e instanceof Error ? e.message : String(e) });
      return '';
    }
  }

  private getRecentCommits(projectPath?: string): string[] {
    try {
      const cwd = projectPath ?? process.cwd();
      const log = execSync('git log --oneline -10', {
        encoding: 'utf-8',
        timeout: 5000,
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return log.split('\n').filter(Boolean);
    } catch (e) {
      logger.debug('Failed to get recent commits', { error: e instanceof Error ? e.message : String(e) });
      return [];
    }
  }
}
