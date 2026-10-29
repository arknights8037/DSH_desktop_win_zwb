/** Electron manager owns tab views and independently scoped local/SSH runtimes. */
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, WebContentsView, dialog, ipcMain, Menu, net, protocol, safeStorage, session, shell, type IpcMainInvokeEvent } from 'electron'
import { removeOwnedDirectoryAsync } from './owned-directory.ts'
import { InstanceRegistry, instanceId, parseCredentials, parseInstance, type InstanceId } from './instances.ts'
import { InstanceService } from './instance-service.ts'
import { LocalInstance } from './local-instance.ts'
import { RemoteInstance } from './remote-instance.ts'
import { MANAGER_CHANNEL, MANAGER_CHANGED, MANAGER_SHORTCUT, INSTANCE_OPEN_SETTINGS, type ManagerSnapshot } from './manager-ipc.ts'
import { managerMessages } from './manager-locale.ts'
import { resolveDesktopLocale } from './locale.ts'
import { DESKTOP_IPC } from './ipc.ts'
import { DesktopProfileMutationError, type DesktopProjectMutation, type DesktopRuntimeExecutables } from './project-manager.ts'
import { inspectPluginInstall, queryPluginCatalog, type DesktopInstallPlanId, type DesktopPluginInstallPlan } from './plugin-market.ts'
import { SoftwareSettings } from './software-settings.ts'
import { DEFAULT_PERSONAL_APPEARANCE, parsePersonalAppearance, type PersonalAppearance } from './personal-appearance.ts'
import { instanceAppearanceCss, loadingAppearanceCss } from './instance-appearance.ts'
import { resolveInstanceSettings, type InstanceSettingsDocument, type InstanceSettingsSupport } from './settings-adapter.ts'
import { instanceSettings } from './manager-settings.ts'
import { DEFAULT_SHORTCUTS, shortcutBinding, type ManagerShortcuts } from './manager-shortcuts.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { DesktopPluginLibrary } from './plugin-library.ts'
import { DesktopKernelManager } from './kernel-manager.ts'
import { prepareDesktopKernel } from './kernel-install.ts'
import { DesktopPluginUpdates } from './plugin-updates.ts'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DesktopDataStorage, type StorageCategory } from './data-storage.ts'
import { discoverSourceModels } from './model-discovery.ts'
import { modelSourceId, parseModelSource } from './model-sources.ts'
import { startupLoadingDocument } from './startup-document.ts'
import { DesktopDiagnostics } from './diagnostics.ts'
import type { DesktopInstallProgress } from './install-progress.ts'

const SCHEME = 'dsh-app'
const MANAGER_URL = 'dsh-app://shell/manager.html'
let focus = (): void => {}
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true, codeCache: true,
} }])

function resources(): DesktopRuntimeExecutables {
  const developmentRuntime = !app.isPackaged ? process.env.DSH_DESKTOP_DSH_DIR : undefined
  if (!app.isPackaged && !developmentRuntime) throw new Error('Start development through pnpm run start:desktop to select a verified kernel')
  return {
    node: app.isPackaged ? process.execPath : process.env.DSH_DESKTOP_NODE_BINARY ?? process.execPath,
    pnpm: (!app.isPackaged ? process.env.DSH_DESKTOP_PNPM_ENTRY : undefined) ?? join(process.resourcesPath, 'runtime', 'pnpm', 'bin', 'pnpm.mjs'),
    dsh: developmentRuntime ?? join(process.resourcesPath, 'dsh'),
    ...(app.isPackaged || developmentRuntime ? { profileResolution: 'runtime' as const } : {}),
  }
}
async function shellAsset(request: Request): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 })
  const root = resolve(app.getAppPath(), 'renderer')
  let path: string
  try { path = resolve(root, `.${decodeURIComponent(new URL(request.url).pathname)}`) }
  catch { return new Response(null, { status: 400 }) }
  if (!path.startsWith(root + sep)) return new Response(null, { status: 403 })
  try {
    const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
    const body = await readFile(path)
    return new Response(request.method === 'HEAD' ? null : body, { headers: {
      'content-type': `${mime[extname(path)] ?? 'application/octet-stream'}; charset=utf-8`,
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'",
    } })
  } catch { return new Response(null, { status: 404 }) }
}
function payload(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid manager payload')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid text argument')
  return value
}

/** Return the size of a desktop-owned directory without following symlinks. */
async function directoryBytes(path: string, excludedNames: ReadonlySet<string> = new Set()): Promise<number> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    let total = 0
    for (const entry of entries) {
      if (excludedNames.has(entry.name)) continue
      const child = join(path, entry.name)
      if (entry.isDirectory()) total += await directoryBytes(child)
      else if (entry.isFile()) total += (await stat(child)).size
    }
    return total
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0
    throw error
  }
}

