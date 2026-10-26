/** Local instances share immutable runtime packages and own all writable Harness state. */
import { DesktopBackendController } from './backend-controller.ts'
import { DesktopHostProcess } from './host-process.ts'
import { resolveDesktopPaths } from './paths.ts'
import { DesktopProjectManager, type DesktopRuntimeExecutables, type DesktopProjectMutation } from './project-manager.ts'
import type { InstanceRuntime } from './instance-service.ts'
import type { InstanceStatus } from './instances.ts'

/** One profile manager and pipe host per local Harness home. */
export class LocalInstance implements InstanceRuntime {
  readonly manager: DesktopProjectManager
  private readonly backend: DesktopBackendController<DesktopHostProcess>
  constructor(
    home: string,
    resources: DesktopRuntimeExecutables,
    report: (status: InstanceStatus) => void,
    private readonly prepare?: (manager: DesktopProjectManager) => Promise<void>,
  ) {
    const paths = resolveDesktopPaths(home)
    this.manager = new DesktopProjectManager(paths, resources)
    this.backend = new DesktopBackendController((onFailure) => {
      this.manager.assertProfileRuntime(paths.profile)
      return new DesktopHostProcess(resources.node, resources.dsh, paths.profile, undefined,
        { ...process.env, DSH_HOME: home }, onFailure)
    }, (state) => {
      if (state.phase === 'error') report({ process: 'error', connection: 'error', message: state.message })
    })
  }
  /** Prepare only this profile and await the local host's ready event. */
  async connect(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const abort = (): void => { void this.backend.stop().catch(() => undefined) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      await this.backend.start(async () => {
        if (this.prepare) await this.prepare(this.manager)
        else await this.manager.applyRelease()
      })
      signal.throwIfAborted()
      return 'dsh-app://app/index.html'
    } finally { signal.removeEventListener('abort', abort) }
  }
  /** Local tab detachment does not terminate the host. */
  async disconnect(): Promise<void> {}
  /** Await complete backend exit. */
  async stop(): Promise<void> { await this.backend.stop() }
  /** Dispatch through the pipe owned by this instance. */
  fetch(request: Request): Promise<Response> {
    return this.backend.host?.fetch(request) ?? Promise.resolve(new Response(null, { status: 503 }))
  }
  /** Profile transactions stop and restart only this backend. */
  async mutate(mutation: DesktopProjectMutation | 'reset'): Promise<void> {
    const hooks = { beforeChange: () => this.backend.stop(), afterChange: async () => { await this.backend.start(async () => {}) } }
    if (mutation === 'reset') await this.manager.resetConfiguration(hooks)
    else await this.manager.mutate(mutation, hooks)
  }
}
