/**
 * Integration tests — primitives working together.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assessRisk } from '../../src/primitives/risk-scoring';
import { estimateContext } from '../../src/primitives/context-estimation';
import { scanForSecrets } from '../../src/primitives/secret-detection';

// Mock MemoryStore for captureEvent
const mockCapture = vi.fn();
const mockInitialize = vi.fn();
const mockClose = vi.fn();

vi.mock('../../src/memory/store', () => ({
  MemoryStore: vi.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    capture: mockCapture,
    close: mockClose,
  })),
}));

// Need to import after mocks are set up
import { captureEvent } from '../../src/primitives/event-capture';

beforeEach(() => {
  vi.clearAllMocks();
  mockInitialize.mockResolvedValue(undefined);
  mockClose.mockResolvedValue(undefined);
  mockCapture.mockResolvedValue({
    id: 'test-id',
    timestamp: new Date().toISOString(),
    session_id: 'test',
    agent_id: 'test',
    event_type: 'decision',
    severity: 'low',
    skill: 'system',
    title: 'test',
    detail: 'test',
    affected_files: [],
    tags: [],
    metadata: {},
    hash: 'abc',
    prev_hash: '000',
  });
});

describe('Risk assessment + event capture', () => {
  it('should assess risk and capture high-risk event', async () => {
    const risk = assessRisk({
      files: ['migration.sql', 'schema.ts', 'api.ts', 'routes.ts', 'models.ts'],
      hasDatabaseChanges: true,
      touchesSharedCode: true,
      isMainBranch: true,
    });

    expect(risk.level).toBe('CRITICAL');

    const event = await captureEvent({
      eventType: 'decision',
      severity: risk.level === 'HIGH' || risk.level === 'CRITICAL' ? 'high' : 'low',
      skill: 'small_bets',
      title: `Risk assessment: ${risk.level}`,
      detail: `Score: ${risk.score}/15. ${risk.recommendation}`,
      affectedFiles: ['migration.sql', 'schema.ts'],
      tags: ['risk-assessment'],
    });

    expect(event).toBeDefined();
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'high',
        skill: 'small_bets',
        tags: ['risk-assessment'],
      })
    );
  });
});

describe('Context estimation + event capture', () => {
  it('should estimate context and capture refresh warning', async () => {
    const health = estimateContext(45);

    expect(health.recommendation).toBe('refresh');

    const event = await captureEvent({
      eventType: 'incident',
      severity: 'high',
      skill: 'context_health',
      title: 'Context window nearing capacity',
      detail: health.details,
      tags: ['context-health', 'refresh-needed'],
    });

    expect(event).toBeDefined();
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'incident',
        skill: 'context_health',
      })
    );
  });
});

describe('Secret detection + event capture', () => {
  it('should detect secrets and capture violation event', async () => {
    const content = 'password = "super_secret_password_12345"';
    const secrets = scanForSecrets(content, 'config.ts');

    expect(secrets.length).toBeGreaterThan(0);

    const event = await captureEvent({
      eventType: 'violation',
      severity: 'critical',
      skill: 'proactive_safety',
      title: `Secret detected: ${secrets[0].type}`,
      detail: `Found ${secrets.length} secret(s) in config.ts. ${secrets[0].description}`,
      affectedFiles: ['config.ts'],
      tags: ['secret-detection', 'security'],
    });

    expect(event).toBeDefined();
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'violation',
        severity: 'critical',
        skill: 'proactive_safety',
      })
    );
  });
});

describe('Combined risk + secrets workflow', () => {
  it('should combine risk scoring with secret detection findings', () => {
    const content = 'password = "hunter2_secret_val"';
    const secrets = scanForSecrets(content);

    const risk = assessRisk({
      files: ['config.ts'],
      hasDatabaseChanges: false,
      touchesSharedCode: true,
      isMainBranch: true,
    });

    expect(secrets.length).toBeGreaterThan(0);
    expect(risk.level).toBe('MEDIUM');
    expect(risk.score).toBeGreaterThanOrEqual(4);
  });
});
