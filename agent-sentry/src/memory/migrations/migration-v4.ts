/**
 * migration-v4.ts — Adds coordination_locks table, schema_version column on events.
 *
 * - coordination_locks: Atomic lock table with UNIQUE resource constraint for CAS semantics
 * - schema_version: Per-event schema versioning for forward-compatible event evolution
 */

export const MIGRATION_V4_SQL = `
  -- Atomic coordination locks (replaces check-then-act pattern)
  CREATE TABLE IF NOT EXISTS coordination_locks (
    resource TEXT PRIMARY KEY,
    holder TEXT NOT NULL,
    fencing_token INTEGER NOT NULL DEFAULT 0,
    acquired_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  -- Event-level schema versioning
  ALTER TABLE ops_events ADD COLUMN schema_version INTEGER DEFAULT 1;
`;
