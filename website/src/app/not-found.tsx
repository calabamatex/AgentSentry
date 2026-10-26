import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="mx-auto flex max-w-site flex-col gap-6 px-6 py-32">
      <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink-200">
        404
      </span>
      <h1 className="text-balance text-4xl font-semibold tracking-tight text-ink-50 sm:text-5xl">
        No trace at this path.
      </h1>
      <p className="max-w-prose-tight text-ink-200">
        The page you were looking for does not exist. It may have been moved or the link may
        be stale.
      </p>
      <div className="flex gap-3">
        <Link
          href="/"
          className="inline-flex items-center rounded-sm bg-ink-50 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ink-800 transition-colors hover:bg-accent"
        >
          Home
        </Link>
        <Link
          href="/agentsentry"
          className="inline-flex items-center rounded-sm border border-ink-400 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ink-100 transition-colors hover:border-ink-200 hover:text-ink-50"
        >
          AgentSentry
        </Link>
        <Link
          href="/stigmergy"
          className="inline-flex items-center rounded-sm border border-ink-400 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ink-100 transition-colors hover:border-ink-200 hover:text-ink-50"
        >
          Stigmergy
        </Link>
      </div>
    </section>
  );
}
