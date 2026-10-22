import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useCreateTodoMutation } from './useCreateTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { create: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(() => useCreateTodoMutation(), { wrapper }) }
}

const input = {
  title: todoFixture.title,
  description: '',
  priority: 'medium' as const,
  due_date: null,
  completed: false,
}

it('puts the saved task first in the cached list', async () => {
  const older = { ...todoFixture, id: 1 }
  const saved = { ...todoFixture, id: 2 }
  vi.mocked(todosApi.create).mockResolvedValue(saved)
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [older])
  await act(() => result.current.mutateAsync(input))
  expect(todosApi.create).toHaveBeenCalledWith(input)
  expect(client.getQueryData(todoKeys.list)).toEqual([saved, older])
})

it('replaces a cached task with the same id instead of duplicating it', async () => {
  const stale = { ...todoFixture, title: 'Stale' }
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [stale])
  await act(() => result.current.mutateAsync(input))
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

it('starts a list from an empty cache', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { client, result } = setup()
  await act(() => result.current.mutateAsync(input))
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

it('leaves the cache untouched when creation fails', async () => {
  vi.mocked(todosApi.create).mockRejectedValue(new Error('nope'))
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [todoFixture])
  await act(() => result.current.mutateAsync(input).catch(() => undefined))
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
