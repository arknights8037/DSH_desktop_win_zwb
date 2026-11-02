/** Shell-owned, versioned plugin installations; instances receive independent deployments. */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compare, satisfies, valid, validRange } from 'semver'
import { DesktopProjectManager, packageNameFromSpec, type DesktopRuntimeExecutables } from './project-manager.ts'
import { resolveDesktopPaths } from './paths.ts'
import { readDesktopRuntime, desktopRuntimeId, type DesktopRuntimeDescriptor } from './runtime-tree.ts'
import { removeOwnedDirectory } from './owned-directory.ts'
import type { DesktopInstallReporter } from './install-progress.ts'

/** One exact version retained by the shell independently of instance activation. */
export interface LibraryPlugin { readonly name: string; readonly version: string }

/** Installs each plugin version in its own dependency graph, outside instance profiles. */
export class DesktopPluginLibrary {
  private pending: Promise<void> | undefined
  private controller: AbortController | undefined
  private descriptor: DesktopRuntimeDescriptor | undefined
  private runtimeIdentity: string | undefined
  constructor(readonly root: string, private readonly executables: DesktopRuntimeExecutables) {}

  private acquire(externalSignal?: AbortSignal): { signal: AbortSignal; release: () => void } {
    if (this.pending) throw new Error('Plugin library is being changed')
    const settled = Promise.withResolvers<void>()
    this.pending = settled.promise
    const controller = new AbortController()
    this.controller = controller
    const signal = externalSignal === undefined ? controller.signal : AbortSignal.any([controller.signal, externalSignal])
    return {
      signal,
      release: () => {
        if (this.controller === controller) this.controller = undefined
        this.pending = undefined
        settled.resolve()
      },
    }
  }

  /** @returns Completion of the current installation or injection, for application shutdown. */
  settled(): Promise<void> { return this.pending ?? Promise.resolve() }

  /** Cancel the active package operation before application shutdown. */
  cancel(): void { this.controller?.abort(new Error('Plugin library operation cancelled')) }

  /** @returns Metadata for this owner's immutable, startup-selected runtime; retained until the owner is released. */
  runtime(): DesktopRuntimeDescriptor { return this.descriptor ??= readDesktopRuntime(this.executables.dsh) }

  private home(name: string, version: string): string {
    if (packageNameFromSpec(`${name}@${version}`) !== name || valid(version) !== version) throw new Error('Invalid library plugin version')
    const identity = this.runtimeIdentity ??= desktopRuntimeId(this.runtime())
    const key = createHash('sha256').update(`${identity}\n${name}@${version}`).digest('hex')
    return join(this.root, key)
  }

  /** @returns Completed library installations; failed preparations are excluded. */
  private entries(): readonly LibraryPlugin[] {
    if (!existsSync(this.root)) return []
    const selectionPath = join(this.root, 'selections.json')
    const selected: unknown = existsSync(selectionPath) ? JSON.parse(readFileSync(selectionPath, 'utf8')) : []
    if (!Array.isArray(selected)) throw new Error('Invalid plugin library selections')
    const versions: LibraryPlugin[] = selected.map((value: unknown) => {
      if (typeof value !== 'object' || value === null || !('name' in value) || !('version' in value)
        || typeof value.name !== 'string' || typeof value.version !== 'string') throw new Error('Invalid plugin library selection')
      this.home(value.name, value.version)
      return { name: value.name, version: value.version }
    })
    const installed = readdirSync(this.root).flatMap((key) => {
      if (!/^[a-f0-9]{64}$/u.test(key)) return []
      const path = join(this.root, key, 'installed.json')
      if (!existsSync(path)) return []
      const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (typeof value !== 'object' || value === null || !('name' in value) || !('version' in value)
        || typeof value.name !== 'string' || typeof value.version !== 'string') throw new Error(`Invalid plugin library entry ${key}`)
      return this.home(value.name, value.version) === join(this.root, key) ? [{ name: value.name, version: value.version }] : []
    })
    return [...new Map([...versions, ...installed].map(plugin => [`${plugin.name}@${plugin.version}`, plugin])).values()]
      .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  }

