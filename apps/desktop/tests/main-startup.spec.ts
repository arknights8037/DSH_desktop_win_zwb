import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MANAGER_CHANNEL, MANAGER_SHORTCUT, INSTANCE_OPEN_SETTINGS, type ManagerSnapshot } from '../src/manager-ipc.ts'
import type { SoftwareSettingsSnapshot } from '../src/software-settings.ts'
import { sourceRoute, sourceKeyRef } from '../src/model-sources.ts'
import type { InstanceConfig } from '../src/instances.ts'
import { DESKTOP_IPC } from '../src/ipc.ts'
import type { DesktopPluginInstallPlan } from '../src/plugin-market.ts'
import type { DesktopPluginRecord } from '../src/project-manager.ts'
import { DEFAULT_PERSONAL_APPEARANCE } from '../src/personal-appearance.ts'
import Schema from '@deepseek-ai/schemastery'
import { mixedSettingsDocument } from './settings-fixtures.ts'

const harness = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const { fileURLToPath } = await import('node:url')
  const { legacySettingsDocument } = await import('./settings-fixtures.ts')
  class Contents extends EventEmitter {
    url = ''
    mainFrame = { url: '' }
    destroyed = false
    send = vi.fn()
    setWindowOpenHandler = vi.fn()
    openDevTools = vi.fn()
    executeJavaScript = vi.fn()
    insertCSS = vi.fn(async () => 'appearance-style')
    removeInsertedCSS = vi.fn(async () => {})
    focus = vi.fn()
    async loadURL(url: string) { this.url = url; this.mainFrame.url = url }
    getURL() { return this.url }
    isDestroyed() { return this.destroyed }
    close() { this.destroyed = true }
  }
  class Window extends EventEmitter {
    static all: Window[] = []
    webContents = new Contents()
    contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
    constructor(readonly options: unknown) { super(); Window.all.push(this) }
    loadURL(url: string) { return this.webContents.loadURL(url) }
    getContentSize() { return [1200, 800] }
    isDestroyed() { return false }
    isMinimized() { return false }
    maximized = false
    isMaximized() { return this.maximized }
    minimize = vi.fn()
    maximize() { this.maximized = true; this.emit('maximize') }
    unmaximize() { this.maximized = false; this.emit('unmaximize') }
    restore() {}
    show() {}
    focus() {}
    close() { this.emit('closed') }
  }
  class View {
    static all: View[] = []
    webContents = new Contents()
    setBounds = vi.fn()
    setVisible = vi.fn()
    setBackgroundColor = vi.fn()
    constructor(readonly options: unknown) { View.all.push(this) }
  }
  class Local {
    static all: Local[] = []
    manager = {
      listPlugins: vi.fn<() => readonly DesktopPluginRecord[]>(() => []), dshVersion: () => '1.0.0', snapshotPath: () => 'snapshot',
      pluginRuntime: () => ({ release: { version: '1.0.0', nodeVersion: '24.17.0' }, sharedPackages: [] }),
    }
    connect = vi.fn(async () => 'dsh-app://app/index.html')
    disconnect = vi.fn(async () => {})
    stop = vi.fn(async () => {})
    mutate = vi.fn(async () => {})
    injectPlugin = vi.fn(async () => {})
    settings = legacySettingsDocument()
    credentials = new Map<string, string>()
    fetch = vi.fn(async (request: Request) => {
      if (!new URL(request.url).pathname.startsWith('/api/settings/') && !new URL(request.url).pathname.startsWith('/api/credentials/')) return new Response(this.home)
      const body = await request.json() as {
        rpcId: string
        method: string
        payload: { args: {
          ns: string
          expectedRevision: number
          ops: Array<{ op: string; path: string[]; value: unknown }>
          ref: string
          value: string
        } }
      }
      const args = body.payload.args
      let value: unknown = {}
      if (body.method === 'settings/describe') value = this.settings
      if (body.method === 'settings/mutate') {
        const section = this.settings.namespaces.find(item => item.ns === args.ns)!
        expect(args.expectedRevision).toBe(section.revision)
        for (const op of args.ops) {
          const target = op.path.length === 2 ? section.value[op.path[0]!] as Record<string, unknown> : section.value
          const field = op.path.at(-1)!
          if (op.op === 'unset') Reflect.deleteProperty(target, field)
          else target[field] = op.value
        }
        value = { revision: ++section.revision }
      }
      if (body.method === 'credentials/set') this.credentials.set(args.ref, args.value)
      if (body.method === 'credentials/unset') this.credentials.delete(args.ref)
      return Response.json({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } })
    })
    constructor(readonly home: string) { Local.all.push(this) }
  }
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const partitions = new Map<string, {
    protocol: { handle: ReturnType<typeof vi.fn>; isProtocolHandled: ReturnType<typeof vi.fn> }
    setPermissionRequestHandler: ReturnType<typeof vi.fn>
    setPermissionCheckHandler: ReturnType<typeof vi.fn>
  }>()
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true, getAppPath: () => fileURLToPath(new URL('..', import.meta.url)), getLocale: () => 'en', whenReady: () => Promise.resolve(),
    requestSingleInstanceLock: () => true, quit: vi.fn(), exit: vi.fn(),
  })
  const library = {
    list: vi.fn<() => readonly { name: string; version: string }[]>(() => []),
    install: vi.fn(async () => {}), select: vi.fn(), source: vi.fn(() => 'shell-library-profile'), remove: vi.fn(), root: 'shell-library',
    withSource: async (_name: string, _version: string, operation: (source: string) => Promise<void>) => operation('shell-library-profile'),
    withSelection: async (_name: string, _version: string, operation: () => Promise<void>) => operation(),
    settled: async () => {},
    runtime: () => ({ release: { version: '1.0.0', nodeVersion: '24.17.0' }, sharedPackages: [] }),
  }
  return { Window, View, Local, handlers, partitions, app, library, root: '', fetch: vi.fn(), openExternal: vi.fn(),
    kernelCheck: vi.fn<(install: boolean) => Promise<{ phase: 'error'; message: string } | undefined>>(), kernelInitialize: vi.fn(),
    dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn(async () => ({ response: 1 })),
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined as string | undefined })) } }
})
vi.mock('electron', () => ({
  app: harness.app, BrowserWindow: harness.Window, WebContentsView: harness.View, dialog: harness.dialog,
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => harness.handlers.set(channel, handler) },
  Menu: { setApplicationMenu: vi.fn() }, protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  net: { fetch: harness.fetch }, shell: { openExternal: harness.openExternal },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value).reverse(),
    decryptString: (value: Buffer) => Buffer.from(value).reverse().toString() },
  session: { fromPartition: (id: string) => {
    if (!harness.partitions.has(id)) harness.partitions.set(id, {
      protocol: { handle: vi.fn(), isProtocolHandled: vi.fn(() => false) },
      setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
    })
    return harness.partitions.get(id)
  } },
}))
vi.mock('../src/paths.ts', () => ({ resolveDesktopPaths: () => ({ root: harness.root }) }))
vi.mock('../src/local-instance.ts', () => ({ LocalInstance: harness.Local }))
vi.mock('../src/remote-instance.ts', () => ({ RemoteInstance: harness.Local }))
vi.mock('../src/kernel-manager.ts', () => ({ DesktopKernelManager: class {
  private enabled = true
  constructor(_root: string, private readonly bundled: unknown) {}
  initialize = async () => { await harness.kernelInitialize() }
  runtime = () => this.bundled
  snapshot = () => ({ phase: 'idle', current: '1.0.0', automatic: this.enabled, restartRequired: false })
  automatic = (enabled: boolean) => { this.enabled = enabled; return this.snapshot() }
  check = async (install = false) => (await harness.kernelCheck(install)) ?? this.snapshot()
  settled = async () => {}
} }))
vi.mock('../src/plugin-library.ts', () => ({
  DesktopPluginLibrary: vi.fn(function () { return harness.library }),
}))
function sender() {
  const contents = harness.Window.all[0]!.webContents
  return { sender: contents, senderFrame: contents.mainFrame }
}
async function invoke(operation: string, payload?: unknown): Promise<unknown> {
  return harness.handlers.get(MANAGER_CHANNEL)!(sender(), operation, payload)
}
async function create(name: string) { return await invoke('save', { config: { name, kind: 'local' } }) as InstanceConfig }
beforeEach(async () => {
  vi.resetModules()
  harness.root = mkdtempSync(join(tmpdir(), 'dsh-manager-main-'))
  harness.Window.all.length = harness.View.all.length = harness.Local.all.length = 0
  harness.handlers.clear(); harness.partitions.clear(); harness.app.removeAllListeners(); vi.clearAllMocks()
  harness.library.list.mockReturnValue([])
  harness.fetch.mockReset()
  harness.app.isPackaged = true
  harness.kernelCheck.mockReset()
  harness.kernelInitialize.mockReset()
  vi.stubGlobal('process', { ...process, resourcesPath: 'resource-root' })
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(harness.Window.all[0]?.webContents.url).toBe('dsh-app://shell/manager.html') })
})
afterEach(() => {
  harness.app.removeAllListeners(); vi.unstubAllEnvs(); vi.unstubAllGlobals()
  rmSync(harness.root, { recursive: true, force: true })
})
it('opens the manager immediately without starting any backend', async () => {
  expect(harness.Local.all).toHaveLength(0)
  expect((await invoke('snapshot') as ManagerSnapshot).instances).toEqual([])
  expect(harness.dialog.showErrorBox).not.toHaveBeenCalled()
})
it('checks for the latest kernel before opening an unpackaged manager and enables plugin injection', async () => {
  vi.resetModules()
  harness.Window.all.length = 0
  harness.handlers.clear()
  harness.app.removeAllListeners()
  harness.app.isPackaged = false
  harness.kernelCheck.mockClear()
  harness.kernelInitialize.mockClear()
  vi.stubEnv('DSH_DESKTOP_DSH_DIR', 'selected-runtime')
  vi.stubEnv('DSH_DESKTOP_KERNEL_ROOT', join(harness.root, 'kernels'))
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(harness.Window.all[0]?.webContents.url).toBe('dsh-app://shell/manager.html') })
  expect(harness.kernelCheck).toHaveBeenCalledWith(true)
  expect(harness.kernelCheck.mock.invocationCallOrder[0]).toBeLessThan(harness.kernelInitialize.mock.invocationCallOrder[0]!)
  expect(await invoke('snapshot')).toMatchObject({ packaged: false, pluginManagement: true })
  const config = await create('Development')
  await invoke('open', { id: config.id })
  await harness.handlers.get(DESKTOP_IPC.pluginsInject)!(sender(), 'test-plugin', '1.2.3', config.id)
  expect(harness.Local.all[0]!.mutate).toHaveBeenCalledWith({ type: 'plugin-inject', name: 'test-plugin', version: '1.2.3', source: 'shell-library-profile' })
})
it('keeps the development window closed when checking the latest kernel fails', async () => {
  vi.resetModules()
  harness.Window.all.length = 0
  harness.app.removeAllListeners()
  harness.app.isPackaged = false
  vi.stubEnv('DSH_DESKTOP_DSH_DIR', 'selected-runtime')
  vi.stubEnv('DSH_DESKTOP_KERNEL_ROOT', join(harness.root, 'kernels'))
  harness.kernelCheck.mockResolvedValueOnce({ phase: 'error', message: 'registry unavailable' })
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(harness.dialog.showErrorBox).toHaveBeenCalledWith('Harness Agent Manager', 'Development kernel update failed: registry unavailable') })
  expect(harness.Window.all).toHaveLength(0)
})
it('restricts kernel update operations to the manager main frame and validates settings', async () => {
  expect(await invoke('kernel', { action: 'read' })).toMatchObject({ current: '1.0.0', automatic: true })
  expect(await invoke('kernel', { action: 'automatic', visible: false })).toMatchObject({ automatic: false })
  expect(await invoke('kernel', { action: 'check' })).toMatchObject({ current: '1.0.0' })
  await expect(invoke('kernel', { action: 'automatic', visible: 'false' })).rejects.toThrow('Invalid automatic')
  await expect(invoke('kernel', { action: 'delete' })).rejects.toThrow('Unsupported kernel')
  const event = sender()
  await expect(harness.handlers.get(MANAGER_CHANNEL)!({ ...event, senderFrame: {} }, 'kernel', { action: 'install' })).rejects.toThrow('Rejected manager IPC sender')
})
it('exports validated colors through a native save dialog without changing software settings', async () => {
  const filePath = join(harness.root, 'colors.json')
  const colors = { ...DEFAULT_PERSONAL_APPEARANCE.colors, text: '#abcdef' }
  await invoke('softwareSettings', { action: 'exportColors', input: { colors } })
  expect(existsSync(filePath)).toBe(false)
  harness.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath })
  await invoke('softwareSettings', { action: 'exportColors', input: { colors } })
  expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ version: 1, colors })
  expect(await invoke('softwareSettings', { action: 'read' })).toMatchObject({ revision: 0 })
  await expect(invoke('softwareSettings', { action: 'exportColors', input: { colors: { text: 'red' } } })).rejects.toThrow('Invalid personal appearance')
})
it('isolates two local homes, browser partitions, and protocol dispatch', async () => {
  const a = await create('A')
  const b = await create('B')
  await invoke('open', { id: a.id }); await invoke('open', { id: b.id })
  expect(harness.Local.all[0]!.home).not.toBe(harness.Local.all[1]!.home)
  expect(harness.partitions.size).toBe(2)
  expect(harness.View.all).toHaveLength(2)
  const request = new Request('dsh-app://app/api/test')
  const aFetch = harness.partitions.get(`persist:dsh-instance-${a.id}`)!.protocol.handle.mock.calls[0]![1] as (request: Request) => Promise<Response>
  expect(await (await aFetch(request)).text()).toContain(a.id)
  expect((await aFetch(new Request('dsh-app://shell/manager.html'))).status).toBe(403)
})
it('focuses an existing tab and retains its loaded view', async () => {
  const item = await create('A')
  await invoke('open', { id: item.id }); await invoke('open', { id: item.id })
  expect(harness.View.all).toHaveLength(1)
  expect(harness.Local.all[0]!.connect).toHaveBeenCalledTimes(1)
  expect((await invoke('snapshot') as ManagerSnapshot).tabs.ids).toEqual([item.id])
})

