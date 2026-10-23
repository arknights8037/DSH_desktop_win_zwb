/** Community catalog adaptation and read-only npm preflight for Desktop-owned installs. */
import { satisfies, valid, validRange } from 'semver'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { packageNameFromSpec } from './project-manager.ts'
import type { DesktopRuntimeDescriptor } from './runtime-tree.ts'

/** Public data source also consumed by dshmarket; no community code runs during discovery. */
export const COMMUNITY_CATALOG_URL = 'https://awesome-dsh-plugin.com/plugins.json'
const COMMUNITY_CATALOG_MIRROR = 'https://cdn.jsdelivr.net/npm/dsh-plugin-catalog@latest/plugins.json'

/** Normalized community listing. Absence of npm keeps Git-only listings browseable. */
export interface DesktopCatalogEntry {
  readonly name: string
  readonly owner: string
  readonly repository: string
  readonly npm?: string
  readonly categories: readonly string[]
  readonly description: Readonly<Record<string, string>>
  readonly capabilities?: readonly string[]
  readonly capabilityCheckedAt?: string
}

/** One validated catalog response, including its source and publisher timestamp. */
export interface DesktopPluginCatalog {
  readonly source: string
  readonly updated?: string
  readonly plugins: readonly DesktopCatalogEntry[]
  readonly categories: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** Version requirement compared with the packaged runtime, never the globally installed CLI. */
export interface DesktopPluginRequirement {
  readonly name: string
  readonly range: string
  readonly actual?: string
  readonly status: 'compatible' | 'incompatible' | 'unknown'
}

/** Instance-bound, single-use reference to a reviewed installation. */
export type DesktopInstallPlanId = Branded<'DesktopInstallPlanId'>

/** Immutable version review; the main process attaches a single-use approval identifier. */
export interface DesktopPluginInstallPlan {
  readonly id: DesktopInstallPlanId
  readonly name: string
  readonly version: string
  readonly description?: string
  readonly license?: string
  readonly repository?: string
  readonly integrity?: string
  readonly source: 'npm'
  readonly requirements: readonly DesktopPluginRequirement[]
  readonly compatibility: 'compatible' | 'incompatible' | 'unknown'
  readonly blockers: readonly ('missing-bundle' | 'host-owned' | 'web-server-required')[]
  readonly permissions?: readonly string[]
  readonly scripts: readonly string[]
  readonly requiresRestart: true
  readonly snapshotPath: string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined
}

function webUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value.replace(/^git\+/u, '').replace(/\.git$/u, ''))
    return url.protocol === 'https:' && url.username === '' && url.password === '' ? url.href : undefined
  } catch { return undefined }
}

