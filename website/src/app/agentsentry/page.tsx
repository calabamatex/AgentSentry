import { Hero } from '@/components/Hero';
import { SectionHeading } from '@/components/SectionHeading';
import { TabSelector } from '@/components/TabSelector';
import { TraceReceipt } from '@/components/TraceReceipt';
import { EcosystemCard } from '@/components/EcosystemCard';
import { CodeBlock } from '@/components/CodeBlock';
import { ecosystem } from '@/data/ecosystem';
import {
  agentSentryTagline,
  agentSentryPitch,
  agentSentryVersion,
  coreSkills,
  mcpTools,
  enablementLevels,
  advancedCapabilities,
  installSnippets,
  sdkExample,
  sampleEventJson,
} from '@/data/agentsentry';

export const metadata = {
  title: 'AgentSentry — Memory and safety for AI coding agents',
  description: agentSentryTagline,
};

export default function AgentSentryPage() {
  return (
    <>
      <Hero
        eyebrow="AgentSentry"
        versionBadge={agentSentryVersion}
        headline={agentSentryTagline}
        sub={agentSentryPitch}
        ctas={[
          {
            label: 'GitHub',
            href: 'https://github.com/calabamatex/AgentSentry',
            external: true,
          },
          {
            label: 'npm',
            href: 'https://www.npmjs.com/package/@calabamatex/agentsentry',
            external: true,
            variant: 'ghost',
          },
        ]}
      />

      {/* What it does */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="What it does"
            title="A local-first memory and safety layer for AI coding sessions."
            description="Primary integration is Claude Code, but the MCP interface makes it work with any MCP client — Cursor, Codex, ChatGPT, GitHub Copilot. What makes it different is that AgentSentry remembers: every decision, violation, incident, and handoff is captured to a vector-indexed memory store that survives across sessions."
          />
        </div>
      </section>

      {/* Core skills detail */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading eyebrow="Core skills" title="Six disciplines, one framework." />
          <ul className="mt-12 grid gap-4 sm:grid-cols-2">
            {coreSkills.map((skill) => (
              <li
                key={skill.name}
                className="flex flex-col gap-3 rounded-md border border-ink-500/60 bg-ink-700/30 p-6"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xl text-ink-100">{skill.glyph}</span>
                  <h3 className="font-mono text-base text-ink-50">{skill.name}</h3>
                </div>
                <p className="text-ink-200">{skill.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Memory & Intelligence */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto grid max-w-site gap-12 px-6 py-20 md:grid-cols-2">
          <SectionHeading
            eyebrow="Memory and intelligence"
            title="Every session builds on the last."
            description="SQLite with cosine similarity by default. Swap in Supabase for shared team memory. All events are enriched with tags, root-cause hints, and severity before they land."
          />
          <CodeBlock code={sdkExample} language="typescript" filename="capture.ts" />
        </div>
      </section>

      {/* 10 MCP Tools */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="MCP tools"
            title="Ten tools, exposed to any MCP client."
          />
          <div className="mt-10 overflow-hidden rounded-md border border-ink-500/60">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-ink-700/60 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-200">
                <tr>
                  <th className="px-4 py-3 font-normal">Tool</th>
                  <th className="px-4 py-3 font-normal">What it does</th>
                </tr>
              </thead>
              <tbody>
                {mcpTools.map((tool) => (
                  <tr key={tool.name} className="border-t border-ink-500/40 align-top">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-50">
                      {tool.name}
                    </td>
                    <td className="px-4 py-3 text-ink-200">{tool.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Progressive enablement */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="Progressive enablement"
            title="Five levels. Each builds on the last."
          />
          <div className="mt-10 overflow-hidden rounded-md border border-ink-500/60">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-ink-700/60 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-200">
                <tr>
                  <th className="px-4 py-3 font-normal">Level</th>
                  <th className="px-4 py-3 font-normal">Name</th>
                  <th className="px-4 py-3 font-normal">Active</th>
                  <th className="hidden px-4 py-3 font-normal sm:table-cell">Setup</th>
                </tr>
              </thead>
              <tbody>
                {enablementLevels.map((row) => (
                  <tr key={row.level} className="border-t border-ink-500/40 align-top">
                    <td className="px-4 py-3 font-mono text-ink-200">{row.level}</td>
                    <td className="px-4 py-3 font-medium text-ink-50">{row.name}</td>
                    <td className="px-4 py-3 text-ink-200">{row.active}</td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-ink-300 sm:table-cell">
                      {row.setup}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Install */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="Install"
            title="Three wire-up options."
            description="Use AgentSentry as an npm package, a standalone MCP server, or a set of Claude Code hooks."
          />
          <div className="mt-10">
            <TabSelector tabs={installSnippets} />
          </div>
        </div>
      </section>

      {/* Advanced */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="Advanced capabilities"
            title="Beyond the six core skills."
          />
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {advancedCapabilities.map((cap) => (
              <li
                key={cap.name}
                className="flex flex-col gap-2 rounded-md border border-ink-500/60 bg-ink-700/30 p-5"
              >
                <span className="font-mono text-lg text-ink-100">{cap.glyph}</span>
                <h3 className="font-mono text-base text-ink-50">{cap.name}</h3>
                <p className="text-sm text-ink-200">{cap.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Security note */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <div className="rounded-md border border-ink-400/60 bg-ink-700/30 p-6">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-200">
              Security note — v0.6.0+
            </span>
            <p className="mt-3 text-ink-100">
              The MCP server now <span className="text-ink-50">requires authentication by default</span>.
              Set <code className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-xs text-ink-100">AGENT_SENTRY_ACCESS_KEY</code>{' '}
              to a strong random value to start the server. For local development, set{' '}
              <code className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-xs text-ink-100">AGENT_SENTRY_NO_AUTH=true</code>{' '}
              to disable authentication (unsafe — emits a stderr warning). The deprecated{' '}
              <code className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-xs text-ink-100">AGENT_SENTRY_REQUIRE_AUTH</code>{' '}
              variable has been removed.
            </p>
          </div>
        </div>
      </section>

      {/* Sample event */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="A real event"
            title="Hash-chained, semantically indexed, recallable across sessions."
          />
          <div className="mt-10">
            <TraceReceipt label="View a captured decision event" json={sampleEventJson} />
          </div>
        </div>
      </section>

      {/* Ecosystem */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading eyebrow="Ecosystem" title="Where to go next." />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ecosystem.map((item) => (
              <li key={`${item.title}-${item.badge}`}>
                <EcosystemCard item={item} />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
