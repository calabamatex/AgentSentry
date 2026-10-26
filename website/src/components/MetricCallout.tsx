import type { Metric } from '@/data/metrics';

interface MetricCalloutProps {
  metrics: Metric[];
}

export function MetricCallout({ metrics }: MetricCalloutProps) {
  return (
    <section className="border-y border-ink-500/40 bg-ink-700/40">
      <div className="mx-auto grid max-w-site grid-cols-2 gap-8 px-6 py-12 sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="flex flex-col gap-1">
            <span className="text-4xl font-semibold tracking-tight text-ink-50">
              {m.value}
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.14em] text-ink-200">
              {m.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
