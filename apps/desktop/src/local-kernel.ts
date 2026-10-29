/** Stopped-instance kernel preparation with durable backups and one-time baseline plugins. */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { gte } from 'semver'
import { DesktopProjectManager } from './project-manager.ts'
import { DesktopPluginLibrary, type LibraryPlugin } from './plugin-library.ts'
import type { DesktopPluginReplacement } from './project-manager.ts'
import { readDesktopProfileState } from './profile-packages.ts'
import { desktopRuntimeId } from './runtime-tree.ts'
import { DESKTOP_DEFAULT_PLUGINS } from './default-plugins.ts'
import type { DesktopInstallReporter } from './install-progress.ts'

/**
 * Prepare only a stopped instance; retain a complete home backup before changing its kernel.
 * @param home - Instance-owned data home.
 * @param manager - Selected kernel's profile manager.
 * @param library - Shell's versioned plugin library.
 * @param updates - Compatible exact versions prepared before this stopped-instance transaction.
 * @param progress - Kernel backup, source preparation, and default-plugin installation stages.
 * @returns Completion before Host startup; failed preparation never starts the new kernel.
 */
export async function prepareLocalKernel(
  home: string, manager: DesktopProjectManager, library: DesktopPluginLibrary, updates: readonly LibraryPlugin[] = [],
  progress: DesktopInstallReporter = () => {},
): Promise<void> {
  const previous = readDesktopProfileState(manager.paths.profile)
  const nodeModules = join(manager.paths.profile, 'node_modules')
  const legacyContainer = lstatSync(nodeModules, { throwIfNoEntry: false })?.isSymbolicLink() === true
  const changed = legacyContainer || (previous !== undefined && previous.runtimeId !== desktopRuntimeId(library.runtime()))
  const deployments: LibraryPlugin[] = [...updates]
  if (changed) {
    const manifest = JSON.parse(readFileSync(join(manager.paths.profile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { injectedPlugins?: Record<string, string> } }
    }
    if (legacyContainer && Object.keys(manifest.dependencies).some(name =>
      !library.runtime().sharedPackages.some(item => item.name === name))) {
      throw new Error('desktop project: legacy development profile contains external packages; recover them from its original container before migration')
    }
    const recovery = join(dirname(home), `${basename(home)}-kernel-backups`)
    progress({ stage: 'backup' })
    mkdirSync(recovery, { recursive: true, mode: 0o700 })
    const backup = mkdtempSync(join(recovery, 'backup-'))
    await cp(home, join(backup, 'home'), { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true })
    writeFileSync(join(backup, 'complete.json'), `${JSON.stringify({ from: previous?.version ?? 'legacy-development', to: library.runtime().release.version })}\n`)
    for (const name of Object.keys(manifest.dsh.profile.injectedPlugins ?? {})) {
      if (updates.some(update => update.name === name)) continue
      const version = manifest.dependencies[name]
      if (version === undefined) throw new Error(`Missing installed plugin version: ${name}`)
      library.select(name, version)
      deployments.push({ name, version })
    }
  }
  await library.withSources(deployments, async (sources) => {
    const replacements: DesktopPluginReplacement[] = updates.map((update) => {
      const source = sources.get(update.name)
      if (source === undefined) throw new Error(`Missing prepared plugin source: ${update.name}`)
      return { ...update, source }
    })
    if (legacyContainer) {
      unlinkSync(nodeModules)
      mkdirSync(nodeModules, { recursive: true, mode: 0o700 })
    }
    await manager.applyRelease(sources, replacements)
  }, progress)
  if (!gte(manager.dshVersion(), '0.2.0-rc.2')) return
  const marker = join(manager.paths.root, 'default-plugins.json')
  if (existsSync(marker)) {
    const record: unknown = JSON.parse(readFileSync(marker, 'utf8'))
    if (typeof record !== 'object' || record === null || !('version' in record) || record.version !== 1) {
      throw new Error('Invalid default plugin initialization record')
    }
    return
  }
  mkdirSync(manager.paths.root, { recursive: true, mode: 0o700 })
  for (const [index, plugin] of DESKTOP_DEFAULT_PLUGINS.entries()) {
    if (manager.listPlugins().some(installed => installed.name === plugin.name)) continue
    library.select(plugin.name, plugin.version)
    const report: DesktopInstallReporter = event => progress({ ...event, completed: index, total: DESKTOP_DEFAULT_PLUGINS.length })
    await library.withSource(plugin.name, plugin.version, source => manager.mutate({ type: 'plugin-inject', ...plugin, source }, {
      beforeChange: async () => {}, afterChange: async () => {},
    }), report)
  }
  writeFileSync(`${marker}.tmp`, `${JSON.stringify({ version: 1 })}\n`, { mode: 0o600 })
  renameSync(`${marker}.tmp`, marker)
}
