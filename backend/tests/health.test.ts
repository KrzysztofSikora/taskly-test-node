import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createHealthRouter } from '../src/api/health.ts';

it('reports ok after querying the database', async () => {
  const findFirst = vi.fn().mockResolvedValue(null);
  const app = express();
  app.use('/api', createHealthRouter({ todo: { findFirst } } as never));
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
});
