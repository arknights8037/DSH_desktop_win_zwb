import { expect, it, vi } from 'vitest'
import { discoverSourceModels } from '../src/model-discovery.ts'
import { modelSourceId, type ModelSource } from '../src/model-sources.ts'

const source: ModelSource = { id: modelSourceId('aabbccdd-1234-4321-8123-123456789012'), name: 'Fixture',
  baseURL: 'https://provider.test/v1/', protocol: 'openai-completions', models: ['existing'], contextWindow: 128000, maxTokens: 4096 }
it.each(['openai-completions', 'openai-responses'] as const)('lists %s models with bearer authentication and no redirects', async (protocol) => {
  const send = vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: 'model-a' }, { id: 'model-a' }, { id: 'model-b' }] }))
  expect(await discoverSourceModels({ ...source, protocol }, 'fixture-key', send)).toEqual(['model-a', 'model-b'])
  expect(send.mock.calls[0]![0]).toBe('https://provider.test/v1/models')
  expect(send.mock.calls[0]![1]).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer fixture-key' } })
})
it('uses Anthropic headers and follows model pages without duplicating v1', async () => {
  const send = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ data: [{ id: 'claude-a' }], has_more: true, last_id: 'claude-a' }))
    .mockResolvedValueOnce(Response.json({ data: [{ id: 'claude-b' }], has_more: false }))
  expect(await discoverSourceModels({ ...source, protocol: 'anthropic-messages', baseURL: 'https://provider.test' }, 'fixture-key', send)).toEqual(['claude-a', 'claude-b'])
  expect(send.mock.calls[0]![0]).toBe('https://provider.test/v1/models')
  expect(send.mock.calls[1]![0]).toBe('https://provider.test/v1/models?after_id=claude-a')
  expect(send.mock.calls[0]![1]!.headers).toMatchObject({ 'x-api-key': 'fixture-key', 'anthropic-version': '2023-06-01' })
})
it('returns large catalogs for selection and rejects empty, malformed, unauthorized and non-advancing pages without exposing keys', async () => {
  const send = vi.fn<typeof fetch>(async () => Response.json({ data: Array.from({ length: 300 }, (_, i) => ({ id: `model-${i}` })) }))
  expect(await discoverSourceModels(source, 'fixture-key', send)).toHaveLength(300)
  for (const response of [new Response('fixture-key', { status: 401 }), Response.json({ models: [] }), Response.json({ data: [] }), Response.json({ data: [{ id: '\u0000' }] })]) {
    await expect(discoverSourceModels(source, 'fixture-key', async () => response)).rejects.toThrow()
  }
  await expect(discoverSourceModels(source, 'fixture-key', async () => { throw new Error('failure fixture-key') })).rejects.toThrow('failure [redacted]')
  await expect(discoverSourceModels({ ...source, protocol: 'anthropic-messages' }, 'fixture-key', async () => Response.json({ data: [], has_more: true }))).rejects.toThrow('pagination')
})
