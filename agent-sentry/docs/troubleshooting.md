# Troubleshooting

Common issues and solutions for AgentSentry v4.1.0-beta.

## SQLite Errors

### SQLITE_BUSY: database is locked

**Cause:** Multiple processes accessing the same SQLite database simultaneously.

**Fix:** AgentSentry sets `busy_timeout=5000` by default (5 seconds). If you still see this:

1. Ensure only one MCP server instance is running: `ps aux | grep server.js`
2. Check for stale lock files in `agent-sentry/data/`
3. Increase the busy timeout in the SQLite provider configuration

### Database file not found

**Cause:** The `database_path` in `agent-sentry.config.json` points to a nonexistent directory.

**Fix:** The default path is `agent-sentry/data/ops.db`. Ensure the `data/` directory exists:

```bash
mkdir -p agent-sentry/data
```

### Database corruption

**Cause:** Interrupted writes, disk full, or process killed during transaction.

**Fix:**

```bash
# Check integrity
sqlite3 agent-sentry/data/ops.db "PRAGMA integrity_check;"

# If corrupted, export and reimport
npx @calabamatex/agentsentry export > backup.json
rm agent-sentry/data/ops.db
npx @calabamatex/agentsentry import < backup.json
```

## Supabase Connection Issues

### "Supabase API error 500: function not found"

**Cause:** The `ensure_ops_schema` RPC function is not deployed to your Supabase instance.

**Fix:** Run the schema migration SQL against your Supabase database. See [Supabase Setup Guide](supabase-setup.md).

### Connection refused / timeout

**Cause:** Invalid `SUPABASE_URL` or network issues.

**Fix:**

1. Verify environment variables are set:
   ```bash
   echo $SUPABASE_URL
   echo $SUPABASE_SERVICE_ROLE_KEY
   ```
2. Test connectivity: `curl -s $SUPABASE_URL/rest/v1/ -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"`
3. Ensure your Supabase project is active (free tier projects pause after inactivity)

### Retry warnings in logs

AgentSentry automatically retries failed Supabase requests with exponential backoff. If you see retry warnings, check your Supabase instance health and network connectivity.

## Embedding Issues

### "ONNX model unavailable — falling back to noop"

**Cause:** The `onnxruntime-node` optional dependency is not installed, or the ONNX model file is missing.

**Fix:** This is normal for minimal installs. Noop embeddings use text-based search instead of vector search. To enable vector search:

```bash
npm install onnxruntime-node
```

The ONNX model (`all-MiniLM-L6-v2`) is bundled in `agent-sentry/models/`.

### Checksum verification failure

**Cause:** The ONNX model file was corrupted during download or transfer.

**Fix:** Re-download the model or reinstall the package:

```bash
rm -rf agent-sentry/models/
npm install @calabamatex/agentsentry
```

## MCP Server Issues

### "No AGENT_SENTRY_ACCESS_KEY set — accepting all requests"

**Cause:** The MCP server is running without authentication. This is fine for local development.

**Fix:** For production, set the access key:

```bash
export AGENT_SENTRY_ACCESS_KEY=your-secret-key
```

### MCP server not appearing in Claude Code

**Fix:**

1. Verify the server is registered: `claude mcp list`
2. Re-add if missing: `claude mcp add agent-sentry -- node agent-sentry/dist/src/mcp/server.js`
3. Ensure the build is up to date: `cd agent-sentry && npm run build`
4. Check for TypeScript compilation errors in the build output

## Dashboard Issues

### Port 9200 already in use

**Cause:** Another process is using the default dashboard port.

**Fix:**

```bash
# Find what's using the port
lsof -i :9200

# Use a different port
npx @calabamatex/agentsentry dashboard --port 9300
```

### Dashboard shows no data

**Fix:**

1. Ensure the memory store has events: `npx @calabamatex/agentsentry memory`
2. Check that the MCP server is running and capturing events
3. Verify the dashboard is connected to the same database path

## Hook Issues

### Hook script permission denied

**Cause:** Shell scripts in `scripts/` are not executable.

**Fix:**

```bash
chmod +x agent-sentry/scripts/*.sh
```

### Hooks not triggering

**Fix:**

1. Verify hooks are configured in `.claude/settings.json`
2. Check that the script paths are correct (relative to project root)
3. Test a hook manually: `bash agent-sentry/scripts/session-start-checks.sh`

## Build Issues

### "Cannot find type definition file for 'node'"

**Cause:** Node.js type definitions are not installed.

**Fix:**

```bash
cd agent-sentry && npm install
```

### TypeScript compilation errors after upgrade

**Fix:**

```bash
rm -rf dist node_modules
npm install
npm run build
```

## General

### Check system health

```bash
npx @calabamatex/agentsentry health
```

This reports: store stats, chain integrity, embedding state, and enablement level.

### Reset to clean state

```bash
rm -rf agent-sentry/data/ops.db
npx @calabamatex/agentsentry init
```

### Get version

```bash
npx @calabamatex/agentsentry health | head -1
```

Or programmatically:

```typescript
import { VERSION } from '@calabamatex/agentsentry';
console.log(VERSION);
```
