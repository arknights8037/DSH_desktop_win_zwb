/** Expose plugin data and commands to the shell without mounting the kernel's plugin page. */
import type { Context } from '@deepseek-ai/cordis'
import { installDesktopPluginNavigation, type DesktopPluginNavigationBridge } from './plugin-navigation.ts'

interface Result { ok: boolean; value?: unknown; error?: { code: string; diagnostic?: string } }
interface RemotePlugins {
  listBundles(): Promise<Result>
  listPlugins(): Promise<Result>
  setBundleEnabled(name: string, enabled: boolean): Promise<Result>
  setPluginEnabled(id: string, enabled: boolean): Promise<Result>
}
interface Layout {
  panelInfo: { getSnapshot(): { activePanelId: string | null }; subscribe(listener: () => void): () => void }
  selectPanel(id: string | null): void
}

function unwrap(result: Result): unknown {
  if (!result.ok) throw new Error(result.error?.diagnostic || result.error?.code || 'Plugin request failed')
  return result.value
}

/** Register a closed data bridge and route the kernel's plugin navigation to the shell. */
export function installNativePluginPanel(ctx: Context): void {
  const navigation = (globalThis as typeof globalThis & { __DSH_PLUGIN_NAVIGATION__?: DesktopPluginNavigationBridge }).__DSH_PLUGIN_NAVIGATION__
  if (!navigation) throw new Error('Desktop plugin navigation is unavailable')
  installDesktopPluginNavigation(ctx, navigation)
  // Configuration contributors still need their slot owner, even though the shell renders the page.
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'plugins', children: {
      'plugins.add.actions': { kind: 'list', scope: 'root' },
      'plugins.tab': { kind: 'list', scope: 'root' },
      'plugins.item': { kind: 'list', scope: 'root' },
      'plugins.bundle.activation': { kind: 'keyed', scope: 'root' },
      'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
      'plugins.row.config': { kind: 'keyed', scope: 'root' },
      'plugins.detail.actions': { kind: 'list', scope: 'root' },
      'plugins.detail.badge': { kind: 'list', scope: 'root' },
      'plugins.detail.section': { kind: 'list', scope: 'root' },
    },
  } as never, () => null))
  const layout = ctx.get('layout') as Layout
  const plugins = (ctx.get('remote') as { pluginManager: RemotePlugins }).pluginManager
  const forms = ctx.get('configForms')!
  const slots = ctx.get('slots') as { entries(name: string): ReadonlyArray<{ options: { id: string; label?: string | (() => string) } }> }
  const localize = (item: Record<string, unknown>): Record<string, unknown> => {
    const meta = item.meta as { title?: Parameters<typeof ctx.locale.resolveText>[0]; description?: Parameters<typeof ctx.locale.resolveText>[0] } | undefined
    return { ...item, title: meta?.title === undefined ? item.name ?? item.moduleName : ctx.locale.resolveText(meta.title),
      description: meta?.description === undefined ? item.description : ctx.locale.resolveText(meta.description) }
  }
  const bridge = {
    async read() {
      const [bundles, entries] = await Promise.all([plugins.listBundles(), plugins.listPlugins(), forms.describe().ensure()])
      const snapshot = forms.describe().getSnapshot()
      if (!snapshot.view) throw new Error(snapshot.error || 'Plugin configuration is unavailable')
      return {
        bundles: (unwrap(bundles) as Record<string, unknown>[]).map(item => ({ ...localize(item),
          rows: (item.rows as Record<string, unknown>[]).map(localize) })),
        entries: unwrap(entries),
        configurations: snapshot.view.namespaces.map(section => {
          const label = slots.entries('plugins.item').find(entry => entry.options.id === section.ns)?.options.label
          return { ns: section.ns, title: typeof label === 'function' ? label() : label || section.ns }
        }),
      }
    },
    async toggle(input: { kind: 'bundle' | 'row'; target: string; enabled: boolean }) {
      const value = unwrap(await (input.kind === 'bundle'
        ? plugins.setBundleEnabled(input.target, input.enabled) : plugins.setPluginEnabled(input.target, input.enabled))) as {
          application: string; error?: { code: string; diagnostic?: string }
        }
      if (value.application === 'failed' || value.application === 'overridden') {
        throw new Error(value.error?.diagnostic || value.error?.code || value.application)
      }
      return { restartRequired: value.application === 'restart-required' }
    },
    async configuration(input: { target: string }) {
      await forms.describe().ensure()
      const snapshot = forms.describe().getSnapshot()
      const section = snapshot.view?.namespaces.find(section => section.ns === input.target)
      if (!section) throw new Error('Plugin configuration is unavailable')
      return { ...section, writable: snapshot.view!.writable }
    },
    async configure(input: { target: string; revision: number; ops: Parameters<ReturnType<typeof forms.get>['mutate']>[0] }) {
      if (!await forms.get(input.target).mutate(input.ops, input.revision)) {
        throw new Error('Configuration was rejected or changed elsewhere; reload it before saving again')
      }
    },
  }
  ctx.effect(() => {
    const target = globalThis as typeof globalThis & { __DSH_DESKTOP_PLUGINS__?: typeof bridge }
    target.__DSH_DESKTOP_PLUGINS__ = bridge
    let previous = layout.panelInfo.getSnapshot().activePanelId
    const unsubscribe = layout.panelInfo.subscribe(() => {
      const panel = layout.panelInfo.getSnapshot().activePanelId
      if (panel !== 'plugins') { previous = panel; return }
      layout.selectPanel(previous === 'plugins' ? null : previous)
      void navigation.openList().catch(error => ctx.logger.warn('Desktop plugin navigation failed: %s', String(error)))
    })
    return () => {
      unsubscribe()
      if (target.__DSH_DESKTOP_PLUGINS__ === bridge) delete target.__DSH_DESKTOP_PLUGINS__
    }
  }, 'desktop plugin data')
}
