/**
 * observability.ts — Illustrative example showing observability primitives.
 *
 * Demonstrates: Logger, CircuitBreaker, HealthChecker, and MetricsCollector.
 * Run: npx ts-node docs/examples/observability.ts
 */

import {
  Logger,
  generateTraceId,
  CircuitBreaker,
  retry,
  HealthChecker,
  memoryUsageCheck,
  eventLoopCheck,
  MetricsCollector,
} from '@calabamatex/agentsentry';

async function main() {
  // --- Logger ---
  const traceId = generateTraceId();
  const log = new Logger({ module: 'example', traceId, minLevel: 'debug' });
  log.info('Application starting', { version: '1.0.0' });
  log.debug('Debug details', { step: 'init' });

  // Child logger inherits trace ID
  const childLog = log.child('example.sub');
  childLog.warn('Something unusual happened');

  // --- CircuitBreaker ---
  const breaker = new CircuitBreaker({
    name: 'external-api',
    failureThreshold: 3,
    resetTimeoutMs: 5000,
    onStateChange: (from, to, name) => {
      log.info(`Circuit ${name}: ${from} -> ${to}`);
    },
  });

  // Execute through the breaker
  try {
    const result = await breaker.execute(async () => 'success');
    console.log('Breaker result:', result);
  } catch (err) {
    console.error('Breaker error:', err);
  }

  console.log('Breaker stats:', breaker.getStats());

  // --- Retry with backoff ---
  let attempt = 0;
  const value = await retry(
    async () => {
      attempt++;
      if (attempt < 3) throw new Error('transient failure');
      return 'recovered';
    },
    { maxRetries: 5, baseDelayMs: 10 },
  );
  console.log('Retry result:', value);

  // --- HealthChecker ---
  const health = new HealthChecker({ version: '1.0.0' });
  health.registerCheck('memory', memoryUsageCheck(512));
  health.registerCheck('event-loop', eventLoopCheck(100));

  const liveness = health.liveness();
  console.log('Liveness:', liveness.status);

  const readiness = await health.readiness();
  console.log('Readiness:', readiness.status, readiness.checks);

  // --- MetricsCollector ---
  const metrics = MetricsCollector.getInstance();
  metrics.counter('requests_total', 'Total HTTP requests');
  metrics.histogram('request_duration_ms', 'Request latency');

  metrics.inc('requests_total', { method: 'GET' });
  metrics.inc('requests_total', { method: 'GET' });
  metrics.observe('request_duration_ms', 42);
  metrics.observe('request_duration_ms', 87);

  console.log('\nPrometheus output (first 5 lines):');
  const output = metrics.toPrometheus();
  console.log(output.split('\n').slice(0, 5).join('\n'));

  // Clean up singleton for this example
  MetricsCollector.reset();
}

main().catch(console.error);
