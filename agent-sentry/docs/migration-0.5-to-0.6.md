# Migrating from 0.5.x to 0.6.x

0.6.0 is a **security-hardening release**: both network surfaces (MCP HTTP and the
dashboard) now fail closed instead of open. If you only use the MCP server over
stdio (the default for Claude Code integration), nothing breaks — stdio needs no
key. Everything below concerns HTTP mode and the dashboard.

## TL;DR checklist

1. Using MCP over **stdio only**? → No action required.
2. Using MCP over **HTTP**? → Set `AGENT_SENTRY_ACCESS_KEY=<key>` in the server environment; send it as `x-agent-sentry-key` from clients.
3. Using the **dashboard**? → Set `AGENT_SENTRY_DASHBOARD_TOKEN=<token>`, or start with `--dev` to auto-generate one.
4. Relying on **wildcard CORS**? → Set an explicit `AGENT_SENTRY_CORS_ORIGIN`, or opt in with `AGENT_SENTRY_ALLOW_WILDCARD_CORS=1`.
5. Still setting `AGENT_SENTRY_REQUIRE_AUTH`? → Remove it; the variable is gone (auth is now the default).
6. Local development, no auth wanted? → `AGENT_SENTRY_NO_AUTH=1` (or `true`) disables auth on **both** surfaces. Unsafe; a warning is emitted at startup.

## MCP HTTP authentication (breaking, 0.6.0-beta.1)

**Before (0.5.x):** if `AGENT_SENTRY_ACCESS_KEY` was unset, all HTTP requests were accepted.

**After (0.6.x):** authentication is required by default.

- The server refuses to start HTTP mode without a key unless `AGENT_SENTRY_NO_AUTH` is set, and binds `127.0.0.1` when keyless.
- Non-health requests are always validated; `GET /health` remains an unauthenticated liveness probe.
- Clients send the key via the `x-agent-sentry-key` header (preferred) or `?key=` query parameter.
- The deprecated `AGENT_SENTRY_REQUIRE_AUTH` variable was removed.

```bash
# Server
AGENT_SENTRY_ACCESS_KEY=$(openssl rand -hex 24) node dist/src/mcp/server.js --http --port 3100

# Client
curl -H "x-agent-sentry-key: $AGENT_SENTRY_ACCESS_KEY" http://127.0.0.1:3100/mcp ...
```

## Dashboard authentication (breaking, 0.6.0-beta.2)

**Before:** starting the dashboard without a token silently auto-generated one.

**After:** the dashboard **refuses to start without a token** (parity with the MCP layer). Choose one:

| Scenario | Do this |
|----------|---------|
| Production / shared machine | `AGENT_SENTRY_DASHBOARD_TOKEN=<token> agentsentry dashboard` |
| Programmatic embedding | `new DashboardServer({ token: '<token>', ... })` — the constructor throws without one |
| Local development | `agentsentry dashboard --dev` — auto-generates a token and prints it at startup |
| Explicitly no auth | `AGENT_SENTRY_NO_AUTH=1` (unsafe; warned at startup) |

Additional dashboard changes in 0.6.0-beta.2:

- Token comparisons (bearer header and SSE query parameter) are constant-time.
- The token no longer appears in server logs.
- The SSE query-parameter exposure trade-off is documented in [dashboard-guide.md](./dashboard-guide.md#authentication).

## CORS (breaking, 0.6.0-beta.1)

A wildcard origin is refused unless `AGENT_SENTRY_ALLOW_WILDCARD_CORS=1` is set.
The default allowed origin is `http://localhost`; set `AGENT_SENTRY_CORS_ORIGIN`
explicitly for anything else.

## Config schema

No breaking changes to `agent-sentry.config.json` between 0.5.x and 0.6.x. Notes:

- The canonical default enablement level is **2 (Clear Head)**; all fallback paths agree with the shipped config (see `docs/architecture/enablement-model.md`).
- 0.6.0 adds an optional `risk_scoring` block and enablement **Level 6 (Risk Watch)** — both experimental and strictly opt-in; Level 6 is never auto-suggested. Existing configs are unaffected.
- Additive database migration (`migration-v5`) runs automatically on first start; existing event data and hash chains are unchanged.

## Environment variable summary

| Variable | Status in 0.6.x |
|----------|-----------------|
| `AGENT_SENTRY_ACCESS_KEY` | Required for MCP HTTP mode |
| `AGENT_SENTRY_DASHBOARD_TOKEN` | Required for the dashboard (or `--dev` / no-auth) |
| `AGENT_SENTRY_NO_AUTH` | Opt-out for both surfaces (`1` or `true`; unsafe) |
| `AGENT_SENTRY_CORS_ORIGIN` | Allowed CORS origin (default `http://localhost`) |
| `AGENT_SENTRY_ALLOW_WILDCARD_CORS` | Must be `1` to permit `*` |
| `AGENT_SENTRY_REQUIRE_AUTH` | **Removed** — delete from your environment |
