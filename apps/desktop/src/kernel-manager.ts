/** Shell-owned kernel selection; prepared releases take effect on the next application launch. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gt, valid } from 'semver'
import type { DesktopRuntimeExecutables } from './project-manager.ts'
import { readDesktopRuntime } from './runtime-tree.ts'

/** Versions and preparation diagnostics exposed only to shell settings. */
export interface KernelStatus {
  phase: 'idle' | 'checking' | 'installing' | 'ready' | 'error'
  current: string
  available?: string
  automatic: boolean
  restartRequired: boolean
  modernSettings: boolean
  message?: string
}
interface Selection { version: 1; selected: string | null; previous: string | null; automatic: boolean }
/** Installation publishes a verified, self-contained directory only after a disposable Host succeeds. */
export type PrepareKernel = (version: string, directory: string) => Promise<void>

/**
 * Download and prepare kernels without changing any running instance.
 * @param root - Shell-owned kernel store and durable selection.
 * @param bundled - Installer's fallback runtime and execution tools.
 * @param prepare - Verify or publish a complete kernel before selection.
 * @param fetcher - Official registry transport.
 */
export class DesktopKernelManager {
  private selection: Selection
  private readonly started: string | null
  private state: KernelStatus
  private pending: Promise<KernelStatus> | undefined
  private installRequested = false
  constructor(
    private readonly root: string, private readonly bundled: DesktopRuntimeExecutables,
    private readonly prepare: PrepareKernel, private readonly fetcher: typeof fetch = fetch,
  ) {
    const path = join(root, 'selection.json')
    const data: unknown = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { version: 1, selected: null, previous: null, automatic: true }
    if (typeof data !== 'object' || data === null || !('version' in data) || data.version !== 1
      || !('selected' in data) || !this.isVersion(data.selected) || !('previous' in data) || !this.isVersion(data.previous)
      || !('automatic' in data) || typeof data.automatic !== 'boolean') throw new Error('Invalid desktop kernel selection')
    this.selection = data as Selection
    const bundledVersion = readDesktopRuntime(bundled.dsh).release.version
    if (this.selection.selected !== null && gt(bundledVersion, this.selection.selected)) {
      this.commit({ ...this.selection, previous: this.selection.selected, selected: null })
    }
    this.started = this.selection.selected
    this.state = { phase: 'idle', current: readDesktopRuntime(this.runtime().dsh).release.version,
      automatic: this.selection.automatic, restartRequired: false,
      modernSettings: this.hasModernSettings(this.runtime().dsh) }
  }
  private isVersion(value: unknown): value is string | null { return value === null || (typeof value === 'string' && valid(value) === value) }
  private directory(version: string): string { return join(this.root, 'releases', version) }
  private hasModernSettings(runtime: string): boolean {
    return existsSync(join(runtime, 'node_modules', '@deepseek-ai', 'dsh-agent-default-model', 'package.json'))
  }
  /** @returns The kernel selected at application startup; an update never changes this result in-process. */
  runtime(): DesktopRuntimeExecutables {
    return this.started === null ? this.bundled : { ...this.bundled, dsh: this.directory(this.started), profileResolution: 'runtime' }
  }
  /**
   * Revalidate a selected release with this shell's bridge before opening any instance data.
   * @returns Completion before local startup; failed verification rejects without a downgrade.
   */
  async initialize(): Promise<void> {
    if (this.started !== null) await this.prepare(this.started, this.directory(this.started))
  }
  /** @returns Detached update state for shell-owned settings. */
  snapshot(): KernelStatus { return { ...this.state } }
  /** @returns Completion of package preparation, for quiescent application shutdown. */
  settled(): Promise<unknown> { return this.pending ?? Promise.resolve() }
  /**
   * Persist whether launch-time checks also prepare a newer npm latest release.
   * @param enabled - Whether future checks may prepare updates without an explicit install request.
   * @returns Updated status; an already-started preparation continues.
   */
  automatic(enabled: boolean): KernelStatus {
    this.commit({ ...this.selection, automatic: enabled })
    this.state = { ...this.state, automatic: enabled }
    return this.snapshot()
  }
  /**
   * Check the official npm latest channel; install only when requested or automatic updates are enabled.
   * @param install - Request preparation even when automatic updates are disabled.
   * @returns Coalesced operation status; registry and preparation failures appear as error status.
   */
  check(install = false): Promise<KernelStatus> {
    this.installRequested ||= install
    if (this.pending) return this.pending
    const { message: _message, ...state } = this.state
    this.state = { ...state, phase: 'checking' }
    const pending = (async () => {
      try {
        const response = await this.fetcher('https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest', { signal: AbortSignal.timeout(30_000) })
        if (!response.ok) throw new Error(`DSH registry returned HTTP ${response.status}`)
        const value: unknown = await response.json()
        if (typeof value !== 'object' || value === null || !('name' in value) || value.name !== '@deepseek-ai/dsh'
          || !('version' in value) || typeof value.version !== 'string' || valid(value.version) !== value.version) throw new Error('Invalid DSH release metadata')
        const version = value.version
        const selected = this.selection.selected ?? this.state.current
        if (!gt(version, selected)) { this.state = { ...this.state, phase: this.state.restartRequired ? 'ready' : 'idle' }; return this.snapshot() }
        this.state = { ...this.state, phase: 'idle', available: version }
        if (!this.installRequested && !this.selection.automatic) return this.snapshot()
        this.state = { ...this.state, phase: 'installing' }
        await this.prepare(version, this.directory(version))
        const descriptor = readDesktopRuntime(this.directory(version))
        if (descriptor.release.version !== version) throw new Error('Prepared DSH runtime has a different version')
        this.commit({ ...this.selection, selected: version, previous: this.selection.selected })
        this.state = { ...this.state, phase: 'ready', restartRequired: true }
      } catch (error) {
        this.state = { ...this.state, phase: 'error', message: error instanceof Error ? error.message : String(error) }
      }
      return this.snapshot()
    })().finally(() => { if (this.pending === pending) { this.pending = undefined; this.installRequested = false } })
    this.pending = pending
    return pending
  }
  private commit(value: Selection): void {
    mkdirSync(this.root, { recursive: true })
    const path = join(this.root, 'selection.json')
    writeFileSync(`${path}.tmp`, `${JSON.stringify(value)}\n`, { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
    this.selection = value
  }
}
