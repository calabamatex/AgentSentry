/**
 * size-task.test.ts — Tests for agent_sentry_size_task tool.
 */

import { describe, it, expect } from 'vitest';
import { handler } from '../../../src/mcp/tools/size-task';

describe('agent_sentry_size_task', () => {
  it('should rate simple task as LOW risk', async () => {
    const result = await handler({ task: 'Fix typo in readme' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.risk_level).toBe('LOW');
    expect(parsed.estimated_files).toBeGreaterThan(0);
  });

  it('should rate migration task as HIGH risk', async () => {
    const result = await handler({
      task: 'Migrate database schema from v1 to v2 with data migration scripts',
      files: ['src/db/migrate-v1.ts', 'src/db/migrate-v2.ts', 'src/db/schema.ts'],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(['HIGH', 'CRITICAL']).toContain(parsed.risk_level);
    const migrationFactor = parsed.factors.find(
      (f: { name: string }) => f.name === 'migration',
    );
    expect(migrationFactor).toBeDefined();
  });

  it('should rate security task with high risk', async () => {
    const result = await handler({
      task: 'Implement authentication and authorization middleware with encryption',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(['MEDIUM', 'HIGH', 'CRITICAL']).toContain(parsed.risk_level);
    const securityFactor = parsed.factors.find(
      (f: { name: string }) => f.name === 'security',
    );
    expect(securityFactor).toBeDefined();
  });

  it('should rate refactoring task as MEDIUM or higher', async () => {
    const result = await handler({
      task: 'Refactor the entire API layer to use new patterns',
      files: ['src/api/v1.ts', 'src/api/v2.ts', 'src/api/middleware.ts', 'src/api/routes.ts'],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(['MEDIUM', 'HIGH', 'CRITICAL']).toContain(parsed.risk_level);
  });

  it('should reduce risk for test-related tasks', async () => {
    const result = await handler({ task: 'Add unit tests for the utils module' });
    const parsed = JSON.parse(result.content[0].text);

    const testFactor = parsed.factors.find(
      (f: { name: string }) => f.name === 'testing',
    );
    expect(testFactor).toBeDefined();
    expect(testFactor.contribution).toBeLessThan(0);
  });

  it('should use provided file count', async () => {
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'];
    const result = await handler({ task: 'Update imports', files });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.estimated_files).toBe(5);
  });

  it('should estimate file count from task description', async () => {
    const result = await handler({ task: 'Fix a small bug' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.estimated_files).toBeGreaterThan(0);
  });

  it('should include recommendation', async () => {
    const result = await handler({ task: 'Add a button to the UI' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.recommendation).toBeTruthy();
    expect(typeof parsed.recommendation).toBe('string');
  });

  it('should accumulate multiple keyword risks', async () => {
    const result = await handler({
      task: 'Migrate the database schema and refactor security authentication for production deployment',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(['HIGH', 'CRITICAL']).toContain(parsed.risk_level);
    expect(parsed.factors.length).toBeGreaterThanOrEqual(3);
  });
});
