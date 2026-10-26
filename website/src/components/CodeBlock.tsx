'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  className?: string;
}

export function CodeBlock({ code, language = 'bash', filename, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-md border border-ink-500/60 bg-ink-700',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-ink-500/60 px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-200">
          {filename ?? language}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-200 transition-colors hover:text-ink-50"
          aria-label="Copy code to clipboard"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-sm leading-6 text-ink-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}