it('removes a local instance home only when deletion is requested', async () => {
  const item = await create('A')
  const home = join(harness.root, 'agent-manager', 'instances', item.id)
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'owned.txt'), 'fixture')
  await invoke('remove', { id: item.id })
  expect(existsSync(join(home, 'owned.txt'))).toBe(true)
  const retained = await create('Retained')
  const retainedHome = join(harness.root, 'agent-manager', 'instances', retained.id)
  mkdirSync(retainedHome, { recursive: true })
  writeFileSync(join(retainedHome, 'owned.txt'), 'fixture')
  await invoke('remove', { id: retained.id, deleteData: true })
  expect(existsSync(retainedHome)).toBe(false)
  await expect(invoke('remove', { id: retained.id, deleteData: true })).rejects.toThrow()
})

it('allows instance main frames to open shell settings without manager authority', async () => {
  const a = await create('A')
  await invoke('open', { id: a.id })
  const contents = harness.View.all[0]!.webContents
  const navigate = harness.handlers.get(INSTANCE_OPEN_SETTINGS)!
  navigate({ sender: contents, senderFrame: contents.mainFrame })
  expect(harness.Window.all[0]!.webContents.send).toHaveBeenCalledWith(MANAGER_SHORTCUT, 'settings')
  expect(() => navigate(sender())).toThrow('Rejected instance settings sender')
  expect(() => navigate({ sender: contents, senderFrame: {} })).toThrow('Rejected instance settings sender')
  await invoke('close', { id: a.id })
  expect(() => navigate({ sender: contents, senderFrame: contents.mainFrame })).toThrow('Rejected instance settings sender')
})

