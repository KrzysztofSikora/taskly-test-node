import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { useNotice } from '../../hooks/useNotice'
import { todoFixture } from '../../test/todoFixture'
import type { Todo } from './types'
import { useClearCompletedMutation } from './hooks/useClearCompletedMutation'
import { useDuplicateTodoMutation } from './hooks/useDuplicateTodoMutation'
import { useTodoFilters } from './hooks/useTodoFilters'
import { useTodosBusy } from './hooks/useTodosBusy'
import { useTodosQuery } from './hooks/useTodosQuery'
import { useUpdateTodoMutation } from './hooks/useUpdateTodoMutation'
import { TodosPage } from './TodosPage'

vi.mock('../../design-system', () => import('../../design-system/mocks'))
vi.mock('../../hooks/useNotice', () => ({ useNotice: vi.fn() }))
vi.mock('./hooks/useTodoFilters', () => ({ useTodoFilters: vi.fn() }))
vi.mock('./hooks/useTodosBusy', () => ({ useTodosBusy: vi.fn() }))
vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))
vi.mock('./hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./hooks/useClearCompletedMutation', () => ({
  useClearCompletedMutation: vi.fn(),
}))
vi.mock('./hooks/useDuplicateTodoMutation', () => ({
  useDuplicateTodoMutation: vi.fn(),
}))
vi.mock('./components/TodosHeader', () => ({
  TodosHeader: ({
    disabled,
    completedCount,
    onCreate,
    onClearCompleted,
  }: {
    disabled: boolean
    completedCount: number
    onCreate: () => void
    onClearCompleted: () => void
  }) => (
    <>
      <h1>Tasks</h1>
      <p data-testid="completed-count">{completedCount}</p>
      <button disabled={disabled} onClick={onClearCompleted}>
        Header clear
      </button>
      <button disabled={disabled} onClick={onCreate}>
        Header create
      </button>
    </>
  ),
}))
vi.mock('./components/TodoFilters', () => ({ TodoFilters: () => null }))
vi.mock('./components/TodoList', () => ({
  TodoList: ({
    todos,
    onToggle,
    onEdit,
    onDuplicate,
    onDelete,
  }: {
    todos: Todo[]
    onToggle: (todo: Todo) => void
    onEdit: (todo: Todo) => void
    onDuplicate: (todo: Todo) => void
    onDelete: (todo: Todo) => void
  }) => (
    <>
      <p>Task list</p>
      {todos.map((todo) => (
        <div key={todo.id}>
          <button onClick={() => onToggle(todo)}>Toggle {todo.id}</button>
          <button onClick={() => onEdit(todo)}>Edit {todo.id}</button>
          <button onClick={() => onDuplicate(todo)}>Duplicate {todo.id}</button>
          <button onClick={() => onDelete(todo)}>Delete {todo.id}</button>
        </div>
      ))}
    </>
  ),
}))
vi.mock('./components/TodoEditor', () => ({
  TodoEditor: ({
    todo,
    onClose,
    onSaved,
  }: {
    todo: Todo | 'new'
    onClose: () => void
    onSaved: (notice: string) => void
  }) => (
    <div role="dialog" aria-label="Editor">
      <p>{todo === 'new' ? 'creating' : `editing ${todo.id}`}</p>
      <button onClick={onClose}>Close editor</button>
      <button onClick={() => onSaved('Saved!')}>Save editor</button>
    </div>
  ),
}))
vi.mock('./components/DeleteTodoDialog', () => ({
  DeleteTodoDialog: ({
    todo,
    onClose,
    onDeleted,
  }: {
    todo: Todo
    onClose: () => void
    onDeleted: () => void
  }) => (
    <div role="dialog" aria-label="Deleting">
      <p>deleting {todo.id}</p>
      <button onClick={onClose}>Close delete</button>
      <button onClick={onDeleted}>Confirm delete</button>
    </div>
  ),
}))
vi.mock('../../components/SuccessNotice', () => ({
  SuccessNotice: ({ message }: { message: string }) => (
    <p data-testid="notice">{message}</p>
  ),
}))

