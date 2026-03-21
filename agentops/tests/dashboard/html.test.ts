import { describe, it, expect } from 'vitest';
import { getDashboardHtml } from '../../src/dashboard/html';

describe('Dashboard HTML template', () => {
  const html = getDashboardHtml();

  it('returns a valid HTML document', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the title', () => {
    expect(html).toContain('AgentOps Dashboard v5');
  });

  it('includes SSE connection code', () => {
    expect(html).toContain('EventSource');
    expect(html).toContain('/events');
  });

  it('includes API polling endpoints', () => {
    expect(html).toContain('/api/health');
    expect(html).toContain('/api/metrics');
    expect(html).toContain('/api/plugins');
    expect(html).toContain('/api/stats');
  });

  it('includes all panel sections', () => {
    expect(html).toContain('Live Event Feed');
    expect(html).toContain('Health Status');
    expect(html).toContain('Metrics');
    expect(html).toContain('Plugins');
    expect(html).toContain('Overview');
  });

  it('includes connection status indicator', () => {
    expect(html).toContain('conn-dot');
    expect(html).toContain('conn-text');
    expect(html).toContain('connected');
    expect(html).toContain('disconnected');
  });

  it('includes event type color classes', () => {
    expect(html).toContain('type-tool_use');
    expect(html).toContain('type-error');
    expect(html).toContain('type-session_start');
  });

  it('includes reconnection logic', () => {
    expect(html).toContain('reconnectTimer');
    expect(html).toContain('connectSSE');
  });

  it('includes max feed limit', () => {
    expect(html).toContain('MAX_FEED');
  });

  it('includes dark theme CSS variables', () => {
    expect(html).toContain('--bg:#0d1117');
    expect(html).toContain('--accent:#58a6ff');
  });
});
