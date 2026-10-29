/** Reject stale or mixed kernel resources before electron-builder copies application files. */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verifyDesktopRuntime } from '../src/runtime-tree.ts'

/**
 * Verify kernel package bytes, execution target, and prepared tool versions.
 * @param dsh - Materialized kernel directory.
 * @param runtime - Prepared Node.js and pnpm directory.
 * @param version - Kernel version required by the repository release.
 * @param target - Packaged execution target.
 * @returns Completion after every resource matches the required kernel release.
 */
export async function verifyBundledRuntime(
  dsh: string, runtime: string, version: string, target: { platform: NodeJS.Platform; arch: string },
): Promise<void> {
  const descriptor = await verifyDesktopRuntime(dsh, version, target)
  const tools: unknown = JSON.parse(readFileSync(join(runtime, 'versions.json'), 'utf8'))
  if (typeof tools !== 'object' || tools === null
    || !('node' in tools) || tools.node !== descriptor.release.nodeVersion
    || !('pnpm' in tools) || tools.pnpm !== descriptor.release.pnpmVersion) {
    throw new Error('desktop package: prepared Node.js and pnpm do not match the kernel descriptor')
  }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const [dsh, runtime, platform, arch] = process.argv.slice(2)
  if (dsh === undefined || runtime === undefined || arch === undefined
    || (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux')) {
    throw new Error('desktop package: expected kernel directory, tools directory, platform, and architecture')
  }
  const manifest = JSON.parse(readFileSync(new URL('../config/kernel-release.json', import.meta.url), 'utf8')) as { version: string }
  await verifyBundledRuntime(dsh, runtime, manifest.version, { platform, arch })
}
