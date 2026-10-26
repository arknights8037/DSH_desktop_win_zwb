/** Build and launch the unpackaged Electron shell against the current workspace. */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { resolveDevelopmentKernel, type DevelopmentKernel } from './development-kernel.ts'
import { resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'

const APP_ROOT = resolve(import.meta.dirname, '..')
const BUILD_ROOT = join(APP_ROOT, '.desktop-build')
const DEVELOPMENT_ROOT = join(BUILD_ROOT, 'development')

function debugPort(name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop development: ${name} must be an integer from 1 through 65535`)
  }
  return port
}

async function run(command: string, args: readonly string[], cwd: string, environment = process.env): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop development: ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

async function runPackageScript(script: string, cwd: string): Promise<void> {
  const packageManager = process.env.npm_execpath
  if (packageManager === undefined || packageManager === '') {
    throw new Error('desktop development: invoke this launcher through pnpm run dev:desktop or start:desktop')
  }
  await run(process.execPath, [packageManager, 'run', script], cwd)
}

async function launchElectron(kernel: DevelopmentKernel): Promise<void> {
  const require = createRequire(import.meta.url)
  const electron: unknown = require('electron')
  if (typeof electron !== 'string') throw new Error('desktop development: electron executable is unavailable')
  const mainPort = debugPort('DSH_DESKTOP_MAIN_INSPECT_PORT', 9229)
  const rendererPort = debugPort('DSH_DESKTOP_RENDERER_DEBUG_PORT', 9222)
  const hostPort = debugPort('DSH_DESKTOP_HOST_INSPECT_PORT', 9230)
  const home = resolve(process.env.DSH_HOME ?? join(DEVELOPMENT_ROOT, 'home'))
  const userData = join(DEVELOPMENT_ROOT, 'electron-user-data')
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_DESKTOP_DSH_DIR: kernel.directory,
    DSH_DESKTOP_KERNEL_ROOT: kernel.root,
    DSH_DESKTOP_PNPM_ENTRY: kernel.pnpm,
    DSH_DESKTOP_HOST_INSPECT_PORT: String(hostPort),
    DSH_DESKTOP_NODE_BINARY: kernel.node,
    DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS ?? '1',
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? '1',
  }
  console.log(`desktop development: DSH_HOME=${home}`)
  console.log(`desktop development: inspectors main=${String(mainPort)}, renderer=${String(rendererPort)}, host=${String(hostPort)}`)
  await run(electron, [
    ...((process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY) ? [`--proxy-server=${process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY}`] : []),
    `--inspect=127.0.0.1:${String(mainPort)}`,
    `--remote-debugging-port=${String(rendererPort)}`,
    `--user-data-dir=${userData}`,
    APP_ROOT,
  ], APP_ROOT, environment)
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'skip-build': { type: 'boolean', default: false } } })
  if (!values['skip-build']) {
    await runPackageScript('build', APP_ROOT)
  }
  for (const path of [join(APP_ROOT, 'lib', 'main.js')]) {
    if (!existsSync(path)) throw new Error(`desktop development: missing built artifact ${path}`)
  }
  const kernel = resolveDevelopmentKernel(process.env.DSH_DESKTOP_KERNEL_HOME ?? resolveDshHome(), resolveDesktopTargetBuildPaths().runtime)
  console.log(`desktop development: kernel=${kernel.version} source=${kernel.directory}`)
  await launchElectron(kernel)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
