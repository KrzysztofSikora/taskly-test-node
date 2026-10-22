import { beforeEach, expect, it, vi } from 'vitest'
import { request } from '../../../lib/http'
import { todoFixture } from '../../../test/todoFixture'
import { todosApi } from './todos'

vi.mock('../../../lib/http', () => ({ request: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

it('passes the abort signal when fetching tasks', async () => {
  const signal = new AbortController().signal
  vi.mocked(request).mockResolvedValue([todoFixture])
  await expect(todosApi.list(signal)).resolves.toEqual([todoFixture])
  expect(request).toHaveBeenCalledWith('/todos', { signal })
})

it('patches a task with the given fields only', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await todosApi.update(5, { completed: true })
  expect(request).toHaveBeenCalledWith('/todos/5', {
    method: 'PATCH',
    body: JSON.stringify({ completed: true }),
  })
})

it('deletes a task by id', async () => {
  vi.mocked(request).mockResolvedValue(undefined)
  await todosApi.remove(5)
  expect(request).toHaveBeenCalledWith('/todos/5', { method: 'DELETE' })
})

it('duplicates a task by id and returns the copy', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await expect(todosApi.duplicate(5)).resolves.toEqual(todoFixture)
  expect(request).toHaveBeenCalledWith('/todos/5/duplicate', {
    method: 'POST',
  })
})

it('clears completed tasks and returns the deleted count', async () => {
  vi.mocked(request).mockResolvedValue({ deleted: 2 })
  await expect(todosApi.clearCompleted()).resolves.toEqual({ deleted: 2 })
  expect(request).toHaveBeenCalledWith('/todos/completed', { method: 'DELETE' })
})

it('sends only writable task fields on creation', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await expect(todosApi.create(todoFixture)).resolves.toEqual(todoFixture)
  expect(request).toHaveBeenCalledWith('/todos', {
    method: 'POST',
    body: JSON.stringify({
      title: todoFixture.title,
      description: '',
      priority: 'medium',
      due_date: null,
      completed: false,
    }),
  })
})
