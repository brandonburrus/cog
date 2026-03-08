import type { Database } from 'bun:sqlite'
import type { Ollama } from 'ollama'
import type { Logger } from './logger'
import { z } from 'zod'
import matter from 'gray-matter'
import fs from 'node:fs/promises'
import { env } from './env.ts'

export const memorySchema = z.object({
  name: z
    .string()
    .describe(
      'Name for the memory that should be a few key words that summarize the content of the memory',
    ),
  keywords: z
    .array(z.string())
    .optional()
    .describe(
      'A comma-separated list of keywords that are relevant to the memory, this is what is used to determine the relevance of the memory when retrieving it later, so it should be comprehensive and cover all the key topics and themes of the memory',
    ),
  description: z
    .string()
    .describe(
      'A descriptive overview of the memory that should be a few sentences that provide more detail about the content of the memory, this is what is used to determine the relevance of the memory when retrieving it later, so it should be detailed and informative',
    ),
  content: z
    .string()
    .describe(
      'The content of the memory that should be a detailed and comprehensive account of the information, strategy, pattern, or insight that you want to remember, this is what is stored in the vector database and retrieved later when relevant, so it should be as detailed and comprehensive as possible',
    ),
})

export type Memory = z.infer<typeof memorySchema>
export type Vectors = number[]

export interface SearchResult {
  name: string
  keywords: string[]
  score: number
  content: string
}

export interface BrainDeps {
  db: Database
  ollama: Ollama
  memoryPath: string
  logger: Logger
}

export class Brain {
  private readonly db: Database
  private readonly ollama: BrainDeps['ollama']
  private readonly memoryPath: BrainDeps['memoryPath']
  private readonly logger: Logger
  private embeddingDimensions: number | null = null

  constructor({ db, ollama, memoryPath, logger }: BrainDeps) {
    this.db = db
    this.ollama = ollama
    this.memoryPath = memoryPath
    this.logger = logger
  }

  private async getEmbeddingDimensions(): Promise<number> {
    if (this.embeddingDimensions !== null) return this.embeddingDimensions
    const probe = await this.ollama.embed({
      model: env.OLLAMA_EMBEDDING_MODEL,
      input: 'probe',
    })
    const dims = probe.embeddings[0]?.length
    if (!dims) throw new Error('Failed to determine embedding dimensions from Ollama')
    this.embeddingDimensions = dims
    this.logger.debug({ model: env.OLLAMA_EMBEDDING_MODEL, dims }, 'embedding dimensions detected')
    return dims
  }

