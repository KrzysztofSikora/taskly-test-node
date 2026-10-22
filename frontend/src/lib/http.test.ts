import { afterEach, expect, it, vi } from 'vitest'
import { request } from './http'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => vi.resetAllMocks())

function respond(status: number, body?: unknown) {
  fetchMock.mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), { status }),
  )
}

it('prefixes the path with /api and sends JSON headers', async () => {
  respond(200, [1])
  await expect(
    request('/todos', { headers: { 'X-Test': '1' } }),
  ).resolves.toEqual([1])
  expect(fetchMock).toHaveBeenCalledWith('/api/todos', {
    headers: { 'Content-Type': 'application/json', 'X-Test': '1' },
  })
})

it('resolves to undefined for 204 responses', async () => {
  respond(204)
  await expect(
    request('/todos/1', { method: 'DELETE' }),
  ).resolves.toBeUndefined()
})

it('reports a validation hint for 422 responses', async () => {
  respond(422, { detail: [] })
  await expect(request('/todos')).rejects.toThrow(/Check the task details/)
})

it('uses the string detail of an error response', async () => {
  respond(404, { detail: 'Task not found.' })
  await expect(request('/todos/1')).rejects.toThrow('Task not found.')
})

it('falls back to a generic message when the error body is not usable', async () => {
  fetchMock.mockResolvedValue(new Response('<html>', { status: 500 }))
  await expect(request('/todos')).rejects.toThrow(
    'The operation failed. Please try again.',
  )
})

it('reports a connection problem when fetch fails', async () => {
  fetchMock.mockRejectedValue(new TypeError('network'))
  await expect(request('/todos')).rejects.toThrow(
    'Cannot connect to the server. Please try again.',
  )
})

it('rethrows the original error when the request was aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  const abortError = new DOMException('Aborted', 'AbortError')
  fetchMock.mockRejectedValue(abortError)
  await expect(request('/todos', { signal: controller.signal })).rejects.toBe(
    abortError,
  )
})
