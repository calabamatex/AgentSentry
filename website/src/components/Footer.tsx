import Link from 'next/link';

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-ink-500/60 bg-ink-800">
      <div className="mx-auto flex max-w-site flex-col gap-4 px-6 py-10 text-sm text-ink-200 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-ink-50">agenticmgmt</span>
          <span>
            Two halves of a safer multi-agent stack. MIT licensed. Built by{' '}
            <a
              href="https://github.com/calabamatex"
              className="text-ink-100 underline decoration-ink-400 underline-offset-4 hover:text-accent"
              target="_blank"
              rel="noreferrer noopener"
            >
              calabamatex
            </a>
            .
          </span>
        </div>
        <div className="flex items-center gap-5">
          <Link href="/agentsentry" className="hover:text-ink-50">
            AgentSentry
          </Link>
          <Link href="/stigmergy" className="hover:text-ink-50">
            Stigmergy
          </Link>
          <a
            href="https://github.com/calabamatex/AgentSentry"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-ink-50"
          >
            GitHub
          </a>
          <span className="text-ink-300">&copy; {year}</span>
        </div>
      </div>
    </footer>
  );
}
