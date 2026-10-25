/** Local instances share immutable runtime packages and own all writable Harness state. */
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
    private readonly home: string,
    resources: DesktopRuntimeExecutables,
    private readonly developmentProject: string | undefined,
    report: (status: InstanceStatus) => void,
    private readonly prepare?: (manager: DesktopProjectManager) => Promise<void>,
  ) {
    const paths = resolveDesktopPaths(home)
    this.manager = new DesktopProjectManager(paths, resources)
    this.backend = new DesktopBackendController((onFailure) => {
      if (!developmentProject) this.manager.assertProfileRuntime(paths.profile)
      return new DesktopHostProcess(resources.node, developmentProject ?? resources.dsh, paths.profile, undefined,
        { ...process.env, DSH_HOME: home }, onFailure, Boolean(developmentProject))
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
        if (this.developmentProject) {
          const profile = resolveDesktopPaths(this.home).profile
          mkdirSync(profile, { recursive: true })
          if (!existsSync(join(profile, 'package.json'))) writeFileSync(join(profile, 'package.json'), readFileSync(join(this.developmentProject, 'package.json')))
          if (!existsSync(join(profile, 'node_modules'))) symlinkSync(join(this.developmentProject, 'node_modules'), join(profile, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
        } else if (this.prepare) await this.prepare(this.manager)
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
    if (this.developmentProject) throw new Error('Plugin changes require a packaged application')
    const hooks = { beforeChange: () => this.backend.stop(), afterChange: async () => { await this.backend.start(async () => {}) } }
    if (mutation === 'reset') await this.manager.resetConfiguration(hooks)
    else await this.manager.mutate(mutation, hooks)
  }
}
