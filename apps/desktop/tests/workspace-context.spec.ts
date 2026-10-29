import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt, { renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import { MemoryStorageBackend } from '../../../packages/storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkspaceRegistry from '../../desktop-host/src/workspace/registry.ts'
import { registerWorkspaceContext } from '../../desktop-host/src/workspace-context.ts'

it('supplies shell-owned source folders without changing the Session directory', async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'desktop-workspace-context-')))
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend())
    const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', storageDomain)
    ctx.provide('storageDomain', storageDomain)
    ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
    await ctx.plugin(WorkspaceRegistry)
    await ctx.plugin(SystemPrompt, {})
    registerWorkspaceContext(ctx)
    const registry = ctx.workspaceRegistry as unknown as WorkspaceRegistry
    const primary = join(root, 'primary'), extra = join(root, 'extra')
    mkdirSync(primary); mkdirSync(extra)
    const workspace = await registry.create(primary)
    const session = ctx.sessions.create(SessionId('folder-context'), { meta: { cwd: primary } })
    await workspace.attachSession(session.id)
    await registry.edit(workspace.id, 'Combined', [primary, extra])
    const assembled = await ctx.systemPrompt.assemble({ agent: { session } as never })
    const text = renderContextSnapshot(assembled).replace(JSON.stringify(primary), '"<primary>"').replace(JSON.stringify(extra), '"<extra>"')
    await expect(text + '\n').toMatchFileSnapshot('expected/workspace-folders.txt')
    expect(session.header.cwd).toBe(primary)
  } finally {
    await ctx.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})
