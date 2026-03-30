export interface DemoLine {
  type: 'command' | 'output' | 'highlight' | 'blank';
  text: string;
  delay?: number; // ms before showing this line
}

export interface DemoScenario {
  id: string;
  title: string;
  description: string;
  lines: DemoLine[];
}

export const demoScenarios: DemoScenario[] = [
  {
    id: 'init',
    title: 'Quick Setup',
    description: 'Initialize AgentSentry in 60 seconds',
    lines: [
      { type: 'command', text: '$ npx agentsentry init --level 2' },
      { type: 'output', text: 'AgentSentry v4.1.0-beta.1 — Initializing...' },
      { type: 'output', text: '' },
      { type: 'output', text: '  Enablement Level: 2 (Clear Head)' },
      { type: 'output', text: '  Storage: SQLite (local)' },
      { type: 'output', text: '  Embeddings: noop (zero dependencies)' },
      { type: 'output', text: '  Skills: save_points, context_health' },
      { type: 'output', text: '' },
      { type: 'highlight', text: '  ✓ Config written to agent-sentry.config.json' },
      { type: 'highlight', text: '  ✓ Database initialized' },
      { type: 'highlight', text: '  ✓ MCP server ready on stdio' },
      { type: 'output', text: '' },
      { type: 'output', text: '  Ready in 0.8s. Run `agent-sentry health` to verify.' },
    ],
  },
  {
    id: 'health',
    title: 'Health Check',
    description: 'Verify system status and integrity',
    lines: [
      { type: 'command', text: '$ npx agentsentry health' },
      { type: 'output', text: '' },
      { type: 'output', text: '  AgentSentry Health Report' },
      { type: 'output', text: '  ──────────────────────────' },
      { type: 'highlight', text: '  ✓ Store:       OK (142 events, 12 sessions)' },
      { type: 'highlight', text: '  ✓ Hash Chain:  INTACT (142/142 verified)' },
      { type: 'highlight', text: '  ✓ Embeddings:  noop (upgrade to ONNX for semantic search)' },
      { type: 'highlight', text: '  ✓ MCP Server:  Running (9 tools registered)' },
      { type: 'highlight', text: '  ✓ Enablement:  Level 2 — Clear Head' },
      { type: 'output', text: '' },
      { type: 'output', text: '  Last event: 2m ago | Uptime: 4h 23m' },
    ],
  },
  {
    id: 'secret-scan',
    title: 'Secret Detection',
    description: 'Catch secrets before they hit production',
    lines: [
      { type: 'command', text: '$ npx agentsentry scan --file src/config.ts' },
      { type: 'output', text: '' },
      { type: 'output', text: '  Scanning src/config.ts...' },
      { type: 'output', text: '' },
      { type: 'highlight', text: '  ⚠ CRITICAL: AWS Access Key detected' },
      { type: 'output', text: '    Line 14: AKIA3E●●●●●●●●●●●●●●XQ' },
      { type: 'output', text: '    Pattern: AWS Access Key ID' },
      { type: 'output', text: '' },
      { type: 'highlight', text: '  ⚠ WARNING: Hardcoded password detected' },
      { type: 'output', text: '    Line 28: password = "●●●●●●●●"' },
      { type: 'output', text: '    Pattern: Hardcoded credential assignment' },
      { type: 'output', text: '' },
      { type: 'highlight', text: '  2 secrets found. Blocked from commit.' },
      { type: 'output', text: '  Run with --fix to see remediation suggestions.' },
    ],
  },
  {
    id: 'memory',
    title: 'Memory Search',
    description: 'Recall context from previous sessions',
    lines: [
      { type: 'command', text: '$ npx agentsentry memory search "auth token refresh"' },
      { type: 'output', text: '' },
      { type: 'output', text: '  Searching 142 events across 12 sessions...' },
      { type: 'output', text: '' },
      { type: 'highlight', text: '  [1] Session #8 — 3 days ago (score: 0.91)' },
      { type: 'output', text: '      "Implemented JWT refresh token rotation in auth/middleware.ts.' },
      { type: 'output', text: '       Added 15-min access token TTL with 7-day refresh window."' },
      { type: 'output', text: '' },
      { type: 'highlight', text: '  [2] Session #5 — 1 week ago (score: 0.78)' },
      { type: 'output', text: '      "Fixed token expiry race condition — added 30s grace period' },
      { type: 'output', text: '       before invalidating old refresh tokens."' },
      { type: 'output', text: '' },
      { type: 'output', text: '  2 results in 9ms' },
    ],
  },
  {
    id: 'risk',
    title: 'Risk Scoring',
    description: 'Assess change risk before committing',
    lines: [
      { type: 'command', text: '$ npx agentsentry size-task' },
      { type: 'output', text: '' },
      { type: 'output', text: '  Analyzing staged changes...' },
      { type: 'output', text: '' },
      { type: 'output', text: '  Files changed:     8' },
      { type: 'output', text: '  DB migrations:     1 (V4_add_locks)' },
      { type: 'output', text: '  Shared code edits:  2 (coordinator.ts, lease.ts)' },
      { type: 'output', text: '  Branch:            feature/atomic-locks' },
      { type: 'output', text: '' },
      { type: 'highlight', text: '  Risk Score: 9/15 — HIGH' },
      { type: 'output', text: '' },
      { type: 'output', text: '  Recommendation: Request code review.' },
      { type: 'output', text: '  Consider splitting DB migration into a separate PR.' },
    ],
  },
];
