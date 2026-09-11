/** Discover the current text models from Loomy's generated OpenCode config. */
import { readFile } from 'node:fs/promises'
import { defaultLoomyConfigPath, LOOMY_CONFIG_FILE_ENV } from './auth.ts'

export interface LoomyModel {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  supportsImages: boolean
  reasoning: boolean
}

const FALLBACK: readonly LoomyModel[] = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 980_000, maxTokens: 384_000, supportsImages: false, reasoning: true },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: 980_000, maxTokens: 393_216, supportsImages: false, reasoning: true },
  { id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus', contextWindow: 1_000_000, maxTokens: 65_536, supportsImages: true, reasoning: true },
  { id: 'doubao-seed-2.0-pro', name: 'Doubao Seed 2.0 Pro', contextWindow: 262_144, maxTokens: 131_072, supportsImages: true, reasoning: true },
  { id: 'MiniMax-M3', name: 'MiniMax M3', contextWindow: 1_048_576, maxTokens: 512_000, supportsImages: true, reasoning: true },
]

function positive(value: unknown, fallback: number): number { return typeof value === 'number' && value > 0 ? value : fallback }

export function parseLoomyModels(text: string): readonly LoomyModel[] {
  try {
    const document: unknown = JSON.parse(text)
    if (typeof document !== 'object' || document === null || Array.isArray(document)) return FALLBACK
    const provider = (document as Record<string, unknown>).provider
    if (typeof provider !== 'object' || provider === null || Array.isArray(provider)) return FALLBACK
    const imodel = (provider as Record<string, unknown>).imodel
    if (typeof imodel !== 'object' || imodel === null || Array.isArray(imodel)) return FALLBACK
    const models = (imodel as Record<string, unknown>).models
    if (typeof models !== 'object' || models === null || Array.isArray(models)) return FALLBACK
    const result: LoomyModel[] = []
    for (const [id, value] of Object.entries(models as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
      const model = value as Record<string, unknown>
      const modalities = model.modalities as Record<string, unknown> | undefined
      const input = Array.isArray(modalities?.input) ? modalities.input : []
      // DSH is a chat surface: do not expose image-generation-only rows.
      const output = Array.isArray(modalities?.output) ? modalities.output : ['text']
      if (!output.includes('text')) continue
      const limit = model.limit as Record<string, unknown> | undefined
      result.push({
        id,
        name: typeof model.name === 'string' && model.name.trim() !== '' ? model.name : id,
        contextWindow: positive(limit?.context, 128_000),
        maxTokens: positive(limit?.output, 16_384),
        supportsImages: input.includes('image'),
        reasoning: model.reasoning === true || typeof model.variants === 'object',
      })
    }
    return result.length === 0 ? FALLBACK : result
  } catch { return FALLBACK }
}

export class LoomyCatalog {
  private models: readonly LoomyModel[] = FALLBACK
  current(): readonly LoomyModel[] { return this.models }
  async refresh(configFile?: string): Promise<void> {
    const path = configFile ?? process.env[LOOMY_CONFIG_FILE_ENV] ?? defaultLoomyConfigPath()
    this.models = parseLoomyModels(await readFile(path, 'utf8'))
  }
}
