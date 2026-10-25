/** Stopped-instance kernel preparation with durable backups and one-time baseline plugins. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { gte } from 'semver'
import { DesktopProjectManager } from './project-manager.ts'
import { DesktopPluginLibrary } from './plugin-library.ts'
import { readDesktopProfileState } from './profile-packages.ts'
import { desktopRuntimeId } from './runtime-tree.ts'
import { DESKTOP_DEFAULT_PLUGINS } from './default-plugins.ts'

/**
 * Prepare only a stopped instance; retain a complete home backup before changing its kernel.
 * @param home - Instance-owned data home.
 * @param manager - Selected kernel's profile manager.
 * @param library - Shell's versioned plugin library.
 * @returns Completion before Host startup; failed preparation never starts the new kernel.
 */
export async function prepareLocalKernel(home: string, manager: DesktopProjectManager, library: DesktopPluginLibrary): Promise<void> {
  const previous = readDesktopProfileState(manager.paths.profile)
  const changed = previous !== undefined && previous.runtimeId !== desktopRuntimeId(library.runtime())
  const sources = new Map<string, string>()
  if (changed) {
    const recovery = join(dirname(home), `${basename(home)}-kernel-backups`)
    mkdirSync(recovery, { recursive: true, mode: 0o700 })
    const backup = mkdtempSync(join(recovery, 'backup-'))
    await cp(home, join(backup, 'home'), { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true })
    writeFileSync(join(backup, 'complete.json'), `${JSON.stringify({ from: previous.version, to: library.runtime().release.version })}\n`)
    const manifest = JSON.parse(readFileSync(join(manager.paths.profile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { injectedPlugins?: Record<string, string> } }
    }
    for (const name of Object.keys(manifest.dsh.profile.injectedPlugins ?? {})) {
      const version = manifest.dependencies[name]
      if (version === undefined) throw new Error(`Missing installed plugin version: ${name}`)
      library.select(name, version)
      await library.withSource(name, version, (source) => {
        sources.set(name, source)
        return Promise.resolve()
      })
    }
  }
  await manager.applyRelease(sources)
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
  for (const plugin of DESKTOP_DEFAULT_PLUGINS) {
    if (manager.listPlugins().some(installed => installed.name === plugin.name)) continue
    library.select(plugin.name, plugin.version)
    await library.withSource(plugin.name, plugin.version, source => manager.mutate({ type: 'plugin-inject', ...plugin, source }, {
      beforeChange: async () => {}, afterChange: async () => {},
    }))
  }
  writeFileSync(`${marker}.tmp`, `${JSON.stringify({ version: 1 })}\n`, { mode: 0o600 })
  renameSync(`${marker}.tmp`, marker)
}
