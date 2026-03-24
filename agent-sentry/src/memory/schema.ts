/**
 * schema.ts — OpsEvent types, enums, and validation for AgentSentry memory store.
 */

import { createHash } from 'crypto';

export const EVENT_TYPES = ['decision', 'violation', 'incident', 'pattern', 'handoff', 'audit_finding'] as const;
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const SKILLS = ['save_points', 'context_health', 'standing_orders', 'small_bets', 'proactive_safety', 'system'] as const;

export type EventType = (typeof EVENT_TYPES)[number] | (string & {});
export type Severity = (typeof SEVERITIES)[number] | (string & {});
export type Skill = (typeof SKILLS)[number] | (string & {});

export interface OpsEvent {
  id: string;
  timestamp: string;
  session_id: string;
  agent_id: string;
  event_type: EventType;
  severity: Severity;
  skill: Skill;
  title: string;
  detail: string;
  affected_files: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  embedding?: number[];
  hash: string;
  prev_hash: string;
  /** Event schema version. Not included in hash computation. */
  schema_version?: number;
}

export type OpsEventInput = Omit<OpsEvent, 'id' | 'hash' | 'prev_hash' | 'embedding' | 'schema_version'>;

export interface QueryOptions {
  limit?: number;
  offset?: number;
  event_type?: EventType;
  severity?: Severity;
  skill?: Skill;
  since?: string;
  until?: string;
  session_id?: string;
  agent_id?: string;
  tag?: string;
}

export interface VectorSearchOptions {
  limit?: number;
  threshold?: number;
  event_type?: EventType;
  severity?: Severity;
  skill?: Skill;
  since?: string;
  session_id?: string;
}

export interface SearchResult {
  event: OpsEvent;
  score: number;
}

export interface AggregateOptions {
  since?: string;
  until?: string;
  session_id?: string;
}

export interface OpsStats {
  total_events: number;
  by_type: Record<EventType, number>;
  by_severity: Record<Severity, number>;
  by_skill: Record<Skill, number>;
  first_event?: string;
  last_event?: string;
}

export interface ChainVerification {
  valid: boolean;
  total_checked: number;
  first_broken_at?: string;
  broken_event_id?: string;
}

export function computeHash(event: Omit<OpsEvent, 'hash' | 'embedding'>): string {
  const content = JSON.stringify({
    id: event.id,
    timestamp: event.timestamp,
    session_id: event.session_id,
    agent_id: event.agent_id,
    event_type: event.event_type,
    severity: event.severity,
    skill: event.skill,
    title: event.title,
    detail: event.detail,
    affected_files: event.affected_files,
    tags: event.tags,
    metadata: event.metadata,
    prev_hash: event.prev_hash,
  });
  return createHash('sha256').update(content).digest('hex');
}

export function validateEventInput(input: OpsEventInput): string[] {
  const errors: string[] = [];
  if (!input.timestamp) errors.push('timestamp is required');
  if (!input.session_id) errors.push('session_id is required');
  if (!input.agent_id) errors.push('agent_id is required');
  if (!input.event_type) errors.push('event_type is required');
  if (!input.severity) errors.push('severity is required');
  if (!input.skill) errors.push('skill is required');
  if (!input.title || input.title.length > 120) errors.push('title is required and must be <= 120 chars');
  if (!input.detail) errors.push('detail is required');
  if (!Array.isArray(input.affected_files)) errors.push('affected_files must be an array');
  if (!Array.isArray(input.tags)) errors.push('tags must be an array');
  return errors;
}
