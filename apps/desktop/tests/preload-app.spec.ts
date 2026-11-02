import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_IPC, type DshDesktopStartupApi } from '../src/ipc.ts'
import { INSTANCE_OPEN_SETTINGS, INSTANCE_OPEN_PLUGINS } from '../src/manager-ipc.ts'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}))
vi.mock('electron', () => electron)

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules() })

it.each(['dsh-app://app/index.html', 'https://shell/startup.html'])('exposes only settings navigation to %s', async (url) => {
  vi.stubGlobal('location', new URL(url))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as { protocolVersion: number; openSettings: () => Promise<void> }
  expect(Object.keys(api)).toEqual(['protocolVersion', 'openSettings'])
  await api.openSettings()
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(INSTANCE_OPEN_SETTINGS)
})

it('provides startup controls and a removable state subscription to shell documents', async () => {
  vi.stubGlobal('location', new URL('dsh-app://shell/startup.html'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as DshDesktopStartupApi
  await api.locale()
  await api.backend.status()
  await api.disablePlugins()
  await api.resetConfiguration()
  await api.restart()
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
    [DESKTOP_IPC.localeGet], [DESKTOP_IPC.backendStatus],
    [DESKTOP_IPC.pluginsDisableAll], [DESKTOP_IPC.configurationReset], [DESKTOP_IPC.applicationRestart],
  ])
  const listener = vi.fn()
  const dispose = api.backend.subscribe(listener)
  const handler = electron.ipcRenderer.on.mock.calls[0]?.[1] as (event: unknown, state: unknown) => void
  handler({}, { phase: 'error', message: 'startup failed' })
  expect(listener).toHaveBeenCalledWith({ phase: 'error', message: 'startup failed' })
  dispose()
  expect(electron.ipcRenderer.off).toHaveBeenCalledWith(DESKTOP_IPC.backendState, handler)
  expect(api).not.toHaveProperty('plugins')
})

it('exposes plugin navigation only to local instance documents', async () => {
  vi.stubGlobal('location', new URL('dsh-app://app/index.html'))
  await import('../src/preload-app.ts')
  const bridge = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === '__DSH_PLUGIN_NAVIGATION__')?.[1]
  expect(Object.keys(bridge)).toEqual(['openList', 'openBundle'])
  await bridge.openList()
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(INSTANCE_OPEN_PLUGINS, 'native')
  await bridge.openBundle('@scope/plugin')
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(INSTANCE_OPEN_PLUGINS, {
    mode: 'bundle', packageName: '@scope/plugin',
  })
  vi.resetModules(); vi.clearAllMocks()
  vi.stubGlobal('location', new URL('https://remote.example/'))
  await import('../src/preload-app.ts')
  expect(electron.contextBridge.exposeInMainWorld.mock.calls.some(([name]) => name === '__DSH_PLUGIN_NAVIGATION__')).toBe(false)
})
