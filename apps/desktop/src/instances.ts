/** Persistent instance definitions; credentials and live connections never enter this file. */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Stable owner key shared by the registry, backend, and browser partition. */
export type InstanceId = string & { readonly __instanceId: unique symbol }
/** One local environment or one Linux host environment. */
export type InstanceConfig = { id: InstanceId; name: string } & (
  | { kind: 'local' }
  | { kind: 'ssh'; host: string; port: number; username: string; auth: 'password' | 'key'; privateKeyPath: string; executable: string; home: string }
)
/** Live process knowledge is independent of the availability of its connection. */
export interface InstanceStatus {
  process: 'stopped' | 'starting' | 'running' | 'unknown' | 'error'
  connection: 'disconnected' | 'connecting' | 'connected' | 'error'
  message?: string
}
/** Open tabs survive restarts without implicitly starting every backend. */
export interface TabState { ids: InstanceId[]; active: InstanceId | null }
/** Session-only input, never returned to a renderer or included in a snapshot. */
export interface InstanceCredentials { password?: string; passphrase?: string }
interface RegistryData {
  version: 1
  instances: InstanceConfig[]
  tabs: TabState
  fingerprints: Record<string, string>
}

/** Validate an instance key before using it in paths or process ownership checks. */
export function instanceId(value: unknown): InstanceId {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) throw new Error('Invalid instance ID')
  return value as InstanceId
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected an object')
  return value as Record<string, unknown>
}
function field(row: Record<string, unknown>, key: string, max = 1024): string {
  const value = row[key]
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/u.test(value)) throw new Error(`Invalid ${key}`)
  return value.trim()
}
/** Parse renderer/file input and discard fields outside the persisted public configuration. */
export function parseInstance(value: unknown, id: InstanceId): InstanceConfig {
  const row = record(value)
  const name = field(row, 'name', 100)
  if (!name) throw new Error('Instance name is required')
  if (row.kind === 'local') return { id, name, kind: 'local' }
  if (row.kind !== 'ssh') throw new Error('Invalid instance kind')
  const host = field(row, 'host', 253)
  const username = field(row, 'username', 100)
  if (!host || /[\s/@]/u.test(host) || !username) throw new Error('SSH host and username are required')
  if (!Number.isInteger(row.port) || Number(row.port) < 1 || Number(row.port) > 65535) throw new Error('Invalid SSH port')
  if (row.auth !== 'password' && row.auth !== 'key') throw new Error('Invalid SSH authentication')
  const privateKeyPath = field(row, 'privateKeyPath')
  if (row.auth === 'key' && !privateKeyPath) throw new Error('Private key path is required')
  const executable = field(row, 'executable') || 'dsh'
  const home = field(row, 'home') || `~/.local/share/dsh-manager/instances/${id}`
  if ((!home.startsWith('/') && !home.startsWith('~/')) || home.split('/').includes('..') || home === '/' || home === '~/') throw new Error('Use a dedicated absolute or ~/ remote data directory')
  return { id, name, kind: 'ssh', host, port: Number(row.port), username, auth: row.auth, privateKeyPath, executable, home }
}
/** Validate ephemeral secrets at the IPC boundary. */
export function parseCredentials(value: unknown): InstanceCredentials {
  if (value === undefined) return {}
  const row = record(value)
  const result: InstanceCredentials = {}
  for (const key of ['password', 'passphrase'] as const) {
    if (row[key] === undefined) continue
    if (typeof row[key] !== 'string' || row[key].length > 8192) throw new Error('Invalid credential')
    result[key] = row[key]
  }
  return result
}
/** Serial, atomic registry updates owned by the desktop main process. */
export class InstanceRegistry {
  private data: RegistryData
  constructor(private readonly path: string) {
    if (!existsSync(path)) {
      this.data = { version: 1, instances: [], tabs: { ids: [], active: null }, fingerprints: {} }
      return
    }
    const row = record(JSON.parse(readFileSync(path, 'utf8')))
    if (row.version !== 1 || !Array.isArray(row.instances)) throw new Error('Unsupported instance registry')
    const instances = row.instances.map(value => parseInstance(value, instanceId(record(value).id)))
    const ids = new Set(instances.map(value => value.id))
    if (ids.size !== instances.length) throw new Error('Duplicate instance IDs')
    const tabs = record(row.tabs)
    if (!Array.isArray(tabs.ids)) throw new Error('Invalid tab state')
    const open = tabs.ids.map(instanceId)
    if (new Set(open).size !== open.length || open.some(id => !ids.has(id))) throw new Error('Invalid saved tabs')
    const active = tabs.active === null ? null : instanceId(tabs.active)
    if (active !== null && !open.includes(active)) throw new Error('Invalid active tab')
    const fingerprints = record(row.fingerprints)
    if (Object.values(fingerprints).some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))) throw new Error('Invalid host fingerprint')
    this.data = { version: 1, instances, tabs: { ids: open, active }, fingerprints: fingerprints as Record<string, string> }
  }
  /** Return a detached public snapshot. */
  snapshot(): Pick<RegistryData, 'instances' | 'tabs'> { return structuredClone({ instances: this.data.instances, tabs: this.data.tabs }) }
  /** Resolve an existing owner; unknown IDs never create runtime state. */
  get(id: InstanceId): InstanceConfig {
    const item = this.data.instances.find(row => row.id === id)
    if (!item) throw new Error('Unknown instance')
    return structuredClone(item)
  }
  /** Persist a validated configuration, allocating new ownership only for creation. */
  save(input: unknown, existing?: InstanceId): InstanceConfig {
    if (existing) this.get(existing)
    const item = parseInstance(input, existing ?? instanceId(randomUUID()))
    if (existing && item.kind !== this.get(existing).kind) throw new Error('Instance kind cannot change')
    const next = structuredClone(this.data)
    next.instances = [...next.instances.filter(row => row.id !== item.id), item]
    this.commit(next)
    return item
  }
  /** Forget a configuration without deleting local or remote instance data. */
  remove(id: InstanceId): void {
    this.get(id)
    const next = structuredClone(this.data)
    next.instances = next.instances.filter(row => row.id !== id)
    next.tabs.ids = next.tabs.ids.filter(row => row !== id)
    if (next.tabs.active === id) next.tabs.active = next.tabs.ids.at(-1) ?? null
    this.commit(next)
  }
  /** Open/focus or close a tab without assigning process lifetime to the tab. */
  tab(id: InstanceId, open: boolean): void {
    this.get(id)
    const next = structuredClone(this.data)
    if (open) {
      if (!next.tabs.ids.includes(id)) next.tabs.ids.push(id)
      next.tabs.active = id
    } else {
      next.tabs.ids = next.tabs.ids.filter(row => row !== id)
      if (next.tabs.active === id) next.tabs.active = next.tabs.ids.at(-1) ?? null
    }
    this.commit(next)
  }
  /** Return the pinned server key for one network endpoint. */
  fingerprint(endpoint: string): string | undefined { return this.data.fingerprints[endpoint] }
  /** Pin a confirmed first-use fingerprint; changed keys require external investigation. */
  trust(endpoint: string, fingerprint: string): void {
    const previous = this.fingerprint(endpoint)
    if (previous && previous !== fingerprint) throw new Error('SSH host key changed')
    const next = structuredClone(this.data)
    next.fingerprints[endpoint] = fingerprint
    this.commit(next)
  }
  private commit(next: RegistryData): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, this.path)
    this.data = next
  }
}
