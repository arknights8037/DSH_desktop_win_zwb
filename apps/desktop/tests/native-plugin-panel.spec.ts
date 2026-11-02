import type { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { installNativePluginPanel } from '../../desktop-host/src/native-plugin-panel.ts'

it('exposes plugin data and revision-fenced commands without mounting the kernel page', async () => {
  let activePanelId: string | null = 'chat'
  let listener = () => {}
  const effects: (() => void)[] = []
  const dispose = () => { for (const effect of effects.splice(0).reverse()) effect() }
  const unsubscribe = vi.fn()
  const setBundleEnabled = vi.fn(async () => ({ ok: true, value: { application: 'restart-required' } }))
  const setPluginEnabled = vi.fn(async () => ({ ok: false, error: { code: 'unaddressable' } }))
  const mutate = vi.fn(async () => true)
  const openList = vi.fn(async () => {})
  const bridgeTarget = globalThis as typeof globalThis & {
    __DSH_DESKTOP_PLUGINS__?: {
      read(): Promise<{ bundles: Array<{ title: string }>; configurations: Array<{ ns: string; title: string }> }>
      toggle(input: { kind: 'bundle' | 'row'; target: string; enabled: boolean }): Promise<unknown>
      configuration(input: { target: string }): Promise<unknown>
      configure(input: { target: string; revision: number; ops: unknown[] }): Promise<void>
    }
  }
  const openBundle = vi.fn(async () => {})
  vi.stubGlobal('__DSH_PLUGIN_NAVIGATION__', { openList, openBundle })
  const provide = vi.fn(() => vi.fn())
  const register = vi.fn(() => vi.fn())
  const services = {
    layout: {
      panelInfo: { getSnapshot: () => ({ activePanelId }), subscribe: (next: () => void) => { listener = next; return unsubscribe } },
      selectPanel: (id: string | null) => { activePanelId = id; listener() },
    },
    remote: { pluginManager: {
      listBundles: async () => ({ ok: true, value: [{ name: 'meter', meta: { title: 'Cost meter' }, rows: [] }] }),
      listPlugins: async () => ({ ok: true, value: [] }), setBundleEnabled, setPluginEnabled,
    } },
    configForms: {
      describe: () => ({ ensure: async () => {}, getSnapshot: () => ({ view: {
        namespaces: [{ ns: 'terminal', revision: 7, value: { enabled: true }, schema: {} }], writable: true,
      } }) }),
      get: () => ({ mutate }),
    },
    slots: { entries: () => [{ options: { id: 'terminal', label: () => 'Terminal' } }], register,
      inject: (_name: string, setup: () => () => void) => { effects.push(setup()) } },
  }
  const ctx = {
    get: (name: keyof typeof services) => services[name],
    locale: { resolveText: (text: string) => text },
    slots: services.slots,
    reflect: { provide },
    effect: (setup: () => () => void) => { effects.push(setup()) },
    logger: { warn: vi.fn() },
  }
  try {
    installNativePluginPanel(ctx as unknown as Context)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ name: 'main', key: 'plugins',
      children: expect.objectContaining({ 'plugins.item': { kind: 'list', scope: 'root' } }) }), expect.any(Function))
    const navigation = provide.mock.calls[0] as unknown as [string, { openBundle(name: string): void }]
    navigation[1].openBundle('meter')
    expect(openBundle).toHaveBeenCalledWith('meter')
    const bridge = bridgeTarget.__DSH_DESKTOP_PLUGINS__!
    expect(await bridge.read()).toMatchObject({ bundles: [{ title: 'Cost meter' }], configurations: [{ ns: 'terminal', title: 'Terminal' }] })
    expect(await bridge.configuration({ target: 'terminal' })).toMatchObject({ revision: 7, writable: true })
    await expect(bridge.configuration({ target: 'missing' })).rejects.toThrow('unavailable')
    expect(await bridge.toggle({ kind: 'bundle', target: 'meter', enabled: false })).toEqual({ restartRequired: true })
    expect(setBundleEnabled).toHaveBeenCalledWith('meter', false)
    await expect(bridge.toggle({ kind: 'row', target: 'row-id', enabled: false })).rejects.toThrow('unaddressable')
    const ops = [{ op: 'set', path: ['enabled'], value: false }]
    await bridge.configure({ target: 'terminal', revision: 7, ops })
    expect(mutate).toHaveBeenCalledWith(ops, 7)
    mutate.mockResolvedValueOnce(false)
    await expect(bridge.configure({ target: 'terminal', revision: 7, ops })).rejects.toThrow('rejected')
    services.layout.selectPanel('plugins')
    expect(activePanelId).toBe('chat')
    expect(openList).toHaveBeenCalledOnce()
    dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(bridgeTarget.__DSH_DESKTOP_PLUGINS__).toBeUndefined()
  } finally { dispose(); vi.unstubAllGlobals() }
})
