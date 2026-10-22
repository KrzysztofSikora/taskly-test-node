import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TodoForm } from './TodoForm'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

describe('TodoForm', () => {
  it('rejects a whitespace-only title without submitting', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '   ')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(screen.getByText('Enter a task title.')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits trimmed values and the selected priority', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '  Prepare a demo  ')
    await user.selectOptions(screen.getByLabelText('Priority'), 'high')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Prepare a demo',
      description: '',
      priority: 'high',
      due_date: null,
      completed: false,
    })
  })

  it('prefills the initial values and submits edited description and due date', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        initial={{
          title: 'Existing',
          description: 'Old',
          priority: 'low',
          due_date: '2026-10-15',
          completed: true,
        }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    expect(screen.getByLabelText(/Task title/)).toHaveValue('Existing')
    expect(screen.getByLabelText('Priority')).toHaveValue('low')
    expect(screen.getByLabelText(/Due date/)).toHaveValue('2026-10-15')
    await user.clear(screen.getByLabelText(/Description/))
    await user.type(screen.getByLabelText(/Description/), '  New text  ')
    await user.clear(screen.getByLabelText(/Due date/))
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Existing',
      description: 'New text',
      priority: 'low',
      due_date: null,
      completed: true,
    })
  })

  it('shows validation errors for an overlong title and description', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <TodoForm
        initial={{
          title: 'x'.repeat(121),
          description: 'y'.repeat(2001),
          priority: 'medium',
          due_date: null,
          completed: false,
        }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(
      screen.getByText('The title must be at most 120 characters.'),
    ).toBeVisible()
    expect(
      screen.getByText('The description must be at most 2000 characters.'),
    ).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('calls cancel and shows the server error', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={vi.fn()}
        onCancel={onCancel}
        busy={false}
        error="Could not save."
      />,
    )
    expect(screen.getByTestId('alert')).toHaveTextContent('Could not save.')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('disables the form and shows progress while busy', () => {
    render(<TodoForm onSubmit={vi.fn()} onCancel={vi.fn()} busy error={null} />)
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByLabelText(/Task title/)).toBeDisabled()
  })
})
