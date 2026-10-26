import { Hero } from '@/components/Hero';
import { SectionHeading } from '@/components/SectionHeading';
import { TabSelector } from '@/components/TabSelector';
import { TraceReceipt } from '@/components/TraceReceipt';
import { StepSequence } from '@/components/StepSequence';
import { EcosystemCard } from '@/components/EcosystemCard';
import { ecosystem } from '@/data/ecosystem';
import {
  stigmergyTagline,
  stigmergyPitch,
  stigmergyIdea,
  stigmergyVersion,
  traceTypes,
  decayFormula,
  stigmergyTools,
  stigmergyInstallSnippets,
  sampleTraceJson,
  workflow,
  techFacts,
} from '@/data/stigmergy';

export const metadata = {
  title: 'Stigmergy — Digital pheromone traces via MCP',
  description: stigmergyPitch,
};

export default function StigmergyPage() {
  return (
    <>
      <Hero
        eyebrow="Stigmergy"
        versionBadge={`${stigmergyVersion} · alpha`}
        headline={stigmergyTagline}
        sub={stigmergyPitch}
        ctas={[
          {
            label: 'GitHub',
            href: 'https://github.com/calabamatex/stigmergy-mcp',
            external: true,
          },
          {
            label: 'npm',
            href: 'https://www.npmjs.com/package/stigmergy-mcp',
            external: true,
            variant: 'ghost',
          },
        ]}
      />

      {/* The idea */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading eyebrow="The idea" title="Coordination without communication." />
          <p className="mt-6 max-w-prose-tight text-ink-200">{stigmergyIdea}</p>
        </div>
      </section>

      {/* Trace types */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="Trace types"
            title="Three primitives. One decay function."
          />
          <ul className="mt-12 grid gap-4 sm:grid-cols-3">
            {traceTypes.map((t) => (
              <li
                key={t.name}
                className="flex flex-col gap-3 rounded-md border border-ink-500/60 bg-ink-700/30 p-6"
              >
                <span className="font-mono text-2xl text-ink-100">{t.glyph}</span>
                <h3 className="font-mono text-base text-ink-50">{t.name}</h3>
                <p className="text-sm text-ink-200">{t.description}</p>
              </li>
            ))}
          </ul>
          <div className="mt-8 rounded-md border border-ink-500/60 bg-ink-700/40 px-4 py-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-200">
              Effective intensity
            </span>
            <div className="mt-1 font-mono text-sm text-ink-100">{decayFormula}</div>
            <p className="mt-2 text-xs text-ink-300">
              Stale signals fade naturally; reinforced signals dominate. Sub-1% traces are
              auto-pruned.
            </p>
          </div>
        </div>
      </section>

      {/* MCP tools */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="MCP tools"
            title="Four calls. That's the whole interface."
          />
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

      {/* Install */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading eyebrow="Install" title="One package, one MCP wire-up." />
          <div className="mt-10">
            <TabSelector tabs={stigmergyInstallSnippets} />
          </div>
        </div>
      </section>

      {/* Sample trace */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading
            eyebrow="A real trace"
            title="What the environment looks like from an agent's perspective."
          />
          <div className="mt-10">
            <TraceReceipt label="View a sense_environment response" json={sampleTraceJson} />
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto grid max-w-site gap-12 px-6 py-20 md:grid-cols-[1fr_1.3fr]">
          <SectionHeading
            eyebrow="Example workflow"
            title="Three agents, one codebase, no direct messages."
          />
          <StepSequence steps={workflow} />
        </div>
      </section>

      {/* Tech stack */}
      <section className="border-t border-ink-500/40">
        <div className="mx-auto max-w-site px-6 py-20">
          <SectionHeading eyebrow="Tech" title="Small, local, boring on purpose." />
          <dl className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {techFacts.map((fact) => (
              <div
                key={fact.label}
                className="flex flex-col gap-1 rounded-md border border-ink-500/60 bg-ink-700/30 px-4 py-3"
              >
                <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-200">
                  {fact.label}
                </dt>
                <dd className="font-mono text-sm text-ink-50">{fact.value}</dd>
              </div>
            ))}
          </dl>
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
