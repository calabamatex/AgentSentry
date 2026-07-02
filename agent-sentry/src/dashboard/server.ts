/**
 * server.ts — Dashboard HTTP server for AgentSentry.
 *
 * Serves a single-file SPA dashboard and proxies API endpoints:
 *   /           → Dashboard HTML
 *   /events     → SSE event stream (delegated to EventStream)
 *   /api/health → HealthChecker readiness
 *   /api/metrics → Prometheus text metrics
 *   /api/plugins → Plugin list
 *   /api/stats  → Memory store stats
 *   /api/enablement → Enablement level + skills
 *   /api/risk   → Confidence-labeled risk score (Level 6 only)
 *
 * Zero external dependencies — uses only Node built-in http.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { EventStream, StreamClient, StreamEvent, StreamFilter } from '../streaming/event-stream';
import { Logger } from '../observability/logger';
import { errorMessage } from '../utils/error-message';
import { timingSafeStringEqual } from '../utils/timing-safe';

const logger = new Logger({ module: 'dashboard-server' });
import { HealthChecker, memoryUsageCheck, eventLoopCheck } from '../observability/health';
import { MetricsCollector } from '../observability/metrics';
import { PluginRegistry } from '../plugins/registry';
import { getDashboardHtml } from './html';
import { VERSION } from '../version';
import { MemoryStore } from '../memory/store';
import { getDashboardHeader, getDashboardPanels } from '../enablement/dashboard-adapter';
import type { EnablementConfig } from '../enablement/engine';
import { RiskScoringEngine, DEFAULT_RISK_SCORING_CONFIG } from '../risk-scoring';
import type { AgentCoordinator } from '../coordination/coordinator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardServerOptions {
  /** Port to listen on (default 9200). */
  port?: number;
  /** Host to bind to (default '127.0.0.1'). */
  host?: string;
  /** CORS origin (default 'http://127.0.0.1:9200'). */
  corsOrigin?: string;
  /** Authentication token. All requests must include Authorization: Bearer <token>. */
  token?: string;
  /**
   * Dev mode: auto-generate a random token when none is configured instead of
   * refusing to start. The generated token is retrievable via getToken() so the
   * caller (CLI --dev) can display it. Never use in production.
   */
  devMode?: boolean;
  /** EventStream instance to subscribe to. */
  eventStream?: EventStream;
  /** HealthChecker instance. */
  healthChecker?: HealthChecker;
  /** PluginRegistry instance. */
  pluginRegistry?: PluginRegistry;
  /** Optional MemoryStore for enriched /api/stats responses. */
  memoryStore?: MemoryStore;
  /** Optional EnablementConfig for /api/enablement endpoint. */
  enablementConfig?: EnablementConfig;
  /** Optional AgentCoordinator for /api/coordination endpoint. */
  coordinator?: AgentCoordinator;
}

export interface DashboardServerInfo {
  port: number;
  host: string;
  url: string;
}

// ---------------------------------------------------------------------------
// DashboardServer
// ---------------------------------------------------------------------------

export class DashboardServer {
  private server: http.Server | null = null;
  private eventStream: EventStream;
  private healthChecker: HealthChecker;
  private pluginRegistry: PluginRegistry;
  private memoryStore?: MemoryStore;
  private enablementConfig?: EnablementConfig;
  private coordinator?: AgentCoordinator;
  private token?: string;
  private options: Required<Omit<DashboardServerOptions, 'eventStream' | 'healthChecker' | 'pluginRegistry' | 'memoryStore' | 'enablementConfig' | 'coordinator' | 'token' | 'devMode'>>;
  private startTime = 0;

