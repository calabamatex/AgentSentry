'use client';

import { useEffect, useState, useCallback } from 'react';

const lines = [
  { text: '$ npx @calabamatex/agentsentry scan --file config.ts', className: 'text-green-400' },
  { text: '', className: '' },
  { text: '  Scanning config.ts...', className: 'text-gray-400' },
  { text: '', className: '' },
  { text: '  \u26a0 CRITICAL: AWS Access Key detected', className: 'text-red-400 font-bold' },
  { text: '    Line 14: AKIA3E\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cfXQ', className: 'text-gray-400' },
  { text: '', className: '' },
  { text: '  \u2713 Blocked before commit. 1 secret caught.', className: 'text-green-400 font-bold' },
];

export default function TerminalAnimation() {
  const [visibleCount, setVisibleCount] = useState(0);

  const restart = useCallback(() => {
    setVisibleCount(0);
  }, []);

  useEffect(() => {
    if (visibleCount < lines.length) {
      const timer = setTimeout(() => {
        setVisibleCount((c) => c + 1);
      }, 150);
      return () => clearTimeout(timer);
    }

    // All lines shown -- pause 3 seconds then restart
    const restartTimer = setTimeout(restart, 3000);
    return () => clearTimeout(restartTimer);
  }, [visibleCount, restart]);

  return (
    <div className="overflow-hidden rounded-xl bg-gray-900 shadow-2xl">
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-gray-700 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-red-500" />
        <span className="h-3 w-3 rounded-full bg-yellow-500" />
        <span className="h-3 w-3 rounded-full bg-green-500" />
        <span className="ml-3 text-sm text-gray-400">agent-sentry scan</span>
      </div>

      {/* Terminal body */}
      <div className="px-6 py-5 font-mono text-sm leading-relaxed">
        {lines.slice(0, visibleCount).map((line, i) => (
          <div key={i} className={line.className} style={{ minHeight: '1.5em' }}>
            {line.text}
          </div>
        ))}
        {/* Blinking cursor */}
        {visibleCount < lines.length && (
          <span className="inline-block h-4 w-2 animate-pulse bg-green-400" />
        )}
      </div>
    </div>
  );
}