it('reapplies shell presentation on reload and despite rejected instance settings', async () => {
  const a = await create('A')
  await invoke('open', { id: a.id })
  const view = harness.View.all[0]!
  expect(view.setBackgroundColor).toHaveBeenCalledWith('#00000000')
  const value = { ...DEFAULT_PERSONAL_APPEARANCE, colors: { ...DEFAULT_PERSONAL_APPEARANCE.colors, text: '#123456' } }
  harness.Local.all[0]!.fetch.mockRejectedValueOnce(new Error('Settings unavailable'))
  await invoke('softwareSettings', { action: 'personalize', input: { value } })
  expect(view.webContents.insertCSS).toHaveBeenLastCalledWith(expect.stringContaining('--dsw-alias-label-primary:#123456!important'), { cssOrigin: 'author' })
  expect(view.webContents.removeInsertedCSS).toHaveBeenCalledWith('appearance-style')
  const count = view.webContents.insertCSS.mock.calls.length
  view.webContents.emit('did-finish-load')
  await vi.waitFor(() => { expect(view.webContents.insertCSS.mock.calls.length).toBeGreaterThan(count) })
})

it('injects motion by default and toggles existing and reloaded views without unsupported backend writes', async () => {
  const a = await create('A'); const b = await create('B')
  await invoke('open', { id: a.id }); await invoke('open', { id: b.id })
  for (const view of harness.View.all) {
    expect(view.webContents.insertCSS).toHaveBeenLastCalledWith(expect.stringContaining('dsh-motion-popup'), { cssOrigin: 'author' })
  }
  for (const local of harness.Local.all) local.fetch.mockClear()
  await invoke('softwareSettings', { action: 'update', input: { field: 'motionEnabled', value: false } })
  for (const view of harness.View.all) {
    expect(view.webContents.insertCSS).toHaveBeenLastCalledWith(expect.not.stringContaining('dsh-motion-popup'), { cssOrigin: 'author' })
    expect(view.webContents.removeInsertedCSS).toHaveBeenCalled()
  }
  for (const local of harness.Local.all) {
    expect(local.fetch).toHaveBeenCalledOnce()
    expect(new URL(local.fetch.mock.calls[0]![0].url).pathname).toBe('/api/settings/describe')
  }
  const view = harness.View.all[0]!
  const count = view.webContents.insertCSS.mock.calls.length
  view.webContents.emit('did-finish-load')
  await vi.waitFor(() => { expect(view.webContents.insertCSS.mock.calls.length).toBeGreaterThan(count) })
  expect(view.webContents.insertCSS).toHaveBeenLastCalledWith(expect.not.stringContaining('dsh-motion-popup'), { cssOrigin: 'author' })
  await invoke('softwareSettings', { action: 'update', input: { field: 'motionEnabled', value: true } })
  for (const view of harness.View.all) {
    expect(view.webContents.insertCSS).toHaveBeenLastCalledWith(expect.stringContaining('dsh-motion-popup'), { cssOrigin: 'author' })
  }
})

