# AGENTS.md

Guidelines for agentic coding agents working in this repository.

## Project Overview

This is a **Model Context Protocol (MCP) server** that gives AI agents persistent, semantically
searchable memory. Memories are stored as local Markdown files with YAML frontmatter; embedding
vectors are stored in SQLite for cosine-similarity search, powered by a locally running Ollama
instance.

**Stack:** TypeScript · Bun · FastMCP · Awilix · Zod · Pino · SQLite (via `bun:sqlite`)

---

## Build / Lint / Test Commands

```bash
# Type-check (no emit)
bun run build

# Run all tests
bun test

# Run a single test file
bun test tests/brain.test.ts

# Run a single test by name pattern
bun test --test-name-pattern "saves a markdown file"

# Lint and auto-fix (Biome)
bun run biome

# Start the MCP server
bun src/mcp.ts
```

> **Note:** Tests are integration tests that call a real local Ollama instance. Ensure Ollama is
> running with the configured embedding model before running tests.

---

## Code Style

### Formatter & Linter — Biome

All formatting and linting is handled by [Biome](https://biomejs.dev/) (`biome.json`). There is no
ESLint or Prettier. Always run `bun run biome` before committing.

| Rule                | Value                  |
| ------------------- | ---------------------- |
| Indent              | 2 spaces               |
| Line width          | 100 chars              |
| Quotes              | Single (`'`)           |
| Semicolons          | None (ASI)             |
| Trailing commas     | All                    |
| Arrow parentheses   | Only when needed       |
| Non-null assertions | Allowed (`!` is fine)  |

---

## TypeScript

The `tsconfig.json` uses strict settings. Key rules to follow:

- **`verbatimModuleSyntax: true`** — use `import type` for type-only imports:
  ```ts
  import type { Database } from 'bun:sqlite'
  import { z } from 'zod'
  ```
- **`noUncheckedIndexedAccess: true`** — array/record access returns `T | undefined`; check before
  use or use the non-null assertion (`!`) when certainty is warranted.
- **`strict: true`** — all strict checks enabled; no implicit `any`.
- **`allowImportingTsExtensions: true`** — use `.ts` extensions in local imports:
  ```ts
  import { env } from './env.ts'
  ```
- **Module resolution: `bundler`** — path resolution follows Bun/bundler semantics.
- Target is `ESNext`; use modern syntax freely.

---

## Naming Conventions

| Construct       | Convention                                      |
| --------------- | ----------------------------------------------- |
| Files           | `kebab-case.ts` (e.g. `brain.ts`, `env.ts`)     |
| Classes         | `PascalCase` (e.g. `Brain`)                     |
| Interfaces      | `PascalCase` — no `I` prefix (e.g. `BrainDeps`) |
| Types / Schemas | `PascalCase` for types, `camelCase` for schemas  |
| Functions       | `camelCase`                                     |
| Constants       | `camelCase` at module scope (e.g. `env`)        |
| Env vars        | `SCREAMING_SNAKE_CASE`                          |
| Test artifacts  | stored under `tests/.artifacts/`                |

---

## Imports

- Group and order: external packages first, then internal modules.
- Use `import type` for anything that is only a type (required by `verbatimModuleSyntax`).
- Prefer named imports; default imports only when the package exports a single default.
- Use `.ts` file extensions on all relative imports.

```ts
// ✅ Correct
import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import type { Logger } from './logger.ts'
import { Brain } from './brain.ts'

// ❌ Incorrect — missing `type`, missing extension
import { Logger } from './logger'
```

---

## Error Handling

- Throw plain `Error` objects with descriptive messages:
  ```ts
  throw new Error(`Memory not found: ${name}`)
  ```
- Use `cause` chaining when wrapping a lower-level error:
  ```ts
  throw new Error('Failed to save memory', { cause: error })
  ```
- Narrow unknown caught values before accessing properties:
  ```ts
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') { ... }
  ```
- Log errors before or alongside throwing using the injected Pino `logger`:
  ```ts
  logger.error({ name, err }, 'Failed to delete memory file')
  ```
- In MCP tool `execute` functions, wrap domain calls in `try/catch` and re-throw with context so
  FastMCP can surface a clean error to the client.

---

## Patterns & Conventions

### Environment Config
Parse and validate env vars with Zod at module load; fail fast on startup:
```ts
export const env = z.object({ ... }).parse(process.env)
```

### Dependency Injection
Use Awilix for the DI container (see `src/mcp.ts`). Classes receive a single destructured deps
object in their constructor:
```ts
constructor({ db, ollama, memoryPath, logger }: BrainDeps) { ... }
```

### Zod Schemas
Export both the schema and the inferred type:
```ts
export const memorySchema = z.object({ ... })
export type Memory = z.infer<typeof memorySchema>
```

### Async
Use `async/await` throughout. Use `Promise.all` for independent parallel operations:
```ts
const [files] = await Promise.all([readFiles(), queryDb()])
```

### Logging
Use the injected Pino logger (never `console.log`). Log structured data as the first argument:
```ts
logger.info({ name, keywords }, 'Memory saved')
logger.error({ name, err }, 'Failed to read memory')
```

---

## Testing

- **Runtime:** `bun:test` — use `describe`, `it`, `expect`, `beforeAll`, `beforeEach`, `mock`,
  `afterAll` from `'bun:test'`.
- **Structure:** Group tests by feature area using `describe` blocks.
- **Isolation:** Wipe both the in-memory SQLite DB and any file artifacts in `beforeEach`.
- **Mocks:** Use `mock()` from `bun:test` for logger and other side-effectful deps.
- **Assertions:** Prefer specific matchers (`.toEqual`, `.toContain`, `.toHaveLength`) over generic
  `.toBe(true)`.
- **No HTTP mocking:** Tests call real Ollama; ensure the embedding model is available locally.

```ts
// Single test run by name
bun test --test-name-pattern "reconcile removes stale embeddings"
```

---

## File Layout

```
src/
  mcp.ts        # Entry point — MCP server, tool registration, DI wiring
  brain.ts      # Core domain — memory CRUD, embeddings, vector search
  env.ts        # Zod-parsed environment config
  logger.ts     # Pino logger factory
tests/
  brain.test.ts # Integration tests for Brain
commands/       # Slash-command prompt files (.md)
skills/         # Agent skill definitions (.md)
biome.json      # Linter + formatter config
tsconfig.json   # TypeScript config
package.json    # Scripts and dependencies
```

---

## Key Dependencies

| Package       | Purpose                                    |
| ------------- | ------------------------------------------ |
| `fastmcp`     | MCP server framework                       |
| `awilix`      | Dependency injection container             |
| `zod`         | Schema validation and env parsing          |
| `ollama`      | Ollama JS client for embedding generation  |
| `pino`        | Structured logger                          |
| `gray-matter` | YAML frontmatter parsing for memory files  |
| `env-paths`   | XDG-compliant data directory resolution    |
| `bun:sqlite`  | Built-in Bun SQLite for vector storage     |
