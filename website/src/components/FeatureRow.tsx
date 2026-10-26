import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface FeatureRowProps {
  eyebrow?: string;
  title: string;
  body?: string;
  bullets?: string[];
  visual: ReactNode;
  reverse?: boolean;
  id?: string;
}

export function FeatureRow({
  eyebrow,
  title,
  body,
  bullets,
  visual,
  reverse = false,
  id,
}: FeatureRowProps) {
  return (
    <section id={id} className="border-t border-ink-500/40">
      <div className="mx-auto max-w-site px-6 py-20">
        <div
          className={cn(
            'grid items-start gap-12 md:grid-cols-2',
            reverse && 'md:[&>div:first-child]:order-2',
          )}
        >
          <div className="flex flex-col gap-4">
            {eyebrow && (
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink-200">
                {eyebrow}
              </span>
            )}
            <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
              {title}
            </h2>
            {body && <p className="max-w-prose-tight text-ink-200">{body}</p>}
            {bullets && bullets.length > 0 && (
              <ul className="mt-2 flex flex-col gap-2 text-ink-200">
                {bullets.map((b) => (
                  <li key={b} className="flex gap-3">
                    <span className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-ink-300" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="min-w-0">{visual}</div>
        </div>
      </div>
    </section>
  );
}
