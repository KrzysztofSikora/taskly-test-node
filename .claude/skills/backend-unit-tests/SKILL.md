---
name: backend-unit-tests
description: Write or update Vitest unit tests for the Node.js + Express + Prisma backend (backend/src) following this repo's conventions - Supertest for routers, a fake repository for HTTP tests, Prisma delegates spied with vi.spyOn so no PostgreSQL is needed. Use when a backend source file needs new or updated tests.
allowed-tools: Read Grep Glob Write Edit Bash(node .claude/skills/test-verification/scripts/run-tests.mjs backend *)
---

# Backend unit tests

Stack: Vitest 4 (`environment: 'node'`), Supertest 7, Express 5, Prisma 7 with the PostgreSQL
adapter, Zod 4. Tests never need a database, network or `.env`.

## Before writing

1. Read the source file and its `own_test` (if any), plus `backend/tests/fixture.ts`.
2. Read one existing test of the same kind and copy its shape:
   - HTTP layer (routers, app factory, health): `backend/tests/router.test.ts`
   - data access (repository, Prisma calls): `backend/tests/repository.test.ts`
   - pure functions (validators, mappers, config): `backend/tests/validators.test.ts`, `mappers.test.ts`

## Where tests go

- `backend/tests/<module>.test.ts`, flat (Vitest only collects `tests/**/*.test.ts`). Use the
  `target_test` from the change analysis. It handles name clashes with a subfolder.
- Shared data goes in `backend/tests/fixture.ts` (`record` is the database row, `todo` the API
  shape). Extend it instead of redefining objects. New helpers go in `backend/tests/helpers*.ts`.

## Conventions (match the existing tests)

- **Match the file you extend.** Most test files use flat `it(...)` blocks without `describe`, so new
  files do too. A file that already groups with `describe` keeps its grouping.
- **One import per module.** Add names to the existing `import { ... } from 'vitest'` line instead
  of a second import from the same module.
- Names state behaviour: `'returns 404 when the task does not exist'`.
- `it.each([...])` for input tables, with `%s` / `%j` in the name.
- A local `setup()` function builds the unit under test and its fakes. No shared mutable state
  between tests. `afterEach(() => vi.restoreAllMocks())` when spying.
- Imports: in tests import sources **with the `.ts` extension**
  (`'../src/features/todos/router.ts'`). Sources themselves use `.js`. Do not change that.
- Types: tests are type-checked (`tsconfig.json` includes `tests/**`). Use real types from
  `src/features/todos/types.ts`. Prefer `vi.fn()` fakes typed via the interface (`TodoStore`)
  over `as any` / `as never`. Where a cast is unavoidable use `as unknown as T` locally, with `T`
  the real type (e.g. `as unknown as Database`).

## Recipes

**Router / app (HTTP):** mount the router on a fresh `express()` with `express.json()`, pass a
fake repository whose methods are `vi.fn()`, call it with `supertest`, and assert on status,
body **and** the repository call (arguments, or `not.toHaveBeenCalled()` on validation
failures). For `createApp(database)` pass a fake `database` object with only the members the
path touches (e.g. `{ todo: { findFirst: vi.fn() } }` for `/api/health`).

**Error handling in `factory.ts`:** malformed JSON (`.set('Content-Type','application/json').send('{')`)
→ 422, oversized body → 413, unknown route → 404, a repository that rejects → 500 with
`{ detail: 'Internal Server Error' }`. Silence the expected `console.error` with
`vi.spyOn(console, 'error').mockImplementation(() => {})` and assert it was called.

**Repository / Prisma:** construct the real client with
`createDatabase('postgresql://test:test@localhost:5432/test')` (it does not connect), then
`vi.spyOn(database.todo, '<method>').mockResolvedValue(...)`. Assert on the mapped result and
on the exact Prisma arguments (`where`, `orderBy`, `data`).

**Config / environment:** use `vi.stubEnv(name, value)` and `vi.unstubAllEnvs()` in
`afterEach`. Never read the real `.env`. Cover each branch (explicit override,
`DATABASE_URL`, composed URL, each missing variable).

**Process lifecycle (`lifespan.ts`):** mock collaborators with `vi.mock('../src/core/database.ts', ...)`
and `vi.mock('../src/factory.ts', ...)`, use port `0` via `vi.stubEnv('API_PORT', '0')`, close
the server in the test, and spy on `process.once` rather than sending real signals. If a path
cannot be reached without real signals or `process.exit`, mark it `blocked` instead of hacking it.

## Assertions that defend behaviour

- Assert the observable contract: status code, response body, the arguments passed to the next
  layer, thrown error message. Not private details, not call counts that do not matter.
- Cover the unhappy paths the code has: validation failures (422), missing rows (404), rejected
  promises (500 / propagated error), boundary values (title length 120 vs 121, invalid dates).
- One behaviour per test, but a test may assert several facts about that behaviour.
- No snapshots, no `.only` / `.skip` / `.todo`, no real timers or the current date without
  `vi.useFakeTimers()` / `vi.setSystemTime()`.

## Never

- Edit anything under `backend/src`, configs, `package.json` or thresholds. If production code
  looks wrong, keep the failing expectation out of the suite and report a `suspected_bug`.
- Connect to PostgreSQL or the network, or read `.env`.
