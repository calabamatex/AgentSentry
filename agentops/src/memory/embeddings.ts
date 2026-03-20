/**
 * embeddings.ts — Embedding provider abstraction with download-on-first-use ONNX.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

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
  private session: any = null;
  private tokenizer: any = null;

  async embed(text: string): Promise<number[]> {
    await this.ensureLoaded();
    if (!this.session) {
      throw new Error('ONNX model not loaded');
    }
    return this.runInference(text);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.session) return;

    const modelPath = path.join(ONNX_MODEL_DIR, ONNX_MODEL_FILE);
    const tokenizerPath = path.join(ONNX_MODEL_DIR, ONNX_TOKENIZER_FILE);

    if (!fs.existsSync(modelPath)) {
      await this.downloadModel(modelPath);
    }
    if (!fs.existsSync(tokenizerPath)) {
      await this.downloadFile(ONNX_TOKENIZER_URL, tokenizerPath);
    }

    try {
      const ort = require('onnxruntime-node');
      this.session = await ort.InferenceSession.create(modelPath);
      const tokenizerData = JSON.parse(fs.readFileSync(tokenizerPath, 'utf8'));
      this.tokenizer = tokenizerData;
    } catch (err) {
      this.session = null;
      throw new Error(`Failed to load ONNX model: ${err}`);
    }
  }

  private async runInference(text: string): Promise<number[]> {
    const ort = require('onnxruntime-node');
    const inputIds = this.tokenize(text);
    const attentionMask = new Array(inputIds.length).fill(1);
    const tokenTypeIds = new Array(inputIds.length).fill(0);

    const feeds: Record<string, any> = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]),
      attention_mask: new ort.Tensor('int64', BigInt64Array.from(attentionMask.map(BigInt)), [1, inputIds.length]),
      token_type_ids: new ort.Tensor('int64', BigInt64Array.from(tokenTypeIds.map(BigInt)), [1, inputIds.length]),
    };

    const results = await this.session.run(feeds);
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

  private async downloadModel(destPath: string): Promise<void> {
    await this.downloadFile(ONNX_MODEL_URL, destPath);
  }

  private async downloadFile(url: string, destPath: string): Promise<void> {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const follow = (url: string, redirects: number) => {
        if (redirects > 5) {
          reject(new Error('Too many redirects'));
          return;
        }
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            follow(res.headers.location, redirects + 1);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          const file = fs.createWriteStream(destPath);
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
          file.on('error', (err) => { fs.unlinkSync(destPath); reject(err); });
        }).on('error', reject);
      };
      follow(url, 0);
    });
  }
}

export async function detectEmbeddingProvider(): Promise<EmbeddingProvider> {
  // 1. Try ONNX local
  try {
    require.resolve('onnxruntime-node');
    const provider = new OnnxEmbeddingProvider();
    return provider;
  } catch {
    // onnxruntime-node not available
  }

  // 2. Try Ollama (if running locally)
  try {
    const ollamaAvailable = await checkOllama();
    if (ollamaAvailable) {
      return new OllamaEmbeddingProvider();
    }
  } catch {
    // Ollama not available
  }

  // 3. Try OpenAI
  if (process.env.OPENAI_API_KEY) {
    return new OpenAIEmbeddingProvider();
  }

  // 4. Fallback to noop
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
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(body);
            resolve(result.embedding || []);
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
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(body);
            resolve(result.data?.[0]?.embedding || []);
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
