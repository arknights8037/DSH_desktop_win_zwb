import { expect, it, vi } from 'vitest'
import { instanceSettings } from '../src/manager-settings.ts'
import { DEFAULT_SHORTCUTS, parseShortcuts, shortcutBinding } from '../src/manager-shortcuts.ts'
import { modelSourceId, sourceRoute } from '../src/model-sources.ts'

it('updates only owned provider paths and unsets deleted sources without replacing other providers', async () => {
  const fetcher = transport()
  const id = modelSourceId('aabbccdd-1234-4321-8123-123456789012')
  const removed = modelSourceId('bbccddee-1234-4321-8123-123456789012')
  const source = { id, name: 'Private API', protocol: 'anthropic-messages', baseURL: 'https://gateway.test',
    models: ['claude-fixture'], contextWindow: 128000, maxTokens: 4096 }
  await instanceSettings(fetcher, 'dsh-app://app/', 'sources', { sources: [source], removed: [removed], revision: 3 })
  const envelope = await fetcher.mock.calls[0]![0].json() as { payload: { args: { ops: unknown[] } } }
  expect(envelope.payload.args.ops).toMatchObject([
    { op: 'set', path: ['providers', sourceRoute(id)], value: { api: 'anthropic-messages', models: [{ id: 'claude-fixture' }] } },
    { op: 'unset', path: ['providers', sourceRoute(removed)] },
  ])
  await expect(instanceSettings(fetcher, 'dsh-app://app/', 'sources', { sources: [source], removed: ['openai'], revision: 3 })).rejects.toThrow('ID')
})

function transport(value: unknown = {}) {
  return vi.fn(async (request: Request) => {
    const envelope = await request.clone().json() as { rpcId: string }
    return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value } })
  })
}
it('uses the selected instance API and preserves settings revisions', async () => {
  const fetcher = transport({ revision: 9 })
  expect(await instanceSettings(fetcher, 'https://instance.test/', 'update', {
    namespace: 'ui-theme', field: 'preference', value: 'dark', revision: 8,
  })).toEqual({ revision: 9 })
  const request = fetcher.mock.calls[0]![0]
  expect(request.url).toBe('https://instance.test/api/settings/mutate')
  expect(request.headers.get('origin')).toBe('https://instance.test')
})
it('refuses arbitrary RPC names, fields, and unfenced edits before dispatch', async () => {
  const fetcher = transport()
  await expect(instanceSettings(fetcher, 'https://instance.test/', 'execute', {})).rejects.toThrow('Unsupported')
  for (const input of [
    { namespace: 'ui-theme', field: 'secret', revision: 1 },
    { namespace: 'ui-theme', field: 'fontSize' },
    { namespace: 'other', field: 'preference', revision: 1 },
    { namespace: 'llm-deepseek', edits: { apiKey: 'secret' }, revision: 1 },
    { namespace: 'llm-deepseek', edits: {}, revision: 1 },
  ]) await expect(instanceSettings(fetcher, 'https://instance.test/', 'update', input)).rejects.toThrow('Invalid')
  expect(fetcher).not.toHaveBeenCalled()
})
it('sends related model fields in one revision-fenced mutation', async () => {
  const fetcher = transport({ revision: 2 })
  await instanceSettings(fetcher, 'dsh-app://app/', 'update', {
    namespace: 'llm-deepseek', edits: { protocol: 'messages', baseURL: 'https://gateway.test/anthropic' }, revision: 1,
  })
  const envelope = await fetcher.mock.calls[0]![0].json() as { payload: { args: unknown } }
  expect(envelope.payload.args).toEqual({
    ns: 'llm-deepseek', expectedRevision: 1, ops: [
      { op: 'set', path: ['protocol'], value: 'messages' },
      { op: 'set', path: ['baseURL'], value: 'https://gateway.test/anthropic' },
    ],
  })
})
it('reads only credential metadata and writes or removes one named reference', async () => {
  const fetcher = transport({ DEMO_KEY: { configured: true, writable: true } })
  expect(await instanceSettings(fetcher, 'dsh-app://app/', 'credentialInfo', { ref: 'DEMO_KEY' })).toEqual({ DEMO_KEY: { configured: true, writable: true } })
  await instanceSettings(fetcher, 'dsh-app://app/', 'credentialSet', { ref: 'DEMO_KEY', value: 'fixture-only' })
  await instanceSettings(fetcher, 'dsh-app://app/', 'credentialRemove', { ref: 'DEMO_KEY' })
  expect(fetcher.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual(['/api/credentials/describe', '/api/credentials/set', '/api/credentials/unset'])
  await expect(instanceSettings(fetcher, 'dsh-app://app/', 'credentialSet', { ref: '../bad', value: 'x' })).rejects.toThrow('name')
  await expect(instanceSettings(fetcher, 'dsh-app://app/', 'credentialSet', { ref: 'KEY', value: '' })).rejects.toThrow('value')
})
it('rejects mismatched envelopes and surfaces conflicts without echoing a submitted key', async () => {
  const refused = async (request: Request) => {
    const envelope = await request.json() as { rpcId: string }
    return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result: { ok: false, error: { message: 'Rejected fixture-key' } } })
  }
  await expect(instanceSettings(refused, 'dsh-app://app/', 'credentialSet', { ref: 'KEY', value: 'fixture-key' })).rejects.toThrow('Rejected [redacted]')
  await expect(instanceSettings(async () => Response.json({ type: 'server-response', rpcId: 'wrong' }), 'dsh-app://app/', 'read', {})).rejects.toThrow('response')
  await expect(instanceSettings(async () => new Response(null, { status: 401 }), 'https://instance.test/', 'read', {})).rejects.toThrow('401')
})
it('accepts distinct shortcuts, supports disabling, and rejects collisions or bare typing keys', () => {
  expect(parseShortcuts({ ...DEFAULT_SHORTCUTS, close: '' }).close).toBe('')
  expect(() => parseShortcuts({ ...DEFAULT_SHORTCUTS, close: DEFAULT_SHORTCUTS.add })).toThrow('already assigned')
  expect(() => parseShortcuts({ ...DEFAULT_SHORTCUTS, add: 'T' })).toThrow('Invalid')
  expect(() => parseShortcuts({ ...DEFAULT_SHORTCUTS, add: 'Shift+T' })).toThrow('Invalid')
  expect(() => parseShortcuts({ ...DEFAULT_SHORTCUTS, add: 'Ctrl+Ctrl+T' })).toThrow('Invalid')
  expect(shortcutBinding({ key: 't', control: true, alt: false, shift: true, meta: false, isComposing: false })).toBe('Ctrl+Shift+T')
  expect(shortcutBinding({ key: 't', control: true, alt: false, shift: false, meta: false, isComposing: true })).toBe('')
})
