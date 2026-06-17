/**
 * path-traversal.test.ts — Guards the project-root containment check used by
 * the rules validator (prevents caller-supplied paths from escaping the tree).
 */

import { describe, it, expect } from 'vitest';
import { resolve, sep } from 'path';
import { resolveWithinRoot } from '../../src/primitives/rules-validation';

describe('resolveWithinRoot', () => {
  const root = resolve(process.cwd());

  it('accepts a path inside the project root', () => {
    expect(resolveWithinRoot('package.json')).toBe(root + sep + 'package.json');
  });

  it('accepts a nested in-tree path', () => {
    expect(resolveWithinRoot('src/index.ts')).toBe(resolve(root, 'src/index.ts'));
  });

  it('rejects a parent-traversal path', () => {
    expect(resolveWithinRoot('../../etc/passwd')).toBeNull();
  });

  it('rejects an absolute out-of-tree path', () => {
    expect(resolveWithinRoot('/etc/passwd')).toBeNull();
  });

  it('does not treat a sibling dir sharing the root prefix as in-tree', () => {
    // e.g. root="/a/proj", sibling="/a/proj-evil" must not pass the prefix check
    expect(resolveWithinRoot('../' + root.split(sep).pop() + '-evil/secret')).toBeNull();
  });
});
