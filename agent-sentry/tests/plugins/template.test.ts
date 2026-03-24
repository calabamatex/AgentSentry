/**
 * Tests that each plugin template has required structure.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const TEMPLATES_DIR = join(__dirname, '..', '..', 'plugins', '_templates');
const CATEGORIES = ['monitor', 'auditor', 'dashboard', 'integration'];

describe('Plugin template structure', () => {
  for (const category of CATEGORIES) {
    describe(`${category} template`, () => {
      const templateDir = join(TEMPLATES_DIR, category);

      it('should have metadata.json', () => {
        expect(existsSync(join(templateDir, 'metadata.json'))).toBe(true);
      });

      it('should have README.md', () => {
        expect(existsSync(join(templateDir, 'README.md'))).toBe(true);
      });

      it('should have src/index.ts', () => {
        expect(existsSync(join(templateDir, 'src', 'index.ts'))).toBe(true);
      });

      it('README should have required sections', () => {
        const readme = readFileSync(join(templateDir, 'README.md'), 'utf-8');
        expect(readme).toContain('What It Does');
        expect(readme).toContain('Prerequisites');
        expect(readme).toContain('Installation');
        expect(readme).toContain('Configuration');
        expect(readme).toContain('How It Works');
        expect(readme).toContain('Troubleshooting');
      });

      it('src/index.ts should export required plugin interface', () => {
        const source = readFileSync(join(templateDir, 'src', 'index.ts'), 'utf-8');
        expect(source).toContain('export const name');
        expect(source).toContain('export const version');
        expect(source).toContain('export const category');
        expect(source).toContain('export const hooks');
        expect(source).toContain('export async function activate');
        expect(source).toContain('export async function deactivate');
      });

      it('metadata.json category should match directory name', () => {
        const metadata = JSON.parse(
          readFileSync(join(templateDir, 'metadata.json'), 'utf-8')
        );
        expect(metadata.category).toBe(category);
      });

      it('src/index.ts category should match metadata', () => {
        const metadata = JSON.parse(
          readFileSync(join(templateDir, 'metadata.json'), 'utf-8')
        );
        const source = readFileSync(join(templateDir, 'src', 'index.ts'), 'utf-8');
        expect(source).toContain(`'${metadata.category}'`);
      });

      it('src/index.ts name should match metadata', () => {
        const metadata = JSON.parse(
          readFileSync(join(templateDir, 'metadata.json'), 'utf-8')
        );
        const source = readFileSync(join(templateDir, 'src', 'index.ts'), 'utf-8');
        expect(source).toContain(`'${metadata.name}'`);
      });

      it('src/index.ts version should match metadata', () => {
        const metadata = JSON.parse(
          readFileSync(join(templateDir, 'metadata.json'), 'utf-8')
        );
        const source = readFileSync(join(templateDir, 'src', 'index.ts'), 'utf-8');
        expect(source).toContain(`'${metadata.version}'`);
      });
    });
  }
});