function setup({
  todos = [todoFixture],
  busy = false,
  isPending = false,
  queryError = null,
  mutationError = null,
  mutateAsync = vi.fn(),
  clearMutateAsync = vi.fn(),
  clearError = null,
  clearReset = vi.fn(),
  duplicateMutateAsync = vi.fn(),
  duplicateError = null,
  duplicateReset = vi.fn(),
}: {
  duplicateMutateAsync?: ReturnType<typeof vi.fn>
  duplicateError?: Error | null
  duplicateReset?: ReturnType<typeof vi.fn>
  clearMutateAsync?: ReturnType<typeof vi.fn>
  clearError?: Error | null
  clearReset?: ReturnType<typeof vi.fn>
  todos?: Todo[]
  busy?: boolean
  isPending?: boolean
  queryError?: Error | null
  mutationError?: Error | null
  mutateAsync?: ReturnType<typeof vi.fn>
} = {}) {
  const notify = vi.fn()
  const refetch = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useTodosQuery).mockReturnValue({
    data: todos,
    isPending,
    isFetching: false,
    isError: !!queryError,
    error: queryError,
    refetch,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: mutationError,
    reset: vi.fn(),
    mutateAsync,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useClearCompletedMutation).mockReturnValue({
    error: clearError,
    reset: clearReset,
    mutateAsync: clearMutateAsync,
  } as unknown as ReturnType<typeof useClearCompletedMutation>)
  vi.mocked(useDuplicateTodoMutation).mockReturnValue({
    error: duplicateError,
    reset: duplicateReset,
    mutateAsync: duplicateMutateAsync,
  } as unknown as ReturnType<typeof useDuplicateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(busy)
  vi.mocked(useNotice).mockReturnValue({ message: 'Hello notice', notify })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: todos,
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  return { notify, refetch, mutateAsync }
}

it.each([
  [false, 'Another task complete. Well done!'],
  [true, 'Task marked as active.'],
])(
  'toggles a task and announces the result (saved completed: %s)',
  async (completed, notice) => {
    const user = userEvent.setup()
    const mutateAsync = vi
      .fn()
      .mockResolvedValue({ ...todoFixture, completed: !completed })
    const { notify } = setup({
      todos: [{ ...todoFixture, completed }],
      mutateAsync,
    })
    render(<TodosPage />)
    await user.click(screen.getByRole('button', { name: 'Toggle 7' }))
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 7,
      input: { completed: !completed },
    })
    expect(notify).toHaveBeenCalledWith(notice)
  },
)

it('does not announce anything when toggling fails', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn().mockRejectedValue(new Error('nope'))
  const { notify } = setup({ mutateAsync })
  render(<TodosPage />)
  await user.click(screen.getByRole('button', { name: 'Toggle 7' }))
  expect(mutateAsync).toHaveBeenCalledTimes(1)
  expect(notify).not.toHaveBeenCalled()
})

