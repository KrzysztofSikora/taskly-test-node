---
name: frontend-unit-tests
description: Write or update Vitest + React Testing Library unit tests for the React + TypeScript frontend (frontend/src) following this repo's conventions - colocated *.test.tsx files, mocked design system, user-event interactions, renderHook with a QueryClientProvider for TanStack Query hooks. Use when a frontend source file needs new or updated tests.
allowed-tools: Read Grep Glob Write Edit Bash(node .claude/skills/test-verification/scripts/run-tests.mjs frontend *)
---

# Frontend unit tests

Stack: React 19, TypeScript, Vite 6, Vitest 4 (`environment: 'jsdom'`, setup
`src/test/setup.ts` with jest-dom matchers and `cleanup`), React Testing Library 16,
user-event 14, TanStack Query 5, styled-components 6. Code style: Prettier with no semicolons,
single quotes, trailing commas.

## Before writing

1. Read the source file, its `own_test` (if any) and `src/test/todoFixture.ts`.
2. Copy the shape of the closest existing test:
   - component with children and props: `features/todos/components/TodoList.test.tsx`
   - component with interaction: `features/todos/components/TodoForm.test.tsx`, `TodoItem.test.tsx`
   - page wiring hooks together: `features/todos/TodosPage.test.tsx`
   - API module: `features/todos/api/todos.test.ts`
   - plain hook: `hooks/useNotice.test.ts`
   - pure functions: `features/todos/utils/todos.test.ts`

## Where tests go

Next to the source: `Foo.tsx` → `Foo.test.tsx`, `foo.ts` → `foo.test.ts` (use `.test.tsx`
for a `.ts` hook when the test needs JSX for a wrapper). Shared fixtures go in `src/test/`.

## Conventions (match the existing tests)

- Flat `it(...)` blocks, no `describe`. Behavioural names: `'shows loading feedback before showing an empty list'`.
- **Design system is always mocked:** `vi.mock('<relative>/design-system', () => import('<relative>/design-system/mocks'))`.
  The mocks render native elements (`Button` → `<button>`, `Alert` → `data-testid="alert"`, `Input` → `<label>` + `<input>`).
  Read `src/design-system/mocks.tsx` when you need to know what an element renders.
- **Unit isolation:** a component test mocks its child feature components
  (`vi.mock('./TodoItem', () => ({ TodoItem: () => <li>Task</li> }))`) and the hooks it calls
  (`vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))` + `vi.mocked(...).mockReturnValue(...)`).
- Query by role and accessible name (`getByRole('button', { name: 'Try again' })`), then text.
  Use `getByTestId` only for the mocked `alert`.
- Interactions: `const user = userEvent.setup()` and `await user.click(...)` / `user.type(...)`.
  Never `fireEvent` when user-event can do it.
- Async: `await screen.findBy...` or `await waitFor(...)`. Never sleep.
- Imports without extensions (`'./TodoList'`). Global `vi`/`expect` are typed, but import them
  from `'vitest'` explicitly like the existing tests.
- Types: tests are type-checked. For partial hook results use
  `as unknown as ReturnType<typeof useX>`, as `TodosPage.test.tsx` does.

## Recipes

**TanStack Query hooks (`use*Query`, `use*Mutation`):** mock the API module
(`vi.mock('../api/todos', () => ({ todosApi: { list: vi.fn(), create: vi.fn(), ... } }))`),
create a fresh `new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })`
per test, and `renderHook(() => useX(), { wrapper })` with a `QueryClientProvider` wrapper.
Assert on what the hook does to the cache (`queryClient.getQueryData(todoKeys.list)` after
`mutateAsync`), on the API call arguments, and on error state. Seed the cache with
`queryClient.setQueryData` where the hook updates existing data.

**`lib/http.ts` (fetch wrapper):** `vi.stubGlobal('fetch', vi.fn())` and `vi.unstubAllGlobals()`
in `afterEach`. Return `new Response(JSON.stringify(body), { status })`. Cover: the `/api`
prefix and JSON header merge, network failure → friendly message, aborted request → original
error, 422 → validation message, other errors → `detail` string or fallback, 204 → `undefined`.

**Time-dependent code (`isOverdue`, `formatDate`):** `vi.useFakeTimers()` +
`vi.setSystemTime(new Date('2026-10-15T12:00:00'))`, and `vi.useRealTimers()` in `afterEach`.

**Pure functions:** table-driven `it.each`, including boundaries (120 vs 121 characters,
invalid calendar dates like `2026-02-30`) and every sort/filter branch.

## Assertions that defend behaviour

- Assert what the user sees or what the unit hands to its collaborators: rendered text and
  roles, enabled/disabled state, callbacks called with the right arguments, API arguments,
  cache contents. Not internal state, class names or styled-components output.
- Cover the states a component has: loading, empty, error, populated, busy/disabled.
- No snapshots, no `.only` / `.skip` / `.todo`, no real network, no real timers for time logic.

## Finish

Run `node .claude/skills/test-verification/scripts/run-tests.mjs frontend format <test files>`
so CI's `format:check` passes, then verify (test-verification skill).

## Never

- Edit anything outside test files and `src/test/`, including components, the design system,
  configs, `package.json`. If production code looks wrong, report a `suspected_bug`.
