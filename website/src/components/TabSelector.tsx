'use client';

import { useState } from 'react';
import { CodeBlock } from './CodeBlock';
import { cn } from '@/lib/cn';

interface Tab {
  id: string;
  label: string;
  language: string;
  code: string;
}

interface TabSelectorProps {
  tabs: Tab[];
  initial?: string;
}

export function TabSelector({ tabs, initial }: TabSelectorProps) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!current) return null;

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-ink-500/40">
        {tabs.map((tab) => {
          const isActive = tab.id === current.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              type="button"
              onClick={() => setActive(tab.id)}
              className={cn(
                '-mb-px border-b-2 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] transition-colors',
                isActive
                  ? 'border-ink-50 text-ink-50'
                  : 'border-transparent text-ink-200 hover:text-ink-100',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <CodeBlock code={current.code} language={current.language} filename={current.label} />
    </div>
  );
}
