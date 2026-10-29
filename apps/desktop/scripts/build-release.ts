/** Compile Desktop and its private Host in an isolated npm installation. */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const HOST_ROOT = join(REPOSITORY_ROOT, 'apps/desktop-host')
const STAGE_ROOT = mkdtempSync(join(tmpdir(), 'dsh-desktop-release-'))
const NPM_CLI = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const KERNEL_RELEASE = JSON.parse(readFileSync(join(APP_ROOT, 'config/kernel-release.json'), 'utf8')) as { version?: unknown }

function runNode(args: readonly string[], cwd: string): void {
  const result = spawnSync(process.execPath, [...args], { cwd, stdio: 'inherit', windowsHide: true })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`desktop release build: ${basename(args[0] ?? 'command')} failed with ${String(result.status)}`)
}

function copyPackage(source: string, destination: string): void {
  cpSync(source, destination, {
    recursive: true,
    filter(path) {
      const relativePath = path.slice(source.length).replaceAll('\\', '/').replace(/^\//u, '')
      return relativePath !== 'node_modules' && !relativePath.startsWith('node_modules/')
        && relativePath !== 'lib' && !relativePath.startsWith('lib/')
        && relativePath !== '.desktop-build' && !relativePath.startsWith('.desktop-build/')
    },
  })
}

function npmInstall(packageRoot: string): void {
  if (!existsSync(NPM_CLI)) throw new Error(`desktop release build: npm CLI not found beside Node at ${NPM_CLI}`)
  runNode([NPM_CLI, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'], packageRoot)
}

function pinKernelDependencies(packageRoot: string): void {
  if (typeof KERNEL_RELEASE.version !== 'string' || KERNEL_RELEASE.version === '') {
    throw new Error('desktop release build: config/kernel-release.json must specify an exact version')
  }
  const manifestPath = join(packageRoot, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  for (const section of [manifest.dependencies, manifest.devDependencies]) {
    for (const name of Object.keys(section ?? {})) {
      if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) {
        section![name] = KERNEL_RELEASE.version
      }
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
}

function compile(packageRoot: string, tsconfig: string): void {
  const tsc = join(packageRoot, 'node_modules/typescript/bin/tsc')
  const tsdown = join(packageRoot, 'node_modules/tsdown/dist/run.mjs')
  if (!existsSync(tsc) || !existsSync(tsdown)) throw new Error(`desktop release build: compiler tools are missing in ${packageRoot}`)
  runNode([tsc, '-p', tsconfig], packageRoot)
  runNode([tsdown, '--config-loader', 'native'], packageRoot)
}

try {
  const stagedDesktop = join(STAGE_ROOT, 'desktop')
  const stagedHost = join(STAGE_ROOT, 'desktop-host')
  mkdirSync(stagedDesktop, { recursive: true })
  mkdirSync(stagedHost, { recursive: true })
  copyPackage(APP_ROOT, stagedDesktop)
  copyPackage(HOST_ROOT, stagedHost)
  pinKernelDependencies(stagedHost)
  pinKernelDependencies(stagedDesktop)
  npmInstall(stagedHost)
  npmInstall(stagedDesktop)
  compile(stagedHost, 'tsconfig.release.json')
  compile(stagedDesktop, 'tsconfig.release.json')
  for (const [staged, destination] of [[stagedHost, HOST_ROOT], [stagedDesktop, APP_ROOT]] as const) {
    const output = join(staged, 'lib')
    if (!existsSync(output)) throw new Error(`desktop release build: compiler produced no output in ${output}`)
    rmSync(join(destination, 'lib'), { recursive: true, force: true })
    cpSync(output, join(destination, 'lib'), { recursive: true })
  }
} finally {
  rmSync(STAGE_ROOT, { recursive: true, force: true })
}
