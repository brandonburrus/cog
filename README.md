# cog

An MCP server that gives AI agents persistent, semantically searchable memory. Memories are stored as local markdown files with embeddings indexed in a local SQLite database for fast vector search, powered by Ollama.

## How to use it

Once cog is installed and running as an MCP server, you interact with it through **skills** and **commands** in OpenCode (or any MCP client that supports them).

### Skills

Skills are loaded on demand and inject guided workflows into the agent's context.

| Skill | Description |
|---|---|
| `cog-create-memory` | Proactively captures useful information as long-term memories during any task — use when you discover user preferences, non-obvious solutions, reusable patterns, or decisions worth remembering. Saves automatically without prompting the user. |
| `cog-recollect` | Searches long-term memory for context relevant to the current task. Use liberally at the start of tasks, when encountering unfamiliar patterns, or whenever past sessions might hold useful context. Always asks before loading full memory content. |

### Commands

Commands are slash-commands that run as subtasks.

| Command | Description |
|---|---|
| `/remember` | Saves something to memory — drafts a proposed memory from conversation context, asks clarifying questions, then saves on confirmation. |
| `/recall <query>` | Searches memories by natural language query, presents results with similarity scores, and optionally loads the full content of any matches. |

---

## How it works

1. An agent calls `create-memory` with a name, description, keywords, and content
2. Ollama generates an embedding vector for the memory's description
3. The vector is upserted into a local SQLite database; the full content is written to a local markdown file
4. Later, `search-memory` embeds a natural language query and retrieves the most relevant memories by cosine similarity
5. `retrieve-memory` fetches a specific memory by name via the `memory://` resource template
6. On startup, cog reconciles the markdown files and SQLite index — upserts any file-only memories, removes any orphaned vectors

## MCP tools

| Tool | Description |
|---|---|
| `create-memory` | Save information, strategies, patterns, and insights for future reference |
| `retrieve-memory` | Fetch a specific memory by name |
| `search-memory` | Semantic search across all memories by natural language query |

## Prerequisites

- [Bun](https://bun.sh) — runtime and package manager
- [Ollama](https://ollama.com) — local embedding model server

## Setup

### 1. Install dependencies

```sh
bun install
```

### 2. Pull the embedding model

```sh
ollama pull qwen3-embedding:8b
```

### 3. Configure environment (optional)

All variables have sensible defaults and work out of the box. Override any of them by creating a `.env` file in the project root (Bun loads it automatically):

| Variable | Default | Description |
|---|---|---|
| `MEMORY_PATH` | `~/.config/opencode/memory` | Directory where markdown memory files are stored |
| `OLLAMA_EMBEDDING_MODEL` | `qwen3-embedding:8b` | Ollama model used for embeddings |
| `MEMORY_SEARCH_SCORE_THRESHOLD` | `0.75` | Minimum cosine similarity score for search results (0–1) |
| `LOG_LEVEL` | `info` | Log verbosity (`trace`, `debug`, `info`, `warn`, `error`) |

### 4. Install as a local CLI

Install `cog` as a global command so it can be referenced directly in any MCP client config:

```sh
bun link
```

This creates a symlink at `~/.bun/bin/cog`. Make sure `~/.bun/bin` is on your `$PATH`.

### 5. Install in OpenCode (or any MCP client)

Add the following to your MCP client config (e.g. `opencode.jsonc`):

```jsonc
{
  "mcp": {
    "cog": {
      "type": "local",
      "command": "cog",
    }
  }
}
```

## Storage

Cog uses two stores that are kept in sync automatically:

- **Markdown files** (`$MEMORY_PATH/*.md`) — human-readable and hand-editable. YAML frontmatter carries the name, description, and keywords; the body is the memory content.
- **SQLite database** (`~/.local/share/cog/cog.db`) — stores embedding vectors as JSON blobs for in-process cosine similarity search.

Files edited or added outside of cog are picked up on the next startup via reconciliation.

## Development

### Run tests

```sh
bun test
```

### Type-check

```sh
bun run build
```

### Lint / format

```sh
bun run biome
```
