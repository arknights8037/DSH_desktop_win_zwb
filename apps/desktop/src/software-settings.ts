/** Software-owned preferences and OS-encrypted model credentials inherited by instances. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DEFAULT_SHORTCUTS, parseShortcuts, type ManagerShortcuts } from './manager-shortcuts.ts'
import { DEFAULT_PERSONAL_APPEARANCE, parsePersonalAppearance, type PersonalAppearance } from './personal-appearance.ts'
import { DEFAULT_DSH_SETTINGS, parseDshSettings, type DshSettings } from './dsh-settings.ts'
import { modelSourceId, parseModelSource, sourceKeyRef, type ModelSource, type ModelSourceId, type ModelSourceView } from './model-sources.ts'

/** Shared product preferences applied from the desktop software to each instance. */
export interface SoftwareAppearance {
  theme: 'system' | 'light' | 'dark'
  fontSize: number
  language: '' | 'zh' | 'en'
  busyEnter: 'queue' | 'steer'
  motionEnabled: boolean
}
/** OS-backed encryption; plaintext credentials never enter the preferences file or snapshots. */
export interface SoftwareEncryption {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}
interface StoredSettings {
  version: 1
  revision: number
  appearance: SoftwareAppearance
  personalization: PersonalAppearance
  dsh: DshSettings
  shortcuts: ManagerShortcuts
  credentials: Record<string, string>
  removedCredentials: string[]
  modelSources: ModelSource[]
  removedSources: ModelSourceId[]
}
/** Public software configuration contains credential names and status only. */
export interface SoftwareSettingsSnapshot {
  revision: number
  appearance: SoftwareAppearance
  personalization: PersonalAppearance
  dsh: DshSettings
  shortcuts: ManagerShortcuts
  credentials: string[]
  credentialWritable: boolean
  modelSources: ModelSourceView[]
}
const appearance: SoftwareAppearance = { theme: 'system', fontSize: 14, language: '', busyEnter: 'queue', motionEnabled: true }
function validAppearance(field: string, value: unknown): boolean {
  switch (field) {
    case 'theme': return typeof value === 'string' && ['system', 'light', 'dark'].includes(value)
    case 'fontSize': return typeof value === 'number' && Number.isInteger(value) && value >= 12 && value <= 17
    case 'language': return typeof value === 'string' && ['', 'zh', 'en'].includes(value)
    case 'busyEnter': return value === 'queue' || value === 'steer'
    case 'motionEnabled': return typeof value === 'boolean'
    default: return false
  }
}
function credentialName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256 || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) throw new Error('Invalid credential name')
  return value
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid software settings file')
  return value as Record<string, unknown>
}
/** The software is authoritative; instance settings are never merged into these preferences. */
export class SoftwareSettings {
  private data: StoredSettings
  constructor(private readonly path: string, private readonly encryption: SoftwareEncryption) {
    this.data = { version: 1, revision: 0, appearance: { ...appearance },
      personalization: structuredClone(DEFAULT_PERSONAL_APPEARANCE), dsh: { ...DEFAULT_DSH_SETTINGS },
      shortcuts: { ...DEFAULT_SHORTCUTS },
      credentials: {}, removedCredentials: [], modelSources: [], removedSources: [] }
    if (!existsSync(path)) return
    const data = record(JSON.parse(readFileSync(path, 'utf8')))
    const values = record(data.appearance)
    // Earlier software preference files have no motion choice.
    if (!Object.hasOwn(values, 'motionEnabled')) values.motionEnabled = appearance.motionEnabled
    const credentials = record(data.credentials)
    if (data.version !== 1 || typeof data.revision !== 'number' || !Number.isSafeInteger(data.revision) || data.revision < 0
      || Object.keys(appearance).some(key => !validAppearance(key, values[key]))
      || !Array.isArray(data.removedCredentials)) throw new Error('Invalid software settings file')
    for (const [name, value] of Object.entries(credentials)) {
      credentialName(name)
      if (typeof value !== 'string' || !value || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) throw new Error('Invalid encrypted credential')
    }
    const removedCredentials = data.removedCredentials.map(credentialName)
    const modelSources = data.modelSources === undefined ? [] : data.modelSources
    const removedSources = data.removedSources === undefined ? [] : data.removedSources
    if (!Array.isArray(modelSources) || !Array.isArray(removedSources)) throw new Error('Invalid model sources file')
    const sources = modelSources.map(value => parseModelSource(value, modelSourceId(record(value).id)))
    const removed = removedSources.map(modelSourceId)
    if (new Set(sources.map(source => source.id)).size !== sources.length || sources.some(source => removed.includes(source.id))) {
      throw new Error('Duplicate model source ownership')
    }
    this.data = { version: 1, revision: data.revision,
      personalization: data.personalization === undefined
        ? structuredClone(DEFAULT_PERSONAL_APPEARANCE) : parsePersonalAppearance(data.personalization),
      appearance: { theme: values.theme as SoftwareAppearance['theme'], fontSize: values.fontSize as number,
        language: values.language as SoftwareAppearance['language'], busyEnter: values.busyEnter as SoftwareAppearance['busyEnter'],
        motionEnabled: values.motionEnabled as boolean },
      dsh: data.dsh === undefined ? { ...DEFAULT_DSH_SETTINGS } : parseDshSettings(data.dsh),
      credentials: credentials as Record<string, string>, removedCredentials, shortcuts: parseShortcuts(data.shortcuts),
      modelSources: sources, removedSources: removed }
  }
  /** @returns detached software preferences and credential metadata. */
  snapshot(): SoftwareSettingsSnapshot {
    return structuredClone({ revision: this.data.revision, appearance: this.data.appearance,
      personalization: this.data.personalization, dsh: this.data.dsh,
      modelSources: this.data.modelSources.map(source => ({ ...source,
        keyConfigured: Object.hasOwn(this.data.credentials, sourceKeyRef(source.id)) })),
      shortcuts: this.data.shortcuts, credentials: Object.keys(this.data.credentials), credentialWritable: this.encryption.available() })
  }
  /**
   * Save one shared product preference.
   * @param field - software preference name.
   * @param value - untrusted IPC value.
   */
  update(field: unknown, value: unknown): void {
    if (typeof field !== 'string' || !validAppearance(field, value)) throw new Error('Invalid software preference')
    const next = structuredClone(this.data)
    Object.assign(next.appearance, { [field]: value })
    this.commit(next)
  }
  /**
   * Save the complete DSH form for connected and future instances.
   * @param input - untrusted non-secret preferences from the manager.
   */
  updateDsh(input: unknown): void { this.commit({ ...this.data, dsh: parseDshSettings(input) }) }
  /**
   * Save wallpaper and region colors atomically for connected and future instances.
   * @param input - Untrusted complete personal appearance document.
   */
  personalize(input: unknown): void { this.commit({ ...this.data, personalization: parsePersonalAppearance(input) }) }
  /**
   * Save one source and its optional replacement API key in a single file transaction.
   * @param id - existing owner key, or undefined for a new source.
   * @param input - non-secret form configuration.
   * @param key - replacement key; empty keeps the existing encrypted value.
   */
  saveSource(id: unknown, input: unknown, key: unknown): void {
    const owner = id === undefined ? modelSourceId(randomUUID()) : modelSourceId(id)
    if (id !== undefined && !this.data.modelSources.some(source => source.id === owner)) throw new Error('Unknown model source')
    const source = parseModelSource(input, owner)
    if (typeof key !== 'string' || key.length > 8192) throw new Error('Invalid model source key')
    const next = structuredClone(this.data)
    const ref = sourceKeyRef(owner)
    if (!key && !Object.hasOwn(next.credentials, ref)) throw new Error('A new model source requires an API key')
    if (key) {
      if (!this.encryption.available()) throw new Error('OS credential encryption is unavailable')
      next.credentials[ref] = this.encryption.encrypt(key).toString('base64')
    }
    next.removedCredentials = next.removedCredentials.filter(item => item !== ref)
    const index = next.modelSources.findIndex(item => item.id === owner)
    if (index < 0) next.modelSources.push(source)
    else next.modelSources[index] = source
    this.commit(next)
  }
  /**
   * Delete a source and retain provider/key removal markers for disconnected instances.
   * @param id - software-owned source to remove.
   */
  removeSource(id: unknown): void {
    const owner = modelSourceId(id)
    if (!this.data.modelSources.some(source => source.id === owner)) throw new Error('Unknown model source')
    const next = structuredClone(this.data)
    next.modelSources = next.modelSources.filter(source => source.id !== owner)
    next.removedSources.push(owner)
    const ref = sourceKeyRef(owner)
    next.credentials = Object.fromEntries(Object.entries(next.credentials).filter(([name]) => name !== ref))
    if (!next.removedCredentials.includes(ref)) next.removedCredentials.push(ref)
    this.commit(next)
  }
  /** @returns deleted source owners whose instance routes must be removed on connection. */
  removedSourceIds(): ModelSourceId[] { return [...this.data.removedSources] }
  /** @returns detached non-secret source definitions for instance delivery. */
  instanceSources(): ModelSource[] { return structuredClone(this.data.modelSources) }
  /**
   * Save complete validated shortcut bindings.
   * @param bindings - untrusted keyboard preferences.
   */
  shortcuts(bindings: unknown): void { this.commit({ ...this.data, shortcuts: parseShortcuts(bindings) }) }
  /**
   * Encrypt and save a model key for connected and future instances.
   * @param ref - credential reference used by DSH model providers.
   * @param value - new secret, never included in returned state.
   */
  setCredential(ref: unknown, value: unknown): void {
    const name = credentialName(ref)
    if (typeof value !== 'string' || !value || value.length > 8192) throw new Error('Invalid credential value')
    if (!this.encryption.available()) throw new Error('OS credential encryption is unavailable')
    const next = structuredClone(this.data)
    Object.defineProperty(next.credentials, name, { value: this.encryption.encrypt(value).toString('base64'), enumerable: true, configurable: true, writable: true })
    next.removedCredentials = next.removedCredentials.filter(item => item !== name)
    this.commit(next)
  }
  /**
   * Remove a software key and remember its removal for offline instances.
   * @param ref - credential reference previously managed by the software.
   */
  removeCredential(ref: unknown): void {
    const name = credentialName(ref)
    if (!Object.hasOwn(this.data.credentials, name)) return
    const next = structuredClone(this.data)
    next.credentials = Object.fromEntries(Object.entries(next.credentials).filter(([ref]) => ref !== name))
    if (!next.removedCredentials.includes(name)) next.removedCredentials.push(name)
    this.commit(next)
  }
  /**
   * Decrypt credentials solely for delivery to an instance's credential provider.
   * @returns managed reference names with their current value or a removal marker.
   */
  instanceCredentials(): Array<{ ref: string; value?: string }> {
    const keys = Object.entries(this.data.credentials)
    if (keys.length && !this.encryption.available()) throw new Error('OS credential encryption is unavailable')
    return [...keys.map(([ref, value]) => ({ ref, value: this.encryption.decrypt(Buffer.from(value, 'base64')) })),
      ...this.data.removedCredentials.map(ref => ({ ref }))]
  }
  private commit(next: StoredSettings): void {
    next.revision = this.data.revision + 1
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, this.path)
    this.data = next
  }
}
