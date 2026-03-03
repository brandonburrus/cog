import { describe, it, expect, beforeAll, beforeEach, spyOn, afterAll } from 'bun:test'
import { Brain } from '../src/brain'
import { Pinecone } from '@pinecone-database/pinecone'
import { Ollama } from 'ollama'
import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'

const ARTIFACTS_DIR = path.join(import.meta.dir, '.artifacts')
const INDEX_NAME = 'cog-memory-test'

const memoryIndex = new Pinecone().Index({
  host: 'http://localhost:5081',
  name: INDEX_NAME,
})
const ollama = new Ollama({ host: 'http://localhost:11434' })
const brain = new Brain({ memoryIndex, ollama, memoryPath: ARTIFACTS_DIR })

beforeAll(async () => {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true })
})

afterAll(async () => {
  await memoryIndex.deleteAll()
  const files = await fs.readdir(ARTIFACTS_DIR)
  await Promise.all(files.map(f => fs.rm(path.join(ARTIFACTS_DIR, f))))
  await fs.rmdir(ARTIFACTS_DIR)
})

beforeEach(async () => {
  await memoryIndex.deleteAll()
  const files = await fs.readdir(ARTIFACTS_DIR)
  await Promise.all(files.map(f => fs.rm(path.join(ARTIFACTS_DIR, f))))
})

describe('Brain', () => {
  const testMemory = {
    name: 'test memory alpha',
    description: 'A test memory used in integration tests to verify saving works correctly',
    keywords: ['test', 'integration', 'memory'],
    content:
      'This is the full content of the test memory. It contains detailed information about the test scenario.',
  }

  it('saves a markdown file to the artifacts directory', async () => {
    await brain.saveMemory(testMemory)

    const expectedFile = path.join(ARTIFACTS_DIR, 'test-memory-alpha.md')
    const stat = await fs.stat(expectedFile)
    expect(stat.isFile()).toBe(true)
  })

  it('saved markdown file contains correct frontmatter and content', async () => {
    await brain.saveMemory(testMemory)

    const filePath = path.join(ARTIFACTS_DIR, 'test-memory-alpha.md')
    const raw = await fs.readFile(filePath, 'utf-8')
    const { content, data } = matter(raw)

    expect(data.name).toBe(testMemory.name)
    expect(data.description).toBe(testMemory.description)
    expect(content.trim()).toBe(testMemory.content)
  })

  it('checkMemoryExists returns true after saving', async () => {
    await brain.saveMemory(testMemory)
    expect(await brain.checkMemoryExists(testMemory.name)).toBe(true)
  })

  it('checkMemoryExists returns false for an unsaved memory', async () => {
    expect(await brain.checkMemoryExists('memory that was never saved')).toBe(false)
  })

  it('retrieveMemoryByName round-trips the saved memory', async () => {
    await brain.saveMemory(testMemory)
    const retrieved = await brain.retrieveMemoryByName(testMemory.name)

    expect(retrieved.name).toBe(testMemory.name)
    expect(retrieved.description).toBe(testMemory.description)
    expect(retrieved.content.trim()).toBe(testMemory.content)
  })
})

describe('searchMemories', () => {
  const typescriptMemory = {
    name: 'typescript type errors',
    description: 'How to resolve common TypeScript type errors and configure strict mode',
    keywords: ['typescript', 'types', 'compiler', 'errors'],
    content:
      'TypeScript strict mode enables noImplicitAny, strictNullChecks, and other checks. Common fixes include using type assertions, narrowing with typeof/instanceof, and ensuring proper return types on functions.',
  }

  const cookingMemory = {
    name: 'pasta carbonara recipe',
    description: 'Classic Italian pasta carbonara with eggs, pecorino, and guanciale',
    keywords: ['cooking', 'pasta', 'italian', 'recipe'],
    content:
      'To make carbonara: cook guanciale until crispy, whisk eggs with pecorino romano, cook spaghetti al dente, combine off heat to avoid scrambling eggs. Season with black pepper.',
  }

  const gitMemory = {
    name: 'git rebase workflow',
    description: 'How to use git rebase to keep a clean linear commit history',
    keywords: ['git', 'rebase', 'workflow', 'commits'],
    content:
      'Use git rebase -i HEAD~N to squash, reorder, or edit commits. Always rebase feature branches onto main before merging. Never rebase commits that have been pushed to shared remotes.',
  }

  it('returns the most relevant memory first for a semantic query', async () => {
    await Promise.all([brain.saveMemory(typescriptMemory), brain.saveMemory(cookingMemory)])

    const results = await brain.searchMemories('typescript compiler type checking', 5)

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.name).toBe(typescriptMemory.name)
    expect(results[0]!.score).toBeGreaterThanOrEqual(0.7)
  })

  it('results are sorted descending by score', async () => {
    await Promise.all([
      brain.saveMemory(typescriptMemory),
      brain.saveMemory(gitMemory),
      brain.saveMemory(cookingMemory),
    ])

    const results = await brain.searchMemories('software development tools', 10)

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score)
    }
  })

  it('returns empty array when index is empty', async () => {
    // beforeEach already calls deleteAll
    const results = await brain.searchMemories('typescript type errors')
    expect(results).toEqual([])
  })

  it('each result has name, keywords, score, content and no description', async () => {
    await brain.saveMemory(typescriptMemory)

    const results = await brain.searchMemories('typescript strict mode', 5)

    expect(results.length).toBeGreaterThan(0)
    const result = results[0]!
    expect(result.name).toBeDefined()
    expect(result.keywords).toBeDefined()
    expect(result.score).toBeDefined()
    expect(result.content).toBeDefined()
    expect((result as unknown as Record<string, unknown>).description).toBeUndefined()
  })
})

