'use client';

import { useState } from 'react';
import Link from 'next/link';
import { demoScenarios } from '@/data/demo-scenarios';
import SimulatedTerminal from '@/components/demo/SimulatedTerminal';
import ScenarioSelector from '@/components/demo/ScenarioSelector';

export default function DemoPage() {
  const [activeScenarioId, setActiveScenarioId] = useState('init');

  const activeScenario =
    demoScenarios.find((s) => s.id === activeScenarioId) ?? demoScenarios[0];

  return (
    <main className="max-w-4xl mx-auto px-4 py-16 sm:py-24">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-gray-900 dark:text-white">
          Live Demo
        </h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
          See AgentSentry in action. Click a scenario to watch it run.
        </p>
      </div>

      {/* Scenario selector */}
      <div className="mb-8">
        <ScenarioSelector
          scenarios={demoScenarios}
          activeId={activeScenarioId}
          onSelect={setActiveScenarioId}
        />
      </div>

      {/* Terminal */}
      <SimulatedTerminal scenario={activeScenario} />

      {/* CTA section */}
      <div className="mt-12 bg-gray-50 dark:bg-surface-light rounded-xl p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
          Ready to try it yourself?
        </h2>
        <code className="bg-gray-900 text-green-400 font-mono px-4 py-3 rounded-lg inline-block text-sm">
          npm install @calabamatex/agentsentry
        </code>
        <div className="mt-6">
          <Link
            href="/docs"
            className="inline-flex items-center gap-1 text-primary hover:text-primary-light font-medium transition-colors"
          >
            Read the Docs &rarr;
          </Link>
        </div>
      </div>
    </main>
  );
}
