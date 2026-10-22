import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import { todo } from './fixture.ts';

function setup() {
  const repository = { list: vi.fn().mockResolvedValue([todo]), create: vi.fn().mockResolvedValue(todo), get: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteCompleted: vi.fn(), duplicate: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}
it('lists tasks from the repository', async () => {
  const { app, repository } = setup();
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
  expect(repository.list).toHaveBeenCalledOnce();
});
it('creates tasks with trimmed input and defaults', async () => {
  const { app, repository } = setup();
  const response = await request(app).post('/api/todos').send({ title: '  Plan the sprint  ', priority: 'high' });
  expect(response.status).toBe(201);
  expect(response.body).toEqual(todo);
  expect(repository.create).toHaveBeenCalledWith({ title: 'Plan the sprint', description: '', priority: 'high', due_date: null, completed: false });
});
it('returns a task by id', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(todo);
  const response = await request(app).get('/api/todos/1');
  expect(response.status).toBe(200);
  expect(response.body).toEqual(todo);
  expect(repository.get).toHaveBeenCalledWith(1);
});
it('returns 404 when the task does not exist', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(null);
  repository.update.mockResolvedValue(null);
  repository.delete.mockResolvedValue(false);
  for (const response of [
    await request(app).get('/api/todos/9'),
    await request(app).patch('/api/todos/9').send({ completed: true }),
    await request(app).delete('/api/todos/9'),
  ]) {
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: 'Task not found.' });
  }
});
it.each(['abc', '0', '-1', '1.5'])('rejects invalid id %s without calling the repository', async (id) => {
  const { app, repository } = setup();
  expect((await request(app).get(`/api/todos/${id}`)).status).toBe(422);
  expect((await request(app).delete(`/api/todos/${id}`)).status).toBe(422);
  expect(repository.get).not.toHaveBeenCalled();
  expect(repository.delete).not.toHaveBeenCalled();
});
it('updates a task with a partial payload', async () => {
  const { app, repository } = setup();
  repository.update.mockResolvedValue(todo);
  const response = await request(app).patch('/api/todos/1').send({ completed: true });
  expect(response.status).toBe(200);
  expect(response.body).toEqual(todo);
  expect(repository.update).toHaveBeenCalledWith(1, { completed: true });
});
it.each([{}, { title: '' }, { unknown: 1 }])('rejects invalid update input: %j', async (payload) => {
  const { app, repository } = setup();
  expect((await request(app).patch('/api/todos/1').send(payload)).status).toBe(422);
  expect(repository.update).not.toHaveBeenCalled();
});
it('deletes a task and responds with 204', async () => {
  const { app, repository } = setup();
  repository.delete.mockResolvedValue(true);
  const response = await request(app).delete('/api/todos/1');
  expect(response.status).toBe(204);
  expect(repository.delete).toHaveBeenCalledWith(1);
});
it('duplicates a task and responds with 201', async () => {
  const { app, repository } = setup();
  const copy = { ...todo, id: 2, title: 'Plan the sprint (copy)' };
  repository.duplicate.mockResolvedValue(copy);
  const response = await request(app).post('/api/todos/1/duplicate');
  expect(response.status).toBe(201);
  expect(response.body).toEqual(copy);
  expect(repository.duplicate).toHaveBeenCalledWith(1);
});
it('returns 404 when duplicating a missing task', async () => {
  const { app, repository } = setup();
  repository.duplicate.mockResolvedValue(null);
  const response = await request(app).post('/api/todos/9/duplicate');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
});
it('rejects an invalid id when duplicating without calling the repository', async () => {
  const { app, repository } = setup();
  expect((await request(app).post('/api/todos/abc/duplicate')).status).toBe(422);
  expect(repository.duplicate).not.toHaveBeenCalled();
});
it('clears completed tasks and reports the deleted count', async () => {
  const { app, repository } = setup();
  repository.deleteCompleted.mockResolvedValue(2);
  const response = await request(app).delete('/api/todos/completed');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ deleted: 2 });
  expect(repository.deleteCompleted).toHaveBeenCalledOnce();
  expect(repository.delete).not.toHaveBeenCalled();
});
it.each([{ title: '  ' },{ title: 'x'.repeat(121) }, { title: 'Task', priority: 'urgent' }, { title: 'Task', due_date: '2026-02-30' }])(
  'rejects invalid create input without calling the repository: %j', async (payload) => {
    const { app, repository } = setup();
    expect((await request(app).post('/api/todos').send(payload)).status).toBe(422);
    expect(repository.create).not.toHaveBeenCalled();
  },
);
