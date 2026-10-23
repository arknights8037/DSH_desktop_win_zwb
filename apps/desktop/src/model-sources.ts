/** Non-secret model service definitions shared by desktop-managed instances. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable owner key for one desktop model source and its credential. */
export type ModelSourceId = Branded<'DesktopModelSourceId'>
/** One independently configured API endpoint with its explicit model catalog. */
export interface ModelSource {
  id: ModelSourceId
  name: string
  protocol: 'openai-completions' | 'openai-responses' | 'anthropic-messages'
  baseURL: string
  models: string[]
  contextWindow: number
  maxTokens: number
}
/** Public source metadata never includes the saved API key. */
export interface ModelSourceView extends ModelSource { keyConfigured: boolean }

/**
 * Validate a source owner key from IPC or disk.
 * @param value - untrusted source identifier.
 * @returns the validated identifier.
 */
export function modelSourceId(value: unknown): ModelSourceId {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    throw new Error('Invalid model source ID')
  }
  return value as ModelSourceId
}
/**
 * Validate non-secret source configuration, including an explicit catalog for custom endpoints.
 * @param input - untrusted form or persisted source.
 * @param id - source owner assigned by the software.
 * @returns a detached validated source.
 */
export function parseModelSource(input: unknown, id: ModelSourceId): ModelSource {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Invalid model source')
  const row = input as Record<string, unknown>
  if (Object.keys(row).some(key => !['id', 'name', 'protocol', 'baseURL', 'models', 'contextWindow', 'maxTokens'].includes(key))
    || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 100
    || typeof row.protocol !== 'string' || !['openai-completions', 'openai-responses', 'anthropic-messages'].includes(row.protocol)
    || typeof row.baseURL !== 'string' || row.baseURL.length > 4096
    || !Array.isArray(row.models) || !row.models.length || row.models.length > 256
    || row.models.some(model => typeof model !== 'string' || !model.trim() || model.length > 256 || /[\x00-\x1f\x7f]/u.test(model))
    || typeof row.contextWindow !== 'number' || !Number.isSafeInteger(row.contextWindow) || row.contextWindow < 1
    || typeof row.maxTokens !== 'number' || !Number.isSafeInteger(row.maxTokens) || row.maxTokens < 1
    || row.maxTokens > row.contextWindow) throw new Error('Invalid model source')
  const url = new URL(row.baseURL)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Model source URL must be HTTP(S) without credentials, query, or fragment')
  }
  const models = (row.models as string[]).map(model => model.trim())
  if (new Set(models).size !== models.length) throw new Error('Duplicate model IDs in source')
  return { id, name: row.name.trim(), protocol: row.protocol as ModelSource['protocol'], baseURL: row.baseURL.trim(),
    models, contextWindow: row.contextWindow, maxTokens: row.maxTokens }
}
/**
 * Derive a provider route reserved for one software-owned source.
 * @param id - source owner key.
 * @returns the route used by the DSH model registry.
 */
export function sourceRoute(id: ModelSourceId): string { return `desktop-${id}` }
/**
 * Derive a credential reference isolated from standalone keys and other sources.
 * @param id - source owner key.
 * @returns the key reference delivered to instance credential providers.
 */
export function sourceKeyRef(id: ModelSourceId): string { return `DSH_SOURCE_${id.replaceAll('-', '').toUpperCase()}_API_KEY` }
/**
 * Project a source into the existing DSH pi-ai provider configuration.
 * @param source - validated non-secret source configuration.
 * @returns the complete managed provider profile, without plaintext credentials.
 */
export function sourceProfile(source: ModelSource): Record<string, unknown> {
  return { displayName: source.name, api: source.protocol, baseURL: source.baseURL, apiKeyEnv: sourceKeyRef(source.id),
    models: source.models.map(id => ({ id, contextWindow: source.contextWindow, maxTokens: source.maxTokens })) }
}
