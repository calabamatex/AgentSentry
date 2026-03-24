/**
 * Tests that plugin metadata files conform to the schema.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const SCHEMA_PATH = join(__dirname, '..', '..', 'config', 'plugin.schema.json');
const TEMPLATES_DIR = join(__dirname, '..', '..', 'plugins', '_templates');
const CATEGORIES = ['monitor', 'auditor', 'dashboard', 'integration'];

interface PluginMetadata {
  name: string;
  description: string;
  category: string;
  author: { name: string; github?: string; email?: string };
  version: string;
  requires: { 'agent-sentry': string; primitives?: string[] };
  hooks?: string[];
  mcp_tools?: string[];
  tags: string[];
  difficulty?: string;
}

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('Plugin schema', () => {
  it('should exist and be valid JSON', () => {
    expect(existsSync(SCHEMA_PATH)).toBe(true);
    const schema = loadJson(SCHEMA_PATH) as Record<string, unknown>;
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.type).toBe('object');
  });

  it('should require all mandatory fields', () => {
    const schema = loadJson(SCHEMA_PATH) as Record<string, unknown>;
    const required = schema.required as string[];
    expect(required).toContain('name');
    expect(required).toContain('description');
    expect(required).toContain('category');
    expect(required).toContain('author');
    expect(required).toContain('version');
    expect(required).toContain('requires');
    expect(required).toContain('tags');
  });

  it('should define valid categories', () => {
    const schema = loadJson(SCHEMA_PATH) as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    const category = properties.category as Record<string, unknown>;
    const validCategories = category.enum as string[];
    expect(validCategories).toEqual(['monitor', 'auditor', 'dashboard', 'integration']);
  });

  it('should define valid hooks', () => {
    const schema = loadJson(SCHEMA_PATH) as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    const hooks = properties.hooks as Record<string, unknown>;
    const items = hooks.items as Record<string, unknown>;
    const validHooks = items.enum as string[];
    expect(validHooks).toContain('PreToolUse');
    expect(validHooks).toContain('PostToolUse');
    expect(validHooks).toContain('SessionStart');
    expect(validHooks).toContain('Stop');
  });

  it('should define valid difficulty levels', () => {
    const schema = loadJson(SCHEMA_PATH) as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    const difficulty = properties.difficulty as Record<string, unknown>;
    const validLevels = difficulty.enum as string[];
    expect(validLevels).toEqual(['beginner', 'intermediate', 'advanced']);
  });
});

describe('Template metadata files', () => {
  for (const category of CATEGORIES) {
    describe(`${category} template`, () => {
      const metadataPath = join(TEMPLATES_DIR, category, 'metadata.json');

      it('should exist', () => {
        expect(existsSync(metadataPath)).toBe(true);
      });

      it('should be valid JSON with required fields', () => {
        const metadata = loadJson(metadataPath) as PluginMetadata;
        expect(metadata.name).toBeDefined();
        expect(metadata.description).toBeDefined();
        expect(metadata.category).toBe(category);
        expect(metadata.author).toBeDefined();
        expect(metadata.author.name).toBeDefined();
        expect(metadata.version).toBeDefined();
        expect(metadata.requires).toBeDefined();
        expect(metadata.requires['agent-sentry']).toBeDefined();
        expect(metadata.tags).toBeDefined();
        expect(metadata.tags.length).toBeGreaterThanOrEqual(1);
      });

      it('should have valid name pattern', () => {
        const metadata = loadJson(metadataPath) as PluginMetadata;
        expect(metadata.name).toMatch(/^[a-z0-9-]+$/);
      });

      it('should have valid version', () => {
        const metadata = loadJson(metadataPath) as PluginMetadata;
        expect(metadata.version).toMatch(/^\d+\.\d+\.\d+$/);
      });

      it('should have description under 200 chars', () => {
        const metadata = loadJson(metadataPath) as PluginMetadata;
        expect(metadata.description.length).toBeLessThanOrEqual(200);
      });

      it('should reference valid primitives', () => {
        const metadata = loadJson(metadataPath) as PluginMetadata;
        const validPrimitives = [
          'checkpoint-and-branch', 'rules-validation', 'risk-scoring',
          'context-estimation', 'scaffold-update', 'secret-detection', 'event-capture',
        ];
        if (metadata.requires.primitives) {
          for (const prim of metadata.requires.primitives) {
            expect(validPrimitives).toContain(prim);
          }
        }
      });
    });
  }
});