it('ignores toggles while the page is busy and disables creation', async () => {
  const user = userEvent.setup()
  const { mutateAsync } = setup({ busy: true })
  render(<TodosPage />)
  expect(screen.getByRole('button', { name: 'Header create' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Toggle 7' }))
  expect(mutateAsync).not.toHaveBeenCalled()
})

it('disables creation while the tasks load', () => {
  setup({ isPending: true })
  render(<TodosPage />)
  expect(screen.getByRole('button', { name: 'Header create' })).toBeDisabled()
})

it('shows no alert when there is no error and prefers the mutation error', () => {
  setup()
  const { unmount } = render(<TodosPage />)
  expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
  unmount()
  setup({
    mutationError: new Error('Update failed'),
    queryError: new Error('Query failed'),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent('Update failed')
})

it('opens and closes the editor for a new task and shows the saved notice', async () => {
  const user = userEvent.setup()
  const { notify } = setup()
  render(<TodosPage />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Header create' }))
  expect(screen.getByText('creating')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Close editor' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Header create' }))
  await user.click(screen.getByRole('button', { name: 'Save editor' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(notify).toHaveBeenCalledWith('Saved!')
})

it('opens the editor for an existing task', async () => {
  const user = userEvent.setup()
  setup()
  render(<TodosPage />)
  await user.click(screen.getByRole('button', { name: 'Edit 7' }))
  expect(screen.getByText('editing 7')).toBeVisible()
})

it('confirms deletion, announces it and closes the dialog', async () => {
  const user = userEvent.setup()
  const { notify } = setup()
  render(<TodosPage />)
  await user.click(screen.getByRole('button', { name: 'Delete 7' }))
  expect(screen.getByText('deleting 7')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Close delete' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(notify).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Delete 7' }))
  await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(notify).toHaveBeenCalledWith('Task deleted.')
})

it('passes the number of completed tasks to the header', () => {
  setup({
    todos: [
      { ...todoFixture, id: 1, completed: true },
      { ...todoFixture, id: 2, completed: false },
      { ...todoFixture, id: 3, completed: true },
    ],
  })
  render(<TodosPage />)
  expect(screen.getByTestId('completed-count')).toHaveTextContent('2')
})

it.each([
  [1, '1 completed task removed.'],
  [3, '3 completed tasks removed.'],
])(
  'clears completed tasks and announces the count (%s)',
  async (deleted, notice) => {
    const user = userEvent.setup()
    const clearMutateAsync = vi.fn().mockResolvedValue({ deleted })
    const { notify } = setup({ clearMutateAsync })
    render(<TodosPage />)
    await user.click(screen.getByRole('button', { name: 'Header clear' }))
    expect(clearMutateAsync).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(notice)
  },
)

it('does not announce anything when clearing fails', async () => {
  const user = userEvent.setup()
  const clearMutateAsync = vi.fn().mockRejectedValue(new Error('nope'))
  const { notify } = setup({ clearMutateAsync })
  render(<TodosPage />)
  await user.click(screen.getByRole('button', { name: 'Header clear' }))
  expect(clearMutateAsync).toHaveBeenCalledTimes(1)
  expect(notify).not.toHaveBeenCalled()
})

it('ignores clearing while the page is busy', async () => {
  const user = userEvent.setup()
  const clearMutateAsync = vi.fn()
  setup({ busy: true, clearMutateAsync })
  render(<TodosPage />)
  await user.click(screen.getByRole('button', { name: 'Header clear' }))
  expect(clearMutateAsync).not.toHaveBeenCalled()
})

it('shows the clear mutation error in the alert', () => {
  setup({
    clearError: new Error('Clear failed'),
    queryError: new Error('Query failed'),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent('Clear failed')
})

it('duplicates a task and announces it', async () => {
  const user = userEvent.setup()
  const duplicateMutateAsync = vi.fn().mockResolvedValue(todoFixture)
  const { notify } = setup({ duplicateMutateAsync })
  render(<TodosPage />)
  await user.click(screen.getByRole('button', { name: 'Duplicate 7' }))
  expect(duplicateMutateAsync).toHaveBeenCalledWith(7)
  expect(notify).toHaveBeenCalledWith('Task duplicated.')
})

it('does not announce anything when duplicating fails', async () => {
  const user = userEvent.setup()
  const duplicateMutateAsync = vi.fn().mockRejectedValue(new Error('nope'))
  const { notify } = setup({ duplicateMutateAsync })
  render(<TodosPage />)
  await user.click(screen.getByRole('button', { name: 'Duplicate 7' }))
  expect(duplicateMutateAsync).toHaveBeenCalledTimes(1)
  expect(notify).not.toHaveBeenCalled()
})

it('ignores duplication while the page is busy', async () => {
  const user = userEvent.setup()
  const duplicateMutateAsync = vi.fn()
  setup({ busy: true, duplicateMutateAsync })
  render(<TodosPage />)
  await user.click(screen.getByRole('button', { name: 'Duplicate 7' }))
  expect(duplicateMutateAsync).not.toHaveBeenCalled()
})

it('shows the duplicate mutation error in the alert', () => {
  setup({
    duplicateError: new Error('Duplicate failed'),
    queryError: new Error('Query failed'),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent('Duplicate failed')
})

it('renders the current notice message', () => {
  setup()
  render(<TodosPage />)
  expect(screen.getByTestId('notice')).toHaveTextContent('Hello notice')
})

it('displays a query failure and resets mutation errors before retrying', async () => {
  const user = userEvent.setup()
  const refetch = vi.fn().mockResolvedValue(undefined)
  const reset = vi.fn()
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [],
    isPending: false,
    isFetching: false,
    isError: true,
    error: new Error('The server is unavailable.'),
    refetch,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: null,
    reset,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  const clearReset = vi.fn()
  vi.mocked(useClearCompletedMutation).mockReturnValue({
    error: null,
    reset: clearReset,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useClearCompletedMutation>)
  const duplicateReset = vi.fn()
  vi.mocked(useDuplicateTodoMutation).mockReturnValue({
    error: null,
    reset: duplicateReset,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useDuplicateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(false)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify: vi.fn() })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'The server is unavailable.',
  )
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
  expect(reset).toHaveBeenCalledTimes(1)
  expect(clearReset).toHaveBeenCalledTimes(1)
  expect(duplicateReset).toHaveBeenCalledTimes(1)
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
    refetch.mock.invocationCallOrder[0],
  )
})