it('previews wallpaper across existing and future views without saving or mutating instance settings', async () => {
  const a = await create('A'); const b = await create('B')
  await invoke('open', { id: a.id }); await invoke('open', { id: b.id })
  const saved = await invoke('softwareSettings', { action: 'read' })
  const file = join(harness.root, 'agent-manager', 'software-settings.json')
  const stored = existsSync(file) ? readFileSync(file, 'utf8') : undefined
  for (const local of harness.Local.all) local.fetch.mockClear()
  const value = { ...DEFAULT_PERSONAL_APPEARANCE, backgroundImage: 'data:image/png;base64,AA==',
    colors: { ...DEFAULT_PERSONAL_APPEARANCE.colors, text: '#123456' } }
  await invoke('softwareSettings', { action: 'previewPersonalization', input: { value } })
  for (const view of harness.View.all) expect(view.webContents.insertCSS).toHaveBeenLastCalledWith(expect.stringContaining('html,body{background:transparent!important;}'), { cssOrigin: 'author' })
  expect(harness.Local.all.every(local => local.fetch.mock.calls.length === 0)).toBe(true)
  expect(await invoke('softwareSettings', { action: 'read' })).toEqual(saved)
  expect(existsSync(file) ? readFileSync(file, 'utf8') : undefined).toBe(stored)
  await expect(invoke('softwareSettings', { action: 'previewPersonalization', input: { value: {} } })).rejects.toThrow('Invalid personal appearance')
  const c = await create('C'); await invoke('open', { id: c.id })
  expect(harness.View.all[2]!.webContents.insertCSS).toHaveBeenLastCalledWith(expect.stringContaining('--dsw-alias-label-primary:#123456!important'), { cssOrigin: 'author' })
  expect(harness.Local.all[2]!.settings.namespaces[0]!.value.customization).toEqual(DEFAULT_PERSONAL_APPEARANCE)
  const reloaded = harness.View.all[0]!
  reloaded.webContents.emit('did-finish-load')
  await vi.waitFor(() => { expect(reloaded.webContents.insertCSS.mock.calls.length).toBeGreaterThan(2) })
  expect(reloaded.webContents.insertCSS).toHaveBeenLastCalledWith(expect.stringContaining('--dsw-alias-label-primary:#123456!important'), { cssOrigin: 'author' })
  await invoke('softwareSettings', { action: 'previewPersonalization', input: { value: null } })
  for (const view of harness.View.all) expect(view.webContents.insertCSS).toHaveBeenLastCalledWith(expect.not.stringContaining('html,body{background:transparent!important;}'), { cssOrigin: 'author' })
  await invoke('softwareSettings', { action: 'previewPersonalization', input: { value } })
  harness.Window.all[0]!.webContents.emit('did-finish-load')
  await vi.waitFor(() => {
    for (const view of harness.View.all) expect(view.webContents.insertCSS).toHaveBeenLastCalledWith(expect.not.stringContaining('--dsw-alias-label-primary:#123456!important'), { cssOrigin: 'author' })
  })
})

it('retracts an in-flight appearance preview before completing cancellation', async () => {
  const a = await create('A'); await invoke('open', { id: a.id })
  const contents = harness.View.all[0]!.webContents
  let finishInsert!: (key: string) => void
  const inserting = new Promise<string>((resolve) => { finishInsert = resolve })
  contents.insertCSS.mockImplementationOnce(() => inserting)
  const value = { ...DEFAULT_PERSONAL_APPEARANCE, colors: { ...DEFAULT_PERSONAL_APPEARANCE.colors, text: '#abcdef' } }
  const preview = invoke('softwareSettings', { action: 'previewPersonalization', input: { value } })
  await vi.waitFor(() => { expect(contents.insertCSS).toHaveBeenLastCalledWith(expect.stringContaining('#abcdef'), { cssOrigin: 'author' }) })
  const cancel = invoke('softwareSettings', { action: 'previewPersonalization', input: { value: null } })
  finishInsert('pending-preview')
  await Promise.all([preview, cancel])
  expect(contents.removeInsertedCSS).toHaveBeenCalledWith('pending-preview')
  expect(contents.insertCSS).toHaveBeenLastCalledWith(expect.not.stringContaining('#abcdef'), { cssOrigin: 'author' })
})

