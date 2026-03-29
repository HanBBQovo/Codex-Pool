import type { ModelSchema } from '@/api/models'

export interface ModelRow {
  id: string
  name: string
  provider: string
  status: ModelSchema['availability_status']
  inputPriceMicrocredits: number | null
  outputPriceMicrocredits: number | null
  maxContextTokens: number | null
}

export function mapModelsToRows(models: ModelSchema[]): ModelRow[] {
  return models.map((model) => ({
    id: model.id,
    name: model.official?.title || model.id,
    provider: model.owned_by,
    status: model.availability_status,
    inputPriceMicrocredits:
      model.effective_pricing.input_price_microcredits
      ?? model.official?.input_price_microcredits
      ?? null,
    outputPriceMicrocredits:
      model.effective_pricing.output_price_microcredits
      ?? model.official?.output_price_microcredits
      ?? null,
    maxContextTokens: model.official?.context_window_tokens ?? null,
  }))
}