  constructor(options?: DashboardServerOptions) {
    this.options = {
      port: options?.port ?? 9200,
      host: options?.host ?? '127.0.0.1',
      corsOrigin: options?.corsOrigin ?? 'http://127.0.0.1:9200',
    };

    // Token: env var > options. Fail closed when absent (WI-003, MCP parity):
    // auto-generation only under explicit devMode; AGENT_SENTRY_NO_AUTH=1|true
    // disables auth entirely (unsafe, warned at startup).
    const noAuth = process.env.AGENT_SENTRY_NO_AUTH;
    const authDisabled = noAuth === 'true' || noAuth === '1';
    if (process.env.AGENT_SENTRY_DASHBOARD_TOKEN) {
      this.token = process.env.AGENT_SENTRY_DASHBOARD_TOKEN;
    } else if (options?.token) {
      this.token = options.token;
    } else if (authDisabled) {
      this.token = undefined;
    } else if (options?.devMode) {
      this.token = crypto.randomBytes(24).toString('hex');
    } else {
      throw new Error(
        'DashboardServer requires an auth token. Set AGENT_SENTRY_DASHBOARD_TOKEN, ' +
        'pass { token }, use --dev to auto-generate one, or set ' +
        'AGENT_SENTRY_NO_AUTH=1 to disable authentication (unsafe).',
      );
    }

    this.eventStream = options?.eventStream ?? new EventStream();
    this.healthChecker = options?.healthChecker ?? new HealthChecker({ version: VERSION });
    this.pluginRegistry = options?.pluginRegistry ?? new PluginRegistry();
    this.memoryStore = options?.memoryStore;
    this.enablementConfig = options?.enablementConfig;
    this.coordinator = options?.coordinator;

    // Register default health checks
    this.healthChecker.registerCheck('memory', memoryUsageCheck());
    this.healthChecker.registerCheck('event_loop', eventLoopCheck());
  }

  /** Start the dashboard server. */
  async start(): Promise<DashboardServerInfo> {
    if (this.server) {
      throw new Error('DashboardServer is already running');
    }

    this.startTime = Date.now();
    this.eventStream.start();

    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this.handleRequest(req, res));

      srv.on('error', reject);

