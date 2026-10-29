/** Authenticated model catalogs fetched by the main process without returning API keys. */
import type { ModelSource } from './model-sources.ts'

/**
 * Retrieve and validate every model ID advertised by a configured endpoint.
 * @param source - Validated endpoint and protocol; existing model IDs are not sent.
 * @param key - Decrypted saved key or an unsaved replacement key.
 * @param fetcher - Main-process network transport.
 * @returns Unique model IDs in the service's order; rejects incomplete or empty catalogs.
 */
export async function discoverSourceModels(source: ModelSource, key: string, fetcher: typeof fetch): Promise<string[]> {
  if (!key || key.length > 8192 || /[\r\n]/u.test(key)) throw new Error('A valid API key is required')
  const url = new URL(source.baseURL)
  const anthropic = source.protocol === 'anthropic-messages'
  const base = url.pathname.replace(/\/+$/u, '')
  url.pathname = `${base}${anthropic && !base.endsWith('/v1') ? '/v1' : ''}/models`
  const headers: Record<string, string> = anthropic
    ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', accept: 'application/json' }
    : { authorization: `Bearer ${key}`, accept: 'application/json' }
  const models = new Set<string>()
  const cursors = new Set<string>()
  const signal = AbortSignal.timeout(20_000)
  try {
    while (true) {
      const response = await fetcher(url.href, { headers, redirect: 'error', signal })
      if (!response.ok) throw new Error(`Model catalog request failed (${response.status})`)
      const body: unknown = await response.json()
      if (typeof body !== 'object' || body === null || !('data' in body) || !Array.isArray(body.data)) {
        throw new Error('Invalid model catalog response')
      }
      const items: unknown[] = body.data
      for (const item of items) {
        if (typeof item !== 'object' || item === null || !('id' in item) || typeof item.id !== 'string'
          || !item.id.trim() || item.id.length > 256 || /[\x00-\x1f\x7f]/u.test(item.id)) throw new Error('Invalid model ID in catalog')
        models.add(item.id.trim())
      }
      if (models.size > 4096) throw new Error('Model catalog exceeds 4096 entries')
      if (!anthropic || !('has_more' in body) || body.has_more !== true) break
      if (!('last_id' in body) || typeof body.last_id !== 'string' || !body.last_id || cursors.has(body.last_id)) {
        throw new Error('Invalid model catalog pagination')
      }
      cursors.add(body.last_id)
      url.searchParams.set('after_id', body.last_id)
    }
    if (!models.size) throw new Error('The endpoint returned no available models')
    return [...models]
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Model catalog request failed'
    throw new Error(message.split(key).join('[redacted]'))
  }
}
