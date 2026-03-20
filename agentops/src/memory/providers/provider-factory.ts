/**
 * provider-factory.ts — Auto-detect or config-driven provider selection.
 */

import * as fs from 'fs';
import * as path from 'path';
import { StorageProvider } from './storage-provider';
import { SqliteProvider } from './sqlite-provider';
export interface MemoryConfig {
  enabled: boolean;
  provider: 'sqlite' | 'supabase';
  embedding_provider: 'auto' | 'onnx' | 'ollama' | 'openai' | 'noop';
  database_path: string;
  max_events: number;
  auto_prune_days: number;
}

const DEFAULT_CONFIG: MemoryConfig = {
  enabled: true,
  provider: 'sqlite',
  embedding_provider: 'auto',
  database_path: 'agentops/data/ops.db',
  max_events: 100000,
  auto_prune_days: 365,
};

export function loadMemoryConfig(configPath?: string): MemoryConfig {
  const cfgPath = configPath ?? path.resolve('agentops/agentops.config.json');
  try {
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (raw.memory) {
      return { ...DEFAULT_CONFIG, ...raw.memory };
    }
  } catch {
    // Config file not found or invalid — use defaults
  }
  return { ...DEFAULT_CONFIG };
}

export function createProvider(config?: MemoryConfig): StorageProvider {
  const cfg = config ?? loadMemoryConfig();

  if (cfg.provider === 'supabase') {
    throw new Error(
      'Supabase provider is not yet implemented. ' +
      'Set "provider": "sqlite" in agentops.config.json, or remove SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY environment variables. ' +
      'See https://github.com/ruvnet/claude-flow for roadmap.'
    );
  }

  if (cfg.provider === 'sqlite') {
    return new SqliteProvider(cfg.database_path);
  }

  // Auto-detect: if Supabase env vars are present, warn but use SQLite
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Supabase env vars present but provider not implemented — fall through to SQLite
  }

  return new SqliteProvider(cfg.database_path);
}
