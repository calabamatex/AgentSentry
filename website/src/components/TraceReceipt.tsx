import { ChevronRight } from 'lucide-react';

interface TraceReceiptProps {
  label?: string;
  json: string;
}

export function TraceReceipt({ label = 'View a real receipt', json }: TraceReceiptProps) {
  return (
    <details className="group overflow-hidden rounded-md border border-ink-500/60 bg-ink-700/40 open:bg-ink-700/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-mono text-xs uppercase tracking-[0.14em] text-ink-100 transition-colors hover:text-ink-50">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <pre className="overflow-x-auto border-t border-ink-500/60 px-4 py-4 font-mono text-xs leading-6 text-ink-100">
        <code>{json}</code>
      </pre>
    </details>
  );
}
