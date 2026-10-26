import Link from 'next/link';
import { Hero } from '@/components/Hero';
import { SectionHeading } from '@/components/SectionHeading';
import { MetricCallout } from '@/components/MetricCallout';
import { CodeBlock } from '@/components/CodeBlock';
import { TabSelector } from '@/components/TabSelector';
import { StepSequence } from '@/components/StepSequence';
import { EcosystemCard } from '@/components/EcosystemCard';
import { TraceReceipt } from '@/components/TraceReceipt';
import { FeatureRow } from '@/components/FeatureRow';
import { primaryMetrics, secondaryMetrics } from '@/data/metrics';
import { ecosystem } from '@/data/ecosystem';
import {
  coreSkills,
  installSnippets as agentSentryInstallSnippets,
  sampleEventJson,
  threeSteps,
  enablementLevels,
} from '@/data/agentsentry';
import {
  traceTypes,
  decayFormula,
  stigmergyTools,
  sampleTraceJson,
  combinedExample,
} from '@/data/stigmergy';

export default function HomePage() {
  return (
    <>
      <Hero
        eyebrow="agenticmgmt"
        headline="Two halves of a safer multi-agent stack."
        sub="AgentSentry gives individual AI agents persistent memory and safety guardrails. Stigmergy lets many agents coordinate through the environment — without a message bus. Both are MIT-licensed MCP servers. Local by default."
        ctas={[
          { label: 'Explore AgentSentry', href: '/agentsentry' },
          { label: 'Explore Stigmergy', href: '/stigmergy', variant: 'ghost' },
        ]}
      />

      {/* Thesis */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="The thesis"
            title="One framework governs each agent. Another coordinates between them."
            description="A single well-behaved agent is not enough: sessions forget, risky commands slip through, and multiple agents on one codebase stall or collide. We separate the two problems — per-agent guardrails, inter-agent signals — and solve each with a small, local, MCP-first tool."
          />
        </div>
      </section>

      <MetricCallout metrics={primaryMetrics} />

      {/* AgentSentry intro */}
      <FeatureRow
        id="agentsentry"
        eyebrow="AgentSentry"
        title="Memory-aware management and safety framework for AI agents."
        body="Your AI agents forget everything between sessions. AgentSentry gives them persistent, vector-indexed memory plus six safety skills — so every session builds on the last and dangerous changes never ship by surprise."
        bullets={[
          'Save Points, Context Health, Standing Orders, Small Bets, Safety Checks, Directive Compliance',
          '10 MCP tools, works with any MCP client (Claude Code is the primary integration)',
          'SQLite local-first; Supabase provider for teams (experimental)',
        ]}
        visual={
          <CodeBlock
            code={agentSentryInstallSnippets[0].code}
            language="bash"
            filename="install"
          />
        }
      />

      {/* Core skills grid */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading eyebrow="Six skills" title="Every session, guarded." />
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {coreSkills.map((skill) => (
              <li
                key={skill.name}
                className="flex flex-col gap-3 rounded-md border border-ink-500/60 bg-ink-700/30 p-5"
              >
                <span className="font-mono text-2xl text-ink-100">{skill.glyph}</span>
                <h3 className="font-mono text-base text-ink-50">{skill.name}</h3>
                <p className="text-sm text-ink-200">{skill.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Three Steps */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto grid max-w-site gap-12 px-6 py-20 md:grid-cols-[1fr_1.3fr]">
          <SectionHeading eyebrow="Three steps" title="From zero to a governed session." />
          <StepSequence steps={threeSteps} />
        </div>
      </section>

      {/* Real event */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="A real event"
            title="Every decision, violation, and incident is captured."
            description="Events are appended to a hash-chained log and indexed for semantic search. Any session — weeks later — can ask “what went wrong the last time someone touched this?” and get a ranked answer."
          />
          <div className="mt-10">
            <TraceReceipt label="View a captured decision event" json={sampleEventJson} />
          </div>
        </div>
      </section>

      {/* Stigmergy intro */}
      <FeatureRow
        id="stigmergy"
        eyebrow="Stigmergy"
        title="Digital pheromone traces via MCP."
        body="A shared signal layer that lets multiple AI coding agents coordinate without talking to each other. Agents leave typed, decaying traces on file paths; other agents sense the field around them and move accordingly."
        bullets={[
          'Four MCP tools: deposit_trace, sense_environment, reinforce_trace, get_gradient',
          'Attraction / danger / info — three primitives, one decay function',
          'SQLite-backed; no message bus, queue, or shared state protocol',
        ]}
        visual={<CodeBlock code="npm install stigmergy-mcp" language="bash" filename="install" />}
        reverse
      />

      {/* Trace primitives */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="Three primitives"
            title="Attraction, danger, info."
            description="In ant colonies, coordination emerges from traces in the environment. Stigmergy gives agents the same substrate: shared signals keyed to paths in your codebase, with exponential decay."
          />
          <ul className="mt-12 grid gap-4 sm:grid-cols-3">
            {traceTypes.map((t) => (
              <li
                key={t.name}
                className="flex flex-col gap-3 rounded-md border border-ink-500/60 bg-ink-700/30 p-5"
              >
                <span className="font-mono text-2xl text-ink-100">{t.glyph}</span>
                <h3 className="font-mono text-base text-ink-50">{t.name}</h3>
                <p className="text-sm text-ink-200">{t.description}</p>
              </li>
            ))}
          </ul>
          <div className="mt-8 rounded-md border border-ink-500/60 bg-ink-700/40 px-4 py-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-200">
              Decay
            </span>
            <div className="mt-1 font-mono text-sm text-ink-100">{decayFormula}</div>
          </div>
        </div>
      </section>

      {/* 4 MCP tools */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading eyebrow="Four MCP tools" title="A small surface by design." />
          <ul className="mt-12 divide-y divide-ink-500/40 border-y border-ink-500/40">
            {stigmergyTools.map((t) => (
              <li key={t.name} className="grid gap-6 py-6 md:grid-cols-[minmax(0,1fr)_2fr]">
                <div>
                  <div className="font-mono text-sm text-ink-50">{t.name}</div>
                  <div className="mt-1 font-mono text-xs text-ink-300">{t.signature}</div>
                </div>
                <p className="text-ink-200">{t.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* A real trace */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="A real trace"
            title="What the environment looks like from an agent's perspective."
          />
          <div className="mt-10">
            <TraceReceipt
              label="View a sense_environment response"
              json={sampleTraceJson}
            />
          </div>
        </div>
      </section>

      {/* Together */}
      <FeatureRow
        eyebrow="Together"
        title="Sentry watches the agent. Stigmergy is how agents find each other."
        body="Use either on its own. Use both when you have a codebase, more than one agent, and a reason to care what happens when they meet."
        bullets={[
          'AgentSentry — persistent memory + 6 safety skills per agent',
          'Stigmergy — shared decaying signals across any number of agents',
          'Both ship as MCP servers. Both are MIT-licensed. Both run locally.',
        ]}
        visual={
          <CodeBlock
            code={combinedExample}
            language="typescript"
            filename="coordinate.ts"
          />
        }
      />

      {/* Install tabs */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="Install"
            title="Three ways to wire up AgentSentry."
            description="Pick the form factor that matches your editor and workflow. The MCP server works with any MCP-compatible client."
          />
          <div className="mt-10">
            <TabSelector tabs={agentSentryInstallSnippets} />
          </div>
        </div>
      </section>

      {/* Progressive enablement */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="Progressive enablement"
            title="Start at Level 1. Upgrade when ready."
            description="Each level builds on the last. Beginners stay safe with save points; advanced teams run the full stack with proactive safety checks."
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
                  <tr
                    key={row.level}
                    className="border-t border-ink-500/40 align-top text-ink-100"
                  >
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

      <MetricCallout metrics={secondaryMetrics} />

      {/* Ecosystem */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="Ecosystem"
            title="Four places to go next."
          />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ecosystem.map((item) => (
              <li key={`${item.title}-${item.badge}`}>
                <EcosystemCard item={item} />
              </li>
            ))}
          </ul>
          <div className="mt-10 text-sm text-ink-300">
            Or read the full{' '}
            <Link href="/agentsentry" className="text-ink-100 underline decoration-ink-400 underline-offset-4 hover:text-accent">
              AgentSentry overview
            </Link>{' '}
            and{' '}
            <Link href="/stigmergy" className="text-ink-100 underline decoration-ink-400 underline-offset-4 hover:text-accent">
              Stigmergy overview
            </Link>
            .
          </div>
        </div>
      </section>
    </>
  );
}