it('applies software preferences to existing and future instances without importing their values', async () => {
  await invoke('softwareSettings', { action: 'update', input: { field: 'theme', value: 'light' } })
  await invoke('softwareSettings', { action: 'update', input: { field: 'fontSize', value: 16 } })
  const a = await create('A')
  await invoke('open', { id: a.id })
  expect(harness.Local.all[0]!.settings.namespaces[0]!.value).toMatchObject({ preference: 'light', fontSize: 16 })
  const software = await invoke('softwareSettings', { action: 'read' }) as { personalization: { colors: { text: string }; maskEnabled: boolean } }
  software.personalization.colors.text = '#abcdef'
  software.personalization.maskEnabled = false
  await invoke('softwareSettings', { action: 'personalize', input: { value: software.personalization } })
  await invoke('softwareSettings', { action: 'update', input: { field: 'busyEnter', value: 'steer' } })
  const b = await create('B')
  await invoke('open', { id: b.id })
  for (const local of harness.Local.all) {
    expect(local.settings.namespaces.slice(0, 3).map(item => item.value)).toMatchObject([
      { preference: 'light', fontSize: 16, customization: software.personalization }, { preference: 'en' }, { busyEnter: 'steer' },
    ])
  }
  harness.Local.all[0]!.settings.namespaces[0]!.value.preference = 'dark'
  await invoke('close', { id: a.id }); await invoke('open', { id: a.id })
  expect(harness.Local.all[0]!.settings.namespaces[0]!.value.preference).toBe('light')
  expect(await invoke('softwareSettings', { action: 'read' })).toMatchObject({ appearance: { theme: 'light', language: '', fontSize: 16 }, syncErrors: {} })
})

it('delivers software keys and offline removals without returning secrets to the renderer', async () => {
  const a = await create('A')
  const b = await create('B')
  const saved = await invoke('softwareSettings', { action: 'credentialSet', input: { ref: 'MODEL_KEY', value: 'fixture-key-only' } })
  expect(JSON.stringify(saved)).not.toContain('fixture-key-only')
  await invoke('open', { id: a.id }); await invoke('open', { id: b.id })
  expect(harness.Local.all.map(item => item.credentials.get('MODEL_KEY'))).toEqual(['fixture-key-only', 'fixture-key-only'])
  await invoke('close', { id: b.id })
  await invoke('softwareSettings', { action: 'credentialRemove', input: { ref: 'MODEL_KEY' } })
  expect(harness.Local.all[0]!.credentials.has('MODEL_KEY')).toBe(false)
  await invoke('open', { id: b.id })
  expect(harness.Local.all[1]!.credentials.has('MODEL_KEY')).toBe(false)
})

it('overrides DSH namespaces across connected, future, and reconnected instances', async () => {
  const initial = await invoke('softwareSettings', { action: 'read' }) as { dsh: Record<string, unknown> }
  const dsh = { ...initial.dsh, transcriptView: 'normal', deepseekBaseURL: 'https://gateway.test/anthropic',
    deepseekMaxTokens: 8192, defaultPreset: 'custom', modeSelectionEnabled: false }
  await invoke('softwareSettings', { action: 'dshUpdate', input: { value: dsh } })
  const a = await create('A'); await invoke('open', { id: a.id })
  const b = await create('B'); await invoke('open', { id: b.id })
  for (const local of harness.Local.all) {
    expect(local.settings.namespaces.find(item => item.ns === 'llm-deepseek')!.value).toMatchObject({
      baseURL: dsh.deepseekBaseURL, maxTokens: 8192, unrelated: true,
    })
    expect(local.settings.namespaces.find(item => item.ns === 'agent-presets')!.value).toEqual({ default: 'custom', modeSelectionEnabled: false })
  }
  await invoke('softwareSettings', { action: 'dshUpdate', input: { value: { ...dsh, deepseekMaxTokens: 4096 } } })
  expect(harness.Local.all.map(local => local.settings.namespaces.find(item => item.ns === 'llm-deepseek')!.value.maxTokens)).toEqual([4096, 4096])
  harness.Local.all[0]!.settings.namespaces.find(item => item.ns === 'llm-deepseek')!.value.maxTokens = 999
  await invoke('close', { id: a.id }); await invoke('open', { id: a.id })
  expect(harness.Local.all[0]!.settings.namespaces.find(item => item.ns === 'llm-deepseek')!.value.maxTokens).toBe(4096)
  expect(await invoke('softwareSettings', { action: 'read' })).toMatchObject({ dsh: { deepseekMaxTokens: 4096 }, syncErrors: {} })
})

it('dispatches coexisting settings fields and native motion using each namespace revision', async () => {
  const a = await create('A'); await invoke('open', { id: a.id }); await invoke('close', { id: a.id })
  const local = harness.Local.all[0]!
  local.settings = mixedSettingsDocument()
  const theme = local.settings.namespaces.find(item => item.ns === 'ui-theme')!
  const schema = new Schema(theme.schema as Schema)
  theme.schema = Schema.object({ ...schema.dict, motionEnabled: Schema.boolean() }).toJSON()
  await invoke('open', { id: a.id })
  const initial = await invoke('softwareSettings', { action: 'read' }) as SoftwareSettingsSnapshot
  await invoke('softwareSettings', { action: 'dshUpdate', input: { value: { ...initial.dsh,
    defaultProvider: 'gateway', defaultModel: 'model-a', reasoningEffort: 'medium',
    deepseekProtocol: 'chat-completions', transcriptView: 'normal', defaultPreset: 'custom' } } })
  await invoke('softwareSettings', { action: 'update', input: { field: 'motionEnabled', value: false } })
  const values = Object.fromEntries(local.settings.namespaces.map(section => [section.ns, section.value]))
  expect(values['ui-theme']).toMatchObject({ motionEnabled: false, customization: DEFAULT_PERSONAL_APPEARANCE })
  expect(values['ui-chat']).toMatchObject({ transcriptView: 'normal' })
  expect(values['agent-presets']).toMatchObject({ default: 'custom' })
  expect(values['llm-deepseek']).toMatchObject({ protocol: 'chat-completions' })
  expect(values['llm-deepseek']).not.toHaveProperty('reasoningEffort')
  expect(values['agent-default-model']).toMatchObject({ provider: 'gateway', model: 'model-a', reasoningEffort: 'medium' })
  expect(await invoke('softwareSettings', { action: 'read' })).toMatchObject({ syncErrors: {},
    settingsSupport: { [a.id]: { fields: { motionEnabled: { namespace: 'ui-theme', field: 'motionEnabled' },
      reasoningEffort: { namespace: 'agent-default-model', field: 'reasoningEffort' } } } } })
})