      srv.listen(this.options.port, this.options.host, () => {
        this.server = srv;
        const addr = srv.address();
        const port = (addr && typeof addr === 'object') ? addr.port : this.options.port;
        const host = this.options.host;
        // Never log the token itself (WI-003) — it must not reach log sinks.
        if (!this.token) {
          logger.warn('Dashboard auth DISABLED (AGENT_SENTRY_NO_AUTH) — all requests accepted', { port, host });
        }
        logger.info('Dashboard started', { auth: this.token ? 'token' : 'disabled', port, host });
        resolve({ port, host, url: `http://${host}:${port}` });
      });
    });
  }

  /** Stop the dashboard server. */
  async stop(): Promise<void> {
    if (!this.server) return;

    this.eventStream.stop();

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        resolve();
      });
      this.server!.closeAllConnections?.();
    });
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  // -------------------------------------------------------------------------
  // Request routing
  // -------------------------------------------------------------------------

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // CORS
    res.setHeader('Access-Control-Allow-Origin', this.options.corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Last-Event-ID, Cache-Control');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!this.authenticateRequest(req, res, url)) return;

    const path = url.pathname;

    // Dashboard HTML
    if (path === '/' || path === '/index.html') {
      this.serveDashboard(res);
      return;
    }

    // SSE event stream
    if (path === '/events') {
      this.handleSse(req, res, url);
      return;
    }

    // API endpoints
    if (path === '/api/health') {
      void this.handleHealth(res);
      return;
    }

    if (path === '/api/metrics') {
      this.handleMetrics(res);
      return;
    }

    if (path === '/api/plugins') {
      void this.handlePlugins(res);
      return;
    }

    if (path === '/api/stats') {
      void this.handleStats(res);
      return;
    }

    if (path === '/api/enablement') {
      this.handleEnablement(res);
      return;
    }

    if (path === '/api/streaming') {
      this.handleStreaming(res);
      return;
    }

    if (path === '/api/coordination') {
      void this.handleCoordination(res);
      return;
    }

    if (path === '/api/risk') {
      void this.handleRisk(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  private serveDashboard(res: http.ServerResponse): void {
    const html = getDashboardHtml();
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(html);
  }

  private handleSse(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
    const filter = this.parseFilter(url);
    const clientId = crypto.randomUUID();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Client-Id': clientId,
    });

    res.write(': connected\n\n');

    const client: StreamClient = {
      id: clientId,
      connectedAt: new Date().toISOString(),
      filter,
      transport: 'sse',
      send(event: StreamEvent): void {
        if (event.type === 'heartbeat') {
          res.write(': heartbeat\n\n');
          return;
        }
        let msg = '';
        if (event.id) msg += `id: ${event.id}\n`;
        msg += `event: ${event.type}\n`;
        msg += `data: ${JSON.stringify(event.data)}\n\n`;
        res.write(msg);
      },
      close(): void {
        res.end();
      },
    };

    if (!this.eventStream.addClient(client)) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Max clients reached' }));
      return;
    }

    req.on('close', () => {
      this.eventStream.removeClient(clientId);
    });
  }

  private async handleHealth(res: http.ServerResponse): Promise<void> {
    try {
      const result = await this.healthChecker.readiness();
      const code = result.status === 'healthy' ? 200 : result.status === 'degraded' ? 200 : 503;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch {
      logger.debug('Health check handler threw');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Health check failed' }));
    }
  }

  private handleMetrics(res: http.ServerResponse): void {
    const collector = MetricsCollector.getInstance();
    const text = collector.toPrometheus();
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
  }

  private async handlePlugins(res: http.ServerResponse): Promise<void> {
    try {
      const plugins = await this.pluginRegistry.list();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(plugins));
    } catch (e) {
      logger.warn('Failed to list plugins for dashboard', { error: errorMessage(e) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
  }

  private async handleStats(res: http.ServerResponse): Promise<void> {
    const streamStats = {
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      clients: this.eventStream.getClientCount(),
      eventsPublished: this.eventStream.getStats().eventsPublished,
    };

    if (this.memoryStore) {
      try {
        const memoryStats = await this.memoryStore.stats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...streamStats, memory: memoryStats }));
        return;
      } catch (e) {
        logger.debug('Failed to get memory stats for dashboard', { error: errorMessage(e) });
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(streamStats));
  }

  private handleEnablement(res: http.ServerResponse): void {
    if (!this.enablementConfig) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ available: false }));
      return;
    }
    try {
      const header = getDashboardHeader(this.enablementConfig);
      const panels = getDashboardPanels(this.enablementConfig);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ available: true, ...header, panels }));
    } catch (e) {
      logger.warn('Failed to build enablement data', { error: errorMessage(e) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ available: false }));
    }
  }

  /**
   * Risk scoring for the dashboard (Level 6 only). Builds an engine from the
   * most recent session's events and returns a confidence-labeled RiskScore.
   * Returns { available: false } when risk scoring is not enabled or no store.
   */
  private async handleRisk(res: http.ServerResponse): Promise<void> {
    const enabled = this.enablementConfig?.skills?.risk_scoring?.enabled === true;
    if (!enabled || !this.memoryStore) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ available: false }));
      return;
    }
    try {
      const recent = await this.memoryStore.list({ limit: 1 });
      const sessionId = recent[0]?.session_id;
      if (!sessionId) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ available: true, session_id: null }));
        return;
      }
      const events = await this.memoryStore.list({ session_id: sessionId, limit: 1000 });
      const engine = new RiskScoringEngine(DEFAULT_RISK_SCORING_CONFIG, sessionId);
      engine.loadFromEvents([...events].reverse()); // store is newest-first
      const score = engine.evaluate(new Date().toISOString());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ available: true, session_id: sessionId, ...score }));
    } catch (e) {
      logger.warn('Failed to build risk data', { error: errorMessage(e) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ available: false }));
    }
  }

  private handleStreaming(res: http.ServerResponse): void {
    const stats = this.eventStream.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  }

  private async handleCoordination(res: http.ServerResponse): Promise<void> {
    if (!this.coordinator) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ available: false, agents: [] }));
      return;
    }
    try {
      const agents = await this.coordinator.listAgents();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ available: true, agents }));
    } catch (e) {
      logger.warn('Failed to list coordinated agents', { error: errorMessage(e) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ available: false, agents: [] }));
    }
  }

  /**
   * The active auth token, or undefined when auth is disabled
   * (AGENT_SENTRY_NO_AUTH). Lets the CLI --dev path display an
   * auto-generated token without it ever entering log output.
   */
  getToken(): string | undefined {
    return this.token;
  }

  private authenticateRequest(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
    // Only reachable tokenless under AGENT_SENTRY_NO_AUTH (constructor fails closed otherwise)
    if (!this.token) return true;

    // Allow token in query param for SSE (EventSource can't set headers).
    // URL exposure trade-off is documented in docs/dashboard-guide.md.
    const queryToken = url.searchParams.get('token');
    if (queryToken !== null && timingSafeStringEqual(queryToken, this.token)) return true;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ') || !timingSafeStringEqual(authHeader.slice(7), this.token)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return false;
    }
    return true;
  }

  private parseFilter(url: URL): StreamFilter {
    const filter: StreamFilter = {};
    const type = url.searchParams.get('type');
    const severity = url.searchParams.get('severity');
    const skill = url.searchParams.get('skill');
    const agent = url.searchParams.get('agent');
    const session = url.searchParams.get('session');

    if (type) filter.eventTypes = type.split(',');
    if (severity) filter.severities = severity.split(',');
    if (skill) filter.skills = skill.split(',');
    if (agent) filter.agentId = agent;
    if (session) filter.sessionId = session;

    return filter;
  }
}
