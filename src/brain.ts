import type { Pinecone } from '@pinecone-database/pinecone'
import type { Ollama } from 'ollama'
import { z } from 'zod'
import matter from 'gray-matter'
import fs from 'node:fs/promises'
import { env } from './env'

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
  memoryIndex: ReturnType<Pinecone['Index']>
  ollama: Ollama
  memoryPath: string
}

export class Brain {
  private readonly memoryIndex: BrainDeps['memoryIndex']
  private readonly ollama: BrainDeps['ollama']
  private readonly memoryPath: BrainDeps['memoryPath']

  constructor({ memoryIndex, ollama, memoryPath }: BrainDeps) {
    this.memoryIndex = memoryIndex
    this.ollama = ollama
    this.memoryPath = memoryPath
  }

  async saveMemoryMarkdownFile(memory: Memory): Promise<void> {
    const { content, ...frontmatter } = memory
    const markdown = matter.stringify(content, frontmatter)
    const fileName = `${memory.name.replace(/\s+/g, '-')}.md`
    const filePath = `${this.memoryPath}/${fileName}`
    await fs.mkdir(this.memoryPath, { recursive: true })
    await fs.writeFile(filePath, markdown)
  }

  async createMemoryEmbeddingVectors(memory: Memory): Promise<Vectors> {
    const embedding = await this.ollama.embed({
      model: env.OLLAMA_EMBEDDING_MODEL,
      input: memory.description,
    })
    const vectors: Vectors = embedding.embeddings[0]!
    if (!vectors || vectors.length === 0) {
      throw new Error('Failed to create embedding vectors for memory')
    }
    return vectors
  }

  async saveMemoryToPinecone(memory: Memory): Promise<void> {
    await this.memoryIndex.upsert({
      records: [
        {
          id: memory.name,
          values: await this.createMemoryEmbeddingVectors(memory),
          metadata: {
            description: memory.description,
            keywords: memory.keywords?.join(',') ?? '',
          },
        },
      ],
    })
  }

  async saveMemory(memory: Memory): Promise<void> {
    await Promise.all([this.saveMemoryMarkdownFile(memory), this.saveMemoryToPinecone(memory)])
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

  async searchMemories(query: string, topK = 5): Promise<SearchResult[]> {
    const embedding = await this.ollama.embed({
      model: env.OLLAMA_EMBEDDING_MODEL,
      input: query,
    })
    const vector: Vectors = embedding.embeddings[0]!
    if (!vector || vector.length === 0) {
      throw new Error('Failed to create embedding vectors for search query')
    }

    const results = await this.memoryIndex.query({
      vector,
      topK,
      includeMetadata: true,
    })

    const matches = (results.matches ?? [])
      .filter(m => (m.score ?? 0) >= env.MEMORY_SEARCH_SCORE_THRESHOLD)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

    const searchResults: SearchResult[] = []
    for (const match of matches) {
      const memory = await this.retrieveMemoryByName(match.id)
      searchResults.push({
        name: memory.name,
        keywords: memory.keywords ?? [],
        score: match.score ?? 0,
        content: memory.content,
      })
    }
    return searchResults
  }
}
