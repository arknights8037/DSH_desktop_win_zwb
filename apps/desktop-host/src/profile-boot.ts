/** Version-specific profile launch adapters for bundled and independently installed kernels. */
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
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
 * Create the owner Peer required by kernels with admitted RPC callers.
 * @param runtimeDir - Selected package installation.
 * @param ctx - Host context that owns the Peer lifetime.
 * @returns Owner Peer, or undefined for kernels predating Peers.
 */
export async function desktopOwnerPeer(runtimeDir: string, ctx: Context): Promise<unknown> {
  const require = createRequire(join(runtimeDir, 'package.json'))
  const connection = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-connection')).href) as {
    Peer?: new (owner: Context, options: { principal: { kind: 'owner' } }) => unknown
  }
  return connection.Peer === undefined ? undefined : new connection.Peer(ctx, { principal: { kind: 'owner' } })
}

/**
 * Launch a portless Desktop profile using the selected kernel's own package instances.
 * @param runtimeDir - Selected kernel installation.
 * @param projectDir - Instance-owned desktop profile.
 * @param rootConfig - Empty Loader root.
 * @param desktopPatch - Shell transport and directory-picker overlay.
 * @param allowLinkedPackages - Workspace development allowance.
 * @returns The settled root context; unsupported launch APIs reject before readiness.
 */
export async function bootDesktopProfile(
  runtimeDir: string, projectDir: string, rootConfig: string, desktopPatch: string, allowLinkedPackages: boolean,
): Promise<Context> {
  const require = createRequire(join(runtimeDir, 'package.json'))
  const installAnchor = require.resolve('@deepseek-ai/dsh/package.json')
  const appBoot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href) as typeof import('@deepseek-ai/dsh-app-boot')
  const environment = appBoot.loadLayeredEnv('dsh desktop')
  const profile = appBoot.loadProfileDirectory('dsh desktop', projectDir, installAnchor)
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
  if (!('createProfileResolutionGeneration' in appBoot)) {
    const launcher = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh/profile-boot')).href) as ProfileLauncher
    return (await launcher.runProfile({
      environment, profile: 'desktop', resolvedProfile: { profile, installAnchor }, patchFiles: [desktopPatch], args: [],
    })).ctx
  }
  const layers = [...profile.layers.map(layer => layer.patches), profile.patches, appBoot.loadOverlayPatches('dsh desktop', desktopPatch)]
  const agentPresets = appBoot.composeEntries(layers).find(row => row.id === 'agent-presets')
  if (agentPresets !== undefined) layers.push([{
    id: 'agent-presets', config: {
      ...(agentPresets.config ?? {}) as Record<string, unknown>,
      roots: [{ path: join(dirname(installAnchor), 'config', 'agent-presets'), trust: 'system' }],
    },
  }])
  const resolution = await appBoot.createProfileResolutionGeneration({ installAnchor, profile })
  const cmdline = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-cmdline')).href) as typeof import('@deepseek-ai/dsh-cmdline')
  const { DSH_LAUNCH_ENVIRONMENT_KEY } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-launch-environment')).href) as typeof import('@deepseek-ai/dsh-launch-environment')
  return appBoot.boot('dsh desktop', rootConfig, structuredClone(layers.flat()), async (ctx) => {
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
    await ctx.plugin(appBoot.PluginPackages, { generation: resolution })
    cmdline.provideCmdline(ctx, { args: [], exit: () => {} })
  })
}
