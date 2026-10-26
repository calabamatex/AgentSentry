export interface EcosystemItem {
  title: string;
  description: string;
  href: string;
  badge: string;
  version?: string;
  license?: string;
}

export const ecosystem: EcosystemItem[] = [
  {
    title: 'AgentSentry',
    description: 'Per-agent memory and safety framework for AI coding sessions.',
    href: 'https://github.com/calabamatex/AgentSentry',
    badge: 'Repository',
    version: 'v0.5.0-beta',
    license: 'MIT',
  },
  {
    title: 'stigmergy-mcp',
    description: 'MCP server for digital pheromone-based indirect agent coordination.',
    href: 'https://github.com/calabamatex/stigmergy-mcp',
    badge: 'Repository',
    version: '0.1.0',
    license: 'MIT',
  },
  {
    title: '@calabamatex/agentsentry',
    description: 'Install the AgentSentry runtime from npm.',
    href: 'https://www.npmjs.com/package/@calabamatex/agentsentry',
    badge: 'npm',
    license: 'MIT',
  },
  {
    title: 'stigmergy-mcp',
    description: 'Install the Stigmergy MCP server from npm.',
    href: 'https://www.npmjs.com/package/stigmergy-mcp',
    badge: 'npm',
    license: 'MIT',
  },
];
