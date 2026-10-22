import { expect, it, vi } from 'vitest';
import { createDatabase, initialize } from '../src/core/database.ts';

it('creates a Prisma client without connecting', () => {
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  expect(typeof database.$connect).toBe('function');
  expect(database.todo).toBeDefined();
});

it('initializes the todos table with an idempotent statement', async () => {
  const $executeRaw = vi.fn().mockResolvedValue(0);
  await expect(initialize({ $executeRaw } as never)).resolves.toBeUndefined();
  expect($executeRaw).toHaveBeenCalledOnce();
  const sql = $executeRaw.mock.calls[0][0].join('');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS todos');
  expect(sql).toContain("priority IN ('low', 'medium', 'high')");
});

it('propagates initialization failures', async () => {
  const $executeRaw = vi.fn().mockRejectedValue(new Error('no db'));
  await expect(initialize({ $executeRaw } as never)).rejects.toThrow('no db');
});
