import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it } from 'vitest'
import { todoKeys } from '../api/queryKeys'
import { useTodosBusy } from './useTodosBusy'

function setup() {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(() => useTodosBusy(), { wrapper }) }
}

it('is idle without pending mutations', () => {
  expect(setup().result.current).toBe(false)
})

it('is busy while a todo mutation is pending and idle afterwards', async () => {
  const { client, result } = setup()
  let release: () => void = () => undefined
  const pending = client
    .getMutationCache()
    .build(client, {
      mutationKey: todoKeys.update,
      mutationFn: () => new Promise<void>((resolve) => (release = resolve)),
    })
    .execute(undefined)
  await waitFor(() => expect(result.current).toBe(true))
  release()
  await pending
  await waitFor(() => expect(result.current).toBe(false))
})
