/** Web-facing plugin deployment operations supplied by the active profile launcher. */
import type { Context } from '@deepseek-ai/cordis'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { clientRequestSchema, type ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'

/** Exact registry selection; package code is prepared on the instance's platform. */
export interface ProfilePluginSelection { readonly name: string; readonly version: string }

/** Process-owned preparation identifier; a restart expires unapplied preparations. */
export type ProfilePluginPreparation = Branded<'ProfilePluginPreparation'>

/** Launcher-owned preparation and activation for the current profile only. */
export interface ProfilePluginService {
  /**
   * Prepare an independent dependency graph without changing the running profile.
   * @param plugin - Exact registry version selected by the operator.
   * @param signal - Request cancellation; the provider stops dependency preparation before cleanup.
   * @returns Opaque preparation identifier required by apply.
   */
  prepare(plugin: ProfilePluginSelection, signal: AbortSignal): Promise<ProfilePluginPreparation>
  /**
   * Schedule a prepared graph for the next launch; running modules remain available.
   * @param preparation - Identifier returned by prepare in this process.
   * @returns Completion after the restart request has been persisted.
   */
  apply(preparation: ProfilePluginPreparation): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Plugin deployment provider for the profile launched by dsh. */
    profilePlugins: ProfilePluginService
  }
}

/**
 * Register authenticated plugin RPCs through the existing Web Connection.
 * @param ctx - Web runtime context; registrations follow its fiber lifetime.
 */
export function registerProfilePluginApi(ctx: Context): void {
  ctx.inject(['connection', 'profilePlugins', 'webServer'], (owner) => {
    const handle = async (endpoint: 'prepare' | 'apply', payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult<unknown>> => {
      try {
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('Invalid plugin request')
        const input = payload as Record<string, unknown>
        if (endpoint === 'prepare') {
          if (typeof input.name !== 'string' || typeof input.version !== 'string') throw new Error('Invalid plugin selection')
          const preparation = await owner.profilePlugins.prepare({ name: input.name, version: input.version }, signal)
          return { ok: true, value: { preparation } }
        }
        if (typeof input.preparation !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(input.preparation)) throw new Error('Invalid plugin preparation')
        await owner.profilePlugins.apply(input.preparation as ProfilePluginPreparation)
        return { ok: true, value: { restartRequired: true } }
      } catch (error) {
        return { ok: false, error: { code: 'plugin/deployment-failed', message: error instanceof Error ? error.message : String(error), details: {} } }
      }
    }
    for (const endpoint of ['prepare', 'apply'] as const) {
      owner.connection.fetch.register({
        path: `/api/profile-plugins/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
        fetch: async (request) => {
          if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') return new Response('Expected application/json', { status: 415 })
          let body: unknown
          try { body = await request.json() }
          catch { return new Response('Invalid JSON', { status: 400 }) }
          const parsed = clientRequestSchema.safeParse(body)
          if (!parsed.success || parsed.data.method !== endpoint) return new Response('Invalid plugin request', { status: 400 })
          const result = await handle(endpoint, parsed.data.payload, request.signal)
          return Response.json({ type: 'server-response', rpcId: parsed.data.rpcId, result })
        },
      })
    }
  })
}
