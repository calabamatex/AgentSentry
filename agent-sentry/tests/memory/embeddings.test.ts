import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  NoopEmbeddingProvider,
  OpenAIEmbeddingProvider,
  VoyageEmbeddingProvider,
} from '../../src/memory/embeddings';

// Mock https module for VoyageEmbeddingProvider.embed() tests
vi.mock('https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('https')>();
  return {
    ...actual,
    request: vi.fn(actual.request),
  };
});

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

  describe('detectEmbeddingProvider() config-driven selection', () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      savedEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = savedEnv;
    });

    it('returns NoopEmbeddingProvider when preferred is "noop"', async () => {
      const { detectEmbeddingProvider } = await import('../../src/memory/embeddings');
      const provider = await detectEmbeddingProvider('noop');
      expect(provider).toBeInstanceOf(NoopEmbeddingProvider);
      expect(provider.name).toBe('noop');
    });

    it('returns OpenAIEmbeddingProvider when preferred is "openai" and key is set', async () => {
      process.env.OPENAI_API_KEY = 'test-key-123';
      const { detectEmbeddingProvider } = await import('../../src/memory/embeddings');
      const provider = await detectEmbeddingProvider('openai');
      expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
      expect(provider.name).toBe('openai');
    });

    it('throws when preferred is "openai" but OPENAI_API_KEY is not set', async () => {
      delete process.env.OPENAI_API_KEY;
      const { detectEmbeddingProvider } = await import('../../src/memory/embeddings');
      await expect(detectEmbeddingProvider('openai')).rejects.toThrow(
        'OpenAI provider requested but OPENAI_API_KEY is not set',
      );
    });

    it('returns VoyageEmbeddingProvider when preferred is "voyage" and key is set', async () => {
      process.env.VOYAGE_API_KEY = 'test-voyage-key';
      const { detectEmbeddingProvider } = await import('../../src/memory/embeddings');
      const provider = await detectEmbeddingProvider('voyage');
      expect(provider).toBeInstanceOf(VoyageEmbeddingProvider);
      expect(provider.name).toBe('voyage');
      expect(provider.dimension).toBe(384);
    });

    it('throws when preferred is "voyage" but VOYAGE_API_KEY is not set', async () => {
      delete process.env.VOYAGE_API_KEY;
      const { detectEmbeddingProvider } = await import('../../src/memory/embeddings');
      await expect(detectEmbeddingProvider('voyage')).rejects.toThrow(
        'Voyage provider requested but VOYAGE_API_KEY is not set',
      );
    });

    it('uses fallback chain when preferred is "auto"', async () => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.VOYAGE_API_KEY;
      const { detectEmbeddingProvider } = await import('../../src/memory/embeddings');
      const provider = await detectEmbeddingProvider('auto');
      expect(provider).toBeDefined();
      expect(typeof provider.embed).toBe('function');
    });

    it('uses fallback chain when preferred is undefined', async () => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.VOYAGE_API_KEY;
      const { detectEmbeddingProvider } = await import('../../src/memory/embeddings');
      const provider = await detectEmbeddingProvider(undefined);
      expect(provider).toBeDefined();
      expect(typeof provider.embed).toBe('function');
    });
  });

  describe('VoyageEmbeddingProvider', () => {
    it('has correct name and dimension', () => {
      const provider = new VoyageEmbeddingProvider();
      expect(provider.name).toBe('voyage');
      expect(provider.dimension).toBe(384);
    });

    it('embed() calls Voyage AI API with correct payload', async () => {
      const https = await import('https');
      const mockEmbedding = Array.from({ length: 384 }, (_, i) => i * 0.001);

      const mockResponse = {
        on: vi.fn((event: string, cb: (chunk?: string) => void) => {
          if (event === 'data') {
            cb(JSON.stringify({ data: [{ embedding: mockEmbedding }] }));
          }
          if (event === 'end') {
            cb();
          }
          return mockResponse;
        }),
      };

      const mockReq = {
        on: vi.fn().mockReturnThis(),
        write: vi.fn(),
        end: vi.fn(),
      };

      vi.mocked(https.request).mockImplementation(
        (_opts: any, cb: any) => {
          cb(mockResponse);
          return mockReq as any;
        },
      );

      process.env.VOYAGE_API_KEY = 'test-voyage-key';
      const provider = new VoyageEmbeddingProvider();
      const result = await provider.embed('test text');

      expect(result).toEqual(mockEmbedding);
      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'api.voyageai.com',
          path: '/v1/embeddings',
          method: 'POST',
        }),
        expect.any(Function),
      );

      // Verify request body contains correct model and input
      const writeCall = mockReq.write.mock.calls[0][0];
      const body = JSON.parse(writeCall);
      expect(body.model).toBe('voyage-3-lite');
      expect(body.input).toEqual(['test text']);
      expect(body.output_dimension).toBe(384);

      vi.mocked(https.request).mockRestore();
    });
  });
});
