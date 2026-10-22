import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

const names = ['DATABASE_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'DB_PORT', 'POSTGRES_DB'];

describe('resolveDatabaseUrl', () => {
  beforeEach(() => {
    for (const name of names) vi.stubEnv(name, '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('prefers the override over the environment', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://env/db');
    expect(resolveDatabaseUrl('postgresql://override/db')).toBe('postgresql://override/db');
  });
  it('uses DATABASE_URL and strips the psycopg driver suffix', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql+psycopg://u:p@host:5432/db');
    expect(resolveDatabaseUrl()).toBe('postgresql://u:p@host:5432/db');
  });
  it('builds the url from the POSTGRES variables and encodes the database name', () => {
    vi.stubEnv('POSTGRES_USER', 'user');
    vi.stubEnv('POSTGRES_PASSWORD', 'secret');
    vi.stubEnv('POSTGRES_HOST', 'db.local');
    vi.stubEnv('DB_PORT', '5433');
    vi.stubEnv('POSTGRES_DB', 'my db');
    expect(resolveDatabaseUrl()).toBe('postgresql://user:secret@db.local:5433/my%20db');
  });
  it('names the first missing variable', () => {
    vi.stubEnv('POSTGRES_USER', 'user');
    expect(() => resolveDatabaseUrl()).toThrow('Missing environment variable: POSTGRES_PASSWORD');
  });
});