async function json(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Plugin registry ${url}: HTTP ${String(response.status)}`)
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error(`Plugin registry ${url}: empty response`)
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > 32 * 1024 * 1024) throw new Error(`Plugin registry ${url}: response exceeds 32 MiB`)
      chunks.push(part.value)
    }
  } finally { await reader.cancel() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/**
 * Query the awesome-dsh-plugin catalog shared by dshmarket. Failed requests reject explicitly.
 * @param fetcher - Main-process HTTP transport, including the system proxy in Electron.
 * @param source - Operator-selected HTTPS catalog; defaults to the community catalog.
 * @returns Validated listings; install commands in the feed are never executed.
 */
export async function queryPluginCatalog(fetcher: typeof fetch = fetch, source?: string): Promise<DesktopPluginCatalog> {
  const sources = source === undefined ? [COMMUNITY_CATALOG_URL, COMMUNITY_CATALOG_MIRROR] : [source]
  const failures: string[] = []
  for (const candidate of sources) {
    if (webUrl(candidate) !== candidate) throw new Error('Plugin catalog URL must use HTTPS without credentials')
    try { return parseCatalog(await json(candidate, fetcher), candidate) }
    catch (error) { failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  throw new Error(failures.join('; '))
}

function parseCatalog(data: unknown, source: string): DesktopPluginCatalog {
  if (!record(data) || !Array.isArray(data.plugins)) throw new Error('Plugin catalog: invalid plugins list')
  const plugins = data.plugins.map((value: unknown, index): DesktopCatalogEntry => {
    if (!record(value) || typeof value.name !== 'string' || typeof value.owner !== 'string'
      || !record(value.description)) throw new Error(`Plugin catalog: invalid entry ${String(index)}`)
    const repository = webUrl(value.url)
    const categories = typeof value.category === 'string' ? [value.category] : strings(value.category)
    if (repository === undefined || categories === undefined) throw new Error(`Plugin catalog: invalid source or category at ${String(index)}`)
    let npm: string | undefined
    if (typeof value.npm === 'string' && value.npm !== '') {
      if (packageNameFromSpec(value.npm) !== value.npm) throw new Error(`Plugin catalog: npm must be a package name at ${String(index)}`)
      npm = value.npm
    }
    const capabilities = strings(value.capabilities)
    return {
      name: value.name, owner: value.owner, repository, categories,
      description: Object.fromEntries(Object.entries(value.description).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      ...(npm === undefined ? {} : { npm }),
      ...(capabilities === undefined ? {} : { capabilities }),
      ...(typeof value.capabilityCheckedAt === 'string' ? { capabilityCheckedAt: value.capabilityCheckedAt } : {}),
    }
  })
  const categories = Object.fromEntries(Object.entries(record(data.categories) ? data.categories : {}).map(([name, labels]) => [name,
    Object.fromEntries(Object.entries(record(labels) ? labels : {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  ]))
  return { source, plugins, categories, ...(typeof data.updated === 'string' ? { updated: data.updated } : {}) }
}

/**
 * Resolve a registry tag to an exact version and compare declared engines/peers before writes.
 * @param spec - Registry package name with an optional tag or exact version.
 * @param runtime - Immutable packaged Host inventory.
 * @param snapshotPath - Backup location displayed before confirmation.
 * @param fetcher - Main-process HTTP transport; tests supply isolated responses.
 * @returns Read-only install details; unknown compatibility is distinct from a mismatch.
 */
export async function inspectPluginInstall(
  spec: string, runtime: DesktopRuntimeDescriptor, snapshotPath: string, fetcher: typeof fetch = fetch,
): Promise<Omit<DesktopPluginInstallPlan, 'id'>> {
  const name = packageNameFromSpec(spec)
  const requested = spec.slice(name.length + 1) || 'latest'
  const manifest = await json(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(requested)}`, fetcher)
  if (!record(manifest) || manifest.name !== name || typeof manifest.version !== 'string'
    || valid(manifest.version) !== manifest.version || (valid(requested) !== null && requested !== manifest.version)) {
    throw new Error(`Plugin registry: invalid manifest for ${spec}`)
  }
  const requirements: DesktopPluginRequirement[] = []
  const compare = (name: string, range: unknown, actual: string | undefined): void => {
    const status = typeof range !== 'string' || validRange(range) === null || actual === undefined
      ? 'unknown' : satisfies(actual, range) ? 'compatible' : 'incompatible'
    requirements.push({ name, range: typeof range === 'string' ? range : '(invalid)', status, ...(actual === undefined ? {} : { actual }) })
  }
  if (record(manifest.engines)) {
    if (manifest.engines.dsh !== undefined) compare('dsh', manifest.engines.dsh, runtime.release.version)
    if (manifest.engines.node !== undefined) compare('node', manifest.engines.node, runtime.release.nodeVersion)
  }
  if (record(manifest.peerDependencies)) {
    for (const [peer, range] of Object.entries(manifest.peerDependencies)) {
      const actual = runtime.sharedPackages.find(pkg => pkg.name === peer)?.version
      compare(peer, range, actual)
    }
  }
  const dsh = record(manifest.dsh) ? manifest.dsh : undefined
  const bundle = record(dsh?.bundle) ? dsh.bundle : undefined
  const metadata = record(dsh?.plugin) ? dsh.plugin : undefined
  const blockers: DesktopPluginInstallPlan['blockers'][number][] = []
  if (typeof bundle?.patch !== 'string' || bundle.patch === '') blockers.push('missing-bundle')
  if (runtime.sharedPackages.some(pkg => pkg.name === name)) blockers.push('host-owned')
  // dshmarket owns HTTP routes and package mutations; Desktop's portless Host cannot delegate those operations.
  if (name === 'dshmarket') blockers.push('web-server-required')
  const repository = webUrl(record(manifest.repository) ? manifest.repository.url : manifest.repository)
  const permissions = strings(metadata?.permissions)
  const lifecycle = record(manifest.scripts) ? manifest.scripts : undefined
  const scripts = ['preinstall', 'install', 'postinstall', 'prepare'].filter(key => typeof lifecycle?.[key] === 'string')
  const dist = record(manifest.dist) ? manifest.dist : undefined
  return {
    name, version: manifest.version, source: 'npm', requiresRestart: true, snapshotPath,
    requirements, blockers, scripts,
    compatibility: requirements.some(item => item.status === 'incompatible') ? 'incompatible'
      : requirements.length === 0 || requirements.some(item => item.status === 'unknown') ? 'unknown' : 'compatible',
    ...(typeof manifest.description === 'string' ? { description: manifest.description } : {}),
    ...(typeof manifest.license === 'string' ? { license: manifest.license } : {}),
    ...(repository === undefined ? {} : { repository }),
    ...(permissions === undefined ? {} : { permissions }),
    ...(typeof dist?.integrity === 'string' ? { integrity: dist.integrity } : {}),
  }
}
