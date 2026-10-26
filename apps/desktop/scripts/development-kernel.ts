/** Resolve the verified kernel selection independently of the writable development home. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { valid } from 'semver'
import { readDesktopRuntime } from '../src/runtime-tree.ts'

/** Tools and selected kernel supplied to an unpackaged shell. */
export interface DevelopmentKernel {
  readonly directory: string
  readonly root: string
  readonly version: string
  readonly node: string
  readonly pnpm: string
}

/**
 * Resolve the selected release and require its matching prepared runtime tools.
 * @param kernelHome - Harness home containing the kernel selection.
 * @param runtime - Prepared target's Node.js and pnpm directory.
 * @returns Kernel paths; missing selections, unsafe versions, and mismatched tools throw.
 */
export function resolveDevelopmentKernel(kernelHome: string, runtime: string): DevelopmentKernel {
  const root = join(kernelHome, 'desktop', 'agent-manager', 'kernels')
  const selectionPath = join(root, 'selection.json')
  if (!existsSync(selectionPath)) throw new Error(`desktop development: selected kernel is missing at ${selectionPath}`)
  const selection: unknown = JSON.parse(readFileSync(selectionPath, 'utf8'))
  if (typeof selection !== 'object' || selection === null || !('version' in selection) || selection.version !== 1
    || !('selected' in selection) || typeof selection.selected !== 'string' || valid(selection.selected) !== selection.selected) {
    throw new Error('desktop development: kernel selection has no valid release')
  }
  const directory = join(root, 'releases', selection.selected)
  const descriptor = readDesktopRuntime(directory)
  if (descriptor.release.version !== selection.selected) throw new Error('desktop development: selected kernel version mismatch')
  const tools: unknown = JSON.parse(readFileSync(join(runtime, 'versions.json'), 'utf8'))
  if (typeof tools !== 'object' || tools === null || !('node' in tools) || tools.node !== descriptor.release.nodeVersion
    || !('pnpm' in tools) || tools.pnpm !== descriptor.release.pnpmVersion) {
    throw new Error('desktop development: prepared Node.js and pnpm do not match the selected kernel')
  }
  const node = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  const pnpm = join(runtime, 'pnpm', 'bin', 'pnpm.mjs')
  for (const [name, path] of [['Node.js', node], ['pnpm', pnpm]] as const) {
    if (!existsSync(path)) throw new Error(`desktop development: bundled ${name} is missing at ${path}`)
  }
  return { directory, root, version: descriptor.release.version, node, pnpm }
}
