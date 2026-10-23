import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { c } from 'tar'
import { expect, it } from 'vitest'
import { DesktopProjectManager, type DesktopProjectHooks } from '../src/project-manager.ts'
import { resolveDesktopPaths } from '../src/paths.ts'
import { runtimeFixture, writePackage } from './runtime-fixture.ts'
import { DesktopPluginLibrary } from '../src/plugin-library.ts'
import { activateProfilePluginUpdate, ProfilePlugins } from '../../cli/src/profile-plugins.ts'

it('installs a real pnpm graph, then executes approved scripts with the shared host instance', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-real-pnpm-')))
  const server = createServer()
  const archives = new Map<string, Buffer>()
  try {
    for (const name of ['fixture-plugin', 'node-pty']) {
      const path = writePackage(join(root, 'packages'), name, name === 'fixture-plugin'
        ? { dependencies: { 'node-pty': '1.0.0' }, peerDependencies: { '@deepseek-ai/cordis': '^1.0.0' }, dsh: { bundle: { patch: 'bundle.yml' } } }
        : { scripts: { install: 'node install.cjs' } }, 'export {identity} from "@deepseek-ai/cordis"')
      writeFileSync(join(path, 'bundle.yml'), '[]\n')
      writeFileSync(join(path, 'install.cjs'), 'require("node:fs").writeFileSync("built.json", JSON.stringify({node:process.execPath, host:require.resolve("@deepseek-ai/cordis")}))')
      const tarball = join(root, `${name}.tgz`)
      await c({ file: tarball, cwd: join(path, '..'), gzip: true }, [name])
      archives.set(name, readFileSync(tarball))
    }
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fixture registry has no TCP address')
    const origin = `http://127.0.0.1:${address.port}`
    server.on('request', (request, response) => {
      const name = request.url?.slice(1).replace(/\.tgz$/u, '') ?? ''
      const archive = archives.get(name)
      if (archive === undefined) { response.writeHead(404); response.end(); return }
      if (request.url?.endsWith('.tgz')) { response.end(archive); return }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ name, 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {
        name, version: '1.0.0', dist: { tarball: `${origin}/${name}.tgz`, integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}` },
        ...(name === 'fixture-plugin' ? { dependencies: { 'node-pty': '1.0.0' }, peerDependencies: { '@deepseek-ai/cordis': '^1.0.0' } } : {}),
      } }, time: { '1.0.0': '2020-01-01T00:00:00.000Z' } }))
    })
    const dsh = join(root, 'dsh')
    runtimeFixture(dsh)
    const pnpm = join(root, 'pnpm.mjs')
    const realPnpm = join(import.meta.dirname, '../node_modules/pnpm/bin/pnpm.mjs')
    writeFileSync(pnpm, `process.argv = process.argv.map(arg => arg === '--config.registry=https://registry.npmjs.org/' ? ${JSON.stringify(`--config.registry=${origin}`)} : arg); await import(${JSON.stringify(pathToFileURL(realPnpm).href)})`)
    const manager = new DesktopProjectManager(resolveDesktopPaths(join(root, '.dsh')), { node: process.execPath, pnpm, dsh })
    const hooks: DesktopProjectHooks = { beforeChange: async () => {}, afterChange: async () => {} }
    await manager.applyRelease()
    await manager.mutate({ type: 'plugin-add', spec: 'fixture-plugin@1.0.0' }, hooks)
    expect(manager.listPlugins()).toEqual([{ name: 'fixture-plugin', version: '1.0.0', enabled: true }])
    const built = JSON.parse(readFileSync(join(manager.paths.profile, 'node_modules/node-pty/built.json'), 'utf8')) as { node: string; host: string }
    expect(realpathSync(built.node)).toBe(realpathSync(process.execPath))
    expect(built.host).toBe(join(dsh, 'node_modules/@deepseek-ai/cordis/index.js'))
    const entry = join(dsh, 'identity.mjs')
    writeFileSync(entry, `import {identity} from '@deepseek-ai/cordis'; import {identity as plugin} from ${JSON.stringify(pathToFileURL(join(manager.paths.profile, 'node_modules/fixture-plugin/index.js')).href)}; console.log(identity === plugin)`)
    expect(execFileSync(process.execPath, [entry], { encoding: 'utf8' }).trim()).toBe('true')
    const library = new DesktopPluginLibrary(join(root, 'library'), manager.runtime)
    await library.install('fixture-plugin', '1.0.0')
    const injected = new DesktopProjectManager(resolveDesktopPaths(join(root, 'injected-instance')), manager.runtime)
    await injected.applyRelease()
    await injected.mutate({ type: 'plugin-inject', name: 'fixture-plugin', version: '1.0.0',
      source: library.source('fixture-plugin', '1.0.0'),
    }, hooks)
    library.remove('fixture-plugin', '1.0.0')
    const copiedPlugin = realpathSync(join(injected.paths.profile, 'node_modules/fixture-plugin'))
    writeFileSync(entry, `import {identity} from '@deepseek-ai/cordis'; import {identity as plugin} from ${JSON.stringify(pathToFileURL(join(copiedPlugin, 'index.js')).href)}; console.log(identity === plugin)`)
    expect(execFileSync(process.execPath, [entry], { encoding: 'utf8' }).trim()).toBe('true')
    expect(readFileSync(join(copiedPlugin, '../node-pty/built.json'), 'utf8')).toContain(process.execPath.replaceAll('\\', '\\\\'))
    expect(injected.listPlugins()).toEqual([{ name: 'fixture-plugin', version: '1.0.0', enabled: true }])
    const webProfile = join(root, 'web-instance')
    mkdirSync(webProfile)
    const initial = JSON.stringify({ private: true, dsh: { profile: { bundles: ['base'] } } })
    writeFileSync(join(webProfile, 'package.json'), initial)
    writeFileSync(join(webProfile, 'cordis.patch.yml'), '# instance configuration\n')
    const provider = new ProfilePlugins(webProfile, { profilesDir: root, profileDir: webProfile, localPackageNames: [], entries: [{
      name: '@deepseek-ai/cordis', packageDir: join(dsh, 'node_modules/@deepseek-ai/cordis'),
      version: '1.0.0', declarer: join(dsh, 'package.json'), scope: 'installation',
    }] })
    writeFileSync(join(webProfile, '.npmrc'), `registry=${origin}\nstore-dir=${join(root, 'remote-pnpm-store').replaceAll('\\', '/')}\n`)
    try {
      const preparation = await provider.prepare({ name: 'fixture-plugin', version: '1.0.0' }, new AbortController().signal)
      expect(readFileSync(join(webProfile, 'package.json'), 'utf8')).toBe(initial)
      expect(existsSync(join(webProfile, 'node_modules/fixture-plugin'))).toBe(false)
      await provider.apply(preparation)
      expect(readFileSync(join(webProfile, 'package.json'), 'utf8')).toBe(initial)
      const confirm = await activateProfilePluginUpdate(webProfile)
      const remotePlugin = join(webProfile, 'node_modules/fixture-plugin/index.js')
      writeFileSync(entry, `import {identity} from '@deepseek-ai/cordis'; import {identity as plugin} from ${JSON.stringify(pathToFileURL(remotePlugin).href)}; console.log(identity === plugin)`)
      expect(execFileSync(process.execPath, [entry], { encoding: 'utf8' }).trim()).toBe('true')
      expect(existsSync(join(webProfile, '.plugin-copies', preparation, 'node_modules/node-pty/built.json'))).toBe(false)
      confirm()
      expect(existsSync(join(webProfile, '.plugin-deployment.json'))).toBe(false)
      expect(readFileSync(join(webProfile, 'cordis.patch.yml'), 'utf8')).toBe('# instance configuration\n')
    } finally {
      await provider.close()
    }
    await manager.mutate({ type: 'plugin-remove', name: 'fixture-plugin' }, hooks)
    expect(manager.listPlugins()).toEqual([])
  } finally {
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) reject(error)
        else resolve()
      })
    })
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
