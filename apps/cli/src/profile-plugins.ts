/** Independent plugin preparations and restart-time activation for dsh profiles. */
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { valid, satisfies } from 'semver'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { readProfileManifest, type ProfileResolutionGeneration } from '@deepseek-ai/dsh-app-boot'
import type { ProfilePluginPreparation, ProfilePluginSelection, ProfilePluginService } from '@deepseek-ai/dsh-web-app'

const JOURNAL = '.plugin-deployment.json'
const COPIES = '.plugin-copies'
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

interface Deployment extends ProfilePluginSelection {
  preparation: ProfilePluginPreparation
  state: 'pending' | 'applying'
  hadLink: boolean
}

function validateSelection(plugin: ProfilePluginSelection): void {
  if (!PACKAGE.test(plugin.name) || plugin.name.length > 214 || valid(plugin.version) !== plugin.version) throw new Error('An exact registry plugin version is required')
}

function present(path: string): boolean {
  try { lstatSync(path); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

function readDeployment(profile: string): Deployment | undefined {
  const path = join(profile, JOURNAL)
  if (!existsSync(path)) return undefined
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof data !== 'object' || data === null) throw new Error('Invalid plugin deployment journal')
  const value = data as Record<string, unknown>
  if (typeof value.name !== 'string' || typeof value.version !== 'string' || typeof value.preparation !== 'string'
    || !UUID.test(value.preparation) || (value.state !== 'pending' && value.state !== 'applying')
    || typeof value.hadLink !== 'boolean') throw new Error('Invalid plugin deployment journal')
  validateSelection({ name: value.name, version: value.version })
  return value as unknown as Deployment
}

async function saveDeployment(profile: string, value: Deployment): Promise<void> {
  await writeFileAtomic(join(profile, JOURNAL), `${JSON.stringify(value)}\n`, { mode: 0o600 })
}

/**
 * Apply a scheduled plugin before any profile modules load, or restore an unfinished launch.
 * @param profile - Active profile directory resolved by the launcher.
 * @returns Readiness callback that confirms a successful launch and releases its journal.
 */
export async function activateProfilePluginUpdate(profile: string): Promise<() => void> {
  const deployment = readDeployment(profile)
  if (!deployment) return () => {}
  const copy = join(profile, COPIES, deployment.preparation)
  const manifest = join(profile, 'package.json')
  const previous = readFileSync(join(copy, 'previous-package.json'), 'utf8')
  const link = join(profile, 'node_modules', deployment.name)
  const restore = async (): Promise<void> => {
    rmSync(link, { recursive: true, force: true })
    if (deployment.hadLink) cpSync(join(copy, 'previous-link'), link, { recursive: true, verbatimSymlinks: true })
    await writeFileAtomic(manifest, previous, { mode: 0o600 })
    rmSync(join(profile, JOURNAL))
  }
  if (deployment.state === 'applying') {
    await restore()
    return () => {}
  }
  if (readFileSync(manifest, 'utf8') !== previous) throw new Error('Profile changed after plugin preparation; cancel the pending deployment before editing it')
  await saveDeployment(profile, { ...deployment, state: 'applying' })
  try {
    mkdirSync(dirname(link), { recursive: true })
    rmSync(link, { recursive: true, force: true })
    symlinkSync(join(copy, 'node_modules', deployment.name), link, process.platform === 'win32' ? 'junction' : 'dir')
    const next = readProfileManifest('dsh', profile)
    const wasInstalled = Object.hasOwn(next.dependencies ?? {}, deployment.name)
    const bundles = [...next.dsh?.profile?.bundles ?? []]
    if (!wasInstalled && !bundles.includes(deployment.name)) bundles.push(deployment.name)
    next.dependencies = { ...next.dependencies, [deployment.name]: deployment.version }
    next.dsh = { ...next.dsh, profile: { ...next.dsh?.profile, bundles } }
    await writeFileAtomic(manifest, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  } catch (error) {
    await restore()
    throw error
  }
  return () => { rmSync(join(profile, JOURNAL)) }
}

/** Instance-local dependency preparation; the global shell retains only version selections. */
export class ProfilePlugins implements ProfilePluginService {
  private busy = false
  private readonly lifetime = new AbortController()
  private pendingProcess: Promise<void> | undefined
  private readonly prepared = new Map<ProfilePluginPreparation, { plugin: ProfilePluginSelection; manifest: string }>()
  constructor(private readonly profile: string, private readonly generation: ProfileResolutionGeneration) {}

  /** @returns Completion after any in-flight package preparation has stopped. */
  async close(): Promise<void> {
    this.lifetime.abort()
    await this.pendingProcess?.catch(() => undefined)
  }

  /**
   * Install an exact version into a new private graph using instance-platform pnpm.
   * @param plugin - Registry name and reviewed exact version.
   * @param signal - Cancellation of the authenticated Web request.
   * @returns Preparation identifier; lifecycle scripts never run through this API.
   */
  async prepare(plugin: ProfilePluginSelection, signal: AbortSignal): Promise<ProfilePluginPreparation> {
    signal.throwIfAborted()
    this.lifetime.signal.throwIfAborted()
    validateSelection(plugin)
    if (this.busy || readDeployment(this.profile)) throw new Error('A plugin deployment is already in progress')
    if (this.generation.entries.some(entry => entry.scope === 'installation' && entry.name === plugin.name)) throw new Error('Installation-owned packages cannot be replaced by plugins')
    this.busy = true
    const preparation = randomUUID() as ProfilePluginPreparation
    const copy = join(this.profile, COPIES, preparation)
    try {
      const manifest = readFileSync(join(this.profile, 'package.json'), 'utf8')
      mkdirSync(copy, { recursive: true, mode: 0o700 })
      const shared = Object.fromEntries(this.generation.entries.filter(entry => entry.scope === 'installation')
        .map(entry => [entry.name, `link:${entry.packageDir}`]))
      writeFileSync(join(copy, 'package.json'), `${JSON.stringify({ private: true, type: 'module', dependencies: {
        ...shared, [plugin.name]: plugin.version,
      } })}\n`)
      // The empty local workspace excludes a checkout's enclosing pnpm workspace.
      writeFileSync(join(copy, 'pnpm-workspace.yaml'), `packages: []\noverrides: ${JSON.stringify(shared)}\n`)
      const npmrc = join(this.profile, '.npmrc')
      if (existsSync(npmrc)) cpSync(npmrc, join(copy, '.npmrc'))
      this.pendingProcess = new Promise<void>((resolve, reject) => {
        const child = spawn('pnpm', ['install', '--ignore-scripts', '--config.auto-install-peers=false', '--strict-peer-dependencies', '--engine-strict'], {
          cwd: copy, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'],
          signal: AbortSignal.any([signal, this.lifetime.signal]),
        })
        let diagnostic = ''
        let failure: Error | undefined
        child.stderr.on('data', (data: Buffer) => { diagnostic = (diagnostic + data.toString()).slice(-4096) })
        child.stdout.on('data', (data: Buffer) => { diagnostic = (diagnostic + data.toString()).slice(-4096) })
        child.once('error', (error) => { failure = error })
        child.once('close', (code) => {
          if (failure) reject(failure)
          else if (code === 0) resolve()
          else reject(new Error(`Plugin dependency preparation failed (${String(code)}): ${diagnostic}`))
        })
      })
      await this.pendingProcess
      const installed = readProfileManifest('dsh', join(copy, 'node_modules', plugin.name))
      const patch = installed.dsh?.bundle?.patch
      if (installed.name !== plugin.name || installed.version !== plugin.version || typeof patch !== 'string'
        || isAbsolute(patch)
        || relative(join(copy, 'node_modules', plugin.name), join(copy, 'node_modules', plugin.name, patch)).startsWith('..')
        || !existsSync(join(copy, 'node_modules', plugin.name, patch))) throw new Error('Prepared package is not the requested plugin bundle')
      const dshVersion = this.generation.entries.find(entry => entry.name === '@deepseek-ai/dsh')?.version
      const dshRange = installed.engines?.dsh
      if (dshRange !== undefined && (dshVersion === undefined || !satisfies(dshVersion, dshRange))) throw new Error('Plugin requires a different DSH version on this instance')
      this.prepared.set(preparation, { plugin: { ...plugin }, manifest })
      return preparation
    } catch (error) {
      rmSync(copy, { recursive: true, force: true })
      throw error
    } finally { this.busy = false; this.pendingProcess = undefined }
  }

  /**
   * Persist an explicit next-launch selection without replacing modules in this process.
   * @param preparation - Identifier prepared by this launcher process.
   * @returns Completion after a recoverable deployment journal has been published.
   */
  async apply(preparation: ProfilePluginPreparation): Promise<void> {
    this.lifetime.signal.throwIfAborted()
    if (this.busy || readDeployment(this.profile)) throw new Error('A plugin deployment is already in progress')
    const prepared = this.prepared.get(preparation)
    if (!prepared) throw new Error('Plugin preparation expired; prepare the version again')
    if (readFileSync(join(this.profile, 'package.json'), 'utf8') !== prepared.manifest) throw new Error('Profile changed during plugin preparation')
    this.busy = true
    try {
      const copy = join(this.profile, COPIES, preparation)
      const link = join(this.profile, 'node_modules', prepared.plugin.name)
      const hadLink = present(link)
      writeFileSync(join(copy, 'previous-package.json'), prepared.manifest, { mode: 0o600 })
      if (hadLink) cpSync(link, join(copy, 'previous-link'), { recursive: true, verbatimSymlinks: true })
      await saveDeployment(this.profile, { ...prepared.plugin, preparation, hadLink, state: 'pending' })
      this.prepared.delete(preparation)
    } finally { this.busy = false }
  }
}
