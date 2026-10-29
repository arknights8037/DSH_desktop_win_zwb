import { describe, expect, it, onTestFinished } from 'vitest'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SESSION_FORMAT_VERSION, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../packages/storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkspaceRegistry from '../../desktop-host/src/workspace/registry.ts'

const header = (id: string, cwd: string): SessionHeader => ({
  version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 0, isSeeded: false, cwd,
})

async function makeDir(name: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-workspace-')))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const path = join(root, name)
  await mkdir(path)
  return path
}

async function harness(options: { pool?: MemoryMediaPool; sessions: SessionHeader[] }) {
  const pool = options.pool ?? new MemoryMediaPool()
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('sessionPersistence', {
    list: async () => options.sessions.map(header => ({ header, revision: SessionPersistenceRevision(`rev-${header.id}`) })),
  } as never)
  await ctx.plugin(WorkspaceRegistry)
  return { ctx, pool, registry: ctx.workspaceRegistry as unknown as WorkspaceRegistry }
}

describe('Workspace folder editing', () => {
  it('keeps workspace identity and historical Sessions when the primary changes and records reload', async () => {
    const original = await makeDir('original')
    const primary = await makeDir('primary')
    const sessions = [header('existing', original)]
    const first = await harness({ sessions })
    try {
      const workspace = first.registry.list()[0]!
      await first.registry.edit(workspace.id, 'Combined sources', [primary, original])
      expect(workspace.path).toBe(primary)
      expect(workspace.folders).toEqual([primary, original])
      expect(workspace.sessionIds).toEqual([SessionId('existing')])
      await expect(first.registry.edit(workspace.id, 'Invalid', [primary, primary])).rejects.toThrow('already contains')
      expect(workspace.title).toBe('Combined sources')
      const second = await harness({ pool: first.pool, sessions })
      try {
        expect(second.registry.get(workspace.id)?.folders).toEqual([primary, original])
        expect(second.registry.get(workspace.id)?.sessionIds).toEqual([SessionId('existing')])
      } finally { await second.ctx.fiber.dispose() }
    } finally { await first.ctx.fiber.dispose() }
  })
})
