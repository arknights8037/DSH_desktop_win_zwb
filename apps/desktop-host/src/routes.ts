/** Instance-local routes contributed by shell-injected plugins. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { DesktopFetchHandler } from './remote-stream.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopRoutes: DesktopRoutes
  }
}

/** Route registrations live until their contributing plugin is disposed. */
export class DesktopRoutes extends Service {
  private readonly handlers = new Map<string, DesktopFetchHandler>()

  /** @param ctx - Desktop Host context. */
  constructor(ctx: Context) { super(ctx, 'desktopRoutes') }

  /**
   * Register one exact custom-protocol route.
   * @param path - Absolute route pathname.
   * @param handler - Handler owned by the contributing plugin.
   * @returns Disposer for this registration; duplicate paths reject.
   */
  register(path: string, handler: DesktopFetchHandler): () => void {
    if (this.handlers.has(path)) throw new Error(`Desktop route already registered: ${path}`)
    this.handlers.set(path, handler)
    return () => { this.handlers.delete(path) }
  }

  /** @param path - Request pathname. @returns Registered handler, when present. */
  get(path: string): DesktopFetchHandler | undefined { return this.handlers.get(path) }
}
