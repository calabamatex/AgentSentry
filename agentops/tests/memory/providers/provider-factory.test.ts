import { describe, it, expect } from 'vitest';
import { createProvider, loadMemoryConfig } from '../../../src/memory/providers/provider-factory';
import { SqliteProvider } from '../../../src/memory/providers/sqlite-provider';

describe('ProviderFactory', () => {
  describe('loadMemoryConfig()', () => {
    it('returns defaults when config file is missing', () => {
      const config = loadMemoryConfig('/nonexistent/path.json');
      expect(config.enabled).toBe(true);
      expect(config.provider).toBe('sqlite');
      expect(config.embedding_provider).toBe('auto');
    });
  });

  describe('createProvider()', () => {
    it('creates SqliteProvider by default', () => {
      const provider = createProvider({
        enabled: true,
        provider: 'sqlite',
        embedding_provider: 'auto',
        database_path: ':memory:',
        max_events: 100000,
        auto_prune_days: 365,
      });
      expect(provider).toBeInstanceOf(SqliteProvider);
      expect(provider.name).toBe('sqlite');
    });

    it('throws when Supabase provider is configured', () => {
      expect(() =>
        createProvider({
          enabled: true,
          provider: 'supabase',
          embedding_provider: 'auto',
          database_path: '',
          max_events: 100000,
          auto_prune_days: 365,
        })
      ).toThrow('Supabase provider is not yet implemented');
    });
  });
});
