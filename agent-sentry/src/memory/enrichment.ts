/**
 * enrichment.ts — Auto-classification enrichment for OpsEvents.
 * Phase 4.2: Cross-tagging, root cause hints, related events, severity context.
 */

import { execSync } from 'child_process';
import { OpsEvent, OpsEventInput } from './schema';
import { MemoryStore } from './store';
import { Logger } from '../observability/logger';

const logger = new Logger({ module: 'enrichment' });

export interface EnrichmentResult {
  cross_tags: string[];
  root_cause_hint?: string;
  related_events: string[];
  severity_context?: string;
}

export interface EnrichmentProvider {
  enrich(event: OpsEvent, recentEvents: OpsEvent[]): Promise<EnrichmentResult>;
}

/** File-path pattern to cross-tag mapping. */
const FILE_TAG_PATTERNS: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /(?:^|\/)(auth|login|session|jwt)\//i, tag: 'authentication' },
  { pattern: /(?:^|\/)(db|migration|schema)\//i, tag: 'database' },
  { pattern: /(?:^|\/)(api|routes|endpoint)\//i, tag: 'api' },
  { pattern: /(?:^|\/)(test|spec|__test__)\//i, tag: 'testing' },
  { pattern: /(?:^|\/)(config|settings)\//i, tag: 'configuration' },
  { pattern: /\.env$/i, tag: 'configuration' },
  { pattern: /(?:^|\/)(deploy|ci|docker)\//i, tag: 'infrastructure' },
];

/**
 * Detects the current git branch. Returns undefined on failure.
 */
function getCurrentBranch(): string | undefined {
  try {
    return execSync('git branch --show-current', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim() || undefined;
  } catch (e) {
    logger.debug('Failed to detect current git branch', { error: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
}

/**
 * Computes the intersection of two string arrays.
 */
function intersect(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter((item) => setB.has(item));
}

/**
 * Local pattern matcher: always available, zero cost, <10ms.
 */
export class LocalPatternMatcher implements EnrichmentProvider {
  async enrich(event: OpsEvent, recentEvents: OpsEvent[]): Promise<EnrichmentResult> {
    const crossTags = this.computeCrossTags(event);
    const rootCauseHint = this.detectRootCause(event, recentEvents);
    const relatedEvents = this.findRelatedEvents(event, recentEvents);
    const severityContext = this.computeSeverityContext(event);

    return {
      cross_tags: crossTags,
      root_cause_hint: rootCauseHint,
      related_events: relatedEvents,
      severity_context: severityContext,
    };
  }

  /**
   * File-based cross-tagging: maps affected file paths to domain tags.
   */
  private computeCrossTags(event: OpsEvent): string[] {
    const tags = new Set<string>();

    for (const filePath of event.affected_files) {
      for (const { pattern, tag } of FILE_TAG_PATTERNS) {
        if (pattern.test(filePath)) {
          tags.add(tag);
        }
      }
    }

    return Array.from(tags).sort();
  }

  /**
   * If 3+ recent events share overlapping affected_files with this event,
   * emit a root cause hint.
   */
  private detectRootCause(event: OpsEvent, recentEvents: OpsEvent[]): string | undefined {
    if (event.affected_files.length === 0) return undefined;

    const overlapping: OpsEvent[] = [];
    for (const recent of recentEvents) {
      if (recent.id === event.id) continue;
      const shared = intersect(event.affected_files, recent.affected_files);
      if (shared.length > 0) {
        overlapping.push(recent);
      }
    }

    if (overlapping.length >= 3) {
      // Collect the most-common shared files across all overlapping events
      const fileCounts = new Map<string, number>();
      for (const ov of overlapping) {
        const shared = intersect(event.affected_files, ov.affected_files);
        for (const f of shared) {
          fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
        }
      }
      const topFiles = Array.from(fileCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([f]) => f);

      return `Recurring pattern on ${topFiles.join(', ')} — consider a dedicated rule`;
    }

    return undefined;
  }

  /**
   * Find events in recentEvents with overlapping affected_files or tags.
   * Returns up to 5 event IDs.
   */
  private findRelatedEvents(event: OpsEvent, recentEvents: OpsEvent[]): string[] {
    const related: Array<{ id: string; score: number }> = [];

    for (const recent of recentEvents) {
      if (recent.id === event.id) continue;

      const fileOverlap = intersect(event.affected_files, recent.affected_files).length;
      const tagOverlap = intersect(event.tags, recent.tags).length;
      const score = fileOverlap * 2 + tagOverlap;

      if (score > 0) {
        related.push({ id: recent.id, score });
      }
    }

    return related
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((r) => r.id);
  }

  /**
   * Severity context based on git branch.
   */
  private computeSeverityContext(event: OpsEvent): string | undefined {
    if (event.severity !== 'high' && event.severity !== 'critical') {
      return undefined;
    }

    const branch = getCurrentBranch();
    if (!branch) return undefined;

    const isMainBranch = branch === 'main' || branch === 'master';

    if (event.severity === 'critical' && isMainBranch) {
      return 'Critical on main branch — immediate action required';
    }

    if (event.severity === 'high' && !isMainBranch) {
      return 'High severity mitigated by feature branch isolation';
    }

    if (event.severity === 'critical' && !isMainBranch) {
      return 'Critical severity mitigated by feature branch isolation';
    }

    return undefined;
  }
}

/**
 * Merges multiple EnrichmentResults into one.
 */
function mergeResults(results: EnrichmentResult[]): EnrichmentResult {
  const allTags = new Set<string>();
  const allRelated = new Set<string>();
  let rootCauseHint: string | undefined;
  let severityContext: string | undefined;

  for (const result of results) {
    for (const tag of result.cross_tags) allTags.add(tag);
    for (const id of result.related_events) allRelated.add(id);
    if (!rootCauseHint && result.root_cause_hint) {
      rootCauseHint = result.root_cause_hint;
    }
    if (!severityContext && result.severity_context) {
      severityContext = result.severity_context;
    }
  }

  return {
    cross_tags: Array.from(allTags).sort(),
    root_cause_hint: rootCauseHint,
    related_events: Array.from(allRelated),
    severity_context: severityContext,
  };
}

/**
 * EventEnricher: applies enrichment providers after event capture.
 */
export class EventEnricher {
  private providers: EnrichmentProvider[];
  private store: MemoryStore;

  constructor(store: MemoryStore, providers?: EnrichmentProvider[]) {
    this.providers = providers ?? [new LocalPatternMatcher()];
    this.store = store;
  }

  /**
   * Runs enrichment asynchronously. Fetches recent events (last 7 days)
   * from the store, then runs all providers and merges results.
   */
  async enrichEvent(event: OpsEvent): Promise<EnrichmentResult> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const recentEvents = await this.store.list({
      since: sevenDaysAgo,
      limit: 100,
    });

    const results = await Promise.all(
      this.providers.map((provider) => provider.enrich(event, recentEvents)),
    );

    return mergeResults(results);
  }

  /**
   * Convenience: capture + enrich in one call.
   */
  async captureAndEnrich(
    input: OpsEventInput,
  ): Promise<{ event: OpsEvent; enrichment: EnrichmentResult }> {
    await this.store.initialize();
    const event = await this.store.capture(input);
    const enrichment = await this.enrichEvent(event);
    return { event, enrichment };
  }
}
