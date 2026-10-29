/** Desktop-owned Workspace route validation and persistence dispatch. */
import { expect, it, vi } from 'vitest'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { workspaceHandler } from '../../desktop-host/src/workspace/routes.ts'
import type { WorkspaceRegistry } from '../../desktop-host/src/workspace/registry.ts'

it('rejects an empty folder list before calling the registry', async () => {
  const edit = vi.fn()
  const handler = workspaceHandler({ edit, get: () => undefined })
  const response = await handler.fetch(new Request('https://desktop.test/.dsh/workspace', {
    method: 'POST', body: JSON.stringify({ workspaceId: 'workspace', title: 'Name', folders: [] }),
  }))
  expect(response.status).toBe(400)
  expect(edit).not.toHaveBeenCalled()
})

it('awaits the registry edit and reports persistence failure', async () => {
  const edit = vi.fn().mockRejectedValue(new Error('Storage unavailable'))
  const handler = workspaceHandler({ edit, get: () => undefined })
  const response = await handler.fetch(new Request('https://desktop.test/.dsh/workspace', {
    method: 'POST', body: JSON.stringify({ workspaceId: 'workspace', title: 'Name', folders: ['C:\\source'] }),
  }))
  expect(edit).toHaveBeenCalledWith(WorkspaceId('workspace'), 'Name', ['C:\\source'])
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ code: 'save-failed', message: 'Storage unavailable' })
})

it('reads the shell folder list and distinguishes missing workspace requests', async () => {
  // The read endpoint consumes only these two properties from a registered entity.
  const workspace = { title: 'Name', folders: ['C:\\source', 'D:\\extra'] } as NonNullable<ReturnType<WorkspaceRegistry['get']>>
  const handler = workspaceHandler({ edit: vi.fn(), get: id => id === 'workspace' ? workspace : undefined })
  expect((await handler.fetch(new Request('https://desktop.test/.dsh/workspace'))).status).toBe(400)
  expect((await handler.fetch(new Request('https://desktop.test/.dsh/workspace?workspaceId=missing'))).status).toBe(404)
  const response = await handler.fetch(new Request('https://desktop.test/.dsh/workspace?workspaceId=workspace'))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ title: 'Name', folders: ['C:\\source', 'D:\\extra'] })
})
