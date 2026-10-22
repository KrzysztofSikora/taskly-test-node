import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useDuplicateTodoMutation } from './useDuplicateTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { duplicate: vi.fn() } }))
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
    ...renderHook(() => useDuplicateTodoMutation(), { wrapper }),
  }
}

it('puts the copy at the top of the cached list', async () => {
  const copy = { ...todoFixture, id: 99, title: `${todoFixture.title} (copy)` }
  vi.mocked(todosApi.duplicate).mockResolvedValue(copy)
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [todoFixture])
  await act(() => result.current.mutateAsync(todoFixture.id))
  expect(todosApi.duplicate).toHaveBeenCalledWith(todoFixture.id)
  expect(client.getQueryData(todoKeys.list)).toEqual([copy, todoFixture])
})

it('creates the cached list when none exists yet', async () => {
  const copy = { ...todoFixture, id: 99 }
  vi.mocked(todosApi.duplicate).mockResolvedValue(copy)
  const { client, result } = setup()
  await act(() => result.current.mutateAsync(todoFixture.id))
  expect(client.getQueryData(todoKeys.list)).toEqual([copy])
})

it('keeps the cache when duplication fails', async () => {
  vi.mocked(todosApi.duplicate).mockRejectedValue(new Error('nope'))
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [todoFixture])
  await act(() =>
    result.current.mutateAsync(todoFixture.id).catch(() => undefined),
  )
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