it('retains software values and the connection when an instance lacks a DSH namespace', async () => {
  const a = await create('A'); await invoke('open', { id: a.id }); await invoke('close', { id: a.id })
  harness.Local.all[0]!.settings.namespaces = harness.Local.all[0]!.settings.namespaces.filter(item => item.ns !== 'ui-chat')
  await invoke('open', { id: a.id })
  const data = await invoke('softwareSettings', { action: 'read' }) as { syncErrors: Record<string, string>
    settingsSupport: Record<string, { fields: Record<string, { namespace: string | null }> }> }
  expect(data.syncErrors).toEqual({})
  expect(data.settingsSupport[a.id]!.fields.transcriptView!.namespace).toBeNull()
  expect((await invoke('snapshot') as ManagerSnapshot).statuses[a.id]!.connection).toBe('connected')
})

it('delivers multiple model sources and removes offline routes without touching instance-owned providers', async () => {
  const config = { name: 'Gateway', protocol: 'openai-completions', baseURL: 'https://gateway.test/v1',
    models: ['fixture-model'], contextWindow: 128000, maxTokens: 4096 }
  await invoke('softwareSettings', { action: 'sourceSave', input: { config, key: 'fixture-a' } })
  const state = await invoke('softwareSettings', { action: 'sourceSave', input: {
    config: { ...config, name: 'Anthropic', protocol: 'anthropic-messages' }, key: 'fixture-b',
  } }) as SoftwareSettingsSnapshot
  const [first, second] = state.modelSources
  const a = await create('A'); await invoke('open', { id: a.id })
  const b = await create('B'); await invoke('open', { id: b.id })
  const providers = (index: number) => harness.Local.all[index]!.settings.namespaces.find(item => item.ns === 'llm-pi-ai')!
    .value.providers as Record<string, Record<string, unknown>>
  for (const index of [0, 1]) {
    expect(providers(index)[sourceRoute(first!.id)]).toMatchObject({ api: 'openai-completions' })
    expect(providers(index)[sourceRoute(second!.id)]).toMatchObject({ api: 'anthropic-messages' })
    expect(harness.Local.all[index]!.credentials.get(sourceKeyRef(first!.id))).toBe('fixture-a')
  }
  await invoke('close', { id: b.id })
  await invoke('softwareSettings', { action: 'sourceRemove', input: { id: first!.id } })
  await invoke('softwareSettings', { action: 'sourceSave', input: { id: second!.id,
    config: { ...config, name: 'Changed', protocol: 'openai-responses' }, key: '',
  } })
  await invoke('open', { id: b.id })
  for (const index of [0, 1]) {
    expect(providers(index)[sourceRoute(first!.id)]).toBeUndefined()
    expect(providers(index)[sourceRoute(second!.id)]).toMatchObject({ api: 'openai-responses', displayName: 'Changed' })
    expect(providers(index).unrelated).toEqual({ api: 'openai-completions' })
    expect(harness.Local.all[index]!.credentials.has(sourceKeyRef(first!.id))).toBe(false)
    expect(harness.Local.all[index]!.credentials.get(sourceKeyRef(second!.id))).toBe('fixture-b')
  }
})

it('captures rebound shortcuts in instance content and suspends them during recording', async () => {
  const item = await create('A'); await invoke('open', { id: item.id })
  const bindings = await invoke('shortcuts') as Record<string, string>
  await invoke('shortcuts', { bindings: { ...bindings, settings: 'Ctrl+Alt+S' } })
  const contents = harness.View.all[0]!.webContents
  const event = { preventDefault: vi.fn() }
  const input = { type: 'keyDown', key: 's', control: true, alt: true, shift: false, meta: false, isComposing: false }
  contents.emit('before-input-event', event, input)
  expect(event.preventDefault).toHaveBeenCalled()
  expect(harness.Window.all[0]!.webContents.send).toHaveBeenCalledWith('dsh-manager:shortcut', 'settings')
  const shellEvent = { preventDefault: vi.fn() }
  await invoke('shortcutCapture', { visible: true })
  harness.Window.all[0]!.webContents.emit('before-input-event', shellEvent, input)
  expect(shellEvent.preventDefault).not.toHaveBeenCalled()
})
it('closing a tab destroys its view without stopping its local process', async () => {
  const item = await create('A')
  await invoke('open', { id: item.id }); await invoke('close', { id: item.id })
  expect(harness.View.all[0]!.webContents.destroyed).toBe(true)
  expect(harness.Local.all[0]!.stop).not.toHaveBeenCalled()
  expect((await invoke('snapshot') as ManagerSnapshot).statuses[item.id]!.process).toBe('running')
})
it('rejects manager IPC from an instance even when its frame spoofs the shell URL', async () => {
  const event = { sender: {}, senderFrame: { url: 'dsh-app://shell/manager.html' } }
  await expect(harness.handlers.get(MANAGER_CHANNEL)!(event, 'snapshot')).rejects.toThrow('Rejected')
  await expect(harness.handlers.get(MANAGER_CHANNEL)!({ ...sender(), senderFrame: { url: 'dsh-app://shell/manager.html' } }, 'snapshot')).rejects.toThrow('Rejected')
})
it('quitting waits for local stop and does not enable the official updater', async () => {
  const item = await create('A')
  await invoke('open', { id: item.id })
  const stopped = Promise.withResolvers<undefined>()
  harness.Local.all[0]!.stop.mockImplementation(() => stopped.promise)
  const event = { preventDefault: vi.fn() }
  harness.app.emit('before-quit', event)
  await vi.waitFor(() => { expect(harness.Local.all[0]!.stop).toHaveBeenCalled() })
  expect(event.preventDefault).toHaveBeenCalled()
  expect(harness.app.quit).not.toHaveBeenCalled()
  stopped.resolve(undefined)
  await vi.waitFor(() => { expect(harness.app.quit).toHaveBeenCalled() })
})

