import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useClearCompletedMutation } from './useClearCompletedMutation'

vi.mock('../api/todos', () => ({ todosApi: { clearCompleted: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return {
    client,
    ...renderHook(() => useClearCompletedMutation(), { wrapper }),
  }
}

it('removes completed tasks from the cached list and returns the count', async () => {
  const active = { ...todoFixture, id: 1, completed: false }
  const done = { ...todoFixture, id: 2, completed: true }
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 1 })
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [active, done])
  await expect(act(() => result.current.mutateAsync())).resolves.toEqual({
    deleted: 1,
  })
  expect(client.getQueryData(todoKeys.list)).toEqual([active])
})

it('leaves an empty cache untouched', async () => {
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 0 })
  const { client, result } = setup()
  await act(() => result.current.mutateAsync())
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})

it('keeps the cache when clearing fails', async () => {
  vi.mocked(todosApi.clearCompleted).mockRejectedValue(new Error('nope'))
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [{ ...todoFixture, completed: true }])
  await act(() => result.current.mutateAsync().catch(() => undefined))
  expect(client.getQueryData(todoKeys.list)).toEqual([
    { ...todoFixture, completed: true },
  ])
})
