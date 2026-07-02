/**
 * embeddings.ts — Embedding provider abstraction with download-on-first-use ONNX.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { Logger } from '../observability/logger';
import { safeJsonParse } from '../utils/safe-json';
import { safeReadSync } from '../utils/safe-io';
import { createHash, randomBytes } from 'crypto';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { errorMessage } from '../utils/error-message';

const logger = new Logger({ module: 'embeddings' });

/** Maximum HTTP response body size for embedding API responses (10MB). */
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

/** Simple LRU cache for embeddings keyed by text hash. */
const embeddingCache = new Map<string, { embedding: number[]; timestamp: number }>();
const EMBEDDING_CACHE_MAX = 500;
const EMBEDDING_CACHE_TTL = 300_000; // 5 minutes

function getCachedEmbedding(text: string): number[] | undefined {
  const entry = embeddingCache.get(text);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > EMBEDDING_CACHE_TTL) {
    embeddingCache.delete(text);
    return undefined;
  }
  return entry.embedding;
}

function setCachedEmbedding(text: string, embedding: number[]): void {
  if (embeddingCache.size >= EMBEDDING_CACHE_MAX) {
    // Evict oldest entry
    const oldestKey = embeddingCache.keys().next().value as string;
    embeddingCache.delete(oldestKey);
  }
  embeddingCache.set(text, { embedding, timestamp: Date.now() });
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  readonly dimension: number;
  readonly name: string;
}

const ONNX_MODEL_DIR = path.resolve(__dirname, '../../models');
const ONNX_MODEL_FILE = 'all-MiniLM-L6-v2.onnx';
const ONNX_TOKENIZER_FILE = 'tokenizer.json';
const ONNX_MODEL_URL = 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx';
const ONNX_TOKENIZER_URL = 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json';

/**
 * SHA-256 checksums for download integrity verification (set to empty string to skip).
 * Pinned to sentence-transformers/all-MiniLM-L6-v2 @ main:
 *   onnx/model.onnx   (90,405,214 bytes)
 *   tokenizer.json       (466,247 bytes)
 * Recompute with `shasum -a 256 <file>` if the pinned ONNX_MODEL_URL/ONNX_TOKENIZER_URL change.
 */
const ONNX_MODEL_SHA256 = '6fd5d72fe4589f189f8ebc006442dbb529bb7ce38f8082112682524616046452';
const ONNX_TOKENIZER_SHA256 = 'be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037';

/** Hard cap on a single model/tokenizer download to prevent disk exhaustion (model is ~90 MB). */
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

export class NoopEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'noop';
  readonly dimension = 0;

  async embed(_text: string): Promise<number[]> {
    return [];
  }
}