async function pluginSender(config: InstanceConfig) {
  await invoke('open', { id: config.id })
  await invoke('plugins', { id: config.id })
  const contents = harness.Window.all.at(-1)!.webContents
  return { sender: contents, senderFrame: contents.mainFrame }
}

async function librarySender() {
  return sender()
}

it('owns library installation in the shell and injects only into the selected local or SSH instance', async () => {
  const owner = await librarySender()
  const contents = owner.sender
  expect(harness.Window.all).toHaveLength(1)
  harness.fetch.mockResolvedValueOnce(Response.json({ name: 'test-plugin', version: '1.2.3', dsh: { bundle: { patch: 'patch.yml' } } }))
  const plan = await harness.handlers.get(DESKTOP_IPC.pluginsPlan)!(owner, 'test-plugin') as DesktopPluginInstallPlan
  await harness.handlers.get(DESKTOP_IPC.pluginsAdd)!(owner, plan.id)
  expect(harness.library.select).toHaveBeenCalledWith('test-plugin', '1.2.3')
  expect(harness.Local.all).toHaveLength(0)
  const local = await create('Local')
  await invoke('open', { id: local.id })
  const remote = await invoke('save', { config: { name: 'Linux', kind: 'ssh', host: 'host', port: 22, username: 'user',
    auth: 'password', privateKeyPath: '', executable: 'dsh', home: '/tmp/managed' } }) as InstanceConfig
  await invoke('open', { id: remote.id, credentials: { password: 'ephemeral-secret' } })
  await harness.handlers.get(DESKTOP_IPC.pluginsInject)!(owner, 'test-plugin', '1.2.3', local.id)
  expect(harness.Local.all[0]!.mutate).toHaveBeenCalledWith({ type: 'plugin-inject', name: 'test-plugin', version: '1.2.3', source: 'shell-library-profile' })
  expect(harness.Local.all[1]!.mutate).not.toHaveBeenCalled()
  await harness.handlers.get(DESKTOP_IPC.pluginsInject)!(owner, 'test-plugin', '1.2.3', remote.id)
  expect(harness.Local.all[1]!.injectPlugin).toHaveBeenCalledWith({ name: 'test-plugin', version: '1.2.3' }, { password: 'ephemeral-secret' })
  expect(harness.Local.all[0]!.injectPlugin).not.toHaveBeenCalled()
  const unauthorized = { sender: harness.View.all[0]!.webContents, senderFrame: contents.mainFrame }
  await expect(harness.handlers.get(DESKTOP_IPC.pluginsInject)!(unauthorized, 'test-plugin', '1.2.3', remote.id)).rejects.toThrow('Rejected')
})

it('binds single-use approval to the shell library and denies installation from instance windows', async () => {
  const a = await create('A')
  const instance = await pluginSender(a)
  const owner = await librarySender()
  harness.fetch.mockResolvedValueOnce(Response.json({ name: 'test-plugin', version: '1.2.3', dsh: { bundle: { patch: 'patch.yml' } } }))
  const plan = await harness.handlers.get(DESKTOP_IPC.pluginsPlan)!(owner, 'test-plugin@next') as DesktopPluginInstallPlan
  await expect(harness.handlers.get(DESKTOP_IPC.pluginsPlan)!(instance, 'test-plugin')).rejects.toThrow('Settings')
  expect(() => harness.handlers.get(DESKTOP_IPC.pluginsAdd)!(instance, plan.id)).toThrow('Settings')
  expect(() => harness.handlers.get(DESKTOP_IPC.pluginsAdd)!(owner, 'test-plugin@latest')).toThrow('expired')
  await harness.handlers.get(DESKTOP_IPC.pluginsAdd)!(owner, plan.id)
  expect(harness.library.select).toHaveBeenCalledWith('test-plugin', '1.2.3')
  expect(harness.Local.all[0]!.mutate).not.toHaveBeenCalled()
  expect(() => harness.handlers.get(DESKTOP_IPC.pluginsAdd)!(owner, plan.id)).toThrow('expired')
})

it('rejects packages without bundles and retains versions independently of the local runtime', async () => {
  const owner = await librarySender()
  harness.fetch.mockResolvedValueOnce(Response.json({ name: 'test-plugin', version: '1.0.0', dsh: {} }))
  const blocked = await harness.handlers.get(DESKTOP_IPC.pluginsPlan)!(owner, 'test-plugin') as DesktopPluginInstallPlan
  expect(() => harness.handlers.get(DESKTOP_IPC.pluginsAdd)!(owner, blocked.id)).toThrow('bundle')
  expect(harness.library.select).not.toHaveBeenCalled()
  for (const manifest of [
    { name: 'linux-plugin', engines: { dsh: '^9' } }, { name: 'dshmarket' },
  ]) {
    harness.fetch.mockResolvedValueOnce(Response.json({ ...manifest, version: '1.0.0', dsh: { bundle: { patch: 'patch.yml' } } }))
    const plan = await harness.handlers.get(DESKTOP_IPC.pluginsPlan)!(owner, manifest.name) as DesktopPluginInstallPlan
    await harness.handlers.get(DESKTOP_IPC.pluginsAdd)!(owner, plan.id)
    expect(harness.library.select).toHaveBeenCalledWith(manifest.name, '1.0.0')
  }
  expect(harness.library.install).not.toHaveBeenCalled()
})

