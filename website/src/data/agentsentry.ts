export interface Skill {
  glyph: string;
  name: string;
  description: string;
}

export interface McpTool {
  name: string;
  description: string;
}

export interface EnablementLevel {
  level: number;
  name: string;
  active: string;
  setup: string;
}

export interface InstallSnippet {
  id: string;
  label: string;
  language: string;
  code: string;
}

export const agentSentryVersion = 'v0.5.0-beta';

export const agentSentryTagline = 'Memory-aware management and safety framework for AI agents.';

export const agentSentryPitch =
  "Your AI agents forget everything between sessions. AgentSentry gives them persistent memory, safety guardrails, and operational oversight \u2014 so every session builds on the last.";

export const coreSkills: Skill[] = [
  {
    glyph: '\u26a1',
    name: 'Save Points',
    description: 'Automatic git checkpoints at configurable intervals. Branch-on-risk for dangerous operations.',
  },
  {
    glyph: '\u25c8',
    name: 'Context Health',
    description: 'Monitors token usage and conversation length. Warns before context overflow and recommends handoffs.',
  },
  {
    glyph: '\u26a8',
    name: 'Standing Orders',
    description: 'Lints and enforces rules files (CLAUDE.md, .cursorrules) for project convention compliance.',
  },
  {
    glyph: '\u2696',
    name: 'Small Bets',
    description: 'Scores tasks by file count and complexity. Flags oversized changes and enforces incremental delivery.',
  },
  {
    glyph: '\u2b22',
    name: 'Safety Checks',
    description: 'Scans for leaked secrets, validates permissions, and blocks commits containing sensitive data.',
  },
  {
    glyph: '\u21cc',
    name: 'Directive Compliance',
    description: 'Ensures the agent executes ACTION/RECOMMEND directives from hooks immediately (active at Level 3+).',
  },
];

export const mcpTools: McpTool[] = [
  { name: 'agent_sentry_check_git', description: 'Git hygiene status \u2014 uncommitted files, time since last commit, branch safety.' },
  { name: 'agent_sentry_check_context', description: 'Context window usage, degradation signals, continue/refresh recommendation.' },
  { name: 'agent_sentry_check_rules', description: 'Validates a proposed change against rules files, returns violations.' },
  { name: 'agent_sentry_size_task', description: 'Risk score and decomposition recommendation for a task description.' },
  { name: 'agent_sentry_scan_security', description: 'Scans for secrets and dangerous code patterns (SQL injection, eval, private keys).' },
  { name: 'agent_sentry_capture_event', description: 'Writes a decision, violation, or incident to persistent memory.' },
  { name: 'agent_sentry_search_history', description: 'Semantic search across all stored operational events.' },
  { name: 'agent_sentry_recall_context', description: 'Cross-session context recall \u2014 finds relevant prior session data for the current task.' },
  { name: 'agent_sentry_generate_handoff', description: 'Generates a structured handoff message for session continuity.' },
  { name: 'agent_sentry_health', description: 'Current health scores, KPIs, and skill-level status.' },
];

export const enablementLevels: EnablementLevel[] = [
  { level: 1, name: 'Safe Ground', active: 'save_points (full)', setup: '5 min' },
  { level: 2, name: 'Clear Head', active: '+ context_health (full)', setup: '10 min' },
  { level: 3, name: 'House Rules', active: '+ standing_orders (basic), + directive_compliance (full)', setup: '15 min' },
  { level: 4, name: 'Right Size', active: 'standing_orders \u2192 full, + small_bets (basic)', setup: '15 min' },
  { level: 5, name: 'Full Guard', active: 'small_bets \u2192 full, + proactive_safety (full)', setup: '15 min' },
];

export const advancedCapabilities: Skill[] = [
  { glyph: '\u25c9', name: 'Tracing', description: 'Span-based tracing with OpenTelemetry-compatible context propagation.' },
  { glyph: '\u25c9', name: 'Permissions', description: 'File-level and command-level enforcement with allowlist / denylist.' },
  { glyph: '\u25c9', name: 'Cost Management', description: 'Per-session and monthly budget tracking with warn and hard-stop thresholds.' },
  { glyph: '\u25c9', name: 'Audit Trail', description: 'Append-only, hash-chained event log with semantic search (EU AI Act Article 12 compliant).' },
  { glyph: '\u25c9', name: 'Plugins', description: '4 categories (monitors, auditors, dashboards, integrations) with templates and 11 validation checks.' },
  { glyph: '\u25c9', name: 'Evals', description: 'Built-in evaluation harness for testing safety rules against known attack patterns.' },
];

export const installSnippets: InstallSnippet[] = [
  {
    id: 'npm',
    label: 'npm',
    language: 'bash',
    code: 'npm install @calabamatex/agentsentry',
  },
  {
    id: 'mcp',
    label: 'MCP server',
    language: 'bash',
    code: 'claude mcp add agent-sentry -- node node_modules/@calabamatex/agentsentry/dist/src/mcp/server.js',
  },
  {
    id: 'hooks',
    label: 'Claude Code hooks',
    language: 'json',
    code: `{
  "hooks": {
    "PreToolUse":  [{ "command": "bash agent-sentry/scripts/permission-enforcer.sh" }],
    "PostToolUse": [{ "command": "bash agent-sentry/scripts/post-write-checks.sh" }],
    "SessionStart":[{ "command": "bash agent-sentry/scripts/session-start-checks.sh" }]
  }
}`,
  },
];

export const sdkExample = `import { MemoryStore, createProvider } from '@calabamatex/agentsentry';

const store = new MemoryStore({
  provider: createProvider({ provider: 'sqlite', database_path: './ops.db' }),
});
await store.initialize();

await store.capture({
  timestamp: new Date().toISOString(),
  session_id: 'session-001',
  agent_id:   'agent-coder',
  event_type: 'decision',
  severity:   'low',
  skill:      'save_points',
  title:      'Chose JWT with refresh tokens for auth',
  affected_files: ['src/auth/session.ts'],
  tags: ['auth', 'architecture'],
});

const results = await store.search('authentication patterns');`;

export const sampleEventJson = `{
  "timestamp":    "2026-04-16T14:22:03.412Z",
  "session_id":   "session-8f3c",
  "agent_id":     "agent-coder",
  "event_type":   "decision",
  "severity":     "low",
  "skill":        "save_points",
  "title":        "Chose JWT with refresh tokens for auth",
  "detail":       "Selected JWT with rotating refresh tokens for session management",
  "affected_files": ["src/auth/session.ts"],
  "tags":         ["auth", "architecture"],
  "metadata":     { "risk_score": 3, "files_touched": 1 },
  "hash_prev":    "sha256:8c4e\u2026",
  "hash_self":    "sha256:a17d\u2026"
}`;

export const threeSteps = [
  { title: 'Install', body: 'Add AgentSentry to your project via npm, or attach it as an MCP server.' },
  { title: 'Configure', body: 'Pick an enablement level (1\u20135) and generate agent-sentry.config.json with the setup wizard.' },
  { title: 'Start a session', body: 'Your agent now has memory, safety checks, and directive compliance across sessions.' },
];
