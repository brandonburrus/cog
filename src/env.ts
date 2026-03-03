import { z } from 'zod'

export const env = z
  .object({
    MEMORY_PATH: z.string().default('~/.config/opencode/memory'),
    PINECONE_INDEX_NAME: z.string().default('cog-memory'),
    OLLAMA_EMBEDDING_MODEL: z.string().default('qwen3-embedding:8b'),
    MEMORY_SEARCH_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
    PINECONE_HOST: z.string().default('http://localhost:5081'),
  })
  .parse(process.env)
