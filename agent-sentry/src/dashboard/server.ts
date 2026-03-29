/**
 * server.ts — Dashboard HTTP server for AgentSentry v5.
 *
 * Serves a single-file SPA dashboard and proxies API endpoints:
 *   /           → Dashboard HTML
 *   /events     → SSE event stream (delegated to EventStream)
 *   /api/health → HealthChecker readiness
 *   /api/metrics → Prometheus text metrics
 *   /api/plugins → Plugin list
 *   /api/stats  → Memory store stats
 *
 * Zero external dependencies — uses only Node built-in http.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { EventStream, StreamClient, StreamEvent, StreamFilter } from '../streaming/event-stream';
import { Logger } from '../observability/logger';
import { errorMessage } from '../utils/error-message';

const logger = new Logger({ module: 'dashboard-server' });
import { HealthChecker, memoryUsageCheck, eventLoopCheck } from '../observability/health';
import { MetricsCollector } from '../observability/metrics';
import { PluginRegistry } from '../plugins/registry';
import { getDashboardHtml } from './html';
import { VERSION } from '../version';
import { MemoryStore } from '../memory/store';
import { getDashboardHeader, getDashboardPanels } from '../enablement/dashboard-adapter';
import type { EnablementConfig } from '../enablement/engine';
import type { AgentCoordinator } from '../coordination/coordinator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardServerOptions {
  /** Port to listen on (default 9200). */
  port?: number;
  /** Host to bind to (default '127.0.0.1'). */
  host?: string;
  /** CORS origin (default '*'). */
  corsOrigin?: string;
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
  private options: Required<Omit<DashboardServerOptions, 'eventStream' | 'healthChecker' | 'pluginRegistry' | 'memoryStore' | 'enablementConfig' | 'coordinator'>>;
  private startTime = 0;

  constructor(options?: DashboardServerOptions) {
    this.options = {
      port: options?.port ?? 9200,
      host: options?.host ?? '127.0.0.1',
      corsOrigin: options?.corsOrigin ?? 'http://127.0.0.1:9200',
    };

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
