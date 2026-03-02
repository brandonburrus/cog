import { Pinecone } from '@pinecone-database/pinecone'
import { Ollama } from 'ollama'
import { env } from './env'
import { z } from 'zod'
import matter from 'gray-matter'
import fs from 'node:fs/promises'

const memoryPath = env.MEMORY_PATH.replace('~', process.env.HOME || '')

const pinecone = new Pinecone()
const memoryIndex = pinecone.Index(env.PINECODE_INDEX_NAME)

const ollama = new Ollama({
  host: 'http://localhost:11434',
})

export const memorySchema = z.object({
  name: z.string().describe('Name for the memory that should be a few key words that summarize the content of the memory'),
  keywords: z.array(z.string()).optional().describe('A comma-separated list of keywords that are relevant to the memory, this is what is used to determine the relevance of the memory when retrieving it later, so it should be comprehensive and cover all the key topics and themes of the memory'),
  description: z.string().describe('A descriptive overview of the memory that should be a few sentences that provide more detail about the content of the memory, this is what is used to determine the relevance of the memory when retrieving it later, so it should be detailed and informative'),
  content: z.string().describe('The content of the memory that should be a detailed and comprehensive account of the information, strategy, pattern, or insight that you want to remember, this is what is stored in the vector database and retrieved later when relevant, so it should be as detailed and comprehensive as possible'),
})

export type Memory = z.infer<typeof memorySchema>
export type Vectors = number[]

export async function saveMemoryMarkdownFile(memory: Memory) {
  const { content, ...frontmatter } = memory
  const markdown = matter.stringify(content, frontmatter)
  const fileName = `${memory.name.replace(/\s+/g, '-')}.md`
  const filePath = `${memoryPath}/${fileName}`
  await fs.mkdir(memoryPath, { recursive: true })
  await fs.writeFile(filePath, markdown)
}

export async function createMemoryEmbeddingVectors(memory: Memory): Promise<Vectors> {
  const embedding = await ollama.embed({
    model: env.OLLAMA_EMBEDDING_MODEL,
    input: memory.description,
  })
  const vectors: Vectors = embedding.embeddings[0]!
  if (!vectors || vectors.length === 0) {
    throw new Error('Failed to create embedding vectors for memory')
  }
  return vectors
}

export async function saveMemoryToPinecone(memory: Memory) {
  await memoryIndex.upsert({
    records: [
      {
        id: memory.name,
        values: await createMemoryEmbeddingVectors(memory),
        metadata: {
          description: memory.description,
          keywords: memory.keywords?.join(',') ?? '',
        },
      }
    ]
  })
}

export async function saveMemory(memory: Memory) {
  await Promise.all([
    saveMemoryMarkdownFile(memory),
    saveMemoryToPinecone(memory),
  ])
}

export async function retrieveMemoryByName(memoryName: string): Promise<Memory> {
  const fileName = `${memoryName.replace(/\s+/g, '-')}.md`
  const filePath = `${memoryPath}/${fileName}`
  const fileContent = await fs.readFile(filePath, 'utf-8')
  const { content, data } = matter(fileContent)
  return {
    name: data.name,
    description: data.description,
    keywords: data.keywords ? data.keywords.split(',') : [],
    content,
  }
}

export async function checkMemoryExists(memoryName: string): Promise<boolean> {
  const fileName = `${memoryName.replace(/\s+/g, '-')}.md`
  const filePath = `${memoryPath}/${fileName}`
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
