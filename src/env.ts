import { z } from 'zod'

export const env = z
  .object({
    MEMORY_PATH: z.string().default('~/.config/opencode/memory'),
    OLLAMA_EMBEDDING_MODEL: z.string().default('qwen3-embedding:8b'),
    MEMORY_SEARCH_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .parse(process.env)
