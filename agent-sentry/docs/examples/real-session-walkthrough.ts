/**
 * real-session-walkthrough.ts — Simulates a realistic AI agent coding session.
 *
 * Demonstrates the full AgentSentry workflow:
 *   1. Initialize a memory store
 *   2. Capture events from a simulated coding session
 *   3. Use risk scoring to assess a proposed change
 *   4. Scan code for secrets
 *   5. Search memory for past decisions
 *   6. Generate a session handoff for continuity
 *   7. Verify hash chain integrity
 *
 * Run: npx tsx docs/examples/real-session-walkthrough.ts
 */

import { MemoryStore, createProvider } from '../../src';
import { assessRisk } from '../../src/primitives/risk-scoring';
import { scanForSecrets } from '../../src/primitives/secret-detection';

const SESSION_ID = `session-${Date.now()}`;
const AGENT_ID = 'claude-coder';

async function main() {
  console.log('=== AgentSentry Real Session Walkthrough ===\n');

  // --- Step 1: Initialize the store ---
  console.log('1. Initializing memory store...');
  const store = new MemoryStore({
    provider: createProvider({ provider: 'sqlite', database_path: ':memory:' }),
  });
  await store.initialize();
  console.log('   Store initialized (in-memory SQLite)\n');

  // --- Step 2: Capture session-start event ---
  console.log('2. Capturing session start event...');
  const startEvent = await store.capture({
    timestamp: new Date().toISOString(),
    session_id: SESSION_ID,
    agent_id: AGENT_ID,
    event_type: 'tool_use',
    severity: 'info',
    skill: 'save_points',
    title: 'Session started — working on payment integration',
    detail: 'Task: Add Stripe payment processing to the checkout flow',
    affected_files: [],
    tags: ['session-start', 'payments'],
    metadata: { task: 'payment-integration' },
  });
  console.log(`   Event captured: ${startEvent.id} (hash: ${startEvent.hash.slice(0, 12)}...)\n`);

  // --- Step 3: Risk scoring ---
  console.log('3. Scoring risk for the proposed change...');
  const risk = assessRisk({
    files: [
      'src/payments/stripe.ts',
      'src/payments/checkout.ts',
      'src/db/orders.ts',
      'src/api/payments.ts',
      'tests/payments/stripe.test.ts',
    ],
    hasDatabaseChanges: true,
    touchesSharedCode: true,
    isMainBranch: false,
  });
  console.log(`   Risk level: ${risk.level} (score: ${risk.score})`);
  console.log(`   Recommendation: ${risk.recommendation}`);

  // Capture the risk assessment
  await store.capture({
    timestamp: new Date().toISOString(),
    session_id: SESSION_ID,
    agent_id: AGENT_ID,
    event_type: 'decision',
    severity: risk.level === 'CRITICAL' ? 'critical' : risk.level === 'HIGH' ? 'high' : 'medium',
    skill: 'small_bets',
    title: `Risk assessment: ${risk.level} for payment integration`,
    detail: `Score: ${risk.score}, files: 5, db changes: yes`,
    affected_files: ['src/payments/stripe.ts', 'src/db/orders.ts'],
    tags: ['risk-assessment', 'payments'],
    metadata: { risk_score: risk.score, risk_level: risk.level },
  });
  console.log('   Risk assessment captured to memory\n');

  // --- Step 4: Secret scanning ---
  console.log('4. Scanning code for secrets...');
  const codeWithSecret = `
    const apiKey = "sk-1234567890abcdefghijklmnopqrst";
    const apiUrl = "https://api.stripe.com/v1/charges";
  `;
  const findings = scanForSecrets(codeWithSecret, 'src/payments/stripe.ts');
  if (findings.length > 0) {
    console.log(`   ALERT: ${findings.length} secret(s) detected!`);
    for (const f of findings) {
      console.log(`     - ${f.description} (${f.severity}): ${f.match}`);
    }

    // Capture the violation
    await store.capture({
      timestamp: new Date().toISOString(),
      session_id: SESSION_ID,
      agent_id: AGENT_ID,
      event_type: 'violation',
      severity: 'critical',
      skill: 'proactive_safety',
      title: 'Secret detected in payment code',
      detail: `Found ${findings.length} hardcoded secret(s) in stripe.ts`,
      affected_files: ['src/payments/stripe.ts'],
      tags: ['secret-detection', 'security', 'payments'],
      metadata: { findings_count: findings.length },
    });
    console.log('   Violation captured to memory');
  } else {
    console.log('   No secrets found.');
  }

  // Scan clean code
  const cleanCode = `
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const apiUrl = "https://api.stripe.com/v1/charges";
  `;
  const cleanFindings = scanForSecrets(cleanCode, 'src/payments/stripe.ts');
  console.log(`   Clean version scan: ${cleanFindings.length} findings (expected 0)\n`);

  // --- Step 5: More events to build history ---
  console.log('5. Capturing more session events...');
  await store.capture({
    timestamp: new Date().toISOString(),
    session_id: SESSION_ID,
    agent_id: AGENT_ID,
    event_type: 'decision',
    severity: 'low',
    skill: 'standing_orders',
    title: 'Used environment variables for Stripe credentials',
    detail: 'Replaced hardcoded key with process.env.STRIPE_SECRET_KEY',
    affected_files: ['src/payments/stripe.ts'],
    tags: ['security-fix', 'payments'],
    metadata: {},
  });

  await store.capture({
    timestamp: new Date().toISOString(),
    session_id: SESSION_ID,
    agent_id: AGENT_ID,
    event_type: 'tool_use',
    severity: 'info',
    skill: 'save_points',
    title: 'Git checkpoint after payment module setup',
    detail: 'Committed: "feat: add Stripe payment integration"',
    affected_files: ['src/payments/stripe.ts', 'src/payments/checkout.ts'],
    tags: ['git-checkpoint', 'payments'],
    metadata: {},
  });
  console.log('   2 additional events captured\n');

  // --- Step 6: Search memory ---
  console.log('6. Searching memory for payment-related decisions...');
  const searchResults = await store.search('payment security', { limit: 5 });
  console.log(`   Found ${searchResults.length} results:`);
  for (const { event, score } of searchResults) {
    console.log(`     [${score.toFixed(2)}] ${event.event_type}: ${event.title}`);
  }
  console.log();

  // --- Step 7: Session stats ---
  console.log('7. Session statistics:');
  const stats = await store.stats();
  console.log(`   Total events: ${stats.total_events}`);
  console.log(`   By type:`, stats.by_type);
  console.log(`   By severity:`, stats.by_severity);
  console.log();

  // --- Step 8: Verify hash chain ---
  console.log('8. Verifying hash chain integrity...');
  const chain = await store.verifyChain();
  console.log(`   Chain valid: ${chain.valid}`);
  console.log(`   Links verified: ${chain.total_checked}`);
  if (chain.first_invalid_index !== undefined) {
    console.log(`   First invalid at index: ${chain.first_invalid_index}`);
  }
  console.log();

  // --- Summary ---
  console.log('=== Session Complete ===');
  console.log(`Session ID: ${SESSION_ID}`);
  console.log(`Events captured: ${stats.total_events}`);
  console.log(`Chain integrity: ${chain.valid ? 'VERIFIED' : 'BROKEN'}`);
  console.log(`Secrets caught: ${findings.length}`);
  console.log(`Risk level: ${risk.level}`);
  console.log();
  console.log('This data persists across sessions. Next time an agent starts,');
  console.log('it can search this history to recall decisions and avoid repeating mistakes.');

  await store.close();
}

main().catch(console.error);
