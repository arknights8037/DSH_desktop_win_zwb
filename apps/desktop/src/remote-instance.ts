/** SSH authentication, tmux ownership, and loopback tunnel lifecycle. */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, type ConnectConfig } from 'ssh2'
import type { InstanceRuntime } from './instance-service.ts'
import type { InstanceConfig, InstanceCredentials, InstanceStatus } from './instances.ts'
import { remoteReadyUrl, remoteScript } from './remote-scripts.ts'

/** Confirmation belongs to the local manager, never to a remote renderer. */
export type VerifySshHost = (endpoint: string, fingerprint: string) => Promise<boolean>
/** Remote processes outlive this transport; only stop() terminates the owned tmux session. */
export class RemoteInstance implements InstanceRuntime {
  private client: Client | undefined
  private server: Server | undefined
  private readonly sockets = new Set<Socket>()
  private clientClosed: Promise<void> | undefined
  private connected = false
  private webUrl: string | undefined
  private cookie: string | undefined
  constructor(
    private readonly config: Extract<InstanceConfig, { kind: 'ssh' }>,
    private readonly verify: VerifySshHost,
    private readonly report: (status: InstanceStatus) => void,
  ) {}
  private async authenticate(signal: AbortSignal, credentials: InstanceCredentials): Promise<Client> {
    signal.throwIfAborted()
    const client = new Client()
    this.client = client
    this.clientClosed = new Promise((resolve) => { client.once('close', resolve) })
    let trustError: Error | undefined
    const options: ConnectConfig = {
      host: this.config.host, port: this.config.port, username: this.config.username,
      readyTimeout: 20_000, keepaliveInterval: 10_000, keepaliveCountMax: 3,
      hostVerifier: (key: Buffer, done: (accepted: boolean) => void) => {
        void this.verify(`${this.config.host}:${this.config.port}`, createHash('sha256').update(key).digest('hex'))
          .then((accepted) => { done(accepted && !signal.aborted) }, (error: unknown) => {
            trustError = error instanceof Error ? error : new Error(String(error))
            done(false)
          })
      },
    }
    if (this.config.auth === 'key') {
      options.privateKey = await readFile(this.config.privateKeyPath)
      if (credentials.passphrase) options.passphrase = credentials.passphrase
    } else {
      if (credentials.password === undefined) throw new Error('SSH password is required')
      options.password = credentials.password
    }
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => { client.destroy(); reject(new Error('Connection cancelled')) }
      signal.addEventListener('abort', abort, { once: true })
      client.once('ready', () => { signal.removeEventListener('abort', abort); this.connected = true; resolve() })
      client.once('error', (error) => { signal.removeEventListener('abort', abort); reject(trustError ?? error) })
      client.once('close', () => { signal.removeEventListener('abort', abort); reject(new Error('SSH connection closed')) })
      client.connect(options)
    })
    client.on('error', () => { /* The close event publishes loss of the authenticated transport. */ })
    client.once('close', () => {
      if (this.client !== client) return
      this.connected = false
      this.report({ process: 'unknown', connection: 'error', message: 'SSH disconnected; remote process state is unknown' })
    })
    return client
  }
  private execute(client: Client, script: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { finish(new Error('Remote command timed out')); client.destroy() }, 20_000)
      const abort = (): void => { finish(new Error('Connection cancelled')); client.destroy() }
      const closed = (): void => { finish(new Error('SSH connection closed')) }
      const finish = (error?: Error, value = ''): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        client.removeListener('close', closed)
        if (error) reject(error)
        else resolve(value)
      }
      client.once('close', closed)
      signal?.addEventListener('abort', abort, { once: true })
      client.exec('sh -s', (error, channel) => {
        if (error) { finish(error); return }
        let output = ''
        let diagnostic = ''
        channel.on('data', (data: Buffer) => { output = (output + data.toString()).slice(-65536) })
        channel.stderr.on('data', (data: Buffer) => { diagnostic = (diagnostic + data.toString()).slice(-4096) })
        channel.once('error', finish)
        channel.once('close', (code: number | null) => { finish(code === 0 ? undefined : new Error(diagnostic || 'Remote command failed'), output) })
        channel.end(script)
      })
    })
  }
  /** Connect or resume an owned process and expose its web listener through SSH. */
  async connect(signal: AbortSignal, credentials: InstanceCredentials): Promise<string> {
    await this.disconnect()
    const client = await this.authenticate(signal, credentials)
    await this.execute(client, remoteScript(this.config, 'start'), signal)
    const deadline = Date.now() + 90_000
    let ready: URL | undefined
    while (!ready) {
      signal.throwIfAborted()
      ready = remoteReadyUrl(await this.execute(client, remoteScript(this.config, 'read'), signal))
      if (ready) break
      if (Date.now() >= deadline) throw new Error('Remote DSH readiness timed out; process retained for diagnosis')
      await delay(500, undefined, { signal })
    }
    const remotePort = Number(ready.port)
    const server = createServer((socket) => {
      this.sockets.add(socket)
      socket.once('close', () => { this.sockets.delete(socket) })
      socket.on('error', () => { socket.destroy() })
      client.forwardOut('127.0.0.1', socket.remotePort ?? 0, '127.0.0.1', remotePort, (error, channel) => {
        if (error) { socket.destroy(); return }
        if (socket.destroyed) { channel.destroy(); return }
        channel.on('error', () => { socket.destroy() })
        socket.once('close', () => { channel.destroy() })
        channel.once('close', () => { socket.destroy() })
        socket.pipe(channel).pipe(socket)
      })
    })
    this.server = server
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    server.on('error', () => { this.report({ process: 'unknown', connection: 'error', message: 'SSH tunnel failed' }) })
    signal.throwIfAborted()
    if (!this.connected) throw new Error('SSH connection closed before tunnel became ready')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('SSH tunnel has no local listener')
    ready.port = String(address.port)
    this.webUrl = ready.href
    return ready.href
  }
  /** Close all local listeners and SSH channels, leaving tmux and DSH running. */
  async disconnect(): Promise<void> {
    const server = this.server
    this.server = undefined
    const client = this.client
    this.client = undefined
    this.connected = false
    this.webUrl = undefined
    this.cookie = undefined
    const closed = this.clientClosed
    this.clientClosed = undefined
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    const stopped = server?.listening ? new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
    }) : Promise.resolve()
    client?.destroy()
    await stopped
    // A client that never called connect() has no transport to emit close.
    if (client && closed) await Promise.race([closed, delay(1000)])
  }
  /** Verify ownership over a fresh SSH connection before stopping the remote process. */
  async stop(credentials: InstanceCredentials): Promise<void> {
    await this.disconnect()
    try {
      const client = await this.authenticate(new AbortController().signal, credentials)
      await this.execute(client, remoteScript(this.config, 'stop'))
    } finally { await this.disconnect() }
  }

  /**
   * Send a request through this instance's authenticated Web connection.
   * @param request - Request on the connected instance origin; other origins are refused.
   * @returns Remote response after the launch token has been exchanged for a session cookie.
   */
  async fetch(request: Request): Promise<Response> {
    const base = this.webUrl
    if (!base || !this.connected || new URL(request.url).origin !== new URL(base).origin) throw new Error('Remote Web connection is unavailable')
    if (!this.cookie) {
      const login = await fetch(base, { redirect: 'manual', signal: request.signal })
      try {
        if (login.status !== 303) throw new Error('Remote Web authentication failed')
        const cookies = login.headers.getSetCookie()
        if (!cookies.length) throw new Error('Remote Web authentication returned no session cookie')
        this.cookie = cookies.map(cookie => cookie.split(';', 1)[0]).join('; ')
      } finally { await login.body?.cancel() }
    }
    const headers = new Headers(request.headers)
    headers.set('cookie', this.cookie)
    headers.set('origin', new URL(base).origin)
    return fetch(new Request(request, { headers, redirect: 'manual' }))
  }

  private async pluginApi(operation: 'prepare' | 'apply', payload: object): Promise<Record<string, unknown>> {
    if (!this.webUrl) throw new Error('Connect to the remote instance before injecting plugins')
    const rpcId = randomUUID()
    const response = await this.fetch(new Request(new URL(`/api/profile-plugins/${operation}`, this.webUrl), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: operation, payload }),
    }))
    const mediaType = response.headers.get('content-type') ?? ''
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      throw new Error('Remote Web authentication refused the plugin request; reconnect the instance')
    }
    if (response.status === 404 || !mediaType.includes('application/json')) {
      await response.body?.cancel()
      throw new Error('Remote DSH does not support Web plugin deployment; update the remote DSH installation')
    }
    const value: unknown = await response.json()
    if (!response.ok || typeof value !== 'object' || value === null || !('rpcId' in value) || value.rpcId !== rpcId
      || !('result' in value) || typeof value.result !== 'object' || value.result === null) throw new Error('Invalid remote plugin response')
    const result = value.result as Record<string, unknown>
    if (result.ok === false) {
      const error = result.error as { message?: unknown } | undefined
      throw new Error(typeof error?.message === 'string' ? error.message : 'Remote plugin deployment failed')
    }
    if (result.ok !== true || typeof result.value !== 'object' || result.value === null) throw new Error('Invalid remote plugin result')
    return result.value as Record<string, unknown>
  }

  /**
   * Prepare and schedule plugins through Web, then restart using the existing SSH lifecycle.
   * @param plugin - Version selected in the shell library.
   * @param credentials - Session-only SSH authentication.
   * @returns Completion after the new remote Host reaches readiness; no local tunnel remains.
   */
  async injectPlugin(plugin: { name: string; version: string }, credentials: InstanceCredentials): Promise<void> {
    const prepared = await this.pluginApi('prepare', plugin)
    if (typeof prepared.preparation !== 'string') throw new Error('Invalid remote plugin preparation')
    const applied = await this.pluginApi('apply', { preparation: prepared.preparation })
    if (applied.restartRequired !== true) throw new Error('Remote plugin deployment did not acknowledge restart')
    try {
      await this.stop(credentials)
      await this.connect(new AbortController().signal, credentials)
    } catch (error) {
      try {
        await this.stop(credentials)
        await this.connect(new AbortController().signal, credentials)
      } catch (recoveryError) {
        throw new Error(`${String(error)}; remote Profile restart failed: ${String(recoveryError)}. Inspect ${this.config.home}/profiles/web/.plugin-deployment.json`, { cause: error })
      }
      throw error
    } finally { await this.disconnect() }
  }
}
