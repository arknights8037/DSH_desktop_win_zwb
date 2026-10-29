/** Desktop-owned source-folder context contributed through the prompt registry. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-workspace'
import type { WorkspaceRegistry } from './workspace/registry.ts'

/**
 * Register source folders for Sessions associated with a Desktop Workspace.
 * @param ctx - Desktop plugin context; registrations end with its injection scope.
 */
export function registerWorkspaceContext(ctx: Context): void {
  ctx.inject(['systemPrompt', 'workspaceRegistry'], scope => {
    const registry = scope.workspaceRegistry as unknown as WorkspaceRegistry
    scope.systemPrompt.context({
      name: 'workspace:source-folders',
      order: scope.systemPrompt.getContextOrder('WORKING_DIRECTORY') + 1,
      required: true,
      interpolate: false,
      text: context => {
        const session = context.agent?.session
        if (!session) return ''
        const workspace = registry.list().find(item => item.sessionIds.includes(session.id))
        return workspace?.folders && workspace.folders.length > 1
          ? `Workspace source folders (primary first):\n${workspace.folders.map(path => JSON.stringify(path)).join('\n')}` : ''
      },
    })
  })
}
