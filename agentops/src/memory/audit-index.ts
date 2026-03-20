/**
 * audit-index.ts — Semantic audit search for OpsEvents.
 * Phase 4.3: Summary generation, event indexing, semantic search,
 * file audit trails, and session timelines.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  OpsEvent,
  EventType,
  SearchResult,
} from './schema';
import { MemoryStore } from './store';

export interface AuditSummary {
  audit_record_id: string;
  summary: string;
  event_id: string;
  timestamp: string;
}

export interface AuditSearchResult {
  summary: AuditSummary;
  score: number;
  event: OpsEvent;
}

export class AuditIndex {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Generate a human-readable text summary suitable for semantic search.
   * Format: "Agent {agent_id} recorded {event_type} ({severity}) for {skill}: {title}"
   * Appends affected files if present.
   */
  generateSummary(event: OpsEvent): string {
    let summary = `Agent ${event.agent_id} recorded ${event.event_type} (${event.severity}) for ${event.skill}: ${event.title}`;

    if (event.affected_files.length > 0) {
      const files = event.affected_files.slice(0, 5).join(', ');
      const suffix = event.affected_files.length > 5
        ? ` and ${event.affected_files.length - 5} more`
        : '';
      summary += ` [files: ${files}${suffix}]`;
    }

    return summary;
  }

  /**
   * Index an event for semantic search by capturing an audit_finding event
   * with the generated summary in the detail field, linking back via metadata.
   */
  async indexEvent(event: OpsEvent): Promise<AuditSummary> {
    await this.store.initialize();

    const summary = this.generateSummary(event);
    const auditRecordId = uuidv4();

    await this.store.capture({
      timestamp: new Date().toISOString(),
      session_id: event.session_id,
      agent_id: event.agent_id,
      event_type: 'audit_finding',
      severity: event.severity,
      skill: event.skill,
      title: `Audit: ${event.title}`.slice(0, 120),
      detail: summary,
      affected_files: event.affected_files,
      tags: [...event.tags, 'audit_index'],
      metadata: {
        audit_record_id: auditRecordId,
        source_event_id: event.id,
        source_event_type: event.event_type,
      },
    });

    return {
      audit_record_id: auditRecordId,
      summary,
      event_id: event.id,
      timestamp: event.timestamp,
    };
  }

  /**
   * Semantic search across audit records using the MemoryStore's search.
   * Filters to audit_finding events and maps to AuditSearchResult.
   */
  async search(
    query: string,
    options?: {
      limit?: number;
      since?: string;
      event_type?: EventType;
    },
  ): Promise<AuditSearchResult[]> {
    await this.store.initialize();

    const searchResults: SearchResult[] = await this.store.search(query, {
      limit: options?.limit ?? 20,
      event_type: 'audit_finding',
      since: options?.since,
    });

    // Optionally further filter by the source event_type stored in metadata
    let filtered = searchResults;
    if (options?.event_type) {
      filtered = searchResults.filter(
        (r) => r.event.metadata?.source_event_type === options.event_type,
      );
    }

    return filtered.map((r) => this.toAuditSearchResult(r));
  }

  /**
   * Get an audit trail for a specific file.
   * Lists audit_finding events whose affected_files include the given path.
   */
  async getFileAuditTrail(
    filePath: string,
    options?: {
      limit?: number;
      since?: string;
    },
  ): Promise<AuditSearchResult[]> {
    await this.store.initialize();

    const events = await this.store.list({
      event_type: 'audit_finding',
      tag: 'audit_index',
      limit: options?.limit ?? 50,
      since: options?.since,
    });

    const matching = events.filter((e) =>
      e.affected_files.some((f) => f === filePath || f.includes(filePath)),
    );

    return matching.map((event) => ({
      summary: this.extractAuditSummary(event),
      score: 1.0,
      event,
    }));
  }

  /**
   * Get a timeline of all audit events for a specific session,
   * ordered by timestamp.
   */
  async getSessionTimeline(sessionId: string): Promise<AuditSearchResult[]> {
    await this.store.initialize();

    const events = await this.store.list({
      session_id: sessionId,
      event_type: 'audit_finding',
      tag: 'audit_index',
      limit: 200,
    });

    const sorted = [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    return sorted.map((event) => ({
      summary: this.extractAuditSummary(event),
      score: 1.0,
      event,
    }));
  }

  /**
   * Convert a SearchResult to an AuditSearchResult.
   */
  private toAuditSearchResult(result: SearchResult): AuditSearchResult {
    return {
      summary: this.extractAuditSummary(result.event),
      score: result.score,
      event: result.event,
    };
  }

  /**
   * Extract an AuditSummary from an audit_finding event.
   */
  private extractAuditSummary(event: OpsEvent): AuditSummary {
    return {
      audit_record_id: (event.metadata?.audit_record_id as string) ?? event.id,
      summary: event.detail,
      event_id: (event.metadata?.source_event_id as string) ?? event.id,
      timestamp: event.timestamp,
    };
  }
}
