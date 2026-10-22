import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoList } from './TodoList'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('./TodoEmptyState', () => ({
  TodoEmptyState: () => <p>Empty task list</p>,
}))
vi.mock('./TodoItem', () => ({
  TodoItem: ({
    onToggle,
    onEdit,
    onDelete,
  }: {
    onToggle: () => void
    onEdit: () => void
    onDelete: () => void
  }) => (
    <li>
      <span>Task</span>
      <button onClick={onToggle}>Toggle</button>
      <button onClick={onEdit}>Edit</button>
      <button onClick={onDelete}>Delete</button>
    </li>
  ),
}))

it('shows loading feedback before showing an empty list', () => {
  const props = {
    todos: [],
    hasTodos: false,
    failed: false,
    busy: false,
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }
  const { rerender } = render(<TodoList {...props} loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your tasks…')
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
  rerender(<TodoList {...props} loading={false} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('Empty task list')).toBeVisible()
})

it('shows an unavailable message when loading failed and nothing is cached', () => {
  render(
    <TodoList
      todos={[]}
      hasTodos={false}
      loading={false}
      failed
      busy={false}
      onCreate={vi.fn()}
      onToggle={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(
    screen.getByRole('heading', {
      name: 'The task list is temporarily unavailable',
    }),
  ).toBeVisible()
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
})

it('keeps showing tasks when a refetch failed but data exists', () => {
  render(
    <TodoList
      todos={[todoFixture]}
      hasTodos
      loading={false}
      failed
      busy={false}
      onCreate={vi.fn()}
      onToggle={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(screen.getAllByText('Task')).toHaveLength(1)
  expect(
    screen.queryByText('The task list is temporarily unavailable'),
  ).not.toBeInTheDocument()
})

it('binds item actions to their task', async () => {
  const user = userEvent.setup()
  const second = { ...todoFixture, id: todoFixture.id + 1 }
  const onToggle = vi.fn()
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoList
      todos={[todoFixture, second]}
      hasTodos
      loading={false}
      failed={false}
      busy={false}
      onCreate={vi.fn()}
      onToggle={onToggle}
      onEdit={onEdit}
      onDelete={onDelete}
    />,
  )
  await user.click(screen.getAllByRole('button', { name: 'Toggle' })[1])
  await user.click(screen.getAllByRole('button', { name: 'Edit' })[0])
  await user.click(screen.getAllByRole('button', { name: 'Delete' })[1])
  expect(onToggle).toHaveBeenCalledExactlyOnceWith(second)
  expect(onEdit).toHaveBeenCalledExactlyOnceWith(todoFixture)
  expect(onDelete).toHaveBeenCalledExactlyOnceWith(second)
})

it('renders one item per task', () => {
  render(
    <TodoList
      todos={[todoFixture, { ...todoFixture, id: todoFixture.id + 1 }]}
      hasTodos
      loading={false}
      failed={false}
      busy={false}
      onCreate={vi.fn()}
      onToggle={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(screen.getAllByText('Task')).toHaveLength(2)
})
