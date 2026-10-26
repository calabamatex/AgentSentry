import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const jbm = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jbm',
});

export const metadata: Metadata = {
  title: 'AgentSentry + Stigmergy — Two halves of a safer multi-agent stack',
  description:
    'AgentSentry gives individual AI agents persistent memory and safety guardrails. Stigmergy lets multiple agents coordinate via digital pheromone traces over MCP. Together, a safer multi-agent coding stack.',
  metadataBase: new URL('https://agenticmgmt.dev'),
  openGraph: {
    title: 'AgentSentry + Stigmergy',
    description: 'Per-agent guardrails and multi-agent coordination for AI coding.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AgentSentry + Stigmergy',
    description: 'Per-agent guardrails and multi-agent coordination for AI coding.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${jbm.variable}`}>
      <body className="min-h-screen bg-ink-800 font-sans text-ink-100 antialiased">
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
