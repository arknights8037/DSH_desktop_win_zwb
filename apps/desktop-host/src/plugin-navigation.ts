/** Connect kernel plugin menus to the Electron-owned plugin manager. */
import type { Context } from '@deepseek-ai/cordis'

/** Navigation-only preload capability; package mutations stay in the shell. */
export interface DesktopPluginNavigationBridge {
  openList(): Promise<void>
  openBundle(packageName: string): Promise<void>
}

/** Provide navigation for kernel menus for the lifetime of the Desktop client.
 * @param ctx - Desktop client registration context.
 * @param bridge - Context-isolated preload navigation capability.
 */
export function installDesktopPluginNavigation(ctx: Context, bridge: DesktopPluginNavigationBridge): void {
  const openList = (): void => {
    void bridge.openList().catch((error: unknown) => {
      ctx.logger.warn('Desktop plugin navigation failed: %s', error instanceof Error ? error.message : String(error))
    })
  }
  ctx.effect(() => ctx.reflect.provide('pluginNavigation', {
    openList,
    // Desktop owns a single installed-plugin list, including bundle entries.
    openBundle: (packageName: string) => {
      void bridge.openBundle(packageName).catch((error: unknown) => {
        ctx.logger.warn('Desktop plugin navigation failed: %s', error instanceof Error ? error.message : String(error))
      })
    },
  }), 'desktop plugin navigation')
}
