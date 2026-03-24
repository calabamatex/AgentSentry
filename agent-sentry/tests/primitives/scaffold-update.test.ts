/**
 * Tests for scaffold-update primitive.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { updateScaffold } from '../../src/primitives/scaffold-update';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateScaffold', () => {
  it('should report all files present when they exist', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# Project\n\nThis is a valid scaffold file with content.');

    const result = await updateScaffold('/fake/project');

    expect(result.allPresent).toBe(true);
    expect(result.missingCount).toBe(0);
    expect(result.files).toHaveLength(6);
  });

  it('should report missing files', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await updateScaffold('/fake/project');

    expect(result.allPresent).toBe(false);
    expect(result.missingCount).toBe(6);
    result.files.forEach((f) => {
      expect(f.exists).toBe(false);
      expect(f.issues).toContain('File does not exist');
    });
  });

  it('should detect empty files', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const result = await updateScaffold('/fake/project');

    result.files.forEach((f) => {
      expect(f.issues).toContain('File is empty');
    });
  });

  it('should detect files with minimal content', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('short');

    const result = await updateScaffold('/fake/project');

    result.files.forEach((f) => {
      expect(f.issues.some((i) => i.includes('minimal content'))).toBe(true);
    });
  });

  it('should detect files without markdown headings', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('This is a long paragraph without any markdown headings at all.');

    const result = await updateScaffold('/fake/project');

    result.files.forEach((f) => {
      expect(f.issues).toContain('File has no markdown headings');
    });
  });

  it('should check all 6 scaffold files', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await updateScaffold('/fake/project');

    const fileNames = result.files.map((f) => f.path);
    expect(fileNames).toContain('CLAUDE.md');
    expect(fileNames).toContain('AGENTS.md');
    expect(fileNames).toContain('PLANNING.md');
    expect(fileNames).toContain('TASKS.md');
    expect(fileNames).toContain('CONTEXT.md');
    expect(fileNames).toContain('WORKFLOW.md');
  });

  it('should handle mixed present/missing files', async () => {
    mockExistsSync.mockImplementation((path) => {
      return String(path).includes('CLAUDE') || String(path).includes('AGENTS');
    });
    mockReadFileSync.mockReturnValue('# Valid\n\nContent with headings and enough text.');

    const result = await updateScaffold('/fake/project');

    expect(result.allPresent).toBe(false);
    expect(result.missingCount).toBe(4);
    expect(result.files.filter((f) => f.exists)).toHaveLength(2);
  });
});
