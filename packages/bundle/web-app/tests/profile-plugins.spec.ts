/** Profile plugin RPC registration through Loader and the authenticated HTTP carrier. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { expect, it, vi } from 'vitest'
import { provideBrowserCredentials } from '../../../client/connection/tests/browser-credentials.ts'
import { registerProfilePluginApi, type ProfilePluginPreparation } from '../src/profile-plugins.ts'

function result(body: string): unknown {
  return (JSON.parse(body) as { result: unknown }).result
}

it('authenticates shell deployment requests, validates payloads, and withdraws routes with the plugin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-web-api-'))
  const ctx = new Context()
  const preparation = 'aaaaaaaa-1111-4111-8111-111111111111' as ProfilePluginPreparation
  const prepare = vi.fn(async () => preparation)
  const apply = vi.fn(async () => {})
  try {
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.builtins.webserver = WebServer
    ctx.loader.builtins.connection = Connection
    ctx.loader.builtins['profile-plugins'] = { apply: registerProfilePluginApi }
    provideBrowserCredentials(ctx)
    ctx.provide('profilePlugins', { prepare, apply })
    writeFileSync(join(dir, 'cordis.yml'), [
      '- id: profile-plugins', '  name: cordis:profile-plugins',
      '- name: cordis:connection',
      '- name: cordis:webserver', '  config:', '    host: 127.0.0.1', '    port: 0', '',
    ].join('\n'))
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
    await ctx.loader.await()
    expect(ctx.get('profilePlugins')).toBeDefined()
    expect(ctx.get('connection')).toBeDefined()
    const base = `http://127.0.0.1:${ctx.webServer.port}`
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/', handler: (request, response) => {
      if (!ctx.connection.authorizeIndex(request, response)) return
      response.end('test index')
    } }))
    const request = async (endpoint: string, payload: unknown, cookie?: string, origin = base) => {
      const response = await fetch(`${base}/api/profile-plugins/${endpoint}`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin, ...cookie === undefined ? {} : { cookie } },
        body: JSON.stringify({ type: 'client-request', rpcId: 'test-request', method: endpoint, payload }),
      })
      return { status: response.status, body: await response.text() }
    }
    expect((await request('prepare', { name: 'plugin', version: '1.2.3' })).status).toBe(401)
    const login = await fetch(ctx.connection.authenticatedUrl(base), { redirect: 'manual' })
    expect(login.status).toBe(303)
    const cookie = login.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
    await login.body?.cancel()
    expect((await request('prepare', {}, cookie, 'https://unrelated.test')).status).toBe(403)
    expect(prepare).not.toHaveBeenCalled()
    const ready = await request('prepare', { name: 'plugin', version: '1.2.3' }, cookie)
    expect(result(ready.body)).toEqual({ ok: true, value: { preparation } })
    expect(prepare).toHaveBeenCalledWith({ name: 'plugin', version: '1.2.3' }, expect.any(AbortSignal))
    expect(result((await request('apply', { preparation }, cookie)).body)).toEqual({ ok: true, value: { restartRequired: true } })
    expect(apply).toHaveBeenCalledWith(preparation)
    expect(result((await request('apply', { preparation: '../outside' }, cookie)).body)).toMatchObject({ ok: false })
    expect(result((await request('prepare', { name: 7 }, cookie)).body)).toMatchObject({ ok: false })
    expect((await request('other', {}, cookie)).status).toBe(404)
    prepare.mockRejectedValueOnce(new Error('Target package cannot be installed'))
    expect(result((await request('prepare', { name: 'plugin', version: '1.2.3' }, cookie)).body))
      .toMatchObject({ ok: false, error: { message: 'Target package cannot be installed' } })
    prepare.mockRejectedValueOnce('Target unavailable')
    expect(result((await request('prepare', { name: 'plugin', version: '1.2.3' }, cookie)).body))
      .toMatchObject({ ok: false, error: { message: 'Target unavailable' } })
    for (const payload of [null, [], 'plugin', { name: 'plugin', version: 7 }]) {
      expect(result((await request('prepare', payload, cookie)).body)).toMatchObject({ ok: false })
    }
    expect(result((await request('apply', { preparation: 7 }, cookie)).body)).toMatchObject({ ok: false })
    for (const [body, contentType, status] of [
      ['{', 'application/json', 400], ['{}', 'application/json', 400],
      [JSON.stringify({ type: 'client-request', rpcId: 'wrong-method', method: 'apply', payload: {} }), 'application/json', 400],
      ['{}', 'text/plain', 415],
    ] as const) {
      const response = await fetch(`${base}/api/profile-plugins/prepare`, {
        method: 'POST', headers: { cookie, origin: base, 'content-type': contentType }, body,
      })
      await response.body?.cancel()
      expect(response.status).toBe(status)
    }
    const noMediaType = await fetch(`${base}/api/profile-plugins/prepare`, { method: 'POST', headers: { cookie, origin: base } })
    await noMediaType.body?.cancel()
    expect(noMediaType.status).toBe(415)
    await ctx.loader.entries().find(entry => entry.id.endsWith(':profile-plugins'))!.fiber!.dispose()
    expect((await request('prepare', { name: 'plugin', version: '1.2.3' }, cookie)).status).toBe(404)
  } finally {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