  async initDb(): Promise<void> {
    const dims = await this.getEmbeddingDimensions()

    // Drop legacy table from pre-sqlite-vec schema if it exists
    this.db.exec('DROP TABLE IF EXISTS embeddings')

    // Lookup table: maps human-readable memory name → stable integer rowid
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY
      )
    `)

    // vec0 virtual table: stores float32 BLOB vectors keyed on memories.rowid
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
        memory_rowid INTEGER PRIMARY KEY,
        embedding float[${dims}] distance_metric=cosine
      )
    `)

    this.logger.debug({ dims }, 'SQLite memories + vec_embeddings tables initialized')
  }

  async saveMemoryMarkdownFile(memory: Memory): Promise<void> {
    const { content, ...frontmatter } = memory
    const markdown = matter.stringify(content, frontmatter)
    const fileName = `${memory.name.replace(/\s+/g, '-')}.md`
    const filePath = `${this.memoryPath}/${fileName}`
    await fs.mkdir(this.memoryPath, { recursive: true })
    await fs.writeFile(filePath, markdown)
    this.logger.debug({ name: memory.name, filePath }, 'memory markdown file written')
  }

  async createMemoryEmbeddingVectors(memory: Memory): Promise<Vectors> {
    this.logger.debug(
      { name: memory.name, model: env.OLLAMA_EMBEDDING_MODEL },
      'generating embedding',
    )
    const embedding = await this.ollama.embed({
      model: env.OLLAMA_EMBEDDING_MODEL,
      input: memory.description,
    })
    const vectors: Vectors = embedding.embeddings[0]!
    if (!vectors || vectors.length === 0) {
      throw new Error('Failed to create embedding vectors for memory')
    }
    this.logger.debug({ name: memory.name, dimensions: vectors.length }, 'embedding generated')
    return vectors
  }

  async saveMemoryToDb(memory: Memory): Promise<void> {
    const vectors = await this.createMemoryEmbeddingVectors(memory)

    // Step 1: insert into lookup table — no-op if already exists, preserving the rowid
    this.db.prepare('INSERT OR IGNORE INTO memories (id) VALUES (?)').run(memory.name)

    // Step 2: fetch the stable rowid
    const row = this.db.prepare('SELECT rowid FROM memories WHERE id = ?').get(memory.name) as {
      rowid: number
    }

    // Step 3: remove any existing vector (clean slate before re-insert)
    this.db.prepare('DELETE FROM vec_embeddings WHERE memory_rowid = ?').run(row.rowid)

    // Step 4: insert fresh vector as native float32 BLOB
    const blob = new Uint8Array(new Float32Array(vectors).buffer)
    this.db
      .prepare('INSERT INTO vec_embeddings (memory_rowid, embedding) VALUES (?, ?)')
      .run(row.rowid, blob)

    this.logger.debug({ name: memory.name, rowid: row.rowid }, 'memory upserted to SQLite')
  }

  async saveMemory(memory: Memory): Promise<void> {
    await Promise.all([this.saveMemoryMarkdownFile(memory), this.saveMemoryToDb(memory)])
    this.logger.debug({ name: memory.name }, 'memory saved')
  }

  async retrieveMemoryByName(memoryName: string): Promise<Memory> {
    const fileName = `${memoryName.replace(/\s+/g, '-')}.md`
    const filePath = `${this.memoryPath}/${fileName}`
    const fileContent = await fs.readFile(filePath, 'utf-8')
    const { content, data } = matter(fileContent)
    return {
      name: data.name,
      description: data.description,
      keywords: Array.isArray(data.keywords)
        ? data.keywords
        : data.keywords
          ? String(data.keywords).split(',')
          : [],
      content,
    }
  }

  async checkMemoryExists(memoryName: string): Promise<boolean> {
    const fileName = `${memoryName.replace(/\s+/g, '-')}.md`
    const filePath = `${this.memoryPath}/${fileName}`
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  async listLocalMemoryNames(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.memoryPath, { withFileTypes: true })
      return entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name.slice(0, -3))
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  listVectorIds(): string[] {
    const rows = this.db.prepare('SELECT id FROM memories').all() as { id: string }[]
    return rows.map(r => r.id)
  }

  async reconcile(): Promise<void> {
    const [localNames, vectorIds] = await Promise.all([
      this.listLocalMemoryNames(),
      Promise.resolve(this.listVectorIds()),
    ])

    const localSet = new Set(localNames)
    const vectorSet = new Set(vectorIds)

    const toUpsert = localNames.filter(name => !vectorSet.has(name))
    const toDelete = vectorIds.filter(id => !localSet.has(id))

    this.logger.info({ toUpsert: toUpsert.length, toDelete: toDelete.length }, 'reconcile started')

    let upserted = 0
    let deleted = 0
    let errors = 0

    for (const name of toUpsert) {
      try {
        const memory = await this.retrieveMemoryByName(name)
        await this.saveMemoryToDb(memory)
        upserted++
      } catch (err) {
        errors++
        this.logger.error({ name, err }, 'reconcile: failed to upsert memory')
      }
    }

    for (const id of toDelete) {
      try {
        // Delete vector first (FK-style discipline), then the lookup row
        this.db
          .prepare(
            'DELETE FROM vec_embeddings WHERE memory_rowid = (SELECT rowid FROM memories WHERE id = ?)',
          )
          .run(id)
        this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
        this.logger.debug({ id }, 'reconcile: deleted orphaned SQLite vector (no local file)')
        deleted++
      } catch (err) {
        errors++
        this.logger.error({ id, err }, 'reconcile: failed to delete SQLite vector')
      }
    }

    this.logger.info({ upserted, deleted, errors }, 'reconcile: complete')
  }

  async searchMemories(query: string, topK = 5): Promise<SearchResult[]> {
    const embedding = await this.ollama.embed({
      model: env.OLLAMA_EMBEDDING_MODEL,
      input: query,
    })
    const queryVector: Vectors = embedding.embeddings[0]!
    if (!queryVector || queryVector.length === 0) {
      throw new Error('Failed to create embedding vectors for search query')
    }

    // Oversample (topK * 3) so the score threshold has candidates to filter from
    const queryBlob = new Uint8Array(new Float32Array(queryVector).buffer)
    const rows = this.db
      .prepare(
        `SELECT m.id, v.distance
         FROM vec_embeddings v
         JOIN memories m ON m.rowid = v.memory_rowid
         WHERE v.embedding MATCH ?
           AND k = ?
         ORDER BY v.distance`,
      )
      .all(queryBlob, topK * 3) as { id: string; distance: number }[]

    // Convert cosine distance [0, 2] → cosine similarity [−1, 1], apply threshold, slice
    const scored = rows
      .map(r => ({ id: r.id, score: 1 - r.distance }))
      .filter(r => r.score >= env.MEMORY_SEARCH_SCORE_THRESHOLD)
      .slice(0, topK)

    const searchResults: SearchResult[] = []
    for (const match of scored) {
      const memory = await this.retrieveMemoryByName(match.id)
      searchResults.push({
        name: memory.name,
        keywords: memory.keywords ?? [],
        score: match.score,
        content: memory.content,
      })
    }
    return searchResults
  }
}
