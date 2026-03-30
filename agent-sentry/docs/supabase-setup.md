# Supabase Setup Guide

AgentSentry supports Supabase as a remote storage provider for team-shared memory. This guide covers setup and configuration.

**Status:** Beta

## Prerequisites

- A Supabase project ([supabase.com](https://supabase.com))
- Project URL and service role key
- Node.js >= 18

## 1. Set Environment Variables

AgentSentry reads Supabase credentials from environment variables:

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJ..."
```

Add these to your shell profile (`.bashrc`, `.zshrc`) or a `.env` file (never commit `.env` files).

## 2. Create the Database Schema

Run this SQL in your Supabase SQL editor (Dashboard > SQL Editor):

```sql
-- Events table
CREATE TABLE IF NOT EXISTS ops_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  skill TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  affected_files JSONB NOT NULL DEFAULT '[]',
  tags JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  hash TEXT NOT NULL,
  prev_hash TEXT NOT NULL DEFAULT '',
  embedding vector(384)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ops_events_timestamp ON ops_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ops_events_session ON ops_events (session_id);
CREATE INDEX IF NOT EXISTS idx_ops_events_type ON ops_events (event_type);
CREATE INDEX IF NOT EXISTS idx_ops_events_severity ON ops_events (severity);

-- Chain checkpoints table
CREATE TABLE IF NOT EXISTS chain_checkpoints (
  id SERIAL PRIMARY KEY,
  last_event_id UUID NOT NULL,
  last_event_hash TEXT NOT NULL,
  events_verified INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vector similarity search function
CREATE OR REPLACE FUNCTION match_ops_events(
  query_embedding vector(384),
  match_count INT DEFAULT 10,
  match_threshold FLOAT DEFAULT 0.5,
  filter_event_type TEXT DEFAULT NULL,
  filter_severity TEXT DEFAULT NULL,
  filter_skill TEXT DEFAULT NULL,
  filter_session_id TEXT DEFAULT NULL,
  filter_since TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  timestamp TIMESTAMPTZ,
  session_id TEXT,
  agent_id TEXT,
  event_type TEXT,
  severity TEXT,
  skill TEXT,
  title TEXT,
  detail TEXT,
  affected_files JSONB,
  tags JSONB,
  metadata JSONB,
  hash TEXT,
  prev_hash TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.timestamp, e.session_id, e.agent_id,
    e.event_type, e.severity, e.skill, e.title, e.detail,
    e.affected_files, e.tags, e.metadata, e.hash, e.prev_hash,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM ops_events e
  WHERE e.embedding IS NOT NULL
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
    AND (filter_event_type IS NULL OR e.event_type = filter_event_type)
    AND (filter_severity IS NULL OR e.severity = filter_severity)
    AND (filter_skill IS NULL OR e.skill = filter_skill)
    AND (filter_session_id IS NULL OR e.session_id = filter_session_id)
    AND (filter_since IS NULL OR e.timestamp >= filter_since)
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Schema initialization RPC (called by provider on startup)
CREATE OR REPLACE FUNCTION ensure_ops_schema()
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- No-op if tables already exist
  NULL;
END;
$$;
```

**Note:** Vector search requires the `pgvector` extension. Enable it in Supabase Dashboard > Database > Extensions.

## 3. Configure AgentSentry

Update `agent-sentry.config.json`:

```json
{
  "memory": {
    "provider": "supabase",
    "embedding_provider": "auto"
  }
}
```

Or programmatically:

```typescript
import { MemoryStore, createProvider } from 'agent-sentry';

const store = new MemoryStore({
  provider: createProvider({ provider: 'supabase' }),
});
await store.initialize();
```

The provider reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the environment automatically.

## 4. Verify Connection

```bash
npx agentsentry health
```

You should see the Supabase provider listed with a successful connection status.

## Connection Pooling

For high-throughput use cases, use the pooled provider:

```typescript
import { PooledSupabaseProvider } from 'agent-sentry';

const provider = new PooledSupabaseProvider({
  url: process.env.SUPABASE_URL!,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  poolSize: 5,
});
```

## Row-Level Security (Optional)

If you want to restrict access per agent or session, add RLS policies:

```sql
ALTER TABLE ops_events ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access"
  ON ops_events
  FOR ALL
  USING (auth.role() = 'service_role');
```

## Troubleshooting

- **"function not found"**: Run the SQL schema above; the `ensure_ops_schema` function is missing.
- **Connection timeout**: Check that your Supabase project is active (free tier pauses after inactivity).
- **Vector search not working**: Ensure `pgvector` extension is enabled and embeddings are being generated (requires `onnxruntime-node`).

See [Troubleshooting Guide](troubleshooting.md) for more.
