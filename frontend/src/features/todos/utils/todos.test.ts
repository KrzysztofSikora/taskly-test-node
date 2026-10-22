import { describe, expect, it } from 'vitest'
import { afterEach, vi } from 'vitest'
import { formatDate, isOverdue, selectTodos, validateTodo } from './todos'
import type { Todo } from '../types'

const base: Todo = {
  id: 1,
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

describe('selectTodos', () => {
  it('combines status with a case-insensitive search in the description', () => {
    const matching = { ...base, description: 'Discuss the API' }
    const todos = [
      matching,
      { ...matching, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(selectTodos(todos, 'active', ' api ', 'newest')).toEqual([matching])
  })

  it('sorts by due date with undated tasks last, ties by newest id', () => {
    const undated = { ...base, id: 1 }
    const late = { ...base, id: 2, due_date: '2026-12-01' }
    const early = { ...base, id: 3, due_date: '2026-11-01' }
    const earlyNewer = { ...base, id: 4, due_date: '2026-11-01' }
    expect(
      selectTodos([undated, late, early, earlyNewer], 'all', '', 'due'),
    ).toEqual([earlyNewer, early, late, undated])
  })

  it('sorts newest first by creation time', () => {
    const newer = { ...base, id: 2, created_at: '2026-10-02T12:00:00Z' }
    expect(selectTodos([base, newer], 'all', '', 'newest')).toEqual([
      newer,
      base,
    ])
  })

  it('filters completed tasks', () => {
    const done = { ...base, id: 2, completed: true }
    expect(selectTodos([base, done], 'completed', '', 'newest')).toEqual([done])
  })

  it('sorts by priority without changing the source array', () => {
    const high: Todo = { ...base, id: 2, priority: 'high' }
    const todos = [base, high]
    expect(selectTodos(todos, 'all', '', 'priority')).toEqual([high, base])
    expect(todos).toEqual([base, high])
  })
})

const input = {
  title: 'Plan',
  description: '',
  priority: 'medium' as const,
  due_date: null,
  completed: false,
}

describe('validateTodo', () => {
  it('accepts a valid task', () => {
    expect(validateTodo({ ...input, due_date: '2026-10-15' })).toEqual({})
  })

  it('requires a non-blank title of at most 120 characters', () => {
    expect(validateTodo({ ...input, title: '   ' }).title).toBe(
      'Enter a task title.',
    )
    expect(validateTodo({ ...input, title: 'x'.repeat(121) }).title).toBe(
      'The title must be at most 120 characters.',
    )
    expect(validateTodo({ ...input, title: 'x'.repeat(120) })).toEqual({})
  })

  it('limits the description to 2000 characters', () => {
    expect(
      validateTodo({ ...input, description: 'x'.repeat(2001) }).description,
    ).toBe('The description must be at most 2000 characters.')
  })

  it.each(['2026-02-30', '15-10-2026', 'tomorrow'])(
    'rejects the invalid due date %s',
    (due_date) => {
      expect(validateTodo({ ...input, due_date }).due_date).toBe(
        'Enter a valid date.',
      )
    },
  )
})

describe('isOverdue', () => {
  afterEach(() => vi.useRealTimers())

  it('is true only for open tasks due before today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 15, 12))
    expect(isOverdue({ ...base, due_date: '2026-10-14' })).toBe(true)
    expect(isOverdue({ ...base, due_date: '2026-10-15' })).toBe(false)
    expect(isOverdue({ ...base, due_date: null })).toBe(false)
    expect(
      isOverdue({ ...base, due_date: '2026-10-14', completed: true }),
    ).toBe(false)
  })
})

describe('formatDate', () => {
  it('formats a date in en-GB style', () => {
    expect(formatDate('2026-10-05')).toBe('5 Oct 2026')
  })
})
