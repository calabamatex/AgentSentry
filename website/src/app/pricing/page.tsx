import { Check } from 'lucide-react';
import Link from 'next/link';

export const metadata = {
  title: 'Pricing - AgentSentry',
  description: 'AgentSentry is free and open source. Always.',
};

const included = [
  'All 9 MCP tools',
  'Hash-chained memory store',
  'Secret detection (20+ patterns)',
  'Risk scoring & rules validation',
  'CLI with 11 commands',
  'SQLite storage (zero config)',
  'Progressive enablement (5 levels)',
  'Full observability stack',
  'Unlimited events & sessions',
  'Community support via GitHub',
];

const faqs = [
  {
    q: 'Is AgentSentry really free?',
    a: 'Yes. The core platform is MIT licensed and will always be free. We believe agent safety should be accessible to everyone.',
  },
  {
    q: 'What about data privacy?',
    a: 'AgentSentry stores all data locally by default (SQLite). Your events, decisions, and agent memory never leave your machine unless you configure a remote provider.',
  },
  {
    q: 'Can I use it in production?',
    a: 'Yes. The core features (MCP server, memory store, CLI, primitives, observability) are all marked stable with 1,102 tests passing.',
  },
  {
    q: 'How do I upgrade enablement levels?',
    a: 'Run npx agentsentry enable for an interactive wizard, or set --level on init. Each level adds skills incrementally \u2014 no disruption to existing workflows.',
  },
];

export default function PricingPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white sm:text-5xl">
          Pricing
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600 dark:text-gray-400">
          AgentSentry is free and open source. Always.
        </p>
      </div>

      {/* Free Tier Card */}
      <div className="mx-auto mt-16 max-w-lg">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-lg dark:border-gray-700 dark:bg-surface-light">
          <div className="text-center">
            <p className="text-6xl font-bold text-primary">Free</p>
            <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">
              Open Source &mdash; MIT License
            </p>
          </div>

          <ul className="mt-8 space-y-3">
            {included.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span className="text-gray-700 dark:text-gray-300">
                  {item}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-8 text-center">
            <Link
              href="/docs"
              className="inline-block rounded-lg bg-primary px-6 py-3 font-semibold text-white transition-colors hover:bg-primary-dark"
            >
              Get Started
            </Link>
          </div>
        </div>
      </div>

      {/* Enterprise Support */}
      <div className="mx-auto mt-16 max-w-lg">
        <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 p-8 dark:border-gray-600 dark:bg-surface">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Enterprise Support
          </h2>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Need dedicated support, SLAs, or custom integrations?
          </p>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Enterprise support is coming soon.
          </p>

          <div className="mt-6">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Get notified when enterprise plans launch.
            </label>
            <div className="mt-2 flex gap-2">
              <input
                type="email"
                placeholder="you@company.com"
                className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-gray-600 dark:bg-surface-light dark:text-white dark:placeholder-gray-500"
              />
              <button
                type="button"
                className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
              >
                Notify Me
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div className="mx-auto mt-20 max-w-2xl">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Frequently Asked Questions
        </h2>
        <div className="mt-8 divide-y divide-gray-200 dark:divide-gray-700">
          {faqs.map((faq) => (
            <div key={faq.q} className="py-5">
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {faq.q}
              </h3>
              <p className="mt-1 text-gray-600 dark:text-gray-400">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
