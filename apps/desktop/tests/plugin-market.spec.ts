import { describe, expect, it, vi } from 'vitest'
import { inspectPluginInstall, queryPluginCatalog } from '../src/plugin-market.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import type { DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'

const runtime: DesktopRuntimeDescriptor = {
  schemaVersion: 1, platform: 'win32', arch: 'x64', files: [],
  release: { schemaVersion: 1, version: '0.1.6-alpha.1', nodeVersion: '24.17.0', pnpmVersion: '11.7.0', hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION },
  sharedPackages: [{ name: '@deepseek-ai/cordis', version: '4.0.1', path: 'node_modules/@deepseek-ai/cordis' }],
}
const manifest = {
  name: '@test/plugin', version: '1.2.3', description: 'Example', license: 'MIT',
  repository: { url: 'git+https://github.com/example/plugin.git' },
  dsh: { bundle: { patch: './cordis.patch.yml' }, plugin: { permissions: ['network'] } },
  engines: { dsh: '>=0.1.6-alpha.0', node: '>=24' },
  peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
  scripts: { preinstall: 'node setup.js', postinstall: 'node build.js' },
  dist: { integrity: 'sha512-example' },
}
function response(data: unknown): typeof fetch {
  return vi.fn(async () => Response.json(data))
}

describe('Desktop registry preflight', () => {
  it('resolves arbitrary tags once and projects exact versions and declared access', async () => {
    const fetcher = response(manifest)
    const plan = await inspectPluginInstall('@test/plugin@next', runtime, 'snapshot', fetcher)
    expect(fetcher).toHaveBeenCalledWith('https://registry.npmjs.org/%40test%2Fplugin/next', expect.anything())
    expect(plan).toMatchObject({ name: '@test/plugin', version: '1.2.3', license: 'MIT', repository: 'https://github.com/example/plugin',
      compatibility: 'compatible', permissions: ['network'], scripts: ['preinstall', 'postinstall'], integrity: 'sha512-example', blockers: [] })
    expect(plan.requirements.map(item => item.actual)).toEqual(['0.1.6-alpha.1', '24.17.0', '4.0.1'])
  })

  it.each([
    { engines: { dsh: '^9.0.0' }, expected: 'incompatible' },
    { engines: { node: '>=30' }, expected: 'incompatible' },
    { engines: { dsh: 'invalid' }, expected: 'unknown' },
    { engines: {}, expected: 'unknown' },
  ])('reports $expected from engine requirements without guessing', async ({ engines, expected }) => {
    expect((await inspectPluginInstall('@test/plugin', runtime, 'snapshot', response({ ...manifest, engines, peerDependencies: {} }))).compatibility).toBe(expected)
  })

  it('preserves unknown peers, undeclared permissions, and unsafe repository omission', async () => {
    const plan = await inspectPluginInstall('@test/plugin', runtime, 'snapshot', response({ ...manifest,
      dsh: { bundle: { patch: 'patch.yml' } }, repository: 'javascript:alert(1)', peerDependencies: { missing: '^1' },
    }))
    expect(plan.permissions).toBeUndefined()
    expect(plan.repository).toBeUndefined()
    expect(plan.compatibility).toBe('unknown')
  })

  it.each([
    { name: 'other', version: '1.2.3' }, { name: '@test/plugin', version: 'bad' }, [],
    { name: '@test/plugin', version: '1.2.4' },
  ])('rejects inconsistent registry manifests', async (value) => {
    await expect(inspectPluginInstall('@test/plugin@1.2.3', runtime, 'snapshot', response(value))).rejects.toThrow('invalid manifest')
  })

  it('rejects non-registry package specs before network access', async () => {
    const fetcher = response(manifest)
    await expect(inspectPluginInstall('https://example.com/plugin.tgz', runtime, 'snapshot', fetcher)).rejects.toThrow('unsupported')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('identifies missing Bundles, runtime-owned packages and the HTTP-only market', async () => {
    expect((await inspectPluginInstall('@test/plugin', runtime, 'snapshot', response({ ...manifest, dsh: {} }))).blockers).toEqual(['missing-bundle'])
    expect((await inspectPluginInstall('@deepseek-ai/cordis', runtime, 'snapshot', response({ ...manifest, name: '@deepseek-ai/cordis' }))).blockers).toEqual(['host-owned'])
    expect((await inspectPluginInstall('dshmarket', runtime, 'snapshot', response({ ...manifest, name: 'dshmarket' }))).blockers).toEqual(['web-server-required'])
  })
})

const entry = { name: 'Example', owner: 'example', url: 'https://github.com/example/plugin', category: ['tools', 'dev'],
  description: { en: 'Example tools', zh: '示例工具' }, npm: '@test/plugin', capabilities: [], install: 'do not execute this command' }

describe('shared awesome-dsh-plugin / dshmarket catalog', () => {
  it('preserves Git-only entries and distinguishes unscanned from empty scans', async () => {
    const catalog = await queryPluginCatalog(response({ updated: '2026-10-17',
      plugins: [entry, { ...entry, name: 'Git', npm: null, category: 'tools', capabilities: undefined }],
      categories: { tools: { en: 'Tools', zh: '工具' } } }), 'https://example.com/catalog.json')
    expect(catalog.plugins).toMatchObject([{ npm: '@test/plugin', capabilities: [] }, { name: 'Git', categories: ['tools'] }])
    expect(catalog.plugins[1]?.npm).toBeUndefined()
    expect(catalog.plugins[1]?.capabilities).toBeUndefined()
    expect(catalog.plugins[0]).not.toHaveProperty('install')
    expect(catalog.categories.tools?.zh).toBe('工具')
  })

  it.each([
    {}, { plugins: [{}] }, { plugins: [{ ...entry, npm: 'plugin@latest' }] },
    { plugins: [{ ...entry, url: 'file:///etc/passwd' }] },
    { plugins: [{ ...entry, category: [123] }] },
  ])('rejects malformed catalog entries', async (value) => {
    await expect(queryPluginCatalog(response(value), 'https://example.com/catalog.json')).rejects.toThrow('Plugin catalog')
  })

  it('tries the published catalog mirror after primary failure and identifies the actual source', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ plugins: [entry] }))
    expect((await queryPluginCatalog(fetcher)).source).toBe('https://cdn.jsdelivr.net/npm/dsh-plugin-catalog@latest/plugins.json')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('reports both failed sources and does not fall back from an operator-selected catalog', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }))
    await expect(queryPluginCatalog(fetcher)).rejects.toThrow('cdn.jsdelivr.net')
    fetcher.mockClear()
    await expect(queryPluginCatalog(fetcher, 'https://example.com/catalog.json')).rejects.toThrow('HTTP 503')
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(queryPluginCatalog(fetcher, 'http://example.com/catalog.json')).rejects.toThrow('HTTPS')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
