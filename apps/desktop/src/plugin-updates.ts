/** Shell-owned automatic plugin upgrades, completed before a local Host starts. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { gt } from 'semver'
import type { InstanceId } from './instances.ts'
import { prepareLocalKernel } from './local-kernel.ts'
import { DesktopPluginLibrary, type LibraryPlugin } from './plugin-library.ts'
import { inspectPluginInstall } from './plugin-market.ts'
import type { DesktopProjectManager } from './project-manager.ts'
import type { DesktopInstallProgress, DesktopInstallReporter } from './install-progress.ts'

/** Per-instance preparation result; warnings retain the existing plugin deployment. */
export interface PluginUpdateReport {
  readonly id: InstanceId
  readonly phase: 'checking' | 'ready' | 'warning' | 'error'
  readonly changes: readonly { readonly name: string; readonly from: string; readonly to: string }[]
  readonly diagnostics: readonly { readonly name: string; readonly reason: 'skipped' | 'unavailable'; readonly detail: string }[]
  readonly error?: string
  readonly progress?: DesktopInstallProgress
}

/** Automatic preference and current manager-session results, without plugin configuration. */
export interface PluginUpdateStatus {
  readonly automatic: boolean
  readonly reports: readonly PluginUpdateReport[]
}

/**
 * Upgrade installed local plugins from npm latest only when their declared requirements match.
 * @param path - Durable shell-owned automatic-update preference file.
 * @param library - Versioned plugin installations outside instance data.
 * @param changed - Notify the manager when preparation state changes.
 * @param fetcher - Main-process registry transport.
 */
export class DesktopPluginUpdates {
  private enabled: boolean
  private readonly reports = new Map<InstanceId, PluginUpdateReport>()
  private readonly checked = new Map<InstanceId, string>()
  constructor(
    private readonly path: string, private readonly library: DesktopPluginLibrary,
    private readonly changed: (report?: PluginUpdateReport) => void, private readonly fetcher: typeof fetch = fetch,
  ) {
    const value: unknown = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { version: 1, automatic: true }
    if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1
      || !('automatic' in value) || typeof value.automatic !== 'boolean') throw new Error('Invalid automatic plugin update preference')
    this.enabled = value.automatic
  }

  /** @returns Detached state for the sandboxed manager document. */
  snapshot(): PluginUpdateStatus {
    return { automatic: this.enabled, reports: structuredClone([...this.reports.values()]) }
  }

  /**
   * Persist the policy for subsequent instance starts; an active preparation finishes unchanged.
   * @param enabled - Allow compatible npm latest upgrades before local startup.
   * @returns Updated preference and reports.
   */
  automatic(enabled: boolean): PluginUpdateStatus {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    writeFileSync(`${this.path}.tmp`, `${JSON.stringify({ version: 1, automatic: enabled })}\n`, { mode: 0o600 })
    renameSync(`${this.path}.tmp`, this.path)
    this.enabled = enabled
    this.checked.clear()
    this.changed()
    return this.snapshot()
  }

  private report(value: PluginUpdateReport): void { this.reports.set(value.id, value); this.changed(value) }

  /**
   * Publish owned installation work for an instance, including initial baseline preparation.
   * @param id - Local instance owning the stopped-profile or Host operation.
   * @param progress - Actual stage; counts describe completed packages when provided.
   */
  progress(id: InstanceId, progress: DesktopInstallProgress): void {
    const previous = this.reports.get(id)
    this.report({ id, phase: progress.stage === 'ready' ? (previous?.diagnostics.length ? 'warning' : 'ready') : 'checking',
      changes: previous?.changes ?? [], diagnostics: previous?.diagnostics ?? [], progress })
  }

  /**
   * Check once per installed inventory in this manager session, then prepare the stopped profile.
   * @param id - Local instance whose startup owns this work.
   * @param home - Instance data home, backed up separately when its kernel changes.
   * @param manager - Stopped instance's profile manager.
   * @param signal - Startup cancellation; no registry work begins after cancellation.
   * @returns Completion before Host startup; deployment failure rejects after profile recovery.
   */
  async prepare(id: InstanceId, home: string, manager: DesktopProjectManager, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const installed = manager.listPlugins()
    const report: DesktopInstallReporter = progress => this.progress(id, progress)
    const signature = JSON.stringify(installed)
    if (!this.enabled || this.checked.get(id) === signature) {
      try { await prepareLocalKernel(home, manager, this.library, [], report) }
      catch (error) {
        this.report({ id, phase: 'error', changes: [], diagnostics: [], error: error instanceof Error ? error.message : String(error) })
        throw error
      }
      return
    }
    const changes: PluginUpdateReport['changes'][number][] = []
    const diagnostics: PluginUpdateReport['diagnostics'][number][] = []
    const updates: LibraryPlugin[] = []
    const candidates: { name: string; version: string; from: string }[] = []
    this.report({ id, phase: 'checking', changes, diagnostics })
    try {
      // A single deadline bounds registry availability checks across this instance's plugins.
      const deadline = AbortSignal.timeout(30_000)
      const fetcher: typeof fetch = (input, init) => this.fetcher(input, {
        ...init, signal: AbortSignal.any([signal, deadline, ...(init?.signal ? [init.signal] : [])]),
      })
      for (const [index, plugin] of installed.entries()) {
        signal.throwIfAborted()
        report({ stage: 'checking', package: plugin.name, completed: index, total: installed.length })
        try {
          const plan = await inspectPluginInstall(plugin.name, this.library.runtime(), manager.snapshotPath(), fetcher)
          if (!gt(plan.version, plugin.version)) continue
          const declaresKernel = plan.requirements.some(item => item.name === 'dsh' || item.name.startsWith('@deepseek-ai/dsh-'))
          if (!declaresKernel || plan.compatibility !== 'compatible' || plan.blockers.length > 0) {
            diagnostics.push({ name: plugin.name, reason: 'skipped', detail: `${plan.version}: ${declaresKernel ? plan.compatibility : 'DSH compatibility unknown'}${plan.blockers.length ? `; ${plan.blockers.join(', ')}` : ''}` })
            continue
          }
          candidates.push({ name: plan.name, version: plan.version, from: plugin.version })
        } catch (error) {
          signal.throwIfAborted()
          diagnostics.push({ name: plugin.name, reason: 'unavailable', detail: error instanceof Error ? error.message : String(error) })
        }
      }
      for (const [index, candidate] of candidates.entries()) {
        signal.throwIfAborted()
        try {
          await this.library.install(candidate.name, candidate.version,
            event => report({ ...event, completed: index, total: candidates.length }))
          updates.push({ name: candidate.name, version: candidate.version })
          changes.push({ name: candidate.name, from: candidate.from, to: candidate.version })
        } catch (error) {
          signal.throwIfAborted()
          diagnostics.push({ name: candidate.name, reason: 'unavailable', detail: error instanceof Error ? error.message : String(error) })
        }
      }
      signal.throwIfAborted()
      await prepareLocalKernel(home, manager, this.library, updates, report)
      this.checked.set(id, JSON.stringify(manager.listPlugins()))
      this.report({ id, phase: diagnostics.length ? 'warning' : 'ready', changes, diagnostics })
    } catch (error) {
      this.report({ id, phase: 'error', changes: [], diagnostics, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }
}
