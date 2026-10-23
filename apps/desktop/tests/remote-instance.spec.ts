import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { createServer as httpServer } from 'node:http'
import { connect } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Server, type Connection } from 'ssh2'
import { expect, it, onTestFinished, vi } from 'vitest'
import { RemoteInstance } from '../src/remote-instance.ts'
import { instanceId } from '../src/instances.ts'

const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
async function fixture(auth: 'password' | 'key' = 'password', rejectScript?: (script: string) => string | undefined) {
  const commands: string[] = []
  let running = false
  const connections = new Set<Connection>()
  const home = mkdtempSync(join(tmpdir(), 'dsh-ssh-test-'))
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  const privateKeyPath = join(home, 'key.pem')
  writeFileSync(privateKeyPath, hostKey)
  const requests: { path: string; cookie: string | undefined; payload: unknown }[] = []
  let webFailure: 'missing' | 'install' | undefined
  const web = httpServer((request, response) => {
    if (request.url === '/?token=secret-token') {
      response.writeHead(303, { 'set-cookie': 'dsh_session=test-session; HttpOnly; Path=/', location: '/' })
      response.end(); return
    }
    if (!request.url?.startsWith('/api/profile-plugins/')) { response.end('remote web response'); return }
    if (webFailure === 'missing') { response.writeHead(404); response.end(); return }
    expect(request.headers.cookie).toBe('dsh_session=test-session')
    expect(request.headers.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)
    let body = ''
    request.on('data', (chunk) => { body += String(chunk) })
    request.on('end', () => {
      const envelope = JSON.parse(body) as { rpcId: string; payload: unknown }
      requests.push({ path: request.url!, cookie: request.headers.cookie, payload: envelope.payload })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ type: 'server-response', rpcId: envelope.rpcId, result: webFailure === 'install'
        ? { ok: false, error: { message: 'Target dependency preparation failed' } }
        : { ok: true, value: request.url?.endsWith('/prepare') ? { preparation: 'remote-copy' } : { restartRequired: true } } }))
    })
  })
  await new Promise<void>(resolve => web.listen(0, '127.0.0.1', resolve))
  onTestFinished(async () => { web.closeAllConnections(); await new Promise<void>(resolve => web.close(() => { resolve() })) })
  const webAddress = web.address()
  if (!webAddress || typeof webAddress === 'string') throw new Error('Missing HTTP listener')
  const ssh = new Server({ hostKeys: [hostKey] }, (client) => {
    connections.add(client)
    client.on('error', () => {})
    client.once('close', () => { connections.delete(client) })
    client.on('authentication', (context) => {
      if (context.method === 'password' && context.password === 'test-secret') context.accept()
      else if (auth === 'key' && context.method === 'publickey') context.accept()
      else context.reject()
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        session.on('exec', (acceptExec, _reject, info) => {
          const channel = acceptExec()
          expect(info.command).toBe('sh -s')
          let script = ''
          channel.on('data', (chunk: Buffer) => { script += chunk.toString() })
          channel.on('end', () => {
            commands.push(script)
            const failure = rejectScript?.(script)
            if (failure) {
              channel.stderr.write(failure)
              channel.exit(1)
              channel.end()
              return
            }
            if (script.includes('new-session')) running = true
            if (script.includes('kill-session')) running = false
            const reading = script.includes('tail -c')
            if (reading && running) channel.write(`dsh web: http://127.0.0.1:${webAddress.port}/?token=secret-token\n`)
            channel.exit(reading && !running ? 1 : 0)
            channel.end()
          })
        })
      })
      client.on('tcpip', (accept, _reject, info) => {
        const stream = accept()
        const socket = connect(info.destPort, info.destIP, () => { stream.pipe(socket).pipe(stream) })
        socket.on('error', () => { stream.destroy() })
        stream.on('error', () => { socket.destroy() })
        stream.once('close', () => { socket.destroy() })
      })
    })
  })
  await new Promise<void>(resolve => ssh.listen(0, '127.0.0.1', resolve))
  onTestFinished(async () => {
    for (const client of connections) client.end()
    await new Promise<void>((resolve) => { ssh.close(() => { resolve() }) })
  })
  const address = ssh.address()
  if (!address || typeof address === 'string') throw new Error('Missing SSH listener')
  const config = { id: instanceId(randomUUID()), name: 'test', kind: 'ssh' as const, host: '127.0.0.1', port: address.port, username: 'test', auth, privateKeyPath, executable: 'dsh', home: '/tmp/test-instance' }
  const verify = vi.fn(async () => true)
  const report = vi.fn()
  const runtime = new RemoteInstance(config, verify, report)
  onTestFinished(() => runtime.disconnect())
  return { runtime, verify, report, commands, connections, requests,
    setWebFailure: (value: typeof webFailure) => { webFailure = value }, isRunning: () => running }
}
it('authenticates, tunnels HTTP, disconnects without stopping, and resumes the same remote', async () => {
  const test = await fixture()
  const url = await test.runtime.connect(new AbortController().signal, { password: 'test-secret' })
  expect(await (await fetch(new URL('/', url))).text()).toBe('remote web response')
  expect(test.verify).toHaveBeenCalledWith(expect.stringContaining('127.0.0.1:'), expect.stringMatching(/^[a-f0-9]{64}$/u))
  await test.runtime.disconnect()
  expect(test.isRunning()).toBe(true)
  expect(test.commands.some(command => command.includes('kill-session'))).toBe(false)
  await test.runtime.connect(new AbortController().signal, { password: 'test-secret' })
  await test.runtime.stop({ password: 'test-secret' })
  expect(test.isRunning()).toBe(false)
})
it('supports private key authentication without persisting the key content', async () => {
  const test = await fixture('key')
  const url = await test.runtime.connect(new AbortController().signal, {})
  expect(await (await fetch(new URL('/', url))).text()).toBe('remote web response')
})
it('deploys through authenticated Web RPC and uses SSH only for process lifecycle', async () => {
  const test = await fixture()
  await test.runtime.connect(new AbortController().signal, { password: 'test-secret' })
  await test.runtime.injectPlugin({ name: '@example/plugin', version: '1.2.3' }, { password: 'test-secret' })
  expect(test.requests.map(request => [request.path, request.payload])).toEqual([
    ['/api/profile-plugins/prepare', { name: '@example/plugin', version: '1.2.3' }],
    ['/api/profile-plugins/apply', { preparation: 'remote-copy' }],
  ])
  expect(test.commands.join('\n')).not.toMatch(/pnpm|plugin --profile|cp -a|manager-plugin-snapshot/u)
  expect(test.commands.filter(command => command.includes('new-session'))).toHaveLength(2)
  expect(test.isRunning()).toBe(true)
})
it.each(['missing', 'install'] as const)('preserves the running instance when the Web API rejects preparation: %s', async (failure) => {
  const test = await fixture()
  await test.runtime.connect(new AbortController().signal, { password: 'test-secret' })
  test.setWebFailure(failure)
  await expect(test.runtime.injectPlugin({ name: 'plugin', version: '1.2.3' }, { password: 'test-secret' }))
    .rejects.toThrow(failure === 'missing' ? 'update the remote DSH' : 'Target dependency preparation failed')
  expect(test.commands.some(command => command.includes('kill-session'))).toBe(false)
  expect(test.isRunning()).toBe(true)
})
it('refuses Web requests to an unrelated origin', async () => {
  const test = await fixture()
  await test.runtime.connect(new AbortController().signal, { password: 'test-secret' })
  await expect(test.runtime.fetch(new Request('http://example.com/api/profile-plugins/prepare'))).rejects.toThrow('unavailable')
})
it('rejects bad passwords before executing any remote command', async () => {
  const test = await fixture()
  await expect(test.runtime.connect(new AbortController().signal, { password: 'wrong' })).rejects.toThrow()
  expect(test.commands).toEqual([])
})
it('blocks an untrusted server key without starting a remote process', async () => {
  const test = await fixture()
  test.verify.mockResolvedValue(false)
  await expect(test.runtime.connect(new AbortController().signal, { password: 'test-secret' })).rejects.toThrow()
  expect(test.commands).toEqual([])
})
it('retains the host-key-change diagnostic instead of a generic handshake failure', async () => {
  const test = await fixture()
  test.verify.mockRejectedValue(new Error('SSH host key changed'))
  await expect(test.runtime.connect(new AbortController().signal, { password: 'test-secret' })).rejects.toThrow('host key changed')
})
it('reports unknown process state when the authenticated connection is lost', async () => {
  const test = await fixture()
  await test.runtime.connect(new AbortController().signal, { password: 'test-secret' })
  for (const client of test.connections) client.end()
  await vi.waitFor(() => { expect(test.report).toHaveBeenCalledWith(expect.objectContaining({ process: 'unknown', connection: 'error' })) })
  expect(test.isRunning()).toBe(true)
})
