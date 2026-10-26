import Link from 'next/link';
import { navLinks, wordmark } from '@/data/nav';

export function Nav() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-ink-500/60 bg-ink-800/80 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-site items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="shrink-0 font-mono text-sm tracking-tightest text-ink-50 hover:text-accent"
        >
          {wordmark}
        </Link>
        <ul className="flex items-center gap-3 text-xs text-ink-200 sm:gap-5 sm:text-sm">
          {navLinks.map((link) =>
            link.external ? (
              <li key={link.href}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="transition-colors hover:text-ink-50"
                >
                  {link.label}
                </a>
              </li>
            ) : (
              <li key={link.href}>
                <Link href={link.href} className="transition-colors hover:text-ink-50">
                  {link.label}
                </Link>
              </li>
            ),
          )}
        </ul>
      </nav>
    </header>
  );
}