async function main(diagnostics: DesktopDiagnostics): Promise<void> {
  const window = new BrowserWindow({
    icon: join(app.getAppPath(), 'renderer', 'icon.png'),
    title: resolveDesktopLocale(app.getLocale()).messages.managerTitle, width: 1440, height: 920, minWidth: 940, minHeight: 640, backgroundColor: '#ffffff', frame: false,
    webPreferences: { preload: fileURLToPath(new URL('./preload-manager.cjs', import.meta.url)), nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  focus = () => { if (window.isMinimized()) window.restore(); window.show(); window.focus() }
  const loadingCss = await readFile(join(app.getAppPath(), 'renderer', 'loading.css'), 'utf8')
  const storage = new DesktopDataStorage(join(app.getPath('userData'), 'data-location.json'), resolveDshHome())
  await storage.readLocation()
  const startupSettings = new SoftwareSettings(join(storage.paths().manager, 'software-settings.json'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: value => safeStorage.encryptString(value),
    decrypt: value => safeStorage.decryptString(value),
  }).snapshot()
  const loadingAppearance = loadingAppearanceCss(
    startupSettings.personalization,
    startupSettings.appearance.theme,
    startupSettings.appearance.motionEnabled,
  )
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupLoadingDocument(resolveDesktopLocale(startupSettings.appearance.language || app.getLocale()), loadingCss, undefined, loadingAppearance))}`)
  let managerReady = false
  let kernelProgressChanged = (): void => {}
  let startupRendering = Promise.resolve()
  const startupProgress = (progress: DesktopInstallProgress): void => {
    diagnostics.info('kernel-preparation', progress)
    if (managerReady) { kernelProgressChanged(); return }
    const copy = resolveDesktopLocale(app.getLocale())
    const detail = `${copy.messages[`installStage_${progress.stage}`]}${progress.package ? ` · ${progress.package}` : ''}`
    startupRendering = startupRendering.then(async () => {
      if (!window.webContents.isDestroyed()) await window.webContents.executeJavaScript(`document.getElementById('startup-detail').textContent = ${JSON.stringify(detail)}`)
    })
      .catch((error) => { diagnostics.error('startup-progress-render', error) })
  }
  const motionCss = await readFile(join(app.getAppPath(), 'renderer', 'motion.css'), 'utf8')
  const dataHome = await storage.initialize()
  const storagePaths = storage.paths()
  const root = storagePaths.manager
  const registry = new InstanceRegistry(join(root, 'instances.json'))
  const software = new SoftwareSettings(join(root, 'software-settings.json'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value),
  })
  const syncErrors = new Map<InstanceId, string>()
  const appliedSettings = new Map<InstanceId, number>()
  const settingsSyncs = new Map<InstanceId, Promise<void>>()
  const settingsSupport = new Map<InstanceId, InstanceSettingsSupport>()
  let messages = managerMessages(software.snapshot().appearance.language || app.getLocale())
  let locale = resolveDesktopLocale(software.snapshot().appearance.language || app.getLocale())
  const packageRoot = storagePaths.cache
  const bundled = { ...resources(), packageData: { root: packageRoot, store: join(packageRoot, 'store'),
    cache: join(packageRoot, 'cache'), state: join(packageRoot, 'state'), config: join(packageRoot, 'config'), home: join(packageRoot, 'home') } }
  diagnostics.info('runtime-resources', { version: app.getVersion(), runtime: bundled.dsh })
  const kernelRoot = app.isPackaged ? join(root, 'kernels') : process.env.DSH_DESKTOP_KERNEL_ROOT
  const registryFetch: typeof fetch = (input, init) => net.fetch(input instanceof URL ? input.href : input, init)
  const createKernels = (): DesktopKernelManager | undefined => kernelRoot ? new DesktopKernelManager(kernelRoot, bundled,
    (version, directory, report) => prepareDesktopKernel(version, directory, bundled, join(root, 'kernel-probe-library'), registryFetch,
      (progress) => { report?.(progress); startupProgress(progress) }), registryFetch, app.isPackaged) : undefined
  let kernels = createKernels()
  if (!app.isPackaged) {
    if (!kernels) throw new Error('Development kernel store is missing; use pnpm run start:desktop')
    const update = await kernels.check(true)
    if (update.phase === 'error') throw new Error(`Development kernel update failed: ${update.message}`)
    kernels = createKernels()
  }
  await kernels?.initialize()
  const runtime = kernels?.runtime() ?? bundled
  console.log(`desktop kernel: version=${kernels?.snapshot().current ?? 'bundled'} runtime=${runtime.dsh}`)
  diagnostics.info('kernel-selected', { version: kernels?.snapshot().current ?? 'bundled', path: runtime.dsh })
  const library = new DesktopPluginLibrary(storagePaths.plugins, runtime)
  const views = new Map<InstanceId, WebContentsView>()
  const presentationStyles = new Map<InstanceId, string>()
  let previewAppearance: PersonalAppearance | undefined
  const locals = new Map<InstanceId, LocalInstance>()
  const pluginWindows = new Map<InstanceId, BrowserWindow>()
  const viewConnections = new Map<InstanceId, Promise<void>>()
  const viewEpochs = new Map<InstanceId, number>()
  const retryTimers = new Map<InstanceId, ReturnType<typeof setTimeout>>()
  const retryCounts = new Map<InstanceId, number>()
  const mutations = new Set<InstanceId>()
  const loggedStatuses = new Map<InstanceId, string>()
  let overlay = true
  let closing = false
  let quitAllowed = false
  let quitPending = false
  let relocateOnQuit = false
  let shortcuts: ManagerShortcuts = software.snapshot().shortcuts
  let shortcutCapture = false
  const installShortcuts = (contents: Electron.WebContents): void => {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isAutoRepeat || (shortcutCapture && contents === window.webContents)) return
      const binding = shortcutBinding(input)
      if (binding === 'F12') {
        event.preventDefault()
        if (software.snapshot().debugMode) {
          if (contents.isDevToolsOpened()) contents.closeDevTools()
          else contents.openDevTools({ mode: 'detach' })
        }
        return
      }
      const action = Object.keys(shortcuts).find(key => shortcuts[key as keyof ManagerShortcuts] === binding && binding)
      if (!action) return
      event.preventDefault()
      window.webContents.send(MANAGER_SHORTCUT, action)
    })
  }
  installShortcuts(window.webContents)
  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url)
    if (target.protocol === 'https:' && target.username === '' && target.password === '') void shell.openExternal(target.href)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => { if (url !== MANAGER_URL) event.preventDefault() })
  window.webContents.on('will-redirect', (event) => { event.preventDefault() })
  const layout = (): void => {
    if (window.isDestroyed()) return
    const active = registry.snapshot().tabs.active
    const [width = 1440, height = 920] = window.getContentSize()
    for (const [id, view] of views) {
      view.setBounds({ x: 0, y: 42, width, height: Math.max(0, height - 42) })
      view.setVisible(!overlay && id === active && service.status(registry.get(id)).connection === 'connected')
    }
  }
  const scheduleRetry = (id: InstanceId): void => {
    if (closing || retryTimers.has(id) || !registry.snapshot().tabs.ids.includes(id)) return
    const attempts = retryCounts.get(id) ?? 0
    if (attempts >= 3) return
    retryCounts.set(id, attempts + 1)
    retryTimers.set(id, setTimeout(() => {
      retryTimers.delete(id)
      void openView(id).catch(() => { if (retryCounts.has(id)) scheduleRetry(id) })
    }, [1000, 3000, 10000][attempts]))
  }
  const publish = (): void => {
    if (window.isDestroyed() || closing) return
    for (const config of registry.snapshot().instances) {
      const status = service.status(config)
      const signature = JSON.stringify(status)
      if (loggedStatuses.get(config.id) === signature) continue
      loggedStatuses.set(config.id, signature)
      diagnostics.info(`instance-state:${config.id}`, status)
    }
    window.webContents.send(MANAGER_CHANGED)
    layout()
    for (const [id, plugin] of pluginWindows) {
      if (!plugin.isDestroyed() && id !== 'library') {
        const state = service.status(registry.get(id))
        plugin.webContents.send(DESKTOP_IPC.backendState, state.connection === 'connected' ? { phase: 'ready' } : state.connection === 'error' ? { phase: 'error', message: state.message } : { phase: 'starting' })
      }
    }
    for (const config of registry.snapshot().instances) {
      const state = service.status(config)
      if (state.connection === 'connected') retryCounts.delete(config.id)
      if (config.kind !== 'ssh' || state.connection !== 'error' || state.message !== 'SSH disconnected; remote process state is unknown' || !registry.snapshot().tabs.ids.includes(config.id) || retryTimers.has(config.id)) continue
      scheduleRetry(config.id)
    }
  }
  kernelProgressChanged = publish
  const verify = async (endpoint: string, fingerprint: string): Promise<boolean> => {
    const previous = registry.fingerprint(endpoint)
    if (previous) {
      if (previous !== fingerprint) throw new Error(messages.keyChanged)
      return true
    }
    const response = await dialog.showMessageBox(window, {
      type: 'question', title: messages.trustTitle, message: messages.trustMessage,
      detail: `${endpoint}\nSHA256:${Buffer.from(fingerprint, 'hex').toString('base64').replace(/=+$/u, '')}`,
      buttons: [messages.cancel, messages.trust], defaultId: 0, cancelId: 0,
    })
    if (response.response !== 1 || closing) return false
    registry.trust(endpoint, fingerprint)
    return true
  }
  let localPreparation = Promise.resolve()
  const pluginUpdates = new DesktopPluginUpdates(join(root, 'plugin-updates.json'), library, (report) => {
    if (report) diagnostics.info('plugin-preparation', report)
    publish()
  }, registryFetch)
  const service = new InstanceService((config, report) => {
    if (config.kind === 'ssh') return new RemoteInstance(config, verify, report)
    const home = join(storagePaths.instances, config.id)
    const local = new LocalInstance(home, runtime, report,
      (manager, signal) => {
        const pending = localPreparation.then(() => pluginUpdates.prepare(config.id, home, manager, signal)).catch((error: unknown) => {
          diagnostics.error(`instance-prepare:${config.id}`, error)
          throw error
        })
        localPreparation = pending.catch(() => {})
        return pending
      }, progress => pluginUpdates.progress(config.id, progress))
    locals.set(config.id, local)
    return local
  }, publish)
  const snapshot = (): ManagerSnapshot => {
    const value = registry.snapshot()
    return { ...value, version: app.getVersion(),
      statuses: Object.fromEntries(value.instances.map(config => [config.id, service.status(config)])),
      messages, packaged: app.isPackaged, pluginManagement: app.isPackaged || process.env.DSH_DESKTOP_DSH_DIR !== undefined,
      maximized: window.isMaximized(), installationProgress: Object.fromEntries(pluginUpdates.snapshot().reports
        .flatMap(report => report.progress ? [[report.id, report.progress]] : [])) }
  }
  const clearRetry = (id: InstanceId): void => { clearTimeout(retryTimers.get(id)); retryTimers.delete(id); retryCounts.delete(id) }
  const destroyView = (id: InstanceId): void => {
    viewEpochs.set(id, (viewEpochs.get(id) ?? 0) + 1)
    clearRetry(id)
    appliedSettings.delete(id)
    settingsSupport.delete(id)
    presentationStyles.delete(id)
    syncErrors.delete(id)
    const view = views.get(id)
    if (!view) return
    window.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
    views.delete(id)
  }
  const syncSoftware = (id: InstanceId, presentationOnly = false): Promise<void> => {
    const previous = settingsSyncs.get(id) ?? Promise.resolve()
    const pending = previous.then(async () => {
      const preferences = software.snapshot()
      const config = registry.get(id)
      const view = views.get(id)
      if (!view || service.status(config).connection !== 'connected') return
      const oldStyle = presentationStyles.get(id)
      const css = instanceAppearanceCss(previewAppearance ?? preferences.personalization)
        + (preferences.appearance.motionEnabled ? motionCss : '')
      const style = await view.webContents.insertCSS(css, { cssOrigin: 'author' })
      if (views.get(id) !== view) return
      presentationStyles.set(id, style)
      if (oldStyle) await view.webContents.removeInsertedCSS(oldStyle)
      if (presentationOnly || appliedSettings.get(id) === preferences.revision) return
      const call = (action: string, input: Record<string, unknown>) => instanceSettings(async request => config.kind === 'local'
        ? service.fetch(id, request)
        : view.webContents.session.fetch(request.url, { method: request.method, headers: Object.fromEntries(request.headers),
          body: await request.text(), signal: request.signal }),
      view.webContents.getURL(), action, input)
      const document = await call('read', {}) as InstanceSettingsDocument
      const resolved = resolveInstanceSettings(preferences, document, locale.id)
      if (views.get(id) !== view) return
      settingsSupport.set(id, resolved.support)
      const failures = resolved.failures
      const removed = software.removedSourceIds()
      for (const section of document.namespaces) {
        const namespace = section.ns
        const edits = resolved.edits.find(([ns]) => ns === namespace)?.[1]
        if (namespace === 'agent-default-model' && !preferences.dsh.defaultProvider
          && removed.some(source => `desktop-${source}` === section.value.provider)) {
          try { await call('resetModel', { revision: section.revision, reasoningEffort: edits?.reasoningEffort }) }
          catch (error) { failures.push(`${namespace}: ${error instanceof Error ? error.message : String(error)}`) }
          continue
        }
        if (!edits) continue
        try {
          await call('update', { namespace, edits, revision: section.revision })
        } catch (error) {
          failures.push(`${namespace}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      for (const credential of software.instanceCredentials()) {
        await call(credential.value === undefined ? 'credentialRemove' : 'credentialSet', credential)
      }
      const sources = software.instanceSources()
      if (sources.length || removed.length) {
        const section = document.namespaces.find(item => item.ns === 'llm-pi-ai')
        if (!section) failures.push('Unsupported DSH settings: llm-pi-ai')
        else {
          try { await call('sources', { sources, removed, revision: section.revision }) }
          catch (error) { failures.push(`llm-pi-ai: ${error instanceof Error ? error.message : String(error)}`) }
        }
      }
      if (failures.length) throw new Error(failures.join('\n'))
      if (views.get(id) === view) {
        appliedSettings.set(id, preferences.revision)
        syncErrors.delete(id)
      }
    }).catch((error: unknown) => {
      syncErrors.set(id, error instanceof Error ? error.message : String(error))
    }).finally(() => { if (settingsSyncs.get(id) === pending) settingsSyncs.delete(id) })
    settingsSyncs.set(id, pending)
    return pending
  }
  const syncConnected = async (): Promise<void> => {
    await Promise.all(registry.snapshot().instances.filter(config => service.status(config).connection === 'connected').map(config => syncSoftware(config.id)))
  }
  window.webContents.on('did-finish-load', () => {
    previewAppearance = undefined
    for (const id of views.keys()) void syncSoftware(id, true)
  })
  const softwareSnapshot = () => ({ ...software.snapshot(), syncErrors: Object.fromEntries(syncErrors),
    settingsSupport: Object.fromEntries([...settingsSupport].filter(([id]) => service.status(registry.get(id)).connection === 'connected')) })
  const openView = (id: InstanceId, credentials?: unknown): Promise<void> => {
    const pending = viewConnections.get(id)
    if (pending) return pending
    const epoch = viewEpochs.get(id) ?? 0
    const operation = (async () => {
      const config = registry.get(id)
      const url = await service.connect(config, parseCredentials(credentials))
      if (closing || (viewEpochs.get(id) ?? 0) !== epoch || !registry.snapshot().tabs.ids.includes(id)) return
      let view = views.get(id)
      if (!view) {
        const partition = session.fromPartition(`persist:dsh-instance-${id}`)
        partition.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
        partition.setPermissionCheckHandler(() => false)
        if (config.kind === 'local' && !partition.protocol.isProtocolHandled(SCHEME)) {
          partition.protocol.handle(SCHEME, request => new URL(request.url).hostname === 'app' ? service.fetch(id, request) : Promise.resolve(new Response(null, { status: 403 })))
        }
        view = new WebContentsView({ webPreferences: {
          session: partition, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
          preload: fileURLToPath(new URL('./preload-app.cjs', import.meta.url)),
        } })
        view.setBackgroundColor('#00000000')
        view.webContents.on('did-finish-load', () => {
          presentationStyles.delete(id)
          appliedSettings.delete(id)
          void syncSoftware(id)
        })
        installShortcuts(view.webContents)
        view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        const constrainNavigation = (event: Electron.Event, target: string): void => {
          const current = new URL(view?.webContents.getURL() || url)
          const next = new URL(target)
          if (next.protocol !== current.protocol || next.host !== current.host) event.preventDefault()
        }
        view.webContents.on('will-navigate', constrainNavigation)
        view.webContents.on('will-redirect', constrainNavigation)
        view.webContents.on('render-process-gone', () => { destroyView(id); service.pageFailed(id, new Error('Instance page exited; connect again to reload it')) })
        views.set(id, view)
        window.contentView.addChildView(view)
        view.setVisible(false)
      }
      const current = view.webContents.getURL()
      const target = new URL(url)
      if (!current || new URL(current).host !== target.host || new URL(current).protocol !== target.protocol) {
        await view.webContents.loadURL(url)
      }
      await syncSoftware(id)
      layout()
    })().catch((error: unknown) => {
      diagnostics.error(`instance-open:${id}`, error)
      if (service.status(registry.get(id)).connection === 'connected') { destroyView(id); service.pageFailed(id, error) }
      throw error
    }).finally(() => { if (viewConnections.get(id) === operation) viewConnections.delete(id); publish() })
    viewConnections.set(id, operation)
    return operation
  }
  ipcMain.handle(INSTANCE_OPEN_SETTINGS, (event) => {
    const owner = [...views.values()].find(view => view.webContents === event.sender)
    if (closing || !owner || event.senderFrame !== owner.webContents.mainFrame) throw new Error('Rejected instance settings sender')
    window.webContents.send(MANAGER_SHORTCUT, 'settings')
  })
  ipcMain.handle(DESKTOP_IPC.directoryPick, async (event) => {
    const owner = [...views].find(([, view]) => view.webContents === event.sender)
    if (closing || !owner || registry.get(owner[0]).kind !== 'local'
      || event.senderFrame !== owner[1].webContents.mainFrame
      || !owner[1].webContents.getURL().startsWith('dsh-app://app/')) {
      throw new Error('Rejected directory picker sender')
    }
    const selected = await dialog.showOpenDialog(window, { title: messages.workspaceDirectory, properties: ['openDirectory', 'createDirectory'] })
    return selected.canceled ? null : selected.filePaths[0] ?? null
  })
  const localFor = (id: InstanceId): LocalInstance => {
    if (registry.get(id).kind !== 'local') throw new Error('Use the remote instance settings to manage remote plugins')
    const local = locals.get(id)
    if (!local) throw new Error('Open this local instance first')
    return local
  }
  const changePlugins = async (id: InstanceId, mutation: DesktopProjectMutation | 'reset'): Promise<void> => {
    if (mutations.has(id)) throw new Error('Instance configuration is being changed')
    mutations.add(id)
    try {
      const local = localFor(id)
      destroyView(id)
      await service.stop(id)
      try { await local.mutate(mutation) }
      catch (error) {
        if (error instanceof DesktopProfileMutationError && error.recovered) await openView(id)
        throw error
      }
      await openView(id)
    } finally { mutations.delete(id) }
  }
  const pluginOwner = (event: IpcMainInvokeEvent): InstanceId | 'library' => {
    if (closing) throw new Error('Manager is shutting down')
    if (!window.webContents.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === MANAGER_URL) return 'library'
    for (const [id, plugin] of pluginWindows) if (!plugin.isDestroyed() && event.sender === plugin.webContents && event.senderFrame === plugin.webContents.mainFrame && event.senderFrame.url === 'dsh-app://shell/plugin-manager.html') return id
    throw new Error('Rejected plugin IPC sender')
  }
  const instancePluginOwner = (event: IpcMainInvokeEvent): InstanceId => {
    const owner = pluginOwner(event)
    if (owner === 'library') throw new Error('Choose an instance for this plugin operation')
    return owner
  }
  const openPlugins = (id: InstanceId): void => {
    localFor(id)
    if (!app.isPackaged && process.env.DSH_DESKTOP_DSH_DIR === undefined) {
      throw new Error('Plugin installation requires a runtime-backed desktop application')
    }
    const existing = pluginWindows.get(id)
    if (existing && !existing.isDestroyed()) { existing.focus(); return }
    const plugin = new BrowserWindow({ parent: window, width: 900, height: 780, title: `${registry.get(id).name} — ${messages.plugins}`, webPreferences: {
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), nodeIntegration: false, contextIsolation: true, sandbox: true,
    } })
    plugin.webContents.on('did-finish-load', () => {
      const preferences = software.snapshot()
      void plugin.webContents.insertCSS(loadingAppearanceCss(
        preferences.personalization,
        preferences.appearance.theme,
        preferences.appearance.motionEnabled,
      ))
        .catch((error) => { diagnostics.error('plugin-appearance', error) })
    })
    pluginWindows.set(id, plugin)
    plugin.webContents.setWindowOpenHandler(({ url }) => {
      const target = new URL(url)
      if (target.protocol === 'https:' && target.username === '' && target.password === '') void shell.openExternal(target.href)
      return { action: 'deny' }
    })
    plugin.webContents.on('will-navigate', (event) => { event.preventDefault() })
    plugin.once('closed', () => { pluginWindows.delete(id) })
    void plugin.loadURL('dsh-app://shell/plugin-manager.html')
  }
  protocol.handle(SCHEME, request => new URL(request.url).hostname === 'shell' ? shellAsset(request) : Promise.resolve(new Response(null, { status: 403 })))
  const managerOperation = async (event: IpcMainInvokeEvent, operation: unknown, input: unknown): Promise<unknown> => {
    if (closing || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== MANAGER_URL) throw new Error('Rejected manager IPC sender')
    const args = payload(input)
    if (operation === 'snapshot') return snapshot()
    if (operation === 'diagnostics') {
      if (args.action === 'read') return { path: diagnostics.path, available: diagnostics.available() }
      if (args.action !== 'open') throw new Error('Unsupported diagnostics operation')
      const failure = await shell.openPath(dirname(diagnostics.path))
      if (failure) throw new Error(failure)
      return
    }
    if (operation === 'pluginUpdates') {
      switch (args.action) {
        case 'read': return pluginUpdates.snapshot()
        case 'automatic': {
          if (typeof args.visible !== 'boolean') throw new Error('Invalid automatic plugin update setting')
          return pluginUpdates.automatic(args.visible)
        }
        default: throw new Error('Unsupported plugin update operation')
      }
    }
    if (operation === 'kernel') {
      if (!kernels) throw new Error('Kernel updates require a selected runtime-backed kernel')
      switch (args.action) {
        case 'read': return kernels.snapshot()
        case 'check': case 'install': {
          const pending = kernels.check(args.action === 'install')
          publish()
          const result = await pending
          publish()
          return result
        }
        case 'automatic': {
          if (typeof args.visible !== 'boolean') throw new Error('Invalid automatic kernel update setting')
          return kernels.automatic(args.visible)
        }
        default: throw new Error('Unsupported kernel operation')
      }
    }
    if (operation === 'window') {
      switch (args.action) {
        case 'minimize': window.minimize(); break
        case 'maximize': if (window.isMaximized()) window.unmaximize(); else window.maximize(); break
        case 'close': window.close(); break
        default: throw new Error('Unsupported window action')
      }
      return
    }
    if (operation === 'overlay') {
      if (typeof args.visible !== 'boolean') throw new Error('Invalid visibility')
      overlay = args.visible; layout(); return
    }
    if (operation === 'save') {
      const id = args.id === undefined ? undefined : instanceId(args.id)
      if (id) {
        parseInstance(args.config, id)
        if (mutations.has(id)) throw new Error('Instance configuration is being changed')
        mutations.add(id)
        try {
          destroyView(id); pluginWindows.get(id)?.close()
          await service.forget(id); locals.delete(id)
        } finally { mutations.delete(id) }
      }
      const saved = registry.save(args.config, id)
      publish(); return saved
    }
    if (operation === 'softwareSettings') {
      const input = payload(args.input)
      switch (args.action) {
        case 'read': return softwareSnapshot()
        case 'debugMode': {
          software.setDebugMode(input.value)
          if (!software.snapshot().debugMode) {
            for (const contents of [window.webContents, ...[...views.values()].map(view => view.webContents)]) {
              if (!contents.isDestroyed()) contents.closeDevTools()
            }
          }
          publish()
          return softwareSnapshot()
        }
        case 'previewPersonalization': {
          previewAppearance = input.value === null ? undefined : parsePersonalAppearance(input.value)
          await Promise.all([...views.keys()].map(id => syncSoftware(id, true)))
          return
        }
        case 'exportColors': {
          const { colors } = parsePersonalAppearance({ ...DEFAULT_PERSONAL_APPEARANCE, colors: input.colors })
          const result = await dialog.showSaveDialog(window, { title: messages.exportColors,
            defaultPath: 'dsh-colors.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
          if (!result.canceled && result.filePath) await writeFile(result.filePath, `${JSON.stringify({ version: 1, colors }, null, 2)}\n`, 'utf8')
          return
        }
        case 'update':
          software.update(input.field, input.value)
          locale = resolveDesktopLocale(software.snapshot().appearance.language || app.getLocale())
          messages = managerMessages(locale.id)
          break
        case 'credentialInfo': {
          const data = software.snapshot()
          const ref = text(input.ref)
          return { [ref]: { configured: data.credentials.includes(ref), writable: data.credentialWritable, source: 'software' } }
        }
        case 'credentialSet': software.setCredential(input.ref, input.value); break
        case 'credentialRemove': software.removeCredential(input.ref); break
        case 'dshUpdate': software.updateDsh(input.value); break
        case 'personalize': software.personalize(input.value); previewAppearance = undefined; break
        case 'sourceSave': software.saveSource(input.id, input.config, input.key); break
        case 'sourceModels': {
          const source = parseModelSource(input.config, modelSourceId(input.id ?? randomUUID()))
          const key = typeof input.key === 'string' && input.key ? input.key : software.sourceCredential(input.id)
          return discoverSourceModels(source, key, registryFetch)
        }
        case 'sourceRemove': software.removeSource(input.id); break
        default: throw new Error('Unsupported software settings operation')
      }
      await syncConnected()
      publish()
      return softwareSnapshot()
    }
    if (operation === 'storage') {
      const action = args.action ?? 'read'
      if (action === 'migrate') {
        const category = args.input === undefined ? undefined : text(args.input)
        if (category !== undefined && !['manager', 'instances', 'cache', 'plugins'].includes(category)) throw new Error('Unknown storage category')
        const selected = await dialog.showOpenDialog(window, { title: messages.migrateData, properties: ['openDirectory', 'createDirectory'] })
        if (selected.canceled || !selected.filePaths[0]) return
        const destination = join(selected.filePaths[0], category ? `DshManager-${category}` : 'DshManagerData')
        const confirmation = await dialog.showMessageBox(window, { type: 'question', title: messages.migrateData,
          message: messages.migrateConfirm, detail: `${category ? storagePaths[category as StorageCategory] : dataHome}\n→ ${destination}`,
          buttons: [messages.cancel, messages.migrateRestart], defaultId: 0, cancelId: 0 })
        if (confirmation.response !== 1) return
        await storage.schedule(destination, category as StorageCategory | undefined)
        relocateOnQuit = true
        app.quit()
        return
      }
      if (action === 'open') {
        const category = text(args.input)
        const path = Object.hasOwn(storagePaths, category) ? storagePaths[category as StorageCategory] : undefined
        if (path === undefined) throw new Error('Unknown storage category')
        const failure = await shell.openPath(path)
        if (failure) throw new Error(failure)
        return
      }
      if (action !== 'read') throw new Error('Unsupported storage operation')
      const [managerBytes, instanceBytes, cacheBytes, pluginBytes] = await Promise.all([
        directoryBytes(root, new Set(['instances', 'plugin-library'])), directoryBytes(storagePaths.instances),
        directoryBytes(storagePaths.cache), directoryBytes(storagePaths.plugins),
      ])
      const instances = await Promise.all(registry.snapshot().instances.filter(item => item.kind === 'local').map(async item => ({
        id: item.id, name: item.name, path: join(storagePaths.instances, item.id),
        bytes: await directoryBytes(join(storagePaths.instances, item.id)),
      })))
      return {
        root, dataHome, paths: storagePaths,
        totals: { manager: managerBytes, instances: instanceBytes, cache: cacheBytes, plugins: pluginBytes,
          total: managerBytes + instanceBytes + cacheBytes + pluginBytes },
        instances,
      }
    }
    if (operation === 'shortcutCapture') { shortcutCapture = args.visible === true; return }
    if (operation === 'shortcuts') { if (args.action === 'reset') software.shortcuts(DEFAULT_SHORTCUTS); else if (args.bindings !== undefined) software.shortcuts(args.bindings); shortcuts = software.snapshot().shortcuts; return shortcuts }
    const id = instanceId(args.id)
    registry.get(id)
    if (mutations.has(id) && operation !== 'logs') throw new Error('Instance configuration is being changed')
    switch (operation) {
      case 'rename': registry.save({ ...registry.get(id), name: text(args.name) }, id); break
      case 'open': registry.tab(id, true); overlay = false; publish(); await openView(id, args.credentials); break
      case 'close': {
        registry.tab(id, false); destroyView(id); await service.disconnect(id)
        const active = registry.snapshot().tabs.active
        if (active) await openView(active).catch(() => undefined)
        break
      }
      case 'disconnect': destroyView(id); await service.disconnect(id); break
      case 'stop': destroyView(id); await service.stopInstance(registry.get(id), parseCredentials(args.credentials)); break
      case 'restart': destroyView(id); await service.stopInstance(registry.get(id), parseCredentials(args.credentials)); await openView(id, args.credentials); break
      case 'remove':
        mutations.add(id)
        try {
          const config = registry.get(id)
          if (args.deleteData !== undefined && typeof args.deleteData !== 'boolean') throw new Error('Invalid delete-data option')
          if (args.deleteData === true && config.kind !== 'local') throw new Error('Remote instance data cannot be deleted from this device')
          destroyView(id)
          pluginWindows.get(id)?.close()
          await service.forget(id)
          locals.delete(id)
          if (args.deleteData === true) await removeOwnedDirectoryAsync(join(storagePaths.instances, id))
          registry.remove(id)
        }
        finally { mutations.delete(id) }
        break
      case 'logs': return service.logs(id)
      case 'plugins': openPlugins(id); break
      case 'disablePlugins': await changePlugins(id, { type: 'plugins-disable-all' }); break
      case 'reset': await changePlugins(id, 'reset'); break
      default: throw new Error('Unknown manager operation')
    }
    publish()
    return snapshot()
  }
  ipcMain.handle(
    MANAGER_CHANNEL,
    (event, operation: unknown, input: unknown) => managerOperation(event, operation, input).catch((error: unknown) => {
      diagnostics.error(`manager-operation:${typeof operation === 'string' ? operation : 'invalid'}`, error)
      throw error
    }),
  )
  ipcMain.handle(DESKTOP_IPC.localeGet, (event) => { pluginOwner(event); return locale })
  ipcMain.handle(DESKTOP_IPC.pluginsList, event => pluginOwner(event) === 'library'
    ? library.list().map(plugin => ({ ...plugin, enabled: true })) : localFor(instancePluginOwner(event)).manager.listPlugins())
  ipcMain.handle(DESKTOP_IPC.pluginsLibrary, event => ({ active: pluginOwner(event) === 'library',
    targets: registry.snapshot().instances.map(config => ({ id: config.id, name: config.name, kind: config.kind,
      available: !mutations.has(config.id) && (service.status(config).connection === 'connected'
        || (config.kind === 'local' && locals.has(config.id) && service.status(config).connection !== 'connecting')),
    })),
  }))
  ipcMain.handle(DESKTOP_IPC.pluginsInject, async (event, name: unknown, version: unknown, target: unknown) => {
    if (pluginOwner(event) !== 'library') throw new Error('Use the shell plugin library to inject plugins')
    const plugin = { name: text(name), version: text(version) }
    const id = instanceId(target)
    const config = registry.get(id)
    if (mutations.has(id)) throw new Error('Instance configuration is being changed')
    if (config.kind === 'local') {
      return library.withSource(plugin.name, plugin.version, source => changePlugins(id, { type: 'plugin-inject', ...plugin, source }))
    }
    return library.withSelection(plugin.name, plugin.version, async () => {
      if (service.status(config).connection !== 'connected') throw new Error('Connect to the remote instance before injecting plugins')
      mutations.add(id)
      destroyView(id)
      let failure: Error | undefined
      try {
        try { await service.injectPlugin(config, plugin) }
        catch (error) { failure = error instanceof Error ? error : new Error(String(error)) }
        try { await openView(id) }
        catch (error) {
          if (failure !== undefined) throw new Error(`${failure.message}; reconnect failed: ${String(error)}`, { cause: failure })
          throw error
        }
        if (failure !== undefined) throw failure
      } finally { mutations.delete(id); publish() }
    })
  })
  const plans = new Map<InstanceId | 'library', { plan: DesktopPluginInstallPlan; runtime: string; expires: number }>()
  ipcMain.handle(DESKTOP_IPC.pluginsCatalog, (event) => {
    pluginOwner(event)
    return queryPluginCatalog(registryFetch, process.env.DSH_DESKTOP_PLUGIN_CATALOG_URL)
  })
  ipcMain.handle(DESKTOP_IPC.pluginsPlan, async (event, spec: unknown) => {
    const id = pluginOwner(event)
    if (id !== 'library') throw new Error('Install and update plugins through Settings > Plugins > Plugin library')
    const descriptor = library.runtime()
    const details = await inspectPluginInstall(text(spec), descriptor, library.root, registryFetch)
    pluginOwner(event)
    const plan = { ...details, blockers: details.blockers.filter(blocker => blocker === 'missing-bundle'), id: randomUUID() as DesktopInstallPlanId }
    plans.set(id, { plan, runtime: descriptor.release.version, expires: Date.now() + 15 * 60_000 })
    return plan
  })
  ipcMain.handle(DESKTOP_IPC.pluginsAdd, (event, planId: unknown) => {
    const id = pluginOwner(event)
    if (id !== 'library') throw new Error('Install and update plugins through Settings > Plugins > Plugin library')
    const approval = plans.get(id)
    if (approval === undefined || approval.plan.id !== text(planId) || approval.expires < Date.now()
      || approval.runtime !== library.runtime().release.version) throw new Error('Install plan expired; review the package again')
    const { plan } = approval
    if (plan.blockers.length > 0) throw new Error('Package does not declare a plugin bundle')
    plans.delete(id)
    library.select(plan.name, plan.version)
  })
  ipcMain.handle(DESKTOP_IPC.pluginsRemove, (event, name: unknown, version: unknown) => {
    if (pluginOwner(event) === 'library') { library.remove(text(name), text(version)); return }
    return changePlugins(instancePluginOwner(event), { type: 'plugin-remove', name: text(name) })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsToggle, (event, name: unknown, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid plugin activation')
    return changePlugins(instancePluginOwner(event), { type: 'plugin-toggle', name: text(name), enabled })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsDisableAll, event => changePlugins(instancePluginOwner(event), { type: 'plugins-disable-all' }))
  ipcMain.handle(DESKTOP_IPC.backendStatus, (event) => {
    if (pluginOwner(event) === 'library') return { phase: 'ready' }
    const state = service.status(registry.get(instancePluginOwner(event)))
    return state.connection === 'connected' ? { phase: 'ready' } : { phase: 'error', message: state.message ?? state.process }
  })
  ipcMain.handle(DESKTOP_IPC.backendRetry, event => openView(instancePluginOwner(event)))
  for (const channel of [DESKTOP_IPC.updatesCheck, DESKTOP_IPC.updatesInstall]) ipcMain.handle(channel, (event) => { pluginOwner(event); return { phase: 'error', message: messages.updatesDisabled } })
  Menu.setApplicationMenu(null)
  window.on('resize', layout)
  window.on('maximize', publish)
  window.on('unmaximize', publish)
  window.on('close', (event) => { if (!quitAllowed) { event.preventDefault(); app.quit() } })
  app.on('before-quit', (event) => {
    if (quitAllowed) return
    event.preventDefault()
    if (quitPending) return
    quitPending = true
    void (async () => {
      const activeLocals = registry.snapshot().instances.some(config => config.kind === 'local' && ['running', 'starting'].includes(service.status(config).process))
      if (activeLocals && !relocateOnQuit) {
        const response = await dialog.showMessageBox(window, { type: 'question', title: messages.quitTitle, message: messages.quitMessage, buttons: [messages.cancel, messages.quit], defaultId: 0, cancelId: 0 })
        if (response.response !== 1) return
      }
      closing = true
      await library.settled()
      await kernels?.settled()
      for (const timer of retryTimers.values()) clearTimeout(timer)
      for (const id of [...views.keys()]) destroyView(id)
      await service.close()
      if (relocateOnQuit) app.relaunch()
      quitAllowed = true
      app.quit()
    })().catch((error: unknown) => {
      closing = false
      diagnostics.error('shutdown', error)
      dialog.showErrorBox(messages.title, String(error))
    }).finally(() => { quitPending = false })
  })
  focus = () => { if (window.isMinimized()) window.restore(); window.show(); window.focus() }
  app.on('activate', focus)
  managerReady = true
  await startupRendering
  await window.loadURL(MANAGER_URL)
  diagnostics.info('manager-ready', { version: app.getVersion() })
  if (kernels) void kernels.check().then((status) => {
    if (status.phase === 'error') diagnostics.error('kernel-update', status.message)
    if (!closing) publish()
  })
  if (!app.isPackaged && process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0') window.webContents.openDevTools({ mode: 'detach' })
}
if (claimDesktopSingleInstance(app, () => { focus() })) void app.whenReady().then(async () => {
  process.env.DSH_CLIENT_VERSION = app.getVersion()
  const diagnostics = new DesktopDiagnostics(join(app.getPath('userData'), 'logs', 'desktop.log'))
  diagnostics.info('application-start', { version: app.getVersion(), platform: process.platform, arch: process.arch })
  process.on('uncaughtExceptionMonitor', (error) => { diagnostics.error('uncaught-exception', error) })
  try { await main(diagnostics) }
  catch (error) {
    diagnostics.error('application-start', error)
    const copy = resolveDesktopLocale(app.getLocale()).messages
    const detail = `${error instanceof Error ? error.message : String(error)}\n\n${diagnostics.available() ? `${copy.diagnosticsSaved}: ${diagnostics.path}` : copy.diagnosticsUnavailable}`
    const response = await dialog.showMessageBox({ type: 'error', title: copy.managerTitle, message: copy.startupFailed,
      detail, buttons: [copy.openLogs, copy.closeApplication], defaultId: 0, cancelId: 1 })
    if (response.response === 0) {
      const failure = await shell.openPath(dirname(diagnostics.path))
      if (failure) dialog.showErrorBox(copy.managerTitle, `${detail}\n${failure}`)
    }
    app.exit(1)
  }
}).catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`)
  dialog.showErrorBox('DshManager', error instanceof Error ? error.message : String(error))
  app.exit(1)
})
