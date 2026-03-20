import { describe, it, expect } from 'vitest';
import { NoopEmbeddingProvider } from '../../src/memory/embeddings';

describe('EmbeddingProvider', () => {
  describe('NoopEmbeddingProvider', () => {
    it('returns empty array for any input', async () => {
      const provider = new NoopEmbeddingProvider();
      const result = await provider.embed('hello world');
      expect(result).toEqual([]);
    });

    it('has dimension 0', () => {
      const provider = new NoopEmbeddingProvider();
      expect(provider.dimension).toBe(0);
    });

    it('has name "noop"', () => {
      const provider = new NoopEmbeddingProvider();
      expect(provider.name).toBe('noop');
    });
  });

  describe('detectEmbeddingProvider()', () => {
    it('returns a provider (at least noop)', async () => {
      // Dynamic import to avoid onnxruntime-node resolution errors in test
      const { detectEmbeddingProvider } = await import('../../src/memory/embeddings');
      const provider = await detectEmbeddingProvider();
      expect(provider).toBeDefined();
      expect(provider.name).toBeTruthy();
      expect(typeof provider.embed).toBe('function');
    });
  });
});
