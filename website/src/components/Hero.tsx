import Link from 'next/link';
import { cn } from '@/lib/cn';

interface CTA {
  label: string;
  href: string;
  external?: boolean;
  variant?: 'primary' | 'ghost';
}

interface HeroProps {
  eyebrow?: string;
  headline: string;
  sub: string;
  ctas?: CTA[];
  versionBadge?: string;
}

export function Hero({ eyebrow, headline, sub, ctas = [], versionBadge }: HeroProps) {
  return (
    <section className="border-b border-ink-500/40">
      <div className="mx-auto max-w-site px-6 py-24 sm:py-32">
        {(eyebrow || versionBadge) && (
          <div className="mb-6 flex items-center gap-3">
            {eyebrow && (
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink-200">
                {eyebrow}
              </span>
            )}
            {versionBadge && (
              <span className="rounded border border-ink-400 px-2 py-0.5 font-mono text-[11px] text-ink-100">
                {versionBadge}
              </span>
            )}
          </div>
        )}
        <h1 className="max-w-[20ch] text-balance text-5xl font-semibold tracking-tightest text-ink-50 sm:text-6xl">
          {headline}
        </h1>
        <p className="mt-6 max-w-prose-tight text-lg text-ink-200">{sub}</p>
        {ctas.length > 0 && (
          <div className="mt-10 flex flex-wrap gap-3">
            {ctas.map((cta) => {
              const className = cn(
                'inline-flex items-center rounded-sm px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] transition-colors',
                cta.variant === 'ghost'
                  ? 'border border-ink-400 text-ink-100 hover:border-ink-200 hover:text-ink-50'
                  : 'bg-ink-50 text-ink-800 hover:bg-accent',
              );
              return cta.external ? (
                <a
                  key={cta.href}
                  href={cta.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={className}
                >
                  {cta.label}
                </a>
              ) : (
                <Link key={cta.href} href={cta.href} className={className}>
                  {cta.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
