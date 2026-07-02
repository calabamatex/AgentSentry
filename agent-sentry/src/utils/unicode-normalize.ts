/**
 * unicode-normalize.ts — Normalization for security-sensitive string matching (WI-014).
 *
 * Detection patterns are authored in plain ASCII. An attacker can evade a
 * naive matcher with visually-identical Unicode: NFD decompositions,
 * zero-width characters spliced inside keywords ("rm -r​f"), fullwidth Latin
 * ("ＡＫＩＡ"), or bidi-override reordering. Matching layers normalize inputs
 * through this helper before comparing.
 *
 * NOT for display or storage — only for the matching copy of a string.
 */

// Zero-width and joiner characters that render invisibly inside keywords:
// ZWSP, ZWNJ, ZWJ, word-joiner, and the BOM/zero-width-no-break-space.
const ZERO_WIDTH = /[​‌‍⁠﻿]/g;

// Bidirectional control characters that can visually reorder text:
// LRE/RLE/PDF/LRO/RLO and the isolate forms LRI/RLI/FSI/PDI.
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;

/**
 * Produce the canonical matching form of a string:
 * NFKC (folds fullwidth/compatibility forms and unifies NFC/NFD),
 * then strips zero-width and bidi-control characters.
 */
export function normalizeForMatching(input: string): string {
  return input.normalize('NFKC').replace(ZERO_WIDTH, '').replace(BIDI_CONTROLS, '');
}
