/** Profile launch for the current dsh kernel generation. */
import { createRequire } from 'node:module'
import { join, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Profile } from '@deepseek-ai/dsh-app-boot'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'

interface ProfileLauncher {
  runProfile(options: {
    environment: LaunchEnvironmentSnapshot
    profile: string
    resolvedProfile: { profile: Profile; installAnchor: string }
    patchFiles: readonly string[]
    args: readonly string[]
  }): Promise<{ ctx: Context }>
}

/**
 * Launch a portless Desktop profile using the selected kernel's own package instances.
 * @param runtimeDir - Selected kernel installation.
 * @param projectDir - Instance-owned desktop profile.
 * @param desktopPatch - Shell transport and directory-picker overlay.
 * @param allowLinkedPackages - Workspace development allowance.
 * @returns The settled root context; unsupported launch APIs reject before readiness.
 */
export async function bootDesktopProfile(
  runtimeDir: string, projectDir: string, desktopPatch: string, allowLinkedPackages: boolean,
): Promise<Context> {
  const require = createRequire(join(runtimeDir, 'package.json'))
  // The shell runtime manifest also declares private shell packages that the DSH npm package does not own.
  const installAnchor = join(runtimeDir, 'package.json')
  const appBoot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href) as typeof import('@deepseek-ai/dsh-app-boot')
  const environment = appBoot.loadLayeredEnv('dsh desktop')
  const profile = appBoot.loadProfileDirectory('dsh desktop', projectDir, installAnchor)
  if (profile.skippedBundles.length > 0) {
    throw new Error(`dsh desktop: profile bundles could not load:\n${profile.skippedBundles.map(bundle => `${bundle.packageName}: ${bundle.reason}`).join('\n')}`)
  }
  const inside = (root: string, target: string): boolean => {
    const canonical = realpathSync(root)
    const path = realpathSync(target)
    return path === canonical || path.startsWith(canonical + sep)
  }
  for (const layer of profile.layers) {
    if (!allowLinkedPackages && !inside(projectDir, layer.packageDir) && !inside(runtimeDir, layer.packageDir)) {
      throw new Error(`dsh desktop: profile bundle ${JSON.stringify(layer.packageName)} resolved outside the Desktop runtime and profile`)
    }
  }
  const launcher = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh/profile-boot')).href) as ProfileLauncher
  return (await launcher.runProfile({
    environment, profile: 'desktop', resolvedProfile: { profile, installAnchor }, patchFiles: [desktopPatch], args: [],
  })).ctx
}