export class OnnxEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'onnx-local';
  readonly dimension = 384;
  private session: { run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>> } | null = null;
  private tokenizer: { model?: { vocab?: Record<string, number> } } | null = null;

  async embed(text: string): Promise<number[]> {
    const cached = getCachedEmbedding(text);
    if (cached) return cached;
    await this.ensureLoaded();
    if (!this.session) {
      throw new Error('ONNX model not loaded');
    }
    const result = await this.runInference(text);
    setCachedEmbedding(text, result);
    return result;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.session) return;

    const modelPath = path.join(ONNX_MODEL_DIR, ONNX_MODEL_FILE);
    const tokenizerPath = path.join(ONNX_MODEL_DIR, ONNX_TOKENIZER_FILE);

    if (!fs.existsSync(modelPath)) {
      await this.downloadAndVerify(ONNX_MODEL_URL, modelPath, ONNX_MODEL_SHA256);
    }
    if (!fs.existsSync(tokenizerPath)) {
      await this.downloadAndVerify(ONNX_TOKENIZER_URL, tokenizerPath, ONNX_TOKENIZER_SHA256);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- onnxruntime-node is an optional peer dependency loaded dynamically
      const ort = require('onnxruntime-node') as { InferenceSession: { create(path: string): Promise<{ run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>> }> }; Tensor: new (type: string, data: BigInt64Array, shape: number[]) => unknown };
      this.session = await ort.InferenceSession.create(modelPath);
      const tokenizerData = safeJsonParse<{ model?: { vocab?: Record<string, number> } }>(safeReadSync(tokenizerPath).toString('utf-8'));
      this.tokenizer = tokenizerData;
    } catch (err) {
      this.session = null;
      throw new Error(`Failed to load ONNX model: ${err}`);
    }
  }

  private async runInference(text: string): Promise<number[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- onnxruntime-node is an optional peer dependency loaded dynamically
    const ort = require('onnxruntime-node') as { Tensor: new (type: string, data: BigInt64Array, shape: number[]) => unknown };
    const inputIds = this.tokenize(text);
    const attentionMask = new Array(inputIds.length).fill(1);
    const tokenTypeIds = new Array(inputIds.length).fill(0);

    const feeds: Record<string, unknown> = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]),
      attention_mask: new ort.Tensor('int64', BigInt64Array.from(attentionMask.map(BigInt)), [1, inputIds.length]),
      token_type_ids: new ort.Tensor('int64', BigInt64Array.from(tokenTypeIds.map(BigInt)), [1, inputIds.length]),
    };

    const results = await this.session!.run(feeds);
    const output = results['last_hidden_state'] || results[Object.keys(results)[0]];
    const data = Array.from(output.data as Float32Array);

    // Mean pooling over token dimension
    const seqLen = inputIds.length;
    const embedding = new Array(this.dimension).fill(0);
    for (let i = 0; i < seqLen; i++) {
      for (let j = 0; j < this.dimension; j++) {
        embedding[j] += data[i * this.dimension + j];
      }
    }
    for (let j = 0; j < this.dimension; j++) {
      embedding[j] /= seqLen;
    }

    // L2 normalize
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let j = 0; j < this.dimension; j++) {
        embedding[j] /= norm;
      }
    }
    return embedding;
  }

  private tokenize(text: string): number[] {
    // Simple whitespace tokenizer with vocab lookup fallback
    // Real tokenizer.json has a vocab — use it if available
    if (this.tokenizer?.model?.vocab) {
      const vocab = this.tokenizer.model.vocab as Record<string, number>;
      const tokens: number[] = [vocab['[CLS]'] ?? 101];
      const words = text.toLowerCase().split(/\s+/);
      for (const word of words) {
        const id = vocab[word] ?? vocab['[UNK]'] ?? 100;
        tokens.push(id);
      }
      tokens.push(vocab['[SEP]'] ?? 102);
      // Truncate to max 128 tokens
      return tokens.slice(0, 128);
    }
    // Fallback: CLS + hash-based IDs + SEP
    const tokens: number[] = [101];
    const words = text.toLowerCase().split(/\s+/);
    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash + word.charCodeAt(i)) & 0x7fff;
      }
      tokens.push(hash % 30000 + 1000);
    }
    tokens.push(102);
    return tokens.slice(0, 128);
  }

  /**
   * Download to a random temp name, verify the checksum, and only then
   * rename into place (WI-008) — destPath is never observable in a
   * partially-written or unverified state, so a crash or failed download
   * cannot leave a corrupt file that a later ensureLoaded() would trust.
   */
  private async downloadAndVerify(url: string, destPath: string, expectedHash: string): Promise<void> {
    const tmpPath = `${destPath}.download-${randomBytes(6).toString('hex')}`;
    try {
      await this.downloadFile(url, tmpPath);
      if (expectedHash) {
        await this.verifyChecksum(tmpPath, expectedHash);
      }
      fs.renameSync(tmpPath, destPath);
    } finally {
      fs.rmSync(tmpPath, { force: true });
    }
  }

  private async verifyChecksum(filePath: string, expectedHash: string): Promise<void> {
    const fileBuffer = fs.readFileSync(filePath);
    const actualHash = createHash('sha256').update(fileBuffer).digest('hex');
    if (actualHash !== expectedHash) {
      fs.unlinkSync(filePath);
      throw new Error(`Checksum mismatch for ${path.basename(filePath)}: expected ${expectedHash}, got ${actualHash}`);
    }
  }

  private async downloadFile(url: string, destPath: string): Promise<void> {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Resolve redirects and status first, then stream the body.
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const follow = (u: string, redirects: number) => {
        if (redirects > 5) {
          reject(new Error('Too many redirects'));
          return;
        }
        const client = u.startsWith('https') ? https : http;
        client.get(u, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume(); // drain the redirect body so the socket is freed
            let redirectUrl = res.headers.location;
            // Handle relative redirects
            if (redirectUrl.startsWith('/')) {
              const parsed = new URL(u);
              redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
            }
            follow(redirectUrl, redirects + 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          // Reject oversized downloads up front via Content-Length when present.
          const declared = Number(res.headers['content-length']);
          if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
            res.destroy();
            reject(new Error(`Download too large: ${declared} bytes exceeds ${MAX_DOWNLOAD_BYTES}`));
            return;
          }
          resolve(res);
        }).on('error', reject);
      };
      follow(url, 0);
    });

    // Enforce the cap as bytes stream in (Content-Length may be absent or lie).
    // As a Transform inside pipeline(), an over-cap error tears down BOTH the
    // response and the write stream — no orphaned streams, no settle race (WI-008).
    let received = 0;
    const capGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > MAX_DOWNLOAD_BYTES) {
          callback(new Error(`Download exceeded ${MAX_DOWNLOAD_BYTES} bytes; aborted`));
          return;
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(response, capGuard, fs.createWriteStream(destPath));
    } catch (err) {
      // pipeline() has already destroyed all three streams; remove the partial file.
      fs.rmSync(destPath, { force: true });
      throw err;
    }
  }
}

