import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { InstanceService, redactDiagnostic, type InstanceRuntime } from '../src/instance-service.ts'
import { instanceId, type InstanceConfig, type InstanceStatus } from '../src/instances.ts'
function config(kind: 'local' | 'ssh' = 'local'): InstanceConfig {
  const id = instanceId(randomUUID())
  return kind === 'local' ? { id, kind, name: id } : { id, kind, name: id, host: 'host', port: 22, username: 'test', auth: 'password', privateKeyPath: '', executable: 'dsh', home: `/tmp/${id}` }
}
function runtime() {
  return { connect: vi.fn<InstanceRuntime['connect']>(async () => 'dsh-app://app/index.html'), disconnect: vi.fn(async () => {}), stop: vi.fn(async () => {}), fetch: vi.fn(async () => new Response('own instance')) }
}
it('coalesces duplicate starts but starts independent instances concurrently', async () => {
  const first = config()
  const second = config()
  const ready = Promise.withResolvers<string>()
  const a = runtime()
  a.connect = vi.fn<InstanceRuntime['connect']>(() => ready.promise)
  const b = runtime()
  const service = new InstanceService(item => item.id === first.id ? a : b, () => {})
  const pending = service.connect(first)
  expect(service.connect(first)).toBe(pending)
  await service.connect(second)
  expect(service.status(second).connection).toBe('connected')
  expect(service.status(first).connection).toBe('connecting')
  ready.resolve('dsh-app://app/index.html')
  await pending
  expect(a.connect).toHaveBeenCalledTimes(1)
  await service.close()
})
it('cancels pending startup before awaiting cleanup and never publishes ready', async () => {
  const item = config()
  const started = Promise.withResolvers<undefined>()
  const host = runtime()
  host.connect = vi.fn<InstanceRuntime['connect']>((signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
    signal.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
    started.resolve(undefined)
  }))
  const service = new InstanceService(() => host, () => {})
  const pending = service.connect(item)
  const rejected = expect(pending).rejects.toThrow('cancelled')
  await started.promise
  await service.stop(item.id)
  await rejected
  expect(service.status(item)).toEqual({ process: 'stopped', connection: 'disconnected' })
  expect(host.stop).toHaveBeenCalledTimes(1)
})
it('closing local tabs retains their process and reopening reuses the runtime', async () => {
  const item = config()
  const host = runtime()
  const create = vi.fn(() => host)
  const service = new InstanceService(create, () => {})
  await service.connect(item)
  await service.disconnect(item.id)
  expect(host.stop).not.toHaveBeenCalled()
  expect(service.status(item).process).toBe('running')
  await service.connect(item)
  expect(create).toHaveBeenCalledTimes(1)
  await service.close()
})
it('app exit stops local processes but only disconnects remote transports', async () => {
  const local = config()
  const remote = config('ssh')
  const a = runtime()
  const b = runtime()
  const service = new InstanceService(item => item.kind === 'local' ? a : b, () => {})
  await Promise.all([service.connect(local), service.connect(remote, { password: 'hidden' })])
  await service.close()
  expect(a.stop).toHaveBeenCalledTimes(1)
  expect(b.stop).not.toHaveBeenCalled()
  expect(b.disconnect).toHaveBeenCalledTimes(1)
  await expect(service.connect(local)).rejects.toThrow('shutting down')
})
it('lost SSH connections report unknown process state and redact secrets in logs', async () => {
  let report!: (status: InstanceStatus) => void
  const item = config('ssh')
  const host = runtime()
  const service = new InstanceService((_config, publish) => { report = publish; return host }, () => {})
  await service.connect(item, { password: 'session-secret' })
  report({ process: 'unknown', connection: 'error', message: 'session-secret http://127.0.0.1:5555/?token=abc' })
  expect(service.status(item).process).toBe('unknown')
  expect(service.logs(item.id).join('\n')).not.toMatch(/session-secret|token=abc/u)
  expect(redactDiagnostic('http://127.0.0.1/?token=abc')).toBe('[URL redacted]')
  await service.close()
})
it('cannot fetch through another or unconnected instance', async () => {
  const a = config()
  const b = config()
  const service = new InstanceService(() => runtime(), () => {})
  await service.connect(a)
  expect((await service.fetch(b.id, new Request('http://localhost'))).status).toBe(503)
  expect(await (await service.fetch(a.id, new Request('http://localhost'))).text()).toBe('own instance')
  await service.close()
})
it('stops a saved remote without first launching its process', async () => {
  const item = config('ssh')
  const host = runtime()
  const service = new InstanceService(() => host, () => {})
  await service.stopInstance(item, { password: 'memory-only' })
  expect(host.connect).not.toHaveBeenCalled()
  expect(host.stop).toHaveBeenCalledWith({ password: 'memory-only' })
})
