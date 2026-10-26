import { ArrowUpRight } from 'lucide-react';
import type { EcosystemItem } from '@/data/ecosystem';

interface EcosystemCardProps {
  item: EcosystemItem;
}

export function EcosystemCard({ item }: EcosystemCardProps) {
  return (
    <a
      href={item.href}
      target="_blank"
      rel="noreferrer noopener"
      className="group flex flex-col gap-4 rounded-md border border-ink-500/60 bg-ink-700/30 p-5 transition-colors hover:border-ink-300 hover:bg-ink-700/60"
    >
      <div className="flex items-start justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-200">
          {item.badge}
        </span>
        <ArrowUpRight className="h-4 w-4 text-ink-300 transition-colors group-hover:text-ink-50" />
      </div>
      <div>
        <h3 className="font-mono text-base text-ink-50">{item.title}</h3>
        <p className="mt-1 text-sm text-ink-200">{item.description}</p>
      </div>
      <div className="mt-auto flex items-center gap-3 font-mono text-[11px] text-ink-300">
        {item.version && <span>{item.version}</span>}
        {item.license && <span>{item.license}</span>}
      </div>
    </a>
  );
}
