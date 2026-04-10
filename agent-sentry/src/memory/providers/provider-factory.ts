/**
 * provider-factory.ts — Auto-detect or config-driven provider selection.
 */

import { StorageProvider } from './storage-provider';
import { SqliteProvider } from './sqlite-provider';
import { SupabaseProvider } from './supabase-provider';
import { resolveConfigPath, resolveDatabasePath } from '../../config/resolve';
import { Logger } from '../../observability/logger';
import { safeJsonParse } from '../../utils/safe-json';
import { safeReadSync } from '../../utils/safe-io';

const logger = new Logger({ module: 'provider-factory' });
export interface MemoryConfig {
  enabled: boolean;
  provider: 'sqlite' | 'supabase';
  embedding_provider: 'auto' | 'onnx' | 'ollama' | 'openai' | 'voyage' | 'noop';
  database_path: string;
  max_events: number;
  auto_prune_days: number;
  /** Supabase project URL (overrides SUPABASE_URL env var). */
  supabase_url?: string;
  /** Supabase service role key (overrides SUPABASE_SERVICE_ROLE_KEY env var). */
  supabase_service_role_key?: string;
}

const DEFAULT_CONFIG: MemoryConfig = {
  enabled: true,
  provider: 'sqlite',
  embedding_provider: 'auto',
  database_path: 'agent-sentry/data/ops.db',
  max_events: 100000,
  auto_prune_days: 365,
};

export function loadMemoryConfig(configPath?: string): MemoryConfig {
  const cfgPath = configPath ?? resolveConfigPath();
  if (!cfgPath) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = safeJsonParse<Record<string, unknown>>(safeReadSync(cfgPath).toString('utf-8'));
    if (raw.memory) {
      return { ...DEFAULT_CONFIG, ...raw.memory };
    }
  } catch (e) {
    logger.debug('Config file not found or invalid, using defaults', { error: e instanceof Error ? e.message : String(e) });
  }
  return { ...DEFAULT_CONFIG };
}

export function createProvider(config?: MemoryConfig): StorageProvider {
  const cfg = config ?? loadMemoryConfig();
  const configFilePath = resolveConfigPath();
  const resolvedDbPath = resolveDatabasePath(cfg.database_path, configFilePath);

  if (cfg.provider === 'supabase') {
    return new SupabaseProvider({
      url: cfg.supabase_url,
      serviceRoleKey: cfg.supabase_service_role_key,
    });
  }

  if (cfg.provider === 'sqlite') {
    return new SqliteProvider(resolvedDbPath);
  }

  // Auto-detect: if Supabase env vars are present, warn but use SQLite
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Supabase env vars present but provider not implemented — fall through to SQLite
  }

  return new SqliteProvider(resolvedDbPath);
}
