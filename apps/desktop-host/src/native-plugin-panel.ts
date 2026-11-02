/** Embed the kernel's complete plugin page in the Desktop settings surface. */
import type { Context } from '@deepseek-ai/cordis'

interface Layout {
  panelInfo: { getSnapshot(): { activePanelId: string | null }; subscribe(listener: () => void): () => void }
  selectPanel(id: string | null): void
}

/** Register navigation with disposal and restore the previous panel on exit.
 * @param ctx - Client context containing the kernel layout service.
 */
export function installNativePluginPanel(ctx: Context): void {
  const layout = ctx.get('layout') as Layout
  let previous: string | null | undefined
  let lastPanel = layout.panelInfo.getSnapshot().activePanelId
  let requestedPackage: string | undefined
  const focusRequestedPackage = (): void => {
    if (requestedPackage === undefined) return
    const cards = [...document.querySelectorAll<HTMLElement>('[data-plugin-package], [data-plugin-item]')]
    const target = cards.find(card => card.dataset.pluginPackage === requestedPackage || card.dataset.pluginItem === requestedPackage)
    if (target === undefined) return
    for (const card of cards) card.removeAttribute('data-desktop-plugin-focused')
    target.setAttribute('data-desktop-plugin-focused', '')
    target.scrollIntoView?.({ block: 'center' })
  }
  const show = (packageName?: string): void => {
    if (!ctx.get('pluginNavigation')) throw new Error('Kernel plugin management is unavailable')
    if (previous === undefined) previous = lastPanel === 'plugins' ? null : lastPanel
    requestedPackage = packageName
    document.documentElement.dataset.desktopPluginPanel = ''
    layout.selectPanel('plugins')
    focusRequestedPackage()
  }
  const hide = (): void => {
    delete document.documentElement.dataset.desktopPluginPanel
    requestedPackage = undefined
    for (const element of document.querySelectorAll('[data-desktop-plugin-focused]')) element.removeAttribute('data-desktop-plugin-focused')
    if (previous !== undefined) { layout.selectPanel(previous); previous = undefined }
  }
  ctx.effect(() => {
    const target = globalThis as typeof globalThis & { __DSH_NATIVE_PLUGINS__?: { show(packageName?: string): void; hide(): void } }
    const bridge = { show, hide }
    target.__DSH_NATIVE_PLUGINS__ = bridge
    const unsubscribe = layout.panelInfo.subscribe(() => {
      if (document.documentElement.hasAttribute('data-desktop-plugin-panel')) return
      const panel = layout.panelInfo.getSnapshot().activePanelId
      if (panel !== 'plugins') { lastPanel = panel; return }
      const navigation = (globalThis as typeof globalThis & { __DSH_PLUGIN_NAVIGATION__?: { openList(): Promise<void> } }).__DSH_PLUGIN_NAVIGATION__
      void navigation?.openList().catch(error => ctx.logger.warn('Desktop plugin navigation failed: %s', String(error)))
    })
    const style = document.createElement('style')
    style.textContent = `html[data-desktop-plugin-panel] [class*="_frame"] { grid-template-columns: 0 minmax(0, 1fr) 0 !important; }
html[data-desktop-plugin-panel] [class*="_centerCol"] { grid-column: 2 !important; grid-row: 1 !important; min-width: 0; }
html[data-desktop-plugin-panel] [class*="_sidebarCol"], html[data-desktop-plugin-panel] [class*="_rightbarCol"], html[data-desktop-plugin-panel] [class*="_handle"] { display: none !important; }
html[data-desktop-plugin-panel] [class$="_page"] { padding: 0 12px 24px 0; gap: 24px; align-items: stretch; font-family: system-ui, "Segoe UI", sans-serif; }
html[data-desktop-plugin-panel] [class$="_page"] > * { max-width: none; }
html[data-desktop-plugin-panel] [class$="_pageHead"] { padding-top: 0; justify-content: flex-end; }
html[data-desktop-plugin-panel] [class$="_pageHeading"] { display: none; }
html[data-desktop-plugin-panel] [class$="_groupTitle"] { font-size: 13px; font-weight: 600; }
html[data-desktop-plugin-panel] [class$="_cards"] { border: 1px solid var(--dsw-alias-border-l3); border-radius: 10px; padding: 0 14px; gap: 0; }
html[data-desktop-plugin-panel] [class$="_card"] { margin: 0; border-radius: 0; border-bottom: 1px solid var(--dsw-alias-border-l3); }
html[data-desktop-plugin-panel] [class$="_card"]:last-child { border-bottom: 0; }
html[data-desktop-plugin-panel] [class$="_cardHead"] { padding: 14px 0; gap: 12px; }
html[data-desktop-plugin-panel] [class$="_cardIcon"] { width: 34px; height: 34px; border-radius: 8px; }
html[data-desktop-plugin-panel] [class$="_cardDesc"] { font-size: 12px; -webkit-line-clamp: 2; }
html[data-desktop-plugin-panel] [class$="_detailTop"] { padding-top: 0; }
html[data-desktop-plugin-panel] [class$="_detailSections"] { width: 100%; }`
    style.textContent += `
html[data-desktop-plugin-panel] [data-plugin-panel] { gap: 20px; position: relative; }
html[data-desktop-plugin-panel] [data-plugin-panel] > header[class$="_pageHead"] { position: absolute; right: 12px; top: 0; width: auto; z-index: 1; }
html[data-desktop-plugin-panel] [data-plugin-panel] [class$="_addPrimary"] { display: none; }
html[data-desktop-plugin-panel] [data-plugin-group="bundles"] { order: 1; }
html[data-desktop-plugin-panel] [data-plugin-group="basic"] { order: 2; }
html[data-desktop-plugin-panel] [data-plugin-group="extensions"] { order: 3; }
html[data-desktop-plugin-panel] .desktop-plugin-toolbar { order: 0; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding-right: 100px; box-sizing: border-box; }
html[data-desktop-plugin-panel] .desktop-plugin-toolbar input { flex: 1; min-width: 180px; padding: 9px 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13px; }
html[data-desktop-plugin-panel] .desktop-plugin-filters { display: flex; gap: 4px; }
html[data-desktop-plugin-panel] .desktop-plugin-toolbar button { border: 0; border-radius: 6px; padding: 7px 10px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
html[data-desktop-plugin-panel] .desktop-plugin-toolbar button[aria-pressed="true"] { color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-interactive-bg-hover); }
html[data-desktop-plugin-panel] .desktop-plugin-empty { order: 4; text-align: center; padding: 40px 20px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
html[data-desktop-plugin-panel] [data-desktop-filtered] { display: none !important; }
html[data-desktop-plugin-panel] [data-desktop-plugin-focused] { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; border-radius: 10px; }
html[data-desktop-plugin-panel] [data-plugin-panel] > [class$="_pageTabs"] { order: 0; }
html[data-desktop-plugin-panel] .desktop-plugin-toolbar[hidden], html[data-desktop-plugin-panel] .desktop-plugin-empty[hidden] { display: none; }`
    document.head.append(style)
    const zh = document.documentElement.lang.startsWith('zh')
    const toolbar = document.createElement('div')
    toolbar.className = 'desktop-plugin-toolbar'
    const search = document.createElement('input')
    search.type = 'search'
    search.placeholder = zh ? '搜索此实例的插件…' : 'Search this instance’s plugins…'
    search.setAttribute('aria-label', search.placeholder)
    const filters = document.createElement('div')
    filters.className = 'desktop-plugin-filters'
    filters.setAttribute('role', 'group')
    filters.setAttribute('aria-label', zh ? '插件分类' : 'Plugin categories')
    let filter = 'all'
    const choices = [['all', zh ? '全部' : 'All'], ['bundles', zh ? '已安装' : 'Installed'], ['basic', zh ? '内置配置' : 'Built-in'], ['extensions', zh ? '实验性' : 'Experimental']]
    const empty = document.createElement('div')
    empty.className = 'desktop-plugin-empty'
    const emptyLabel = document.createElement('p')
    const emptyAction = document.createElement('button')
    emptyAction.type = 'button'
    emptyAction.textContent = zh ? '发现插件' : 'Discover plugins'
    emptyAction.onclick = () => {
      const navigation = (globalThis as typeof globalThis & { __DSH_PLUGIN_NAVIGATION__?: { openList(mode?: string): Promise<void> } }).__DSH_PLUGIN_NAVIGATION__
      void navigation?.openList('discover').catch(error => ctx.logger.warn('Desktop plugin discovery failed: %s', String(error)))
    }
    empty.append(emptyLabel, emptyAction)
    const applyFilter = (): void => {
      const groups = [...document.querySelectorAll<HTMLElement>('[data-plugin-panel] [data-plugin-group]')]
      const needle = search.value.trim().toLocaleLowerCase()
      let count = 0
      for (const group of groups) {
        const category = group.dataset.pluginGroup
        const matching = filter === 'all' || category === filter || (category === 'more' && filter === 'extensions')
        const cards = [...group.querySelectorAll<HTMLElement>('[data-plugin-package], [data-plugin-item]')]
        let matches = 0
        for (const card of cards) {
          const include = matching && (!needle || `${card.textContent} ${card.dataset.pluginPackage || card.dataset.pluginItem}`.toLocaleLowerCase().includes(needle))
          card.toggleAttribute('data-desktop-filtered', !include)
          if (include) matches++
        }
        // Keep the native More control available for optional bundles.
        group.toggleAttribute('data-desktop-filtered', !matching || (matches === 0 && (category !== 'extensions' || !!needle)))
        count += matches
      }
      const isList = groups.length > 0
      toolbar.hidden = !isList
      empty.hidden = !isList || count > 0
      const emptyText = !needle && filter === 'bundles'
        ? zh ? '此实例尚未安装第三方插件。' : 'This instance has no third-party plugins.'
        : zh ? '没有匹配的插件，请尝试其他分类或搜索词。' : 'No matching plugins. Try another category or search.'
      if (emptyLabel.textContent !== emptyText) emptyLabel.textContent = emptyText
      emptyAction.hidden = !!needle || filter !== 'bundles'
    }
    for (const [id, label] of choices) {
      const button = document.createElement('button')
      button.type = 'button'; button.textContent = label!; button.dataset.filter = id
      button.setAttribute('aria-pressed', String(id === filter))
      button.onclick = () => {
        filter = id!
        for (const item of filters.querySelectorAll('button')) item.setAttribute('aria-pressed', String(item === button))
        if (filter === 'extensions') document.querySelector<HTMLButtonElement>('[data-plugin-group="extensions"] [class$="_groupMore"]')?.click()
        else document.querySelector<HTMLButtonElement>('[data-plugin-panel] [class$="_moreBack"]')?.click()
        applyFilter()
      }
      filters.append(button)
    }
    search.oninput = applyFilter
    toolbar.append(search, filters)
    const attach = (): void => {
      const page = document.querySelector<HTMLElement>('[data-plugin-panel]')
      if (!page) return
      if (toolbar.parentElement !== page) page.prepend(toolbar)
      if (empty.parentElement !== page) page.append(empty)
      applyFilter()
      focusRequestedPackage()
    }
    const observer = new document.defaultView!.MutationObserver(attach)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    attach()
    return () => {
      observer.disconnect()
      toolbar.remove(); empty.remove()
      for (const element of document.querySelectorAll('[data-desktop-filtered]')) element.removeAttribute('data-desktop-filtered')
      unsubscribe()
      hide()
      style.remove()
      if (target.__DSH_NATIVE_PLUGINS__ === bridge) delete target.__DSH_NATIVE_PLUGINS__
    }
  }, 'desktop native plugin panel')
}
