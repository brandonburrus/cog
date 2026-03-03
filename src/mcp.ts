import { FastMCP } from 'fastmcp'
import { createContainer, asValue, asClass } from 'awilix'
import { Pinecone } from '@pinecone-database/pinecone'
import { Ollama } from 'ollama'
import { Brain, memorySchema, type Memory, type SearchResult } from './brain'
import { env } from './env'
import z from 'zod'

const container = createContainer<{ brain: Brain }>()
container.register({
  memoryIndex: asValue(new Pinecone().Index({
    name: env.PINECONE_INDEX_NAME,
    host: env.PINECONE_HOST,
  })),
  ollama: asValue(new Ollama({ host: 'http://localhost:11434' })),
  memoryPath: asValue(env.MEMORY_PATH.replace('~', process.env.HOME ?? '')),
  brain: asClass(Brain).singleton(),
})
const brain = container.resolve('brain')

const mcp = new FastMCP({
  name: 'cog',
  version: '0.1.0',
})

mcp.addTool({
  name: 'create-memory',
  description: 'Remember information, strategies, patterns, and insights for future reference',
  timeoutMs: 20_000,
  parameters: memorySchema,
  async execute(memory: Memory) {
    try {
      await brain.saveMemory(memory)
    } catch (error) {
      throw new Error(`Failed to save memory`, {
        cause: error,
      })
    }
    return 'Memory saved successfully'
  },
})

mcp.addResourceTemplate({
  name: 'Memory',
  uriTemplate: 'memory://{memoryName}',
  description:
    'A collection of information, strategies, patterns, and insights that have been remembered for future reference',
  mimeType: 'text/text',
  arguments: [
    {
      name: 'memoryName',
      description: 'Name of the memory',
      required: true,
    },
  ],
  async load({ memoryName }) {
    if (!memoryName) {
      throw new Error('Memory name is required to load memory resource')
    }
    if (await brain.checkMemoryExists(memoryName)) {
      const memory = await brain.retrieveMemoryByName(memoryName)
      return {
        text: memory.content,
      }
    } else {
      throw new Error(`Memory with name '${memoryName}' does not exist`)
    }
  },
})

mcp.addTool({
  name: 'retrieve-memory',
  description:
    'Recall information, strategies, patterns, and insights that were previously remembered',
  timeoutMs: 20_000,
  parameters: z.object({
    memoryName: z.string().describe('The name of the memory to retrieve'),
  }),
  async execute({ memoryName }) {
    return {
      content: [
        {
          type: 'resource',
          resource: await mcp.embedded(`memory://${memoryName}`),
        },
      ],
    }
  },
})

mcp.addTool({
  name: 'search-memory',
  description:
    'Search for memories semantically relevant to a query. Returns memory names, keywords, similarity scores, and content sorted by relevance.',
  timeoutMs: 20_000,
  parameters: z.object({
    query: z.string().describe('Natural language query to search memories by'),
    topK: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(5)
      .describe('Max number of candidate results to consider before score filtering (default 5)'),
  }),
  async execute({ query, topK }) {
    const results: SearchResult[] = await brain.searchMemories(query, topK)
    return JSON.stringify(results, null, 2)
  },
})

mcp.start({
  transportType: 'stdio',
})

brain.reconcile().catch((err: unknown) => {
  process.stderr.write(`[cog] Reconciliation failed: ${err}\n`)
})
