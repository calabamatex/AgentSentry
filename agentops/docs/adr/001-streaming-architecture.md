# ADR-001: Streaming Architecture Decision

**Status**: Accepted
**Date**: 2026-03-21
**Context**: AgentSentry streaming module (SSE/WebSocket)

## Decision

**Stay local-only for the foreseeable future.** Add backpressure handling,
connection limits, and reconnection logic. Label as "local development dashboard."

## Context

The streaming module currently provides real-time event streaming via SSE and
WebSocket transports. It bridges the in-process EventBus to external clients
(primarily the dashboard).

The question: should we invest in distributed transport (Redis Streams, NATS,
etc.) or keep it local?

## Analysis

### Who is the customer?

Individual developers and small teams using AI coding agents. They need to see
what their agent is doing in real-time during a session. They do not need
cross-machine event streaming or durable event replay across network boundaries.

### What do they actually need?

1. Real-time visibility into agent activity (dashboard)
2. Connection stability during long sessions
3. No data loss during brief disconnections (replay buffer)
4. Protection against resource exhaustion (backpressure)

### Why not distributed?

- **Complexity cost**: Redis/NATS adds infrastructure dependency, auth, tenancy
- **User profile**: Single-developer local tool, not a cloud platform
- **Maintenance burden**: Distributed streaming requires expertise to operate
- **Alternative path**: If team-level use becomes real, that's a separate product

## Consequences

### What we will do

1. Add backpressure: drop events for slow clients rather than buffering unbounded
2. Add connection limits: configurable max clients (already exists, default 50)
3. Add reconnection with replay: clients can resume from a timestamp
4. Label as `[beta]` in all documentation
5. Document explicitly: "local event streaming for development dashboard"

### What we will NOT do

1. No distributed transport layer
2. No durable event storage beyond the rolling buffer
3. No cross-machine streaming
4. No authentication for streaming endpoints (local only)

## Review

Revisit if:
- AgentSentry is adopted by teams (>1 developer) needing shared dashboards
- Users request persistent event replay beyond the buffer
- A cloud/SaaS offering is planned
