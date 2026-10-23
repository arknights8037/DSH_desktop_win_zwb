/** Narrow desktop access to the instance-owned DSH settings and credential APIs. */
import { randomUUID } from 'node:crypto'
import { modelSourceId, parseModelSource, sourceProfile, sourceRoute } from './model-sources.ts'

/** Operations exposed by the manager without exposing an arbitrary RPC dispatcher. */
export type InstanceSettingsAction = 'read' | 'update' | 'sources' | 'credentialInfo' | 'credentialSet' | 'credentialRemove'

/** Editable product fields; the instance remains responsible for schema validation and persistence. */
const fields: Record<string, readonly string[]> = {
  'ui-theme': ['preference', 'fontSize'], locale: ['preference'], 'ui-conversation': ['busyEnter'],
  'ui-chat': ['transcriptView'], 'agent-presets': ['default', 'modeSelectionEnabled'],
  'llm-deepseek': ['protocol', 'baseURL', 'apiKeyEnv', 'maxTokens', 'reasoningEffort'],
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid settings response')
  return value as Record<string, unknown>
}

/**
 * Call one supported instance API, validating the IPC input and RPC response envelope.
 * @param fetcher - authenticated transport belonging to the selected instance.
 * @param base - instance URL, without sharing it with the manager renderer.
 * @param action - supported settings or credential operation.
 * @param input - untrusted manager payload.
 * @returns the API value; credential reads contain metadata only.
 */
export async function instanceSettings(
  fetcher: (request: Request) => Promise<Response>, base: string, action: unknown, input: unknown,
): Promise<unknown> {
  const args = record(input)
  let endpoint: string
  let values: Record<string, unknown>
  switch (action) {
    case 'read': endpoint = 'settings/describe'; values = {}; break
    case 'sources': {
      if (!Array.isArray(args.sources) || !Array.isArray(args.removed)
        || !Number.isSafeInteger(args.revision) || Number(args.revision) < 0) throw new Error('Invalid model sources edit')
      const sources = args.sources.map(input => parseModelSource(input, modelSourceId(record(input).id)))
      const removed = args.removed.map(modelSourceId)
      if (sources.some(source => removed.includes(source.id)) || !sources.length && !removed.length) {
        throw new Error('Invalid model sources edit')
      }
      endpoint = 'settings/mutate'
      values = { ns: 'llm-pi-ai', expectedRevision: args.revision, ops: [
        ...sources.map(source => ({ op: 'set', path: ['providers', sourceRoute(source.id)], value: sourceProfile(source) })),
        ...removed.map(id => ({ op: 'unset', path: ['providers', sourceRoute(id)] })),
      ] }
      break
    }
    case 'update': {
      const ns = args.namespace
      const edits = args.edits === undefined ? { [String(args.field)]: args.value } : record(args.edits)
      if (typeof ns !== 'string' || !Object.hasOwn(fields, ns) || !Object.keys(edits).length
        || Object.keys(edits).some(field => !fields[ns]?.includes(field))
        || !Number.isSafeInteger(args.revision) || Number(args.revision) < 0) throw new Error('Invalid settings edit')
      endpoint = 'settings/mutate'
      values = { ns, ops: Object.entries(edits).map(([field, value]) => ({ op: 'set', path: [field], value })),
        expectedRevision: args.revision }
      break
    }
    case 'credentialInfo': case 'credentialSet': case 'credentialRemove': {
      if (typeof args.ref !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(args.ref) || args.ref.length > 256) throw new Error('Invalid credential name')
      if (action === 'credentialInfo') { endpoint = 'credentials/describe'; values = { refs: [args.ref] }; break }
      if (action === 'credentialRemove') { endpoint = 'credentials/unset'; values = { ref: args.ref }; break }
      if (typeof args.value !== 'string' || !args.value || args.value.length > 8192) throw new Error('Invalid credential value')
      endpoint = 'credentials/set'; values = { ref: args.ref, value: args.value }; break
    }
    default: throw new Error('Unsupported settings operation')
  }
  const rpcId = randomUUID()
  const response = await fetcher(new Request(new URL(`/api/${endpoint}`, base), {
    method: 'POST', headers: { 'content-type': 'application/json', origin: new URL(base).origin },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args: values } }),
    signal: AbortSignal.timeout(20_000),
  }))
  if (!response.ok) throw new Error(`Instance settings request failed (${response.status})`)
  const envelope = record(await response.json())
  if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId) throw new Error('Invalid settings response')
  const result = record(envelope.result)
  if (result.ok !== true) {
    const error = record(result.error)
    let message = typeof error.message === 'string' ? error.message : 'Instance rejected settings operation'
    if (action === 'credentialSet' && typeof args.value === 'string') message = message.split(args.value).join('[redacted]')
    throw new Error(message)
  }
  return result.value
}