it('denies catalog and plan IPC to instance frames and restores the view after recovered failures', async () => {
  const config = await create('A')
  await invoke('open', { id: config.id })
  const owner = await librarySender()
  const unauthorized = { sender: harness.View.all[0]!.webContents, senderFrame: owner.senderFrame }
  expect(() => harness.handlers.get(DESKTOP_IPC.pluginsCatalog)!(unauthorized)).toThrow('Rejected')
  await expect(harness.handlers.get(DESKTOP_IPC.pluginsPlan)!(unauthorized, 'test')).rejects.toThrow('Rejected')
  expect(() => harness.handlers.get(DESKTOP_IPC.pluginsCatalog)!({ ...owner, senderFrame: { url: owner.senderFrame.url } })).toThrow('Rejected')
  expect(harness.fetch).not.toHaveBeenCalled()
  const { DesktopProfileMutationError } = await import('../src/project-manager.ts')
  harness.Local.all[0]!.mutate.mockRejectedValueOnce(new DesktopProfileMutationError('restored', true, new Error('install failed')))
  await expect(harness.handlers.get(DESKTOP_IPC.pluginsInject)!(owner, 'test-plugin', '1.2.3', config.id)).rejects.toThrow('restored')
  expect(harness.View.all).toHaveLength(2)
  expect((await invoke('snapshot') as ManagerSnapshot).statuses[config.id]?.connection).toBe('connected')
})

it('requires another review after a plan expires', async () => {
  const owner = await librarySender()
  harness.fetch.mockResolvedValueOnce(Response.json({ name: 'test-plugin', version: '1.2.3', dsh: { bundle: { patch: 'patch.yml' } } }))
  const plan = await harness.handlers.get(DESKTOP_IPC.pluginsPlan)!(owner, 'test-plugin') as DesktopPluginInstallPlan
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000)
  try {
    expect(() => harness.handlers.get(DESKTOP_IPC.pluginsAdd)!(owner, plan.id)).toThrow('expired')
    expect(harness.library.select).not.toHaveBeenCalled()
  } finally { clock.mockRestore() }
})

it('discards metadata replies after the settings frame navigates away', async () => {
  const owner = await librarySender()
  const reply = Promise.withResolvers<Response>()
  harness.fetch.mockReturnValueOnce(reply.promise)
  const pending = Promise.resolve(harness.handlers.get(DESKTOP_IPC.pluginsPlan)!(owner, 'test-plugin'))
  const rejected = expect(pending).rejects.toThrow('Rejected')
  owner.senderFrame.url = 'dsh-app://shell/other.html'
  reply.resolve(Response.json({ name: 'test-plugin', version: '1.2.3', dsh: { bundle: { patch: 'patch.yml' } } }))
  await rejected
  expect(harness.library.select).not.toHaveBeenCalled()
})

it('installs a reviewed replacement in the library without updating an instance', async () => {
  const config = await create('A')
  await invoke('open', { id: config.id })
  const owner = await librarySender()
  harness.Local.all[0]!.manager.listPlugins.mockReturnValue([{ name: 'test-plugin', version: '1.0.0', enabled: false }])
  harness.fetch.mockResolvedValueOnce(Response.json({ name: 'test-plugin', version: '1.2.3', dsh: { bundle: { patch: 'patch.yml' } } }))
  const plan = await harness.handlers.get(DESKTOP_IPC.pluginsPlan)!(owner, 'test-plugin@next') as DesktopPluginInstallPlan
  await harness.handlers.get(DESKTOP_IPC.pluginsAdd)!(owner, plan.id)
  expect(harness.library.select).toHaveBeenCalledWith('test-plugin', '1.2.3')
  expect(harness.Local.all[0]!.mutate).not.toHaveBeenCalled()
})

it('opens HTTPS plugin repository links outside settings and rejects other schemes and credentials', async () => {
  const open = harness.Window.all[0]!.webContents.setWindowOpenHandler.mock.calls[0]![0] as (details: { url: string }) => { action: string }
  expect(open({ url: 'https://github.com/example/plugin' })).toEqual({ action: 'deny' })
  expect(harness.openExternal).toHaveBeenCalledWith('https://github.com/example/plugin')
  vi.mocked(harness.openExternal).mockClear()
  for (const url of ['file:///C:/private', 'http://example.com/', 'https://user:secret@example.com/']) {
    expect(open({ url })).toEqual({ action: 'deny' })
  }
  expect(harness.openExternal).not.toHaveBeenCalled()
})

it('routes frameless window controls through authenticated manager IPC', async () => {
  const window = harness.Window.all[0]!
  expect(window.options).toMatchObject({ frame: false })
  await invoke('window', { action: 'minimize' })
  expect(window.minimize).toHaveBeenCalledOnce()
  await invoke('window', { action: 'maximize' })
  expect((await invoke('snapshot') as ManagerSnapshot).maximized).toBe(true)
  expect(window.webContents.send).toHaveBeenCalledWith('dsh-manager:changed')
  await invoke('window', { action: 'maximize' })
  expect((await invoke('snapshot') as ManagerSnapshot).maximized).toBe(false)
  await expect(invoke('window', { action: 'execute' })).rejects.toThrow('Unsupported window action')
  await expect(harness.handlers.get(MANAGER_CHANNEL)!({ ...sender(), sender: {} }, 'window', { action: 'close' })).rejects.toThrow('Rejected manager IPC sender')
  const close = vi.spyOn(window, 'close')
  await invoke('window', { action: 'close' })
  expect(close).toHaveBeenCalledOnce()
})
