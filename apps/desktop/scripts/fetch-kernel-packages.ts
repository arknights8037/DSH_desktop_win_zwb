/** Download the npm package closure for the kernel release selected by Desktop. */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const KERNEL_RELEASE = JSON.parse(readFileSync(join(APP_ROOT, 'config/kernel-release.json'), 'utf8')) as { version?: unknown }
const DSH_PACKAGE = '@deepseek-ai/dsh'
const OMITTED_PACKAGES = new Set(['@deepseek-ai/libreoffice-kit'])
const NPM_CLI = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')

function runNpm(args: readonly string[], cwd = REPOSITORY_ROOT): string {
  if (!existsSync(NPM_CLI)) throw new Error(`desktop kernel packages: npm CLI not found beside Node at ${NPM_CLI}`)
  const result = spawnSync(process.execPath, [NPM_CLI, ...args], { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

function manifestFromTarball(tarball: string): Record<string, unknown> {
  const result = spawnSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8', windowsHide: true })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`cannot read package manifest from ${tarball}: ${result.stderr.trim()}`)
  const manifest: unknown = JSON.parse(result.stdout)
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`invalid npm package manifest in ${tarball}`)
  }
  return manifest as Record<string, unknown>
}

function dependencies(manifest: Readonly<Record<string, unknown>>): string[] {
  const names = new Set<string>()
  for (const section of ['dependencies', 'peerDependencies']) {
    const value = manifest[section]
    if (value === undefined) continue
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${String(manifest.name)} has an invalid ${section} map`)
    }
    for (const name of Object.keys(value)) {
      if (name.startsWith('@deepseek-ai/') && !OMITTED_PACKAGES.has(name)) names.add(name)
    }
  }
  return [...names].sort()
}

function main(): void {
  const args = process.argv.slice(2)
  if (args[0] === '--') args.shift()
  const { values } = parseArgs({
    args,
    options: { out: { type: 'string' }, host: { type: 'string' } },
    allowPositionals: false,
  })
  if (typeof KERNEL_RELEASE.version !== 'string' || KERNEL_RELEASE.version.length === 0) {
    throw new Error('desktop kernel release: config/kernel-release.json must specify an exact version')
  }
  const output = resolve(REPOSITORY_ROOT, values.out ?? '.desktop-build/targets/win-x64/packed/dsh')
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  const queue = [`${DSH_PACKAGE}@${KERNEL_RELEASE.version}`]
  if (values.host !== undefined) {
    const host = manifestFromTarball(resolve(REPOSITORY_ROOT, values.host))
    if (host.name !== '@deepseek-ai/dsh-desktop-host' || host.version !== KERNEL_RELEASE.version) {
      throw new Error(`desktop kernel packages: Host tarball must match kernel release ${KERNEL_RELEASE.version}`)
    }
    for (const name of dependencies(host)) {
      const range = (host.dependencies as Record<string, string> | undefined)?.[name]
        ?? (host.peerDependencies as Record<string, string> | undefined)?.[name]
        ?? (host.optionalDependencies as Record<string, string> | undefined)?.[name]
      if (range !== undefined) queue.push(`${name}@${range}`)
    }
  }
  const seen = new Set<string>()
  while (queue.length > 0) {
    const spec = queue.shift()!
    const packageName = spec.slice(0, spec.lastIndexOf('@'))
    if (seen.has(packageName)) continue
    const result = JSON.parse(runNpm(['pack', spec, '--json', '--pack-destination', output])) as { filename?: unknown }[]
    const filename = result[0]?.filename
    if (typeof filename !== 'string') throw new Error(`npm pack returned no tarball for ${spec}`)
    const manifest = manifestFromTarball(join(output, filename))
    if (manifest.name !== packageName || typeof manifest.version !== 'string') {
      throw new Error(`npm returned an unexpected package for ${spec}`)
    }
    seen.add(packageName)
    for (const dependency of dependencies(manifest)) {
      if (dependency === DSH_PACKAGE) continue
      const range = (manifest.dependencies as Record<string, string> | undefined)?.[dependency]
        ?? (manifest.peerDependencies as Record<string, string> | undefined)?.[dependency]
      if (range === undefined) continue
      const exact = dependency === DSH_PACKAGE ? KERNEL_RELEASE.version : range
      queue.push(`${dependency}@${exact}`)
    }
  }
  console.log(`desktop kernel packages: downloaded ${seen.size} npm packages for dsh@${KERNEL_RELEASE.version} and Desktop Host`)
}

if (import.meta.main) main()
