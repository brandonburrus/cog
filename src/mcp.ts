#!/usr/bin/env bun
import { FastMCP } from 'fastmcp'
import { createContainer, asValue, asClass } from 'awilix'
import { Database } from 'bun:sqlite'
import { Ollama } from 'ollama'
import envPaths from 'env-paths'
import fs from 'node:fs'
import path from 'node:path'
import { Brain, memorySchema, type Memory, type SearchResult } from './brain'
import { env } from './env'
import { logger } from './logger'
import z from 'zod'

const dataDir = envPaths('cog', { suffix: '' }).data
fs.mkdirSync(dataDir, { recursive: true })
const db = new Database(path.join(dataDir, 'cog.db'))

const cleanup = () => {
  db.close()
  process.exit(0)
}
process.on('SIGTERM', cleanup)
process.on('SIGINT', cleanup)

logger.debug({ host: 'http://localhost:11434' }, 'initializing Ollama client')
const ollama = new Ollama({ host: 'http://localhost:11434' })

const container = createContainer<{ brain: Brain }>()
container.register({
  db: asValue(db),
  ollama: asValue(ollama),
  memoryPath: asValue(env.MEMORY_PATH.replace('~', process.env.HOME ?? '')),
  logger: asValue(logger),
  brain: asClass(Brain).singleton(),
})
const brain = container.resolve('brain')

brain.initDb()

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
    logger.debug({ name: memory.name }, 'tool: create-memory called')
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
    logger.debug({ memoryName }, 'tool: retrieve-memory called')
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
    logger.debug({ query, topK }, 'tool: search-memory called')
    const results: SearchResult[] = await brain.searchMemories(query, topK)
    return JSON.stringify(results, null, 2)
  },
})

mcp.start({
  transportType: 'stdio',
})

logger.info({ transport: 'stdio' }, 'cog MCP server started')

brain.reconcile().catch((err: unknown) => {
  logger.error({ err }, 'reconciliation failed')
})
