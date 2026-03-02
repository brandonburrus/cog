import { FastMCP } from 'fastmcp'
import { checkMemoryExists, memorySchema, retrieveMemoryByName, saveMemory, type Memory } from './memory'
import z from 'zod'

const mcp = new FastMCP({
  name: 'cog',
  version: '0.1.0',
})

mcp.addTool({
  name: 'create-memory',
  description: 'Remember information, strategies, patterns, and insights for future reference',
  timeoutMs: 4_000,
  parameters: memorySchema,
  async execute(memory: Memory) {
    try {
      await saveMemory(memory)
    } catch (error) {
      throw new Error(`Failed to save memory`, {
        cause: error,
      })
    }
    return 'Memory saved successfully'
  }
})

mcp.addResourceTemplate({
  name: 'Memory',
  uriTemplate: 'memory://{memoryName}',
  description: 'A collection of information, strategies, patterns, and insights that have been remembered for future reference',
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
    if (await checkMemoryExists(memoryName)) {
      const memory = await retrieveMemoryByName(memoryName)
      return {
        text: memory.content,
      }
    } else {
      throw new Error(`Memory with name '${memoryName}' does not exist`)
    }
  }
})

mcp.addTool({
  name: 'retrieve-memory',
  description: 'Recall information, strategies, patterns, and insights that were previously remembered',
  timeoutMs: 4_000,
  parameters: z.object({
    memoryName: z.string().describe('The name of the memory to retrieve'),
  }),
  async execute({ memoryName }) {
    return {
      content: [
        {
          type: 'resource',
          resource: await mcp.embedded(`memory://${memoryName}`),
        }
      ]
    }
  },
})

// search-memory

mcp.start({
  transportType: 'stdio'
})
