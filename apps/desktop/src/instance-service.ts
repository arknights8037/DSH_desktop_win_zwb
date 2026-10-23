/** Per-instance operation ownership, cancellation, and redacted lifecycle logs. */
import type { InstanceConfig, InstanceCredentials, InstanceId, InstanceStatus } from './instances.ts'

/** Local pipe host and remote SSH host implement the same manager-facing lifecycle. */
export interface InstanceRuntime {
  connect(signal: AbortSignal, credentials: InstanceCredentials): Promise<string>
  disconnect(): Promise<void>
  stop(credentials: InstanceCredentials): Promise<void>
  fetch?(request: Request): Promise<Response>
  injectPlugin?(plugin: { name: string; version: string }, credentials: InstanceCredentials): Promise<void>
}
interface Entry {
  config: InstanceConfig
  runtime: InstanceRuntime
  status: InstanceStatus
  credentials: InstanceCredentials
  abort?: AbortController
  pending?: Promise<string>
  stopping?: Promise<void>
  url?: string
  logs: string[]
}
/** Redact authentication URLs, known secrets, and escape sequences from diagnostics. */
export function redactDiagnostic(message: string, credentials: InstanceCredentials = {}): string {
  let result = message.replace(/\x1b\[[0-9;]*[A-Za-z]/gu, '').replace(/https?:\/\/[^\s]+/gu, '[URL redacted]')
  for (const secret of [credentials.password, credentials.passphrase]) if (secret) result = result.split(secret).join('[redacted]')
  return result.slice(-4096)
}
/** Owns one independent operation stream per instance, with cancellation before cleanup. */
export class InstanceService {
  private readonly entries = new Map<InstanceId, Entry>()
  private closing = false
  constructor(
    private readonly create: (config: InstanceConfig, report: (status: InstanceStatus) => void) => InstanceRuntime,
    private readonly changed: () => void,
  ) {}
  private entry(config: InstanceConfig): Entry {
    const existing = this.entries.get(config.id)
    if (existing) return existing
    const entry: Entry = {
      config, runtime: this.create(config, (status) =>{  this.report(config.id, status) }),
      status: { process: config.kind === 'local' ? 'stopped' : 'unknown', connection: 'disconnected' }, credentials: {}, logs: [],
    }
    this.entries.set(config.id, entry)
    return entry
  }
  /** Get live state without initializing an instance. */
  status(config: InstanceConfig): InstanceStatus {
    return { ...(this.entries.get(config.id)?.status ?? { process: config.kind === 'local' ? 'stopped' : 'unknown', connection: 'disconnected' }) }
  }
  /** Return bounded, sanitized lifecycle diagnostics. */
  logs(id: InstanceId): string[] { return [...(this.entries.get(id)?.logs ?? [])] }
  /** Keep a running backend while exposing a failed page load as a reconnectable error. */
  pageFailed(id: InstanceId, error: unknown): void {
    const entry = this.entries.get(id)
    if (entry) this.report(id, { process: entry.status.process, connection: 'error', message: redactDiagnostic(String(error), entry.credentials) })
  }
  /** Fetch requests can only target the selected instance's connected transport. */
  fetch(id: InstanceId, request: Request): Promise<Response> {
    const entry = this.entries.get(id)
    if (entry?.status.connection !== 'connected' || !entry.runtime.fetch) return Promise.resolve(new Response(null, { status: 503 }))
    return entry.runtime.fetch(request)
  }
  /** Coalesce concurrent connects; the returned URL is main-process-only. */
  connect(config: InstanceConfig, credentials: InstanceCredentials = {}): Promise<string> {
    if (this.closing) return Promise.reject(new Error('Manager is shutting down'))
    const entry = this.entry(config)
    if (entry.stopping) return Promise.reject(new Error('Instance is stopping'))
    entry.credentials = { ...entry.credentials, ...credentials }
    if (entry.pending) return entry.pending
    if (entry.url && entry.status.connection === 'connected') return Promise.resolve(entry.url)
    const abort = new AbortController()
    entry.abort = abort
    this.report(config.id, { process: config.kind === 'local' ? 'starting' : 'unknown', connection: 'connecting' })
    const pending = Promise.resolve().then(() => entry.runtime.connect(abort.signal, entry.credentials)).then((url) => {
      abort.signal.throwIfAborted()
      entry.url = url
      this.report(config.id, { process: 'running', connection: 'connected' })
      return url
    }).catch(async (error: unknown) => {
      await entry.runtime.disconnect().catch(() => undefined)
      if (!abort.signal.aborted) this.report(config.id, {
        process: config.kind === 'local' ? 'error' : 'unknown', connection: 'error',
        message: redactDiagnostic(error instanceof Error ? error.message : String(error), entry.credentials),
      })
      throw new Error(redactDiagnostic(error instanceof Error ? error.message : String(error), entry.credentials))
    }).finally(() => { if (entry.pending === pending) delete entry.pending })
    entry.pending = pending
    return pending
  }
  /** Disconnecting a local tab leaves its process available; remote work remains on Linux. */
  disconnect(id: InstanceId): Promise<void> { return this.end(id, false) }
  /** Stop only this instance and await pending startup and teardown. */
  stop(id: InstanceId): Promise<void> { return this.end(id, true) }
  /** Stop a saved remote instance even when this app session has not connected to it. */
  stopInstance(config: InstanceConfig, credentials: InstanceCredentials = {}): Promise<void> {
    const entry = this.entry(config)
    entry.credentials = { ...entry.credentials, ...credentials }
    return this.end(config.id, true)
  }
  private end(id: InstanceId, stop: boolean): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return Promise.resolve()
    if (entry.stopping) return entry.stopping.then(() => stop ? this.end(id, true) : undefined)
    entry.abort?.abort()
    const pending = (async () => {
      await entry.pending?.catch(() => undefined)
      if (stop) await entry.runtime.stop(entry.credentials)
      else await entry.runtime.disconnect()
      delete entry.url
      this.report(id, { process: stop ? 'stopped' : entry.config.kind === 'local' ? entry.status.process : 'unknown', connection: 'disconnected' })
    })().catch((error: unknown) => {
      this.report(id, { process: 'unknown', connection: 'error', message: redactDiagnostic(String(error), entry.credentials) })
      throw error
    }).finally(() => { if (entry.stopping === pending) delete entry.stopping })
    entry.stopping = pending
    return pending
  }
  /** Release runtime state before replacing configuration; data directories are retained. */
  async forget(id: InstanceId): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    await this.end(id, entry.config.kind === 'local')
    this.entries.delete(id)
  }
  /**
   * Deploy an exact plugin selection using the target's authenticated transport.
   * @param config - Remote instance receiving its independent copy.
   * @param plugin - Version already installed in the shell library.
   * @returns Completion after injection; callers reconnect the instance view.
   */
  async injectPlugin(config: InstanceConfig, plugin: { name: string; version: string }): Promise<void> {
    const entry = this.entry(config)
    if (!entry.runtime.injectPlugin) throw new Error('Instance does not support remote plugin injection')
    if (this.closing || entry.stopping || entry.status.connection !== 'connected') throw new Error('Connect to the instance before injecting plugins')
    const pending = entry.runtime.injectPlugin(plugin, entry.credentials)
    entry.stopping = pending
    try { await pending }
    catch (error) {
      throw new Error(redactDiagnostic(error instanceof Error ? error.message : String(error), entry.credentials))
    } finally {
      await entry.runtime.disconnect()
      delete entry.url
      delete entry.stopping
      this.report(config.id, { process: 'unknown', connection: 'disconnected' })
    }
  }
  /** Stop local children and disconnect remote transports before the app exits. */
  async close(): Promise<void> {
    this.closing = true
    const results = await Promise.allSettled([...this.entries.values()].map(entry => this.end(entry.config.id, entry.config.kind === 'local')))
    for (const entry of this.entries.values()) entry.credentials = {}
    const errors = results.filter(result => result.status === 'rejected')
    if (errors.length) throw new AggregateError(errors.map((result): unknown => result.reason), 'Instance cleanup failed')
  }
  private report(id: InstanceId, status: InstanceStatus): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.status = { ...status, ...(status.message ? { message: redactDiagnostic(status.message, entry.credentials) } : {}) }
    entry.logs.push(`${new Date().toISOString()} ${status.process}/${status.connection}${entry.status.message ? `: ${entry.status.message}` : ''}`)
    if (entry.logs.length > 200) entry.logs.shift()
    this.changed()
  }
}
