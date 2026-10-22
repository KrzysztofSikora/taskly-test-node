import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/factory.ts';

function setup(findFirst = vi.fn().mockResolvedValue(null)) {
  const database = { todo: { findFirst, findMany: vi.fn().mockRejectedValue(new Error('boom')) } };
  return createApp(database as never);
}

describe('createApp', () => {
  afterEach(() => vi.restoreAllMocks());

  it('serves the health check without the x-powered-by header', async () => {
    const response = await request(setup()).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
  it('serves the OpenAPI specification', async () => {
    const response = await request(setup()).get('/openapi.json');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('openapi');
  });
  it('responds with a JSON 404 for unknown routes', async () => {
    const response = await request(setup()).get('/nope');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: 'Not Found' });
  });
  it('responds with 422 for malformed JSON bodies', async () => {
    const response = await request(setup()).post('/api/todos').set('Content-Type', 'application/json').send('{bad');
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ detail: 'Invalid JSON.' });
  });
  it('responds with 413 for oversized bodies', async () => {
    const response = await request(setup()).post('/api/todos').send({ title: 'x'.repeat(200_000) });
    expect(response.status).toBe(413);
    expect(response.body).toEqual({ detail: 'Request body too large.' });
  });
  it('hides unexpected errors behind a 500 response', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await request(setup(vi.fn().mockRejectedValue(new Error('db down')))).get('/api/health');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ detail: 'Internal Server Error' });
    expect(spy).toHaveBeenCalled();
  });
});
