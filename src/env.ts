import { z } from 'zod'

export const env = z.object({
  MEMORY_PATH: z.string().default('~/.config/opencode/memory'),
  PINECODE_INDEX_NAME: z.string().default('cog-memory'),
  OLLAMA_EMBEDDING_MODEL: z.string().default('qwen3-embedding:8b'),
}).parse(process.env)
