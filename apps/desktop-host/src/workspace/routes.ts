/** Workspace edits exposed only through the instance-owned Desktop transport. */
import type { Context } from '@deepseek-ai/cordis'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { DesktopFetchHandler } from '../remote-stream.ts'
import { DESKTOP_WORKSPACE_PATH } from '../workspace-wire.ts'
import type { WorkspaceRegistry } from './registry.ts'
import type {} from '../routes.ts'

/**
 * Create the shell Workspace handler. Invalid requests never invoke the registry.
 * @param registry - Shell-owned registry mounted by the Desktop overlay.
 * @returns Handler; failed edits report an error and never return success.
 */
export function workspaceHandler(registry: Pick<WorkspaceRegistry, 'edit' | 'get'>): DesktopFetchHandler {
  return {
    async fetch(request) {
      if (request.method === 'GET') {
        const id = new URL(request.url).searchParams.get('workspaceId')
        if (!id) return Response.json({ code: 'invalid-request' }, { status: 400 })
        const workspace = registry.get(WorkspaceId(id))
        if (!workspace) return Response.json({ code: 'not-found' }, { status: 404 })
        return Response.json({ title: workspace.title, folders: [...workspace.folders] })
      }
      if (request.method !== 'POST') return new Response(null, { status: 405 })
      let input: unknown
      try { input = await request.json() }
      catch (_invalidJson) { return Response.json({ code: 'invalid-request' }, { status: 400 }) }
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return Response.json({ code: 'invalid-request' }, { status: 400 })
      }
      const value = input as Record<string, unknown>
      if (typeof value.workspaceId !== 'string' || !value.workspaceId
        || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 256
        || !Array.isArray(value.folders) || value.folders.length < 1 || value.folders.length > 32
        || !value.folders.every((folder: unknown) => typeof folder === 'string' && folder.length > 0)) {
        return Response.json({ code: 'invalid-request' }, { status: 400 })
      }
      try {
        await registry.edit(WorkspaceId(value.workspaceId), value.title, value.folders)
        return Response.json({ ok: true })
      } catch (error) {
        return Response.json({ code: 'save-failed', message: error instanceof Error ? error.message : String(error) }, { status: 500 })
      }
    },
  }
}

/**
 * Mount the Workspace route in the shell route registry.
 * @param ctx - Desktop plugin context; disposal removes its route.
 */
export function registerWorkspaceRoutes(ctx: Context): void {
  ctx.inject(['workspaceRegistry', 'desktopRoutes'], scope => {
    // The Desktop overlay replaces the kernel provider under this shared service name.
    const registry = scope.workspaceRegistry as unknown as WorkspaceRegistry
    scope.effect(() => scope.desktopRoutes.register(DESKTOP_WORKSPACE_PATH, workspaceHandler(registry)), 'desktop.workspace.route')
  })
}
