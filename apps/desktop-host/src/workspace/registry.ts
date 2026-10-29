/** Shell-owned Workspace registry selected by the Desktop profile overlay. */
import { randomUUID } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceEntity } from './entity.ts'
import type { WorkspaceEntityHost } from './entity.ts'

import { defaultWorkspaceTitle, fullyQualifiedWorkspacePath, realpathNormalize } from './paths.ts'
import { workspaceDomainSpec } from './spec.ts'
import type { WorkspaceDomainState, WorkspaceRecord } from './spec.ts'
import type { Workspace } from './types.ts'

import {
  WorkspaceId, WorkspaceUnknownSessionError, WorkspaceActiveSessionError,
  WorkspaceArchivedSessionPinError, WorkspaceOrderInvalidError,
  type ArchiveSessionOptions,
} from '@deepseek-ai/dsh-workspace'

interface BootstrapGroup {
  readonly path: string
  readonly headers: SessionHeader[]
  readonly newestAt: number
}

const sameIds = (left: readonly WorkspaceId[], right: readonly WorkspaceId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

const compareHeaders = (left: SessionHeader, right: SessionHeader): number =>
  right.createdAt - left.createdAt || String(left.id).localeCompare(String(right.id))

/**
 * Durable workspace registry. Startup waits for `sessionPersistence`, builds
 * one canonical-cwd header index, and completes the one-time history
 * bootstrap before the service becomes active. The persistence dependency is
 * mandatory so an unavailable peer can never be mistaken for an empty
 * history and commit the initialized marker.
 */
export class WorkspaceRegistry extends Service {
  static inject = ['storageDomain', 'sessionPersistence']

  private table?: KvTable<WorkspaceId, WorkspaceRecord>
  private global?: DomainGlobal<WorkspaceDomainState>
  private state?: WorkspaceDomainState
  private readonly entities = new Map<WorkspaceId, WorkspaceEntity>()
  private readonly headers = new Map<SessionId, SessionHeader>()
  private readonly liveSessions = new Map<SessionId, SessionHeader>()
  private readonly sessionPaths = new Map<SessionId, string>()
  private readonly missingSessionPaths = new Set<SessionId>()
  private readonly invalidSessionPaths = new Map<SessionId, string>()
  private operationTail: Promise<void> = Promise.resolve()

  private readonly host: WorkspaceEntityHost = {
    table: () => this.requireTable(),
    candidateMatches: (id, path) => this.sessionPaths.get(id) === path || this.missingSessionPaths.has(id),
    readSessionHeader: id => this.readSessionHeader(id),
    rememberSessionPath: (id, path) => {
      this.sessionPaths.set(id, path)
      this.missingSessionPaths.delete(id)
      this.invalidSessionPaths.delete(id)
    },
  }

  constructor(ctx: Context) {
    super(ctx, 'workspaceRegistry')
    this.ctx.effect(() => {
      const removeCreated = this.ctx.on('session/created', session => {
        this.liveSessions.set(session.id, session.header)
      })
      const removeDisposed = this.ctx.on('session/disposed', session => {
        this.liveSessions.delete(session.id)
      })
      return () => { removeCreated(); removeDisposed() }
    }, 'workspace.sessionIndex')
  }

  /** Open the domain, finish bootstrap when required, and rebuild the ordered cache. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workspaceDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'workspace.domainClose')
    this.table = domain.table('workspaces')
    this.global = domain.global
    this.state = domain.global.get()

    await this.recoverPendingMutation()
    this.validateStoredState(this.state)
    if (!this.state.initialized) {
      const headers = await this.listStoredHeaders()
      await this.replaceHeaderIndex(headers)
      await this.bootstrap(headers)
    } else if (this.table.size > 0) {
      await this.replaceHeaderIndex(await this.listStoredHeaders())
    }

    await this.indexLiveSessions()
    this.validateStoredState(this.requireState())
    this.rebuildEntities()
    this.reportFilteredCandidates()
  }

  /**
   * Create or reuse a workspace for an existing directory. The fully qualified
   * path is canonicalized through `fs.realpath`; a relative, nonexistent, or
   * non-directory path rejects. Repeated calls for the same canonical path
   * return the existing entity without changing its title.
   * A newly created workspace is prepended to the durable registry order.
   * Different canonical paths may share a display title.
   * @param path - Existing directory to own, in a fully qualified path spelling.
   * @param title - Display title used only when a new record is created.
   * @returns the existing or newly durable workspace.
   */
  // TODO: `title` lost its last production caller when the gateway's
  // create-by-name branch was deleted
  // (.agents/notes/archived/simplification/2026-07-31-one-route-to-add-a-workspace.md);
  // drop the parameter with its @param clause and the `create(path, title?)`
  // lines in this package's README pair.
  async create(path: string, title?: string): Promise<Workspace> {
    const canonical = await realpathNormalize(path)
    if (!(await stat(canonical)).isDirectory()) {
      throw new Error(`cannot create a workspace at '${canonical}': path is not a directory`)
    }
    return await this.enqueueOperation(() => this.createCanonical(canonical, title))
  }

  /**
   * Initialize the default Workspace only while both the registry and Session
   * history are empty. Repeated requests reuse its durable identity; deleting
   * that registration permanently disables automatic creation.
   * @param resolveDirectory - resolve the absolute directory; called only for
   * eligible creation, inside the registry mutation queue. Missing directories
   * are created recursively before registration, and the initial title is the
   * requested directory's own final segment — not the canonical one, so a
   * symlink at that path does not retitle the Workspace after its target.
   * After resolution, caller cancellation does not roll back creation or registration.
   * @returns the initialized Workspace, or undefined when automatic creation is ineligible.
   */
  initializeDefault(resolveDirectory: () => Promise<string>): Promise<Workspace | undefined> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      if (state.defaultWorkspaceId !== undefined) return this.entities.get(state.defaultWorkspaceId)
      if (state.workspaceIds.length > 0 || state.archivedSessionIds.length > 0
        || this.liveSessions.size > 0 || (await this.listStoredHeaders()).length > 0) return undefined

      const path = await resolveDirectory()
      if (!fullyQualifiedWorkspacePath(path)) throw new TypeError(`Workspace path is not fully qualified: '${path}'`)
      await mkdir(path, { recursive: true })
      const canonical = await realpathNormalize(path)
      // A Session can start outside the registry queue while directory preparation awaits I/O.
      if ((await this.listStoredHeaders()).length > 0 || this.liveSessions.size > 0) return undefined
      return this.createCanonical(canonical, defaultWorkspaceTitle(path), true)
    })
  }

  /**
   * Look up a workspace by id.
   * @param id - Workspace id.
   * @returns the workspace, or `undefined` when unknown.
   */
  get(id: WorkspaceId): Workspace | undefined {
    return this.entities.get(id)
  }

  /**
   * Edit a Workspace without replacing its identity or moving existing Sessions.
   * @param id - Existing Workspace identity.
   * @param title - Non-blank display title, unique among other Workspaces.
   * @param folders - Existing absolute directories in primary-first order.
   * @returns The durably updated Workspace; invalid paths and conflicts reject before writing.
   */
  edit(id: WorkspaceId, title: string, folders: readonly string[]): Promise<Workspace> {
    return this.enqueueOperation(async () => {
      const entity = this.entities.get(id)
      if (!entity) throw new Error('Workspace no longer exists')
      title = title.trim()
      if (!title || title.length > 256 || folders.length === 0 || folders.length > 32) throw new Error('Invalid Workspace edit')
      const paths: string[] = []
      for (const folder of folders) {
        if (!fullyQualifiedWorkspacePath(folder)) throw new Error('Workspace directories must be absolute')
        const path = await realpathNormalize(folder)
        if (!(await stat(path)).isDirectory()) throw new Error('Workspace source must be a directory')
        if (paths.includes(path)) throw new Error('Workspace already contains this directory')
        paths.push(path)
      }
      if (this.list().some(item => item.id !== id && (item.title === title || item.path === paths[0]))) throw new Error('Workspace name or primary directory is already registered')
      await entity.edit(title, paths)
      return entity
    })
  }

  /**
   * Synchronous workspace projection in durable registry order. Every
   * entity's `sessionIds` getter is already filtered by the startup/live
   * canonical-cwd header index; this method performs no persistence reads.
   * @returns a fresh ordered array of workspace entities.
   */
  list(): Workspace[] {
    return this.requireState().workspaceIds.map((id) => {
      const entity = this.entities.get(id)
      if (entity === undefined) {
        throw new Error(`workspace registry order references missing workspace '${id}'`)
      }
      return entity
    })
  }

  /**
   * Delete one workspace registration while retaining its directory and every
   * session log. The durable order is updated before the table deletion; a
   * failed table write restores the prior order and keeps the entity
   * published. Unknown ids are an idempotent no-op for domain callers.
   * @param id - Workspace registration to remove.
   * @returns `true` when a record was deleted, `false` when it was unknown.
   */
  delete(id: WorkspaceId): Promise<boolean> {
    return this.enqueueOperation(() => this.deleteKnown(id))
  }

  /**
   * Move one workspace within the durable display order, DOM-insertBefore-like.
   * With an anchor it lands before that workspace; without one it appends.
   * @param id - Workspace to move.
   * @param beforeId - Workspace anchor; omitted appends.
   * @returns the complete committed workspace order.
   */
  insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      if (!state.workspaceIds.includes(id)) throw new WorkspaceOrderInvalidError(id)
      if (beforeId !== undefined && !state.workspaceIds.includes(beforeId)) {
        throw new WorkspaceOrderInvalidError(beforeId)
      }
      if (beforeId === id) return state.workspaceIds
      const without = state.workspaceIds.filter(workspaceId => workspaceId !== id)
      const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
      const workspaceIds = [...without.slice(0, at), id, ...without.slice(at)]
      if (sameIds(workspaceIds, state.workspaceIds)) return state.workspaceIds
      await this.setState({ ...state, workspaceIds })
      return workspaceIds
    })
  }

  /**
   * The registry-global archive set: sessions hidden from every grouping
   * surface. Archiving never touches workspace accounting — an archived
   * session keeps its `sessionIds` slot so unarchiving restores its position.
   * @returns the archived session ids in archive order.
   */
  get archivedSessionIds(): readonly SessionId[] {
    return this.requireState().archivedSessionIds
  }

  /**
   * Archive one session durably. The session must exist (live or in session
   * persistence); its workspace accounting — or lack of one — is irrelevant.
   * Without `stopActivity` the session must also be inactive: the
   * `workspace/session-activity` waterfall is asked once, and any reported
   * activity rejects with {@link WorkspaceActiveSessionError} before anything
   * is written. With `stopActivity` the archive is written without an
   * activity check, and the `workspace/session-stop` providers are then asked
   * to stop the session's work: the durable archive set is what a provider's
   * `agent/pre-step` gate reads, so every wake the stops induce is already
   * blocked. Archiving drops the session's pin in the same durable write
   * (pinning and archival are mutually exclusive). An already archived id
   * resolves without writing, asking, or stopping.
   * @param sessionId - The session to archive.
   * @param options - Whether running work is stopped instead of refusing.
   * @returns resolution after durability and, with `stopActivity`, after every stop request was issued.
   */
  archiveSession(sessionId: SessionId, options: ArchiveSessionOptions = {}): Promise<void> {
    return this.enqueueOperation(async () => {
      // The chain slot serializes against every other registry write, so this
      // check-then-write pair cannot interleave with another archive.
      if (this.requireState().archivedSessionIds.includes(sessionId)) return
      if (!(await this.sessionKnown(sessionId))) {
        throw new WorkspaceUnknownSessionError(sessionId, 'archive')
      }
      if (options.stopActivity !== true) {
        const activity = await this.ctx.waterfall(
          'workspace/session-activity', { sessionId }, () => Promise.resolve([]),
        )
        if (activity.length > 0) throw new WorkspaceActiveSessionError(sessionId, activity)
      }
      const state = this.requireState()
      await this.setState({
        ...state,
        archivedSessionIds: [...state.archivedSessionIds, sessionId],
        pinnedSessionIds: state.pinnedSessionIds.filter(id => id !== sessionId),
      })
      if (options.stopActivity === true) await this.stopSessionActivity(sessionId)
    })
  }

  /**
   * Unarchive one session durably by dropping it from the registry-global
   * archive set; the accounting slot was never touched, so the session
   * returns to its recorded position. Unarchiving runs no session-existence
   * check because removing an id cannot introduce an unknown one, so an
   * entry whose session is gone still resolves. An id that is not archived
   * resolves without writing.
   * @param sessionId - The session to unarchive.
   * @returns resolution after durability.
   */
  unarchiveSession(sessionId: SessionId): Promise<void> {
    return this.enqueueOperation(async () => {
      // The chain slot serializes against every other registry write, so this
      // check-then-write pair cannot interleave with a concurrent archive.
      const state = this.requireState()
      if (!state.archivedSessionIds.includes(sessionId)) return
      await this.setState({
        ...state,
        archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId),
      })
    })
  }

  /**
   * The registry-global pin set: sessions surfaced ahead of every unpinned
   * session on grouping surfaces. Pinning never touches workspace accounting.
   * @returns Session ids in pin order (most recently pinned first).
   */
  get pinnedSessionIds(): readonly SessionId[] {
    return this.requireState().pinnedSessionIds
  }

  /**
   * Pin one session durably, prepending it to the registry-global pin set.
   * The session must exist (live or in session persistence) and must not be
   * archived. An already pinned id resolves without writing or reordering.
   * @param sessionId - The session to pin.
   * @returns resolution after durability.
   */
  pinSession(sessionId: SessionId): Promise<void> {
    return this.enqueueOperation(async () => {
      // The chain slot serializes against every other registry write, so this
      // check-then-write pair cannot interleave with another pin or archive.
      if (this.requireState().pinnedSessionIds.includes(sessionId)) return
      if (this.requireState().archivedSessionIds.includes(sessionId)) {
        throw new WorkspaceArchivedSessionPinError(sessionId)
      }
      if (!(await this.sessionKnown(sessionId))) {
        throw new WorkspaceUnknownSessionError(sessionId, 'pin')
      }
      const state = this.requireState()
      await this.setState({
        ...state,
        pinnedSessionIds: [sessionId, ...state.pinnedSessionIds],
      })
    })
  }

  /**
   * Unpin one session durably by dropping it from the registry-global pin
   * set. Unpinning runs no session-existence check because removing an id
   * cannot introduce an unknown one, so an entry whose session is gone still
   * resolves. An id that is not pinned resolves without writing.
   * @param sessionId - The session to unpin.
   * @returns resolution after durability.
   */
  unpinSession(sessionId: SessionId): Promise<void> {
    return this.enqueueOperation(async () => {
      // The chain slot serializes against every other registry write, so this
      // check-then-write pair cannot interleave with a concurrent pin.
      const state = this.requireState()
      if (!state.pinnedSessionIds.includes(sessionId)) return
      await this.setState({
        ...state,
        pinnedSessionIds: state.pinnedSessionIds.filter(id => id !== sessionId),
      })
    })
  }

  /**
   * Whether a session is live, header-indexed, or present in a fresh
   * persistence listing. Only a definite miss returns false — a failing
   * `sessionPersistence.list()` propagates so storage faults never
   * masquerade as an unknown session.
   */
  private async sessionKnown(id: SessionId): Promise<boolean> {
    if (this.liveSessions.has(id)) return true
    if (this.headers.has(id)) return true
    await this.indexHeaders(await this.listStoredHeaders())
    return this.headers.has(id)
  }

  /** Request every provider's stop; a failing provider is logged, never a reason to keep the session visible. */
  private async stopSessionActivity(sessionId: SessionId): Promise<void> {
    try {
      await this.ctx.parallel('workspace/session-stop', { sessionId })
    } catch (error: unknown) {
      // ctx.parallel settles every listener and rejects with one AggregateError.
      /* v8 ignore next -- the plain arm guards a rethrowing dispatcher. */
      const failures = error instanceof AggregateError ? error.errors : [error]
      for (const failure of failures) {
        this.ctx.logger.warn(`workspace: stopping session '${sessionId}' for archive failed: ${String(failure)}`)
      }
    }
  }

  /**
   * Resolve by canonical directory path without creating or mutating a
   * workspace. A missing path rejects during `realpath`; an existing unowned
   * directory returns `undefined`.
   * @param path - Existing directory path in a fully qualified spelling.
   * @returns the workspace owning the canonical path, when one exists.
   */
  async resolveByPath(path: string): Promise<Workspace | undefined> {
    const canonical = await realpathNormalize(path)
    for (const entity of this.entities.values()) {
      if (entity.path === canonical) return entity
    }
    return undefined
  }

  private async createCanonical(canonical: string, title?: string, firstUse = false): Promise<WorkspaceEntity> {
    for (const entity of this.entities.values()) {
      if (entity.path === canonical) return entity
    }

    const workspaceName = title ?? defaultWorkspaceTitle(canonical)
    const table = this.requireTable()
    const state = this.requireState()
    const id = WorkspaceId(randomUUID())
    const now = new Date().toISOString()
    const record: WorkspaceRecord = {
      path: canonical,
      title: workspaceName,
      sessionIds: [],
      createdAt: now,
      updatedAt: now,
    }
    const entity = new WorkspaceEntity(this.host, id, record)
    this.entities.set(id, entity)
    const pendingState: WorkspaceDomainState = {
      ...state,
      pendingMutation: { operation: 'create', workspaceId: id },
    }
    try {
      await this.setState(pendingState)
    } catch (error) {
      this.entities.delete(id)
      throw error
    }
    try {
      await table.put(id, record)
    } catch (error) {
      this.entities.delete(id)
      try {
        await this.setState(state)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' record write and pending-marker rollback both failed`,
        )
      }
      throw error
    }

    try {
      await this.setState({
        ...state,
        pendingMutation: undefined,
        initialized: true,
        ...(firstUse ? { defaultWorkspaceId: id } : {}),
        workspaceIds: [id, ...state.workspaceIds],
      })
    } catch (error) {
      this.entities.delete(id)
      try {
        await table.delete(id)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' order write and record rollback both failed; the pending marker remains recoverable`,
        )
      }
      try {
        await this.setState(state)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' order write and pending-marker rollback both failed`,
        )
      }
      throw error
    }
    return entity
  }

  private async deleteKnown(id: WorkspaceId): Promise<boolean> {
    const entity = this.entities.get(id)
    if (entity === undefined) return false
    const state = this.requireState()
    const nextState = {
      ...state,
      pendingMutation: undefined,
      initialized: true,
      workspaceIds: state.workspaceIds.filter(workspaceId => workspaceId !== id),
    }
    await this.setState({
      ...nextState,
      pendingMutation: { operation: 'delete', workspaceId: id },
    })
    this.entities.delete(id)
    try {
      await this.requireTable().delete(id)
    } catch (error) {
      this.entities.set(id, entity)
      try {
        await this.setState(state)
      } catch (rollbackError) {
        // The durable marker still says to finish deletion, so the cache must
        // agree with that recoverable direction rather than republish a row
        // absent from the persisted order.
        this.entities.delete(id)
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' record deletion and registry-order rollback both failed`,
        )
      }
      throw error
    }
    try {
      await this.setState(nextState)
    } catch (error) {
      // The deletion committed at the table write and was already published
      // to Host streams. Keep the durable marker for startup recovery rather
      // than reporting failure after the requested state became true.
      this.ctx.logger.warn(
        `workspace '${id}' was deleted but its pending marker could not be cleared: ${String(error)}`,
      )
    }
    return true
  }

  /**
   * Complete the one mutation explicitly named by durable state. Unexplained
   * order/table divergence still reaches {@link validateStoredState} and
   * fails loud; this path never guesses which operation created a row from its shape alone.
   */
  private async recoverPendingMutation(): Promise<void> {
    const state = this.requireState()
    const pending = state.pendingMutation
    if (pending === undefined) return
    if (state.workspaceIds.includes(pending.workspaceId)) {
      throw new Error(
        `workspace domain is inconsistent: pending ${pending.operation} workspace `
        + `'${pending.workspaceId}' is still present in registry order`,
      )
    }
    await this.requireTable().delete(pending.workspaceId)
    await this.setState({ ...state, pendingMutation: undefined })
  }

  private async bootstrap(headers: readonly SessionHeader[]): Promise<void> {
    const table = this.requireTable()
    const state = this.requireState()
    const groupsByPath = new Map<string, SessionHeader[]>()
    for (const header of headers) {
      const path = this.sessionPaths.get(header.id)
      if (path === undefined) continue
      const group = groupsByPath.get(path)
      if (group === undefined) groupsByPath.set(path, [header])
      else group.push(header)
    }
    const groups: BootstrapGroup[] = [...groupsByPath].map(([path, groupHeaders]) => {
      groupHeaders.sort(compareHeaders)
      const newest = groupHeaders[0] as SessionHeader
      return { path, headers: groupHeaders, newestAt: newest.createdAt }
    }).sort((left, right) =>
      right.newestAt - left.newestAt || left.path.localeCompare(right.path))

    const byPath = new Map<string, WorkspaceId>()
    const accounted = new Map<SessionId, WorkspaceId>()
    for (const [id, record] of table.entries()) {
      byPath.set(record.path, id)
      for (const sessionId of record.sessionIds) accounted.set(sessionId, id)
    }

    for (const group of groups) {
      let id = byPath.get(group.path)
      if (id === undefined) {
        const sessionIds = group.headers
          .map(header => header.id)
          .filter(sessionId => !accounted.has(sessionId))
        if (sessionIds.length === 0) continue
        id = WorkspaceId(randomUUID())
        const createdAt = new Date(group.newestAt).toISOString()
        const record: WorkspaceRecord = {
          path: group.path,
          title: defaultWorkspaceTitle(group.path),
          sessionIds,
          createdAt,
          updatedAt: createdAt,
        }
        await table.put(id, record)
        byPath.set(group.path, id)
        for (const sessionId of sessionIds) accounted.set(sessionId, id)
        continue
      }

      const current = table.get(id) as WorkspaceRecord
      const historical = group.headers
        .map(header => header.id)
        .filter(sessionId => accounted.get(sessionId) === undefined || accounted.get(sessionId) === id)
      const historicalSet = new Set(historical)
      const sessionIds = [
        ...historical,
        ...current.sessionIds.filter(sessionId => !historicalSet.has(sessionId)),
      ]
      if (sameSessionIds(current.sessionIds, sessionIds)) continue
      await table.update(id, record => ({
        ...record,
        sessionIds,
        updatedAt: new Date().toISOString(),
      }))
      for (const sessionId of historical) accounted.set(sessionId, id)
    }

    const groupRank = new Map(groups.map(group => [group.path, group.newestAt]))
    const priorRank = new Map(state.workspaceIds.map((id, index) => [id, index]))
    const workspaceIds = [...table.entries()]
      .sort(([leftId, left], [rightId, right]) => {
        const leftTime = groupRank.get(left.path) ?? Date.parse(left.createdAt)
        const rightTime = groupRank.get(right.path) ?? Date.parse(right.createdAt)
        return rightTime - leftTime
          || (priorRank.get(leftId) ?? Number.MAX_SAFE_INTEGER)
            - (priorRank.get(rightId) ?? Number.MAX_SAFE_INTEGER)
          || String(leftId).localeCompare(String(rightId))
      })
      .map(([id]) => id)

    if (!sameIds(state.workspaceIds, workspaceIds)) {
      await this.setState({
        initialized: false,
        workspaceIds,
        archivedSessionIds: state.archivedSessionIds,
        pinnedSessionIds: state.pinnedSessionIds,
      })
    }
    await this.setState({
      initialized: true,
      workspaceIds,
      archivedSessionIds: state.archivedSessionIds,
      pinnedSessionIds: state.pinnedSessionIds,
    })
  }

  private validateStoredState(state: WorkspaceDomainState): void {
    const table = this.requireTable()
    const order = new Set<WorkspaceId>()
    for (const id of state.workspaceIds) {
      if (order.has(id)) {
        throw new Error(`workspace domain is inconsistent: registry order repeats workspace '${id}'`)
      }
      if (table.get(id) === undefined) {
        throw new Error(`workspace domain is inconsistent: registry order references missing workspace '${id}'`)
      }
      order.add(id)
    }
    if (state.initialized && order.size !== table.size) {
      const orphan = [...table.keys()].find(id => !order.has(id))
      throw new Error(
        `workspace domain is inconsistent: workspace '${orphan as WorkspaceId}' is absent from registry order`,
      )
    }

    const paths = new Map<string, WorkspaceId>()
    const accounted = new Map<SessionId, WorkspaceId>()
    for (const [id, record] of table.entries()) {
      const pathHolder = paths.get(record.path)
      if (pathHolder !== undefined) {
        throw new Error(
          `workspace domain is inconsistent: path '${record.path}' is claimed `
          + `by both workspace '${pathHolder}' and workspace '${id}'`,
        )
      }
      paths.set(record.path, id)
      for (const sessionId of record.sessionIds) {
        const holder = accounted.get(sessionId)
        if (holder !== undefined) {
          throw new Error(
            `workspace domain is inconsistent: session '${sessionId}' is accounted `
            + `by both workspace '${holder}' and workspace '${id}'`,
          )
        }
        accounted.set(sessionId, id)
      }
    }
  }

  private rebuildEntities(): void {
    this.entities.clear()
    for (const id of this.requireState().workspaceIds) {
      const record = this.requireTable().get(id) as WorkspaceRecord
      this.entities.set(id, new WorkspaceEntity(this.host, id, record))
    }
  }

  private async replaceHeaderIndex(headers: readonly SessionHeader[]): Promise<void> {
    this.headers.clear()
    this.sessionPaths.clear()
    this.missingSessionPaths.clear()
    this.invalidSessionPaths.clear()
    await this.indexHeaders(headers)
  }

  private async indexHeaders(headers: readonly SessionHeader[]): Promise<void> {
    for (const header of headers) await this.indexHeader(header)
  }

  private async indexHeader(header: SessionHeader): Promise<void> {
    this.headers.set(header.id, header)
    this.sessionPaths.delete(header.id)
    this.missingSessionPaths.delete(header.id)
    if (header.cwd === undefined) {
      this.invalidSessionPaths.set(header.id, 'header has no cwd')
      return
    }
    try {
      const path = await realpathNormalize(header.cwd)
      if (!(await stat(path)).isDirectory()) {
        this.invalidSessionPaths.set(header.id, `cwd '${header.cwd}' is not a directory`)
        return
      }
      this.sessionPaths.set(header.id, path)
      this.invalidSessionPaths.delete(header.id)
    } catch (error) {
      if (fullyQualifiedWorkspacePath(header.cwd)
        && error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        this.missingSessionPaths.add(header.id)
      }
      this.invalidSessionPaths.set(header.id, `cwd '${header.cwd}' does not resolve`)
    }
  }

  /** Every stored session's header, projected from the persistence snapshot listing. */
  private async listStoredHeaders(): Promise<SessionHeader[]> {
    const snapshots = await this.ctx.sessionPersistence.list()
    return snapshots.map(snapshot => snapshot.header)
  }

  private async indexLiveSessions(): Promise<void> {
    await this.indexHeaders([...this.liveSessions.values()])
  }

  private reportFilteredCandidates(): void {
    for (const entity of this.entities.values()) {
      const record = this.requireTable().get(entity.id) as WorkspaceRecord
      for (const sessionId of record.sessionIds) {
        if ([record.path, ...record.previousPaths ?? []].some(path => this.host.candidateMatches(sessionId, path))) continue
        const path = this.sessionPaths.get(sessionId)
        const reason = this.invalidSessionPaths.get(sessionId)
          ?? (this.headers.has(sessionId)
            ? `canonical cwd '${path}' differs from workspace path '${record.path}'`
            : 'session header is missing')
        this.ctx.logger.warn(
          `workspace '${entity.id}' filtered session '${sessionId}' from membership: ${reason}`,
        )
      }
    }
  }

  private async readSessionHeader(id: SessionId): Promise<SessionHeader> {
    const live = this.liveSessions.get(id)
    if (live !== undefined) {
      this.headers.set(id, live)
      return live
    }
    const cached = this.headers.get(id)
    if (cached !== undefined) return cached

    const headers = await this.listStoredHeaders()
    await this.indexHeaders(headers)
    const header = this.headers.get(id)
    if (header === undefined) {
      throw new Error(`cannot validate session '${id}': session persistence holds no such session`)
    }
    return header
  }

  private requireTable(): KvTable<WorkspaceId, WorkspaceRecord> {
    if (this.table === undefined) throw new Error('workspace registry is not started yet')
    return this.table
  }

  private requireState(): WorkspaceDomainState {
    if (this.state === undefined) throw new Error('workspace registry is not started yet')
    return this.state
  }

  private async setState(state: WorkspaceDomainState): Promise<void> {
    await (this.global as DomainGlobal<WorkspaceDomainState>).set(state)
    this.state = state
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(async () => {
      // A committed delete may leave only its marker cleanup pending. Retry
      // recovery before another create/delete can overwrite that pending operation record.
      await this.recoverPendingMutation()
      return await operation()
    })
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}

const sameSessionIds = (left: readonly SessionId[], right: readonly SessionId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

export default WorkspaceRegistry