describe('reconcile', () => {
  const memoryA = {
    name: 'reconcile-memory-a',
    description: 'First reconciliation test memory about cloud infrastructure patterns',
    keywords: ['cloud', 'infrastructure', 'reconcile'],
    content: 'Content of reconcile memory A: cloud infrastructure patterns and best practices.',
  }

  const memoryB = {
    name: 'reconcile-memory-b',
    description: 'Second reconciliation test memory about database indexing strategies',
    keywords: ['database', 'indexing', 'reconcile'],
    content:
      'Content of reconcile memory B: database indexing strategies for high-throughput systems.',
  }

  const memoryC = {
    name: 'reconcile-memory-c',
    description: 'Third reconciliation test memory about API rate limiting approaches',
    keywords: ['api', 'rate-limiting', 'reconcile'],
    content: 'Content of reconcile memory C: API rate limiting approaches and backoff strategies.',
  }

  it('upserts local-only memories into Pinecone', async () => {
    // Write markdown files locally but skip Pinecone
    await brain.saveMemoryMarkdownFile(memoryA)
    await brain.saveMemoryMarkdownFile(memoryB)

    // Pinecone should be empty before reconcile
    const beforeIds = await brain.listPineconeVectorIds()
    expect(beforeIds).toHaveLength(0)

    await brain.reconcile()

    // Both memories should now be searchable in Pinecone
    const afterIds = await brain.listPineconeVectorIds()
    expect(afterIds).toContain(memoryA.name)
    expect(afterIds).toContain(memoryB.name)
    expect(afterIds).toHaveLength(2)
  })

  it('deletes Pinecone-only vectors that have no local file', async () => {
    // Save to both stores normally, then delete the local file to simulate drift
    await brain.saveMemory(memoryA)
    await fs.rm(path.join(ARTIFACTS_DIR, `${memoryA.name}.md`))

    // Pinecone has the vector but local file is gone
    const beforeIds = await brain.listPineconeVectorIds()
    expect(beforeIds).toContain(memoryA.name)
    const localBefore = await brain.listLocalMemoryNames()
    expect(localBefore).toHaveLength(0)

    await brain.reconcile()

    // Orphaned vector should be removed from Pinecone
    const afterIds = await brain.listPineconeVectorIds()
    expect(afterIds).not.toContain(memoryA.name)
    expect(afterIds).toHaveLength(0)
  })

  it('leaves already-synced memories untouched', async () => {
    // Save all three memories normally — both stores are in sync
    await Promise.all([
      brain.saveMemory(memoryA),
      brain.saveMemory(memoryB),
      brain.saveMemory(memoryC),
    ])

    const beforeIds = (await brain.listPineconeVectorIds()).sort()
    const beforeLocal = (await brain.listLocalMemoryNames()).sort()
    expect(beforeIds).toEqual(beforeLocal)

    await brain.reconcile()

    // Both stores should be unchanged
    const afterIds = (await brain.listPineconeVectorIds()).sort()
    const afterLocal = (await brain.listLocalMemoryNames()).sort()
    expect(afterIds).toEqual(beforeIds)
    expect(afterLocal).toEqual(beforeLocal)
  })

  it('handles mixed drift: upserts local-only and deletes Pinecone-only in one pass', async () => {
    // memoryA: in Pinecone only (local file deleted after save)
    await brain.saveMemory(memoryA)
    await fs.rm(path.join(ARTIFACTS_DIR, `${memoryA.name}.md`))

    // memoryB: local only (saved to disk, not Pinecone)
    await brain.saveMemoryMarkdownFile(memoryB)

    // memoryC: in both stores (in sync, should be untouched)
    await brain.saveMemory(memoryC)

    await brain.reconcile()

    const afterIds = await brain.listPineconeVectorIds()
    const afterLocal = await brain.listLocalMemoryNames()

    // memoryA orphan should be gone from Pinecone
    expect(afterIds).not.toContain(memoryA.name)
    // memoryB should now be in Pinecone
    expect(afterIds).toContain(memoryB.name)
    // memoryC should still be present in both
    expect(afterIds).toContain(memoryC.name)
    expect(afterLocal).toContain(memoryC.name)

    // Local and Pinecone sets should now match
    expect(afterIds.sort()).toEqual(afterLocal.sort())
  })

  it('logs a completion summary to stderr', async () => {
    await brain.saveMemoryMarkdownFile(memoryA)

    const written: string[] = []
    const spy = spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk))
      return true
    })

    try {
      await brain.reconcile()
    } finally {
      spy.mockRestore()
    }

    const summary = written.find(line => line.includes('reconcile: complete'))
    expect(summary).toBeDefined()
    expect(summary).toContain('+1 upserted')
    expect(summary).toContain('-0 deleted')
    expect(summary).toContain('0 errors')
  })
})
