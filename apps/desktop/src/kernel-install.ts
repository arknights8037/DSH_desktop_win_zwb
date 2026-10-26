/** Prepare an official npm kernel beside the bundled fallback and verify its real Desktop transport. */
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { DESKTOP_HOST_PACKAGE } from './core-package-set.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from './host-protocol.ts'
import { DesktopHostProcess } from './host-process.ts'
import { DesktopProjectManager, type DesktopRuntimeExecutables } from './project-manager.ts'
import { resolveDesktopPaths } from './paths.ts'
import { readDesktopRuntime, verifyDesktopRuntime, writeDesktopRuntime } from './runtime-tree.ts'
import { removeOwnedDirectoryAsync, renameOwnedDirectory } from './owned-directory.ts'
import { DesktopPluginLibrary } from './plugin-library.ts'
import { DESKTOP_DEFAULT_PLUGINS } from './default-plugins.ts'
import { instanceSettings } from './manager-settings.ts'

async function pnpm(runtime: DesktopRuntimeExecutables, cwd: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(runtime.node, [runtime.pnpm, '--dir', cwd, '--config.userconfig=' + join(cwd, 'npmrc'),
      '--config.registry=https://registry.npmjs.org/', '--config.enable-global-virtual-store=false', ...args], {
      windowsHide: true, env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'NODE_OPTIONS' && name !== 'NODE_PATH' && !/^(?:npm|pnpm|corepack)_/iu.test(name))),
        ELECTRON_RUN_AS_NODE: '1', PATH: `${dirname(runtime.node)}${delimiter}${process.env.PATH ?? ''}`,
      }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let diagnostic = ''
    child.stderr.on('data', (data: Buffer) => { diagnostic = (diagnostic + data.toString()).slice(-8192) })
    child.stdout.on('data', (data: Buffer) => { diagnostic = (diagnostic + data.toString()).slice(-8192) })
    const timeout = setTimeout(() => { child.kill() }, 300_000)
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      if (code === 0) resolve()
      else reject(new Error(`Kernel package preparation failed (${String(code ?? signal)}): ${diagnostic}`))
    })
  })
}

/**
 * Materialize and launch-test one kernel and its three default plugins without opening user data.
 * @param version - Exact official npm version.
 * @param directory - Unpublished version directory under the shell kernel store.
 * @param bundled - Bundled Node, pnpm, and matching Desktop transport implementation.
 * @param libraryRoot - Shared shell plugin-library location.
 * @param fetcher - Registry metadata transport, including shell proxy settings.
 * @returns Completion after version publication; failed stages remain unselected.
 */
