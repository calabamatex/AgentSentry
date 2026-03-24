export const MIGRATION_V3_SQL = `
  CREATE INDEX IF NOT EXISTS idx_events_session_type ON ops_events(session_id, event_type);
  CREATE INDEX IF NOT EXISTS idx_events_session_timestamp ON ops_events(session_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_events_type_severity ON ops_events(event_type, severity);
  CREATE INDEX IF NOT EXISTS idx_events_type_timestamp ON ops_events(event_type, timestamp DESC);
`;
