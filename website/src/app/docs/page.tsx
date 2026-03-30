import { BookOpen, Terminal, Settings, Shield, Database, Puzzle } from 'lucide-react';
import Link from 'next/link';

export const metadata = {
  title: 'Documentation - AgentSentry',
  description: 'Everything you need to get started with AgentSentry.',
};

const docSections = [
  {
    icon: BookOpen,
    title: 'MCP Integration',
    description:
      'Connect AgentSentry to Claude Code, Cursor, or any MCP-compatible client.',
    href: '#mcp',
  },
  {
    icon: Terminal,
    title: 'CLI Reference',
    description:
      '11 commands for init, health, metrics, search, streaming, and more.',
    href: '#cli',
  },
  {
    icon: Settings,
    title: 'Configuration',
    description:
      'Customize enablement levels, storage providers, embedding backends, and more.',
    href: '#config',
  },
  {
    icon: Shield,
    title: 'Security',
    description:
      'Secret detection patterns, rules validation, and risk scoring details.',
    href: '#security',
  },
  {
    icon: Database,
    title: 'Storage Providers',
    description:
      'SQLite (default), Supabase (beta), and custom provider interface.',
    href: '#storage',
  },
  {
    icon: Puzzle,
    title: 'Plugin System',
    description:
      'Build custom plugins with manifest-based discovery and hook lifecycle.',
    href: '#plugins',
  },
];

const cliCommands = [
  { command: 'init', description: 'Initialize AgentSentry in a project with interactive or flag-based setup.' },
  { command: 'health', description: 'Run a health check on the AgentSentry installation and dependencies.' },
  { command: 'metrics', description: 'Display aggregated metrics for events, sessions, and risk scores.' },
  { command: 'memory search', description: 'Semantic search across the hash-chained memory store.' },
  { command: 'memory list', description: 'List recent memory entries with optional filters.' },
  { command: 'stream', description: 'Stream real-time events from the AgentSentry event bus.' },
  { command: 'plugin list', description: 'List installed plugins and their activation status.' },
  { command: 'config show', description: 'Display the current AgentSentry configuration.' },
  { command: 'dashboard', description: 'Launch the local observability dashboard in your browser.' },
  { command: 'enable', description: 'Interactive wizard to change the progressive enablement level.' },
  { command: 'prune', description: 'Remove stale sessions, expired events, and orphaned memory entries.' },
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-gray-900 text-green-400 font-mono text-sm p-4 rounded-lg overflow-x-auto">
      <code>{children}</code>
    </pre>
  );
}

export default function DocsPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white sm:text-5xl">
          Documentation
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600 dark:text-gray-400">
          Everything you need to get started with AgentSentry.
        </p>
      </div>

      {/* Quick Start */}
      <div className="mt-16">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Quick Start
        </h2>
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-surface-light sm:p-8">
          <ol className="space-y-8">
            <li>
              <div className="flex items-baseline gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                  1
                </span>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Install
                </h3>
              </div>
              <div className="mt-3 ml-10">
                <CodeBlock>npm install @calabamatex/agentsentry</CodeBlock>
              </div>
            </li>

            <li>
              <div className="flex items-baseline gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                  2
                </span>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Initialize
                </h3>
              </div>
              <div className="mt-3 ml-10">
                <CodeBlock>npx @calabamatex/agentsentry init --level 2</CodeBlock>
              </div>
            </li>

            <li>
              <div className="flex items-baseline gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                  3
                </span>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Wire MCP
                </h3>
              </div>
              <div className="mt-3 ml-10">
                <CodeBlock>{`{
  "mcpServers": {
    "@calabamatex/agentsentry": {
      "command": "npx",
      "args": ["@calabamatex/agentsentry", "serve"]
    }
  }
}`}</CodeBlock>
              </div>
            </li>

            <li>
              <div className="flex items-baseline gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                  4
                </span>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Verify
                </h3>
              </div>
              <div className="mt-3 ml-10">
                <CodeBlock>npx @calabamatex/agentsentry health</CodeBlock>
              </div>
            </li>
          </ol>
        </div>
      </div>

      {/* Documentation Sections Grid */}
      <div className="mt-16">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Explore the Docs
        </h2>
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {docSections.map((section) => {
            const Icon = section.icon;
            return (
              <Link
                key={section.title}
                href={section.href}
                className="group rounded-xl bg-gray-50 p-6 transition-shadow hover:shadow-md dark:bg-surface-light"
              >
                <Icon className="h-6 w-6 text-primary" />
                <h3 className="mt-3 font-semibold text-gray-900 dark:text-white">
                  {section.title}
                </h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {section.description}
                </p>
              </Link>
            );
          })}
        </div>
      </div>

      {/* CLI Reference */}
      <div id="cli" className="mt-20">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          CLI Reference
        </h2>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          AgentSentry ships with 11 CLI commands covering initialization,
          observability, memory, plugins, and maintenance.
        </p>
        <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-gray-100 dark:bg-surface-lighter">
                <th className="px-4 py-3 font-semibold text-gray-900 dark:text-white">
                  Command
                </th>
                <th className="px-4 py-3 font-semibold text-gray-900 dark:text-white">
                  Description
                </th>
              </tr>
            </thead>
            <tbody>
              {cliCommands.map((row, i) => (
                <tr
                  key={row.command}
                  className={
                    i % 2 === 0
                      ? 'bg-white dark:bg-surface-light'
                      : 'bg-gray-50 dark:bg-surface'
                  }
                >
                  <td className="px-4 py-3 font-mono text-primary">
                    {row.command}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {row.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