export type EmbeddingProviderChoice = 'auto' | 'onnx' | 'ollama' | 'openai' | 'voyage' | 'noop';

export async function detectEmbeddingProvider(
  preferred?: EmbeddingProviderChoice,
): Promise<EmbeddingProvider> {
  // If a specific provider is requested (not 'auto'), try only that one
  if (preferred && preferred !== 'auto') {
    switch (preferred) {
      case 'noop':
        return new NoopEmbeddingProvider();
      case 'onnx':
        try {
          require.resolve('onnxruntime-node');
          return new OnnxEmbeddingProvider();
        } catch (e) {
          logger.debug('ONNX runtime not available', { error: errorMessage(e) });
          throw new Error('ONNX provider requested but onnxruntime-node is not available');
        }
      case 'ollama': {
        const ollamaAvailable = await checkOllama();
        if (ollamaAvailable) {
          return new OllamaEmbeddingProvider();
        }
        throw new Error('Ollama provider requested but Ollama is not reachable at 127.0.0.1:11434');
      }
      case 'openai':
        if (process.env.OPENAI_API_KEY) {
          return new OpenAIEmbeddingProvider();
        }
        throw new Error('OpenAI provider requested but OPENAI_API_KEY is not set');
      case 'voyage':
        if (process.env.VOYAGE_API_KEY) {
          return new VoyageEmbeddingProvider();
        }
        throw new Error('Voyage provider requested but VOYAGE_API_KEY is not set');
      default:
        throw new Error(`Unknown embedding provider: ${preferred}`);
    }
  }

  // Auto-detect: ONNX -> Ollama -> OpenAI -> Voyage -> Noop
  // 1. Try ONNX local
  try {
    require.resolve('onnxruntime-node');
    const provider = new OnnxEmbeddingProvider();
    return provider;
  } catch (e) {
    logger.debug('ONNX runtime not available for auto-detection', { error: errorMessage(e) });
  }

  // 2. Try Ollama (if running locally)
  try {
    const ollamaAvailable = await checkOllama();
    if (ollamaAvailable) {
      return new OllamaEmbeddingProvider();
    }
  } catch (e) {
    logger.debug('Ollama not available for auto-detection', { error: errorMessage(e) });
  }

  // 3. Try OpenAI
  if (process.env.OPENAI_API_KEY) {
    return new OpenAIEmbeddingProvider();
  }

  // 4. Try Voyage AI
  if (process.env.VOYAGE_API_KEY) {
    return new VoyageEmbeddingProvider();
  }

  // 5. Fallback to noop
  return new NoopEmbeddingProvider();
}

async function checkOllama(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:11434/api/tags', (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly dimension = 384;

  async embed(text: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({ model: 'all-minilm', prompt: text });
      const req = http.request({
        hostname: '127.0.0.1',
        port: 11434,
        path: '/api/embeddings',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > MAX_RESPONSE_SIZE) { req.destroy(); reject(new Error('Embedding response too large')); }
        });
        res.on('end', () => {
          try {
            const result = safeJsonParse<Record<string, unknown>>(body);
            resolve((result.embedding as number[]) || []);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly dimension = 384;

  async embed(text: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 384,
      });
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/embeddings',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > MAX_RESPONSE_SIZE) { req.destroy(); reject(new Error('Embedding response too large')); }
        });
        res.on('end', () => {
          try {
            const result = safeJsonParse<Record<string, unknown>>(body);
            const dataArr = result.data as Array<Record<string, unknown>> | undefined;
            resolve((dataArr?.[0]?.embedding as number[]) || []);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'voyage';
  readonly dimension = 384;

  async embed(text: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        model: 'voyage-3-lite',
        input: [text],
        output_dimension: 384,
      });
      const req = https.request({
        hostname: 'api.voyageai.com',
        path: '/v1/embeddings',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
        },
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > MAX_RESPONSE_SIZE) { req.destroy(); reject(new Error('Embedding response too large')); }
        });
        res.on('end', () => {
          try {
            const result = safeJsonParse<Record<string, unknown>>(body);
            const dataArr = result.data as Array<Record<string, unknown>> | undefined;
            resolve((dataArr?.[0]?.embedding as number[]) || []);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }
}