  /** @returns One current version per package, including legacy library inventories. */
  list(): readonly LibraryPlugin[] {
    const latest = new Map<string, LibraryPlugin>()
    for (const plugin of this.entries()) {
      const previous = latest.get(plugin.name)
      if (!previous || compare(plugin.version, previous.version) > 0) latest.set(plugin.name, plugin)
    }
    return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  private retain(plugins: readonly LibraryPlugin[]): void {
    const retained = new Set(plugins.map(plugin => `${plugin.name}@${plugin.version}`))
    const obsolete = this.entries().filter(plugin => !retained.has(`${plugin.name}@${plugin.version}`))
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    writeFileSync(join(this.root, 'selections.json'), `${JSON.stringify(plugins)}\n`, { mode: 0o600 })
    for (const plugin of obsolete) removeOwnedDirectory(this.home(plugin.name, plugin.version))
  }

  /** Remove superseded library copies; instance profiles own independent copies. */
  pruneSuperseded(): void {
    const { release } = this.acquire()
    try { this.retain(this.list()) } finally { release() }
  }

  /**
   * Retain a reviewed version without installing dependencies on the shell's platform.
   * @param name - Registry package name.
   * @param version - Exact registry version.
   */
  select(name: string, version: string): void {
    this.home(name, version)
    const { release } = this.acquire()
    try {
      const versions = this.list().filter(plugin => plugin.name !== name)
      this.retain([...versions, { name, version }])
    } finally { release() }
  }

  /**
   * Retain a selected version during a remote deployment without preparing Windows dependencies.
   * @param name - Selected package name.
   * @param version - Selected exact version.
   * @param operation - Deployment through the instance's authenticated Web connection.
   * @returns Deployment completion while library changes remain locked.
   */
  async withSelection(name: string, version: string, operation: (signal: AbortSignal) => Promise<void>, externalSignal?: AbortSignal): Promise<void> {
    const { signal, release } = this.acquire(externalSignal)
    try {
      signal.throwIfAborted()
      if (!this.list().some(plugin => plugin.name === name && plugin.version === version)) throw new Error('Add this version to the shell plugin library first')
      await operation(signal)
      signal.throwIfAborted()
    } finally { release() }
  }

  /**
   * Install a reviewed exact version without starting or changing an instance.
   * @param name - Registry package name.
   * @param version - Reviewed exact version.
   * @param progress - Installation stages; package names are attached by the library.
   * @returns Completion after dependency validation and approved builds.
   */
  async install(
    name: string, version: string, progress: DesktopInstallReporter = () => {}, externalSignal?: AbortSignal,
  ): Promise<void> {
    const { signal, release } = this.acquire(externalSignal)
    try {
      await this.prepareLocal(name, version, progress, signal)
      signal.throwIfAborted()
      this.retain([...this.list().filter(plugin => plugin.name !== name), { name, version }])
    }
    finally { release() }
  }

  private async prepareLocal(
    name: string, version: string, progress: DesktopInstallReporter = () => {}, signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted()
    if (name === 'dshmarket') throw new Error('This plugin requires a Web instance; select a remote instance for injection')
    const home = this.home(name, version)
    if (existsSync(join(home, 'installed.json'))) return
    mkdirSync(home, { recursive: true, mode: 0o700 })
    const manager = new DesktopProjectManager(resolveDesktopPaths(home), this.executables,
      event => progress({ ...event, package: `${name}@${version}` }))
    await manager.applyRelease(new Map(), [], signal)
    signal?.throwIfAborted()
    await manager.mutate({ type: 'plugin-add', spec: `${name}@${version}` }, {
      beforeChange: async () => {}, afterChange: async () => {},
    }, signal)
    signal?.throwIfAborted()
    this.validateEngines(manager.paths.profile, name)
    writeFileSync(join(home, 'installed.json'), `${JSON.stringify({ name, version })}\n`, { mode: 0o600 })
  }

  private validateEngines(profile: string, name: string): void {
    const metadata: unknown = JSON.parse(readFileSync(join(profile, 'node_modules', name, 'package.json'), 'utf8'))
    if (typeof metadata !== 'object' || metadata === null) throw new Error('Invalid plugin manifest')
    if (!('engines' in metadata)) return
    const engines = metadata.engines
    if (typeof engines !== 'object' || engines === null) throw new Error('Invalid plugin engine requirements')
    const runtime = this.runtime()
    for (const [engine, actual] of [['dsh', runtime.release.version], ['node', runtime.release.nodeVersion]] as const) {
      if (!(engine in engines)) continue
      const range: unknown = Reflect.get(engines, engine)
      if (typeof range !== 'string' || validRange(range) === null || !satisfies(actual, range, { includePrerelease: true })) {
        throw new Error(`Plugin requires a different ${engine} version; this local runtime has ${actual}`)
      }
    }
  }

  /**
   * Locate a completed installation for copying into a local instance.
   * @param name - Installed package name.
   * @param version - Installed exact version.
   * @returns Validated profile directory with the plugin and its private dependencies.
   */
  source(name: string, version: string): string {
    const home = this.home(name, version)
    if (!existsSync(join(home, 'installed.json'))) throw new Error('Install this version in the shell plugin library first')
    const manager = new DesktopProjectManager(resolveDesktopPaths(home), this.executables)
    const plugin = manager.listPlugins().find(item => item.name === name && item.version === version)
    if (!plugin) throw new Error('Plugin library installation is incomplete')
    this.validateEngines(manager.paths.profile, name)
    return manager.paths.profile
  }

  /**
   * Keep a source available until an instance has finished copying or preparing it.
   * @param name - Installed package name.
   * @param version - Installed exact version.
   * @param operation - Deployment using the validated source profile.
   * @param progress - Stages while preparing this source for deployment.
   * @returns Deployment completion; library changes are rejected until it settles.
   */
  async withSource(
    name: string,
    version: string,
    operation: (source: string, signal: AbortSignal) => Promise<void>,
    progress: DesktopInstallReporter = () => {},
    externalSignal?: AbortSignal,
  ): Promise<void> {
    await this.withSources([{ name, version }], (sources, signal) => {
      const source = sources.get(name)
      if (source === undefined) throw new Error(`Missing prepared plugin source: ${name}`)
      return operation(source, signal)
    }, progress, false, externalSignal)
  }

  /**
   * Retain all sources throughout one instance's stopped-profile transaction.
   * @param plugins - Selected exact versions, at most one per package name.
   * @param operation - Deployment using validated source profiles indexed by package name.
   * @param progress - Stages while preparing the selected sources.
   * @returns Deployment completion while library changes remain locked.
   */
  async withSources(
    plugins: readonly LibraryPlugin[], operation: (sources: ReadonlyMap<string, string>, signal: AbortSignal) => Promise<void>,
    progress: DesktopInstallReporter = () => {},
    historical = false,
    externalSignal?: AbortSignal,
  ): Promise<void> {
    const { signal, release } = this.acquire(externalSignal)
    let selected: readonly LibraryPlugin[] | undefined
    try {
      signal.throwIfAborted()
      selected = this.list()
      const inventory = selected
      const sources = new Map<string, string>()
      for (const { name, version } of plugins) {
        signal.throwIfAborted()
        if (!historical && !inventory.some(plugin => plugin.name === name && plugin.version === version)) throw new Error('Add this version to the shell plugin library first')
        if (sources.has(name)) throw new Error(`Duplicate plugin deployment: ${name}`)
        await this.prepareLocal(name, version, progress, signal)
        sources.set(name, this.source(name, version))
      }
      signal.throwIfAborted()
      await operation(sources, signal)
    }
    finally {
      try { if (historical && selected) this.retain(selected) }
      finally { release() }
    }
  }

  /**
   * Remove a library copy; existing independent instance deployments remain available.
   * @param name - Installed package name.
   * @param version - Exact version to remove.
   */
  remove(name: string, version: string): void {
    if (this.pending) throw new Error('Plugin library is being changed')
    const versions = this.list().filter(plugin => plugin.name !== name || plugin.version !== version)
    removeOwnedDirectory(this.home(name, version))
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    writeFileSync(join(this.root, 'selections.json'), `${JSON.stringify(versions)}\n`, { mode: 0o600 })
  }
}
