-- Supabase migration for AgentSentry memory store.
-- Run this in your Supabase SQL Editor to set up the required schema.

-- Enable pgvector extension
create extension if not exists vector;

-- Events table
create table if not exists ops_events (
  id text primary key,
  timestamp timestamptz not null,
  session_id text not null,
  agent_id text not null,
  event_type text not null,
  severity text not null,
  skill text not null,
  title text not null,
  detail text not null,
  affected_files jsonb not null default '[]',
  tags jsonb not null default '[]',
  metadata jsonb not null default '{}',
  hash text not null,
  prev_hash text not null,
  embedding vector(384)
);

-- Indexes
create index if not exists idx_events_type on ops_events(event_type);
create index if not exists idx_events_session on ops_events(session_id);
create index if not exists idx_events_severity on ops_events(severity);
create index if not exists idx_events_skill on ops_events(skill);
create index if not exists idx_events_timestamp on ops_events(timestamp);

-- IVFFlat index for vector search (create after inserting initial data for best results)
-- create index if not exists idx_events_embedding on ops_events using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Chain checkpoints
create table if not exists chain_checkpoints (
  id serial primary key,
  verified_at timestamptz not null default now(),
  last_event_id text not null,
  last_event_hash text not null,
  events_verified integer not null
);

-- RPC for vector search
create or replace function match_ops_events(
  query_embedding vector(384),
  match_count int default 10,
  match_threshold float default 0.5,
  filter_event_type text default null,
  filter_severity text default null,
  filter_skill text default null,
  filter_session_id text default null,
  filter_since timestamptz default null
)
returns table (
  id text,
  timestamp timestamptz,
  session_id text,
  agent_id text,
  event_type text,
  severity text,
  skill text,
  title text,
  detail text,
  affected_files jsonb,
  tags jsonb,
  metadata jsonb,
  hash text,
  prev_hash text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    e.id, e.timestamp, e.session_id, e.agent_id,
    e.event_type, e.severity, e.skill, e.title, e.detail,
    e.affected_files, e.tags, e.metadata, e.hash, e.prev_hash,
    1 - (e.embedding <=> query_embedding) as similarity
  from ops_events e
  where e.embedding is not null
    and 1 - (e.embedding <=> query_embedding) >= match_threshold
    and (filter_event_type is null or e.event_type = filter_event_type)
    and (filter_severity is null or e.severity = filter_severity)
    and (filter_skill is null or e.skill = filter_skill)
    and (filter_session_id is null or e.session_id = filter_session_id)
    and (filter_since is null or e.timestamp >= filter_since)
  order by e.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- RPC for schema initialization (idempotent)
create or replace function ensure_ops_schema()
returns void
language plpgsql
as $$
begin
  -- Tables already created above, this is a no-op health check
  perform 1 from ops_events limit 1;
end;
$$;
