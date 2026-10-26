export interface TraceType {
  glyph: string;
  name: string;
  description: string;
}

export interface StigmergyTool {
  name: string;
  signature: string;
  description: string;
}

export interface InstallSnippet {
  id: string;
  label: string;
  language: string;
  code: string;
}

export interface WorkflowStep {
  title: string;
  body: string;
}

export const stigmergyVersion = '0.1.0';

export const stigmergyTagline = 'Digital pheromone traces via MCP.';

export const stigmergyPitch =
  'A shared signal layer that lets multiple AI coding agents coordinate without talking to each other. No message bus, queue, or shared state protocol.';

export const stigmergyIdea =
  'In ant colonies, ants coordinate without communicating directly. They leave pheromones in the environment \u2014 attraction traces toward food, danger signals near threats \u2014 and other ants respond to what they sense. The environment itself becomes the communication channel. Stigmergy brings this pattern to AI coding agents: shared signals keyed to file paths, with exponential decay so stale paths fade and reinforced ones dominate.';

export const traceTypes: TraceType[] = [
  {
    glyph: '\u2192',
    name: 'attraction',
    description: 'This path worked well. Other agents are pulled toward successful routes through the codebase.',
  },
  {
    glyph: '\u26a0',
    name: 'danger',
    description: 'Something is broken or risky here. Agents steer away from known hazards without needing explicit coordination.',
  },
  {
    glyph: '\u25cb',
    name: 'info',
    description: 'Neutral annotation. A fact worth sharing with future agents that does not bias movement in either direction.',
  },
];

export const decayFormula = 'effective = intensity * exp(-elapsed_hours / decay_hours)';

export const stigmergyTools: StigmergyTool[] = [
  {
    name: 'deposit_trace',
    signature: 'deposit_trace(path, type, intensity, decay_hours)',
    description: 'Leave a typed signal on a file path or module with an intensity value and a decay half-life.',
  },
  {
    name: 'sense_environment',
    signature: 'sense_environment(path, radius)',
    description: 'Read nearby traces by walking up the path hierarchy. Returns the live, decay-adjusted signal field.',
  },
  {
    name: 'reinforce_trace',
    signature: 'reinforce_trace(id, delta)',
    description: 'Strengthen or weaken an existing trace with a positive or negative delta. Consensus through repetition.',
  },
  {
    name: 'get_gradient',
    signature: 'get_gradient(prefix)',
    description: 'Scan a broad prefix and return the top signals. The "which direction should I look?" tool.',
  },
];

export const stigmergyInstallSnippets: InstallSnippet[] = [
  {
    id: 'npm',
    label: 'npm',
    language: 'bash',
    code: 'npm install stigmergy-mcp',
  },
  {
    id: 'mcp',
    label: 'MCP server',
    language: 'bash',
    code: 'claude mcp add stigmergy -- node node_modules/stigmergy-mcp/dist/src/index.js',
  },
  {
    id: 'env',
    label: 'Env',
    language: 'bash',
    code: '# Optional \u2014 override the SQLite path\nexport STIGMERGY_DB_PATH=./stigmergy.db',
  },
];

export const sampleTraceJson = `{
  "path":  "src/auth/session.ts",
  "radius": 2,
  "traces": [
    {
      "id":         "trc_4c21",
      "path":       "src/auth/session.ts",
      "type":       "danger",
      "intensity":  0.82,
      "effective":  0.71,
      "age_hours":  3.4,
      "decay_hours": 24,
      "deposited_by": "agent-reviewer"
    },
    {
      "id":         "trc_9e07",
      "path":       "src/auth/",
      "type":       "attraction",
      "intensity":  0.55,
      "effective":  0.48,
      "age_hours":  6.1,
      "decay_hours": 48,
      "deposited_by": "agent-coder"
    }
  ]
}`;

export const combinedExample = `// Five lines, two SDKs, one coordinated agent.
import { MemoryStore } from '@calabamatex/agentsentry';
import { StigmergyClient } from 'stigmergy-mcp/client';

const memory = await new MemoryStore().initialize();
const field  = await new StigmergyClient().sense_environment('src/auth/', 2);

if (field.traces.some(t => t.type === 'danger' && t.effective > 0.5)) {
  await memory.capture({ event_type: 'decision', title: 'Avoided danger trace in src/auth/', severity: 'low' });
}`;

export const workflow: WorkflowStep[] = [
  {
    title: 'Agent A refactors auth',
    body: 'Deposits an attraction trace on src/auth/session.ts after a clean, well-tested change.',
  },
  {
    title: 'Agent B hits a bug',
    body: 'Finds a broken test in src/auth/middleware.ts, deposits a danger trace \u2014 no messaging, just a signal on the path.',
  },
  {
    title: 'Agent C arrives later',
    body: 'Calls sense_environment("src/auth/") and sees both signals. It is pulled toward the working path and avoids the hazard \u2014 without either of the prior agents knowing it exists.',
  },
];

export const techFacts: { label: string; value: string }[] = [
  { label: 'Language', value: 'TypeScript' },
  { label: 'Runtime', value: 'Node \u2265 18' },
  { label: 'Storage', value: 'SQLite (better-sqlite3)' },
  { label: 'Protocol', value: '@modelcontextprotocol/sdk' },
  { label: 'License', value: 'MIT' },
  { label: 'Status', value: 'Alpha (0.1.0)' },
];
