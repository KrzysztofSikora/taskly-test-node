import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { update: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(() => useUpdateTodoMutation(), { wrapper }) }
}

it('replaces only the updated task in the cached list', async () => {
  const other = { ...todoFixture, id: 1 }
  const saved = { ...todoFixture, completed: true }
  vi.mocked(todosApi.update).mockResolvedValue(saved)
  const { client, result } = setup()
  client.setQueryData(todoKeys.list, [other, todoFixture])
  await act(() =>
    result.current.mutateAsync({
      id: todoFixture.id,
      input: { completed: true },
    }),
  )
  expect(todosApi.update).toHaveBeenCalledWith(todoFixture.id, {
    completed: true,
  })
  expect(client.getQueryData(todoKeys.list)).toEqual([other, saved])
})

it('does not create a list when nothing is cached', async () => {
  vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
  const { client, result } = setup()
  await act(() =>
    result.current.mutateAsync({ id: todoFixture.id, input: { title: 'A' } }),
  )
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})
