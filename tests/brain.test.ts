import { describe, it, expect, beforeAll, beforeEach } from 'bun:test'
import { Brain } from '../src/brain'
import { Pinecone } from '@pinecone-database/pinecone'
import { Ollama } from 'ollama'
import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'

const ARTIFACTS_DIR = path.join(import.meta.dir, '.artifacts')
const INDEX_NAME = 'cog-memory-test'

const memoryIndex = new Pinecone().Index(INDEX_NAME, 'http://localhost:5081')
const ollama = new Ollama({ host: 'http://localhost:11434' })
const brain = new Brain({ memoryIndex, ollama, memoryPath: ARTIFACTS_DIR })

beforeAll(async () => {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true })
})

beforeEach(async () => {
  await memoryIndex.deleteAll()
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
