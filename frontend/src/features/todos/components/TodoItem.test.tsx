import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoItem } from './TodoItem'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('shows an active task and forwards edit requests', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={onEdit}
      onToggle={onToggle}
      onDuplicate={vi.fn()}
      onDelete={onDelete}
    />,
  )
  expect(screen.getByRole('heading', { name: todoFixture.title })).toBeVisible()
  expect(screen.getByText('To do')).toBeVisible()
  expect(screen.getByText('Medium')).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  )
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(onToggle).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})

it('forwards toggle and delete requests', async () => {
  const user = userEvent.setup()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={vi.fn()}
      onToggle={onToggle}
      onDuplicate={vi.fn()}
      onDelete={onDelete}
    />,
  )
  await user.click(
    screen.getByRole('checkbox', { name: `Complete: ${todoFixture.title}` }),
  )
  expect(onToggle).toHaveBeenCalledTimes(1)
  await user.click(
    screen.getByRole('button', { name: `Delete: ${todoFixture.title}` }),
  )
  expect(onDelete).toHaveBeenCalledTimes(1)
})

it('forwards duplicate requests', async () => {
  const user = userEvent.setup()
  const onDuplicate = vi.fn()
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={onEdit}
      onToggle={vi.fn()}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
    />,
  )
  await user.click(
    screen.getByRole('button', { name: `Duplicate: ${todoFixture.title}` }),
  )
  expect(onDuplicate).toHaveBeenCalledTimes(1)
  expect(onEdit).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})

it('shows a completed task with its description and an offer to reactivate it', () => {
  render(
    <TodoItem
      todo={{
        ...todoFixture,
        completed: true,
        description: 'Slides and notes',
        priority: 'high',
      }}
      busy={false}
      onEdit={vi.fn()}
      onToggle={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(screen.getByText('Completed')).toBeVisible()
  expect(screen.getByText('High')).toBeVisible()
  expect(screen.getByText('Slides and notes')).toBeVisible()
  expect(
    screen.getByRole('checkbox', {
      name: `Mark as active: ${todoFixture.title}`,
    }),
  ).toBeChecked()
})

it('marks an active task with a past due date as overdue', () => {
  render(
    <TodoItem
      todo={{ ...todoFixture, due_date: '2000-01-15' }}
      busy={false}
      onEdit={vi.fn()}
      onToggle={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(screen.getByText(/15 Jan 2000/)).toHaveTextContent('· overdue')
})

it('does not mark a completed task or a future due date as overdue', () => {
  const { rerender } = render(
    <TodoItem
      todo={{ ...todoFixture, completed: true, due_date: '2000-01-15' }}
      busy={false}
      onEdit={vi.fn()}
      onToggle={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(screen.getByText(/15 Jan 2000/)).not.toHaveTextContent('overdue')
  rerender(
    <TodoItem
      todo={{ ...todoFixture, due_date: '2999-03-04' }}
      busy={false}
      onEdit={vi.fn()}
      onToggle={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(screen.getByText(/4 Mar 2999/)).not.toHaveTextContent('overdue')
})

it('disables every action while busy', () => {
  render(
    <TodoItem
      todo={todoFixture}
      busy
      onEdit={vi.fn()}
      onToggle={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(screen.getByRole('checkbox')).toBeDisabled()
  screen
    .getAllByRole('button')
    .forEach((button) => expect(button).toBeDisabled())
})
