# MCP Integration Architecture

## Overview

AgentSentry exposes its capabilities as a Model Context Protocol (MCP) server with 9 tools. The server supports two transport modes: stdio for local CLI usage and HTTP for networked/team deployments. HTTP mode adds access-key authentication and per-IP rate limiting.

Source files: `src/mcp/server.ts`, `src/mcp/transport.ts`, `src/mcp/auth.ts`, `src/mcp/tools/*.ts`.

---

## Tool-to-Primitive Mapping

Each MCP tool is a thin adapter that validates input (via Zod schemas), delegates to an underlying primitive, and serializes the result as JSON text content.

| Tool | Underlying Primitive | What It Does |
|------|---------------------|--------------|
| `agent_sentry_check_git` | `execFileSync('git', ...)` | Reports uncommitted files, branch, last commit age, and a computed risk score |
| `agent_sentry_check_context` | Arithmetic estimation | Estimates context window usage from message count (4000 tokens/message against a 200K ceiling) |
| `agent_sentry_check_rules` | `primitives/rules-validation.validateRules()` | Checks a proposed file change against CLAUDE.md/AGENTS.md rules, returns violations |
| `agent_sentry_size_task` | Keyword + heuristic scoring | Analyzes task description for risk keywords (migration, security, destructive ops) and file count to produce a risk level |
| `agent_sentry_scan_security` | Regex pattern matching | Scans code content for API keys, hardcoded passwords, SQL injection patterns, eval usage, and private keys |
| `agent_sentry_capture_event` | `MemoryStore.capture()` | Writes an event into the hash-chained memory store |
| `agent_sentry_search_history` | `MemoryStore.search()` | Searches event history using the vector/text/JS fallback chain |
| `agent_sentry_recall_context` | `ContextRecaller.recall()` | Searches across session summaries and events for relevant prior context |
| `agent_sentry_health` | Multiple subsystems | Aggregates store stats, chain verification, embedding status, and enablement level into a single health report |

Tools that access the `MemoryStore` (`capture_event`, `search_history`, `recall_context`, `health`) create a fresh store instance, initialize it, perform the operation, and close it in a `finally` block.

---

## Transports: stdio vs HTTP

### stdio (default)

```bash
node dist/mcp/server.js
```

Uses `StdioServerTransport` from the MCP SDK. Communication happens over stdin/stdout. This is the standard mode for local tools like Claude Code, where the MCP client spawns the server as a child process.

Use stdio when: running locally, single-user, no network exposure needed.

### HTTP

```bash
node dist/mcp/server.js --http --port 3100
```

Uses `StreamableHTTPServerTransport` from the MCP SDK, wrapped in a Node.js HTTP server. Each connection gets a unique session ID via `randomUUID()`.

The HTTP server handles:

- **CORS**: Configurable origin. If an access key is set, uses `AGENT_SENTRY_CORS_ORIGIN` env var (defaults to `http://localhost`). Without an access key, allows `*`.
- **OPTIONS preflight**: Returns 204 with appropriate headers.
- **Health endpoint**: `GET /health` returns `{"status": "ok", "transport": "http"}` (bypasses MCP transport).
- **All other requests**: Delegated to `mcpTransport.handleRequest()`.

Use HTTP when: team/shared deployments, remote agents, or when multiple clients need concurrent access.

---

## Authentication (HTTP mode only)

Access key authentication is controlled by the `AGENT_SENTRY_ACCESS_KEY` environment variable. If the variable is not set, all requests are accepted (open access).

When set, every request must provide the key via either:

- `x-agent-sentry-key` HTTP header, or
- `?key=` query parameter.

Key validation in `auth.ts` uses constant-time comparison to prevent timing attacks: it XORs each character pair and accumulates mismatches, returning `false` if any bit differs or if lengths do not match.

---

## Rate Limiting (HTTP mode only)

`createRateLimiter()` in `auth.ts` tracks request counts per IP address with a sliding window. Defaults: 100 requests per 60-second window. Exceeding the limit returns HTTP 429 with a JSON body containing `retryAfterMs`.

Implementation details:

- Uses an in-memory `Map<string, {count, resetAt}>`.
- A periodic cleanup interval (matching the window duration) removes expired entries. The interval is `unref()`'d so it does not prevent process exit.
- The store is capped at 10,000 entries. If the cap is reached for a new IP, expired entries are purged. If still over capacity, the request is rejected (DoS protection).

---

## Error Handling

All tool handlers wrap their logic in try/catch. On success, they return:

```typescript
{ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
```

On error, they return the same structure with the error message serialized as `{ error: message }`.

At the server level (`server.ts`), if a tool name is not found in the tool map, the response includes `isError: true` with a message listing available tools. If a tool handler throws an unhandled exception, the server catches it and returns `isError: true` with the error message.

For HTTP transport errors, if `handleRequest()` rejects and headers have not been sent, the server responds with HTTP 500 and `{ error: 'Internal server error' }`. The actual error is logged to stderr.

The `health` tool provides a consolidated view of subsystem failures. It returns `status: 'healthy'`, `'degraded'`, or `'error'` based on chain integrity, critical event counts, and store initialization success. If the store cannot initialize at all, it returns a full error skeleton with `issues: ['Store initialization failed: ...']`.
