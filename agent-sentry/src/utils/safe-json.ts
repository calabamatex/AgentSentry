/**
 * safe-json.ts — Safe JSON parsing with duplicate key and prototype pollution protection.
 *
 * Security rationale:
 * - JSON.parse() uses last-wins semantics on duplicate keys. An attacker
 *   can craft JSON with two identical keys — different parsers interpret
 *   different values, undermining cross-platform verification.
 * - Keys like __proto__, constructor, prototype enable prototype pollution
 *   attacks when parsed objects are spread or merged.
 *
 * This module provides drop-in replacements that reject these patterns.
 */

/** Keys that enable prototype pollution. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class SafeJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafeJsonError';
  }
}

/**
 * Parse JSON with duplicate key detection and prototype pollution prevention.
 *
 * @throws SafeJsonError on duplicate keys or dangerous key names
 */
export function safeJsonParse<T = unknown>(text: string): T {
  // First pass: check for duplicate keys and dangerous keys via state machine
  checkDuplicateKeys(text);

  // Second pass: parse with reviver to catch dangerous keys in nested objects
  const result = JSON.parse(text, function (_key: string, value: unknown) {
    if (_key === '') return value; // Root level
    if (DANGEROUS_KEYS.has(_key)) {
      throw new SafeJsonError(
        `Dangerous JSON key rejected: "${_key}" (prototype pollution vector)`
      );
    }
    return value;
  });

  return result as T;
}

/**
 * Check raw JSON text for duplicate keys at any nesting level.
 * Uses a character-by-character state machine to track keys per object depth.
 */
function checkDuplicateKeys(text: string): void {
  const keysByDepth: Map<number, Set<string>> = new Map();
  let depth = 0;
  let inString = false;
  let escaped = false;
  let currentKey = '';
  let collectingKey = false;
  let afterColon = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      if (collectingKey) currentKey += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      if (collectingKey) currentKey += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      if (!inString) {
        inString = true;
        if (!afterColon) {
          collectingKey = true;
          currentKey = '';
        }
      } else {
        inString = false;
        if (collectingKey) {
          collectingKey = false;
          if (!keysByDepth.has(depth)) {
            keysByDepth.set(depth, new Set());
          }
          const keys = keysByDepth.get(depth)!;
          if (keys.has(currentKey)) {
            throw new SafeJsonError(`Duplicate JSON key: "${currentKey}"`);
          }
          keys.add(currentKey);

          // Also check dangerous keys during duplicate scan
          if (DANGEROUS_KEYS.has(currentKey)) {
            throw new SafeJsonError(
              `Dangerous JSON key rejected: "${currentKey}" (prototype pollution vector)`
            );
          }
        }
      }
      continue;
    }

    if (inString) {
      if (collectingKey) currentKey += ch;
      continue;
    }

    if (ch === ':') {
      afterColon = true;
      continue;
    }

    if (ch === ',' || ch === '}' || ch === ']') {
      afterColon = false;
    }

    if (ch === '{') {
      depth++;
      keysByDepth.set(depth, new Set());
      afterColon = false;
    } else if (ch === '}') {
      keysByDepth.delete(depth);
      depth--;
      afterColon = false;
    }
  }
}

/**
 * Stringify with sorted keys for deterministic output.
 * Used for canonical hashing and comparison.
 */
export function safeJsonStringify(value: unknown, indent?: number): string {
  return JSON.stringify(value, sortedReplacer, indent);
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