export async function prepareDesktopKernel(
  version: string, directory: string, bundled: DesktopRuntimeExecutables, libraryRoot: string, fetcher: typeof fetch = fetch,
): Promise<void> {
  if (existsSync(join(directory, 'desktop-runtime.json'))) {
    const descriptor = await verifyDesktopRuntime(directory, version)
    const previousBridge = await readFile(join(directory, 'node_modules', DESKTOP_HOST_PACKAGE, 'lib/index.js'))
    const bridge = await readFile(join(bundled.dsh, 'node_modules', DESKTOP_HOST_PACKAGE, 'lib/index.js'))
    const release = readDesktopRuntime(bundled.dsh).release
    if (previousBridge.equals(bridge) && descriptor.release.nodeVersion === release.nodeVersion
      && descriptor.release.pnpmVersion === release.pnpmVersion) return
  }
  await mkdir(dirname(directory), { recursive: true })
  const stage = await mkdtemp(join(dirname(directory), '.preparing-'))
  const installation = await mkdtemp(join(tmpdir(), 'dsh-kernel-install-'))
  const home = await mkdtemp(join(tmpdir(), 'dsh-kernel-smoke-'))
  let host: DesktopHostProcess | undefined
  try {
    const hostManifest = JSON.parse(await readFile(join(bundled.dsh, 'node_modules', DESKTOP_HOST_PACKAGE, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    const dependencies: Record<string, string> = { '@deepseek-ai/dsh': version, '@deepseek-ai/dsh-client-store': version }
    for (const name of Object.keys(hostManifest.dependencies)) if (name.startsWith('@deepseek-ai/dsh-')) dependencies[name] = version
    for (const plugin of DESKTOP_DEFAULT_PLUGINS) {
      const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(plugin.name)}/${plugin.version}`, {
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`Default plugin metadata failed (${response.status}): ${plugin.name}`)
      const metadata: unknown = await response.json()
      if (typeof metadata !== 'object' || metadata === null || !('peerDependencies' in metadata)
        || typeof metadata.peerDependencies !== 'object' || metadata.peerDependencies === null) {
        throw new Error(`Default plugin metadata lacks Host peers: ${plugin.name}`)
      }
      for (const [name, range] of Object.entries(metadata.peerDependencies)) {
        // The pinned at-file adapter replaces its retired runtime peer with client-store.
        if (name.startsWith('@deepseek-ai/dsh-') && name !== '@deepseek-ai/dsh-client-runtime') dependencies[name] = version
        if ((name === 'react' || name === 'react-dom') && typeof range === 'string') dependencies[name] = range
      }
    }
    await writeFile(join(installation, 'package.json'), `${JSON.stringify({ name: 'dsh-managed-kernel', private: true, type: 'module', dependencies })}\n`)
    await writeFile(join(installation, 'npmrc'), '')
    await writeFile(join(installation, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\nautoInstallPeers: true\nstrictDepBuilds: true\nallowBuilds:\n  node-pty: true\n  koffi: true\n  fs-ext: true\n  node-addon-require-builtin: true\n')
    await pnpm(bundled, installation, ['install', '--prod', '--ignore-scripts', '--registry=https://registry.npmjs.org/'])
    await pnpm(bundled, installation, ['rebuild', '--pending'])
    await cp(join(installation, 'node_modules'), join(stage, 'node_modules'), {
      recursive: true, dereference: true, filter: source => !source.split(/[\\/]/u).includes('.bin'),
    })
    await cp(join(bundled.dsh, 'node_modules', DESKTOP_HOST_PACKAGE), join(stage, 'node_modules', DESKTOP_HOST_PACKAGE), { recursive: true, dereference: true })
    const hostDependencies: Record<string, string> = {}
    for (const name of Object.keys(hostManifest.dependencies)) {
      const installed = JSON.parse(await readFile(join(stage, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }
      hostDependencies[name] = installed.version
    }
    await writeFile(join(stage, 'node_modules', DESKTOP_HOST_PACKAGE, 'package.json'), `${JSON.stringify({ ...hostManifest, dependencies: hostDependencies, name: DESKTOP_HOST_PACKAGE, version, type: 'module', main: 'lib/index.js' })}\n`)
    await writeFile(join(stage, 'package.json'), `${JSON.stringify({ name: 'dsh-managed-kernel', version, private: true, type: 'module', dependencies })}\n`)
    const shared = (await readdir(join(stage, 'node_modules', '@deepseek-ai'))).map(name => `@deepseek-ai/${name}`)
    for (const name of ['react', 'react-dom']) if (existsSync(join(stage, 'node_modules', name, 'package.json'))) shared.push(name)
    const bundledRelease = readDesktopRuntime(bundled.dsh).release
    writeDesktopRuntime(stage, { ...bundledRelease, version, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION }, shared)
    const runtime: DesktopRuntimeExecutables = { ...bundled, dsh: stage, profileResolution: 'runtime' }
    const library = new DesktopPluginLibrary(libraryRoot, runtime)
    const manager = new DesktopProjectManager(resolveDesktopPaths(home), runtime)
    await manager.applyRelease()
    for (const plugin of DESKTOP_DEFAULT_PLUGINS) {
      library.select(plugin.name, plugin.version)
      await library.withSource(plugin.name, plugin.version, source => manager.mutate({ type: 'plugin-inject', ...plugin, source }, {
        beforeChange: async () => {}, afterChange: async () => {},
      }))
    }
    host = new DesktopHostProcess(runtime.node, stage, manager.paths.profile, undefined, { ...process.env, DSH_HOME: home }, () => {})
    const ready = await host.start()
    if (ready.dshVersion !== version) throw new Error('Kernel probe reported a different DSH version')
    const response = await host.fetch(new Request('dsh-app://app/index.html'))
    if (!response.ok || !(await response.text()).includes('<html')) throw new Error('Kernel probe could not load its Web client')
    const streamLifetime = new AbortController()
    try {
      const events = await host.fetch(new Request('dsh-app://app/.dsh/remote-stream', {
        method: 'POST', body: JSON.stringify({ endpoint: '$events', payload: { args: {} } }),
        signal: AbortSignal.any([streamLifetime.signal, AbortSignal.timeout(15_000)]),
      }))
      if (!events.ok || events.body === null) throw new Error('Kernel probe could not open its event stream')
      const reader = events.body.getReader()
      try {
        const first = await reader.read()
        if (first.done) throw new Error('Kernel event stream ended before readiness')
        const frame: unknown = JSON.parse(new TextDecoder().decode(first.value))
        if (typeof frame !== 'object' || frame === null || !('type' in frame) || frame.type !== 'ready'
          || !('clientId' in frame) || typeof frame.clientId !== 'string') throw new Error('Kernel event stream omitted its readiness frame')
      } finally { streamLifetime.abort(); await reader.cancel().catch(() => undefined) }
    } finally { streamLifetime.abort() }
    const runningHost = host
    const settings = await instanceSettings(request => runningHost.fetch(request), 'dsh-app://app/', 'read', {}) as {
      namespaces: Array<{ ns: string; revision: number; value: Record<string, unknown> }>
    }
    for (const [namespace, field] of [['ui-theme', 'fontSize'], ['locale', 'preference'], ['ui-conversation', 'busyEnter'],
      ['llm-deepseek', 'maxTokens'], ['agent-default-model', 'reasoningEffort']] as const) {
      const section = settings.namespaces.find(item => item.ns === namespace)
      if (!section) throw new Error(`Kernel probe lacks settings namespace ${namespace}`)
      if (section.value[field] === undefined) continue
      await instanceSettings(request => runningHost.fetch(request), 'dsh-app://app/', 'update', {
        namespace, edits: { [field]: section.value[field] }, revision: section.revision,
      })
    }
    await host.stop()
    host = undefined
    const replaced = existsSync(directory) ? await mkdtemp(join(dirname(directory), '.previous-')) : undefined
    if (replaced !== undefined) {
      await removeOwnedDirectoryAsync(replaced)
      await renameOwnedDirectory(directory, replaced)
    }
    try { await renameOwnedDirectory(stage, directory) }
    catch (error) {
      if (replaced !== undefined) await renameOwnedDirectory(replaced, directory)
      throw error
    }
    if (replaced !== undefined) await removeOwnedDirectoryAsync(replaced)
  } finally {
    await host?.stop()
    if (existsSync(stage)) await removeOwnedDirectoryAsync(stage)
    await removeOwnedDirectoryAsync(installation)
    await removeOwnedDirectoryAsync(home)
  }
}
