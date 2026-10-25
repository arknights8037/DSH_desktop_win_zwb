/* The settings page and instance recovery window share scoped plugin controls. */
window.mountPluginManager = async function (root, api, prefix = '') {
  root.classList.add('plugin-workspace')
  root.innerHTML = `
    <div class="plugin-overview"><div><h1 id="title"></h1></div><button id="refresh" type="button"></button></div>
    <p id="status" class="plugin-status" role="status" aria-live="polite"></p>
    <section id="recovery" hidden><p id="recovery-description"></p><p id="startup-error" role="alert"></p><button id="retry" type="button"></button><button id="disable-all" type="button"></button></section>
    <div class="plugin-columns">
      <div class="plugin-discovery">
        <section id="market" aria-labelledby="catalog-heading">
          <div class="plugin-column-heading"><h2 id="catalog-heading"></h2><button id="catalog-refresh" type="button"></button></div>
          <form id="catalog-search" class="plugin-search" data-browse-controls>
            <div class="search-field"><label id="search-label" for="search-query"></label><input id="search-query" type="search" autocomplete="off"></div>
            <div class="category-field"><label id="category-label" for="search-category"></label><select id="search-category"></select></div>
            <button id="search-submit" type="submit"></button>
          </form>
          <div class="plugin-filters" data-browse-controls><div class="plugin-filter-tabs"><button type="button" data-catalog-filter="all" aria-pressed="true"></button><button type="button" data-catalog-filter="npm" aria-pressed="false"></button><button type="button" data-catalog-filter="library" aria-pressed="false"></button></div><button id="search-clear" type="button" hidden></button></div>
          <div class="plugin-results-meta"><p id="catalog-status" role="status" aria-live="polite"></p><details class="plugin-source"><summary id="catalog-source-label"></summary><p id="catalog-source"></p></details></div>
          <p id="catalog-empty" class="plugin-empty" hidden></p>
          <ul id="catalog" tabindex="-1" aria-labelledby="catalog-heading"></ul>
          <div data-browse-controls><button id="catalog-more" type="button" hidden></button></div>
        </section>
        <details id="manual-install" class="plugin-manual"><summary id="manual-install-label"></summary><form id="install-form"><label id="package-label" for="package-spec"></label><div class="install-row"><input id="package-spec" name="package-spec" autocomplete="off" placeholder="@scope/plugin@1.2.3" required><button id="install" type="submit"></button></div></form></details>
      </div>
      <div class="plugin-management">
        <div class="plugin-column-heading"><h2 id="installed-heading"></h2><span id="installed-count" class="plugin-count"></span></div>
        <section id="library-target" hidden><label id="target-label" for="target-instance"></label><select id="target-instance" aria-describedby="target-hint"></select><p id="target-hint" class="plugin-hint"></p></section>
        <section id="install-plan" aria-labelledby="plan-heading" hidden>
          <div class="plugin-review-heading"><span id="review-label" class="plugin-eyebrow"></span><h2 id="plan-heading" tabindex="-1"></h2></div>
          <p id="plan-description"></p><dl id="plan-fields"></dl>
          <details id="plan-advanced" class="plugin-advanced"><summary id="plan-advanced-label"></summary><dl id="plan-advanced-fields"></dl></details>
          <p id="plan-blockers" role="alert"></p><p id="permission-notice"></p><p id="backup-notice"></p>
          <div class="package-actions plugin-review-actions"><button id="confirm-install" class="plugin-primary" type="button"></button><button id="cancel-install" type="button"></button></div>
        </section>
        <section class="plugin-installed" aria-labelledby="installed-heading">
          <div class="plugin-library-search" data-browse-controls><label id="library-search-label" for="library-search"></label><input id="library-search" type="search" autocomplete="off"></div>
          <ul id="plugins"></ul><p id="empty" class="plugin-empty"></p>
        </section>
      </div>
    </div>
`.replace(/(id|for|aria-labelledby|aria-describedby)="([^"]+)"/gu, (_, attribute, value) => `${attribute}="${prefix}${value}"`)
  const select = selector => root.querySelector(selector.replace(/#([\w-]+)/gu, (_, id) => `#${prefix}${id}`))
  const selectAll = selector => root.querySelectorAll(selector)

  const locale = await api.locale()
  const messages = locale.messages
  let library = await api.plugins.library()
  const target = select('#target-instance')
  const message = (key, values = {}) => messages[key].replaceAll(/\{([^{}]+)\}/gu, (placeholder, name) => values[name] ?? placeholder)
  if (!prefix) {
    document.documentElement.lang = locale.id
    document.title = messages.pluginManagerTitle
  }
  select('#title').textContent = messages.pluginManagerTitle
  select('#refresh').textContent = messages.refresh
  select('#package-label').textContent = messages.npmPackage
  select('#install').textContent = messages.reviewInstall
  select('#installed-heading').textContent = messages.installed
  select('#empty').textContent = messages.noPlugins
  if (library.active) {
    select('#title').textContent = messages.libraryTitle
    if (!prefix) document.title = messages.libraryTitle
    select('#installed-heading').textContent = messages.libraryVersions
    select('#empty').textContent = messages.libraryEmpty
    select('#confirm-install').textContent = messages.installInLibrary
    select('#library-target').hidden = false
    select('#target-label').textContent = messages.targetInstance
  } else {
    select('#install-form').hidden = true
    select('#market').hidden = true
    select('#manual-install').hidden = true
    select('.plugin-library-search').hidden = true
  }

  select('#recovery-description').textContent = messages.recoveryDescription
  select('#retry').textContent = messages.retry
  select('#disable-all').textContent = messages.disableAll

  const list = select('#plugins')
  const empty = select('#empty')
  const status = select('#status')
  const form = select('#install-form')
  const input = select('#package-spec')
  const refresh = select('#refresh')
  let activePlan
  let busy = false
  let installedPlugins = []
  let targetInitialized = false
  let catalogFilter = 'all'
  let reviewOrigin
  let selectedPackage
  let catalog
  let catalogLoading = false
  let visible = 30
  let catalogEntry
  const confirm = select('#confirm-install')
  const planSection = select('#install-plan')
  const catalogStatus = select('#catalog-status')
  const query = select('#search-query')
  const category = select('#search-category')
  const libraryQuery = select('#library-search')
  for (const [id, text] of [
    ['catalog-heading', messages.catalogTitle], ['catalog-refresh', messages.refreshCatalog], ['search-label', messages.searchPlugins],
    ['category-label', messages.category], ['search-submit', messages.search], ['catalog-more', messages.showMore],
    ['confirm-install', messages.confirmInstall], ['cancel-install', messages.cancel], ['permission-notice', messages.permissionNotice],
    ['backup-notice', messages.backupNotice],
    ['manual-install-label', messages.manualInstall], ['catalog-source-label', messages.catalogSourceLabel],
    ['search-clear', messages.clearFilters], ['library-search-label', messages.findLibraryPlugin],
    ['catalog-empty', messages.noCatalogMatches], ['plan-advanced-label', messages.technicalDetails], ['review-label', messages.reviewInstall],
  ]) select(`#${id}`).textContent = text
  query.placeholder = messages.searchPlaceholder
  libraryQuery.placeholder = messages.librarySearchPlaceholder
  for (const button of selectAll('[data-catalog-filter]')) button.textContent = messages[{ all: 'filterAll', npm: 'filterNpm', library: 'filterLibrary' }[button.dataset.catalogFilter]]
  if (library.active) {
    confirm.textContent = messages.installInLibrary
    select('#backup-notice').textContent = messages.libraryBackupNotice
  }

  function eligible() {
    return activePlan && (library.active || activePlan.compatibility !== 'incompatible') && activePlan.blockers.length === 0
  }

  function setStatus(text, tone = 'info') {
    status.textContent = text
    status.dataset.tone = tone
  }

  function setBusy(value, statusMessage = '') {
    busy = value
    select('.plugin-columns').setAttribute('aria-busy', String(busy))
    for (const control of selectAll('button, input, select')) {
      if (!control.closest('[data-instance-deployments], [data-browse-controls]')) control.disabled = busy
    }
    for (const control of selectAll('[data-unsupported="true"]')) control.disabled = true
    select('#catalog-refresh').disabled = busy || catalogLoading
    confirm.disabled = busy || !eligible()
    for (const control of selectAll('[data-inject]')) {
      const instance = library.targets.find(instance => instance.id === target.value && instance.available)
      control.disabled = busy || !instance
      control.title = instance ? message('applyToTarget', { target: instance.name }) : messages.chooseTarget
    }
    if (busy) setStatus(statusMessage, 'busy')
  }

  function focusLibrary(name) {
    libraryQuery.value = ''
    renderInstalled()
    const row = [...list.children].find(item => item.dataset.package === name)
    if (row) {
      row.focus({ preventScroll: true })
      row.scrollIntoView?.({ block: 'nearest' })
    }
  }

  function renderInstalled() {
    const needle = libraryQuery.value.trim().toLocaleLowerCase()
    const plugins = installedPlugins.filter(plugin => `${plugin.name} ${plugin.version}`.toLocaleLowerCase().includes(needle))
    select('#installed-count').textContent = String(installedPlugins.length)
    list.replaceChildren(...plugins.map(plugin => {
      const item = document.createElement('li')
      item.dataset.package = plugin.name
      item.tabIndex = -1
      const identity = document.createElement('span')
      const version = document.createElement('span')
      version.className = 'package-version'
      version.textContent = plugin.enabled ? plugin.version : `${plugin.version} · ${messages.disabled}`
      identity.append(document.createTextNode(plugin.name), version)
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'plugin-remove'
      remove.textContent = messages.remove
      remove.setAttribute('aria-label', message('removeVersion', { name: plugin.name, version: plugin.version }))
      remove.addEventListener('click', () => void run(
        () => api.plugins.remove(plugin.name, ...(library.active ? [plugin.version] : [])),
        message('removing', { name: plugin.name }),
      ))
      const actions = document.createElement('span')
      actions.className = 'package-actions'
      if (library.active) {
        const inject = document.createElement('button')
        inject.type = 'button'
        inject.className = 'plugin-apply'
        inject.textContent = messages.injectPlugin
        inject.dataset.inject = 'true'
        inject.addEventListener('click', () => {
          const instance = library.targets.find(instance => instance.id === target.value && instance.available)
          if (busy || !instance || !window.confirm(message('injectConfirm', { name: plugin.name, version: plugin.version, target: instance.name }))) return
          void run(() => api.plugins.inject(plugin.name, plugin.version, instance.id), messages.injectingPlugin,
            message('appliedToTarget', { name: plugin.name, version: plugin.version, target: instance.name }))
        })
        actions.append(inject, remove)
      } else {
        const toggle = document.createElement('button')
        toggle.type = 'button'
        toggle.textContent = plugin.enabled ? messages.disable : messages.enable
        toggle.addEventListener('click', () => void run(
          () => api.plugins.toggle(plugin.name, !plugin.enabled), messages.changingActivation,
        ))
        actions.append(toggle, remove)
      }
      item.append(identity, actions)
      return item
    }))
    empty.hidden = plugins.length !== 0
    empty.textContent = installedPlugins.length && needle ? messages.noLibraryMatches : library.active ? messages.libraryEmpty : messages.noPlugins
    setBusy(busy, status.textContent)
  }

  async function render() {
    library = await api.plugins.library()
    const previous = target.value
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = messages.chooseTarget
    target.replaceChildren(placeholder, ...library.targets.map(instance => {
      const option = document.createElement('option')
      option.value = instance.id
      option.disabled = !instance.available
      option.textContent = `${instance.name} · ${messages[instance.kind === 'local' ? 'localInstance' : 'sshInstance']}${instance.available ? '' : ` · ${messages.connectFirst}`}`
      return option
    }))
    target.value = !targetInitialized ? library.targets.find(instance => instance.available)?.id ?? ''
      : library.targets.some(instance => instance.id === previous && instance.available) ? previous : ''
    targetInitialized = true
    const targetAvailable = library.targets.some(instance => instance.available)
    select('#target-hint').textContent = targetAvailable ? '' : messages.openTargetHint
    select('#target-hint').hidden = targetAvailable
    const backend = await api.backend.status()
    select('#recovery').hidden = backend.phase !== 'error'
    select('#startup-error').textContent = backend.phase === 'error' ? backend.message : ''
    installedPlugins = await api.plugins.list()
    renderInstalled()
    renderCatalog()
  }

  async function run(operation, statusMessage, success) {
    if (busy) return
    setBusy(true, statusMessage)
    try {
      await operation()
      await render()
      setStatus(success ?? (library.active ? messages.libraryOperationComplete : messages.operationComplete), 'success')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  function field(key, value, link = false) {
    const term = document.createElement('dt')
    term.textContent = messages[key]
    const definition = document.createElement('dd')
    if (link && value) {
      const anchor = document.createElement('a')
      anchor.href = value
      anchor.target = '_blank'
      anchor.rel = 'noreferrer'
      anchor.textContent = value
      definition.append(anchor)
    } else definition.textContent = value ?? messages.notDeclared
    select(['source', 'repository', 'integrity', 'snapshotLocation'].includes(key) ? '#plan-advanced-fields' : '#plan-fields').append(term, definition)
  }

  async function review(spec, entry) {
    if (busy) return
    reviewOrigin = document.activeElement
    selectedPackage = entry?.npm
    renderCatalog()
    activePlan = undefined
    catalogEntry = entry
    planSection.hidden = true
    setBusy(true, messages.loadingPlan)
    try {
      const plan = await api.plugins.plan(spec)
      activePlan = plan
      select('#plan-heading').textContent = `${plan.name}@${plan.version}`
      select('#plan-description').textContent = plan.description ?? ''
      select('#plan-fields').replaceChildren()
      select('#plan-advanced-fields').replaceChildren()
      select('#plan-advanced').open = false
      field('source', 'npm · https://registry.npmjs.org/')
      field('license', plan.license)
      field('repository', plan.repository, true)
      field('compatibility', messages[plan.compatibility])
      field('versionRequirements', plan.requirements.length ? plan.requirements.map(item => `${item.name}: ${item.range} · ${item.actual ?? messages.notAvailable} · ${messages[item.status]}`).join('\n') : undefined)
      field('permissions', plan.permissions?.join(', ') || (plan.permissions ? messages.noneDeclared : undefined))
      field('catalogCapabilities', catalogEntry?.capabilities?.join(', ') || (catalogEntry?.capabilities ? messages.noneDetected : messages.notScanned))
      if (catalogEntry?.capabilityCheckedAt) field('scanDate', catalogEntry.capabilityCheckedAt)
      field('buildScriptsLabel', plan.scripts.join(', ') || messages.noBuildScripts)
      field('integrity', plan.integrity)
      field('snapshotLocation', plan.snapshotPath)
      select('#plan-blockers').textContent = plan.blockers.map(key => messages[{
        'missing-bundle': 'missingBundle', 'host-owned': 'hostOwned', 'web-server-required': 'webServerRequired',
      }[key]]).join(' ')
      planSection.hidden = false
      setStatus(messages.reviewBeforeInstall)
      select('#plan-heading').focus()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error')
    } finally { setBusy(false) }
  }

  function renderCatalog() {
    if (!catalog) return
    const needle = query.value.trim().toLocaleLowerCase()
    const retained = new Set(installedPlugins.map(plugin => plugin.name))
    const matches = catalog.plugins.filter(entry => (!category.value || entry.categories.includes(category.value))
      && (catalogFilter !== 'npm' || entry.npm) && (catalogFilter !== 'library' || retained.has(entry.npm))
      && [entry.name, entry.npm ?? '', entry.owner, ...Object.values(entry.description), ...entry.categories].join(' ').toLocaleLowerCase().includes(needle))
    catalogStatus.textContent = message('catalogCount', { count: matches.length, total: catalog.plugins.length })
    select('#catalog-empty').hidden = matches.length !== 0
    select('#search-clear').hidden = !needle && !category.value && catalogFilter === 'all'
    for (const button of selectAll('[data-catalog-filter]')) button.setAttribute('aria-pressed', String(button.dataset.catalogFilter === catalogFilter))
    select('#catalog').replaceChildren(...matches.slice(0, visible).map(entry => {
      const inLibrary = retained.has(entry.npm)
      const item = document.createElement('li')
      item.className = 'plugin-card'
      item.classList.toggle('plugin-card-selected', selectedPackage !== undefined && entry.npm === selectedPackage)
      const text = document.createElement('div')
      text.className = 'plugin-card-content'
      const heading = document.createElement('div')
      heading.className = 'plugin-card-heading'
      const name = document.createElement('strong')
      name.textContent = entry.name
      heading.append(name)
      if (inLibrary) {
        const badge = document.createElement('span')
        badge.className = 'plugin-badge'
        badge.textContent = messages.inLibrary
        heading.append(badge)
      }
      const description = document.createElement('details')
      description.className = 'plugin-card-description'
      const summary = document.createElement('summary')
      summary.textContent = (locale.id === 'zh-CN' ? entry.description.zh ?? entry.description['zh-CN'] : entry.description.en) ?? Object.values(entry.description)[0] ?? ''
      description.append(summary)
      const meta = document.createElement('small')
      meta.textContent = `${entry.owner} · ${entry.categories.map(value => catalog.categories?.[value]?.[locale.id === 'zh-CN' ? 'zh' : 'en'] ?? value).join(', ')}`
      const source = document.createElement('a')
      source.href = entry.repository
      source.target = '_blank'
      source.rel = 'noreferrer'
      source.textContent = messages.repository
      source.setAttribute('aria-label', message('pluginRepository', { name: entry.name }))
      const packageName = document.createElement('span')
      packageName.className = 'plugin-package-name'
      packageName.textContent = entry.npm ?? messages.gitOnly
      text.append(heading, description, meta, document.createTextNode(' · '), source, packageName)
      const action = document.createElement('button')
      action.type = 'button'
      action.className = entry.npm && !inLibrary ? 'plugin-primary' : ''
      action.textContent = inLibrary ? messages.viewLibrary : entry.npm ? messages.reviewPlugin : messages.gitOnlyShort
      action.disabled = busy || !entry.npm
      action.dataset.unsupported = String(!entry.npm)
      action.addEventListener('click', () => { if (inLibrary) focusLibrary(entry.npm); else void review(entry.npm, entry) })
      const actions = document.createElement('span')
      actions.className = 'package-actions'
      actions.append(action)
      if (inLibrary) {
        const latest = document.createElement('button')
        latest.type = 'button'
        latest.textContent = messages.reviewLatest
        latest.disabled = busy
        latest.addEventListener('click', () => void review(entry.npm, entry))
        actions.append(latest)
      }
      item.append(text, actions)
      return item
    }))
    select('#catalog-more').hidden = matches.length <= visible
    select('#catalog-more').textContent = message('showMoreCount', { count: Math.max(0, Math.min(30, matches.length - visible)) })
  }

  async function loadCatalog() {
    if (catalogLoading) return
    catalogLoading = true
    const reload = select('#catalog-refresh')
    reload.disabled = true
    catalogStatus.textContent = messages.loadingCatalog
    select('#market').setAttribute('aria-busy', 'true')
    select('#catalog-empty').hidden = true
    try {
      catalog = await api.plugins.catalog()
      select('#catalog-source').textContent = message('catalogSource', { source: catalog.source, updated: catalog.updated ?? messages.notAvailable })
      const previous = category.value
      category.replaceChildren(...['', ...new Set(catalog.plugins.flatMap(entry => entry.categories))].sort().map(value => {
        const option = document.createElement('option')
        option.value = value
        option.textContent = value ? (catalog.categories?.[value]?.[locale.id === 'zh-CN' ? 'zh' : 'en'] ?? value) : messages.allCategories
        return option
      }))
      category.value = [...category.options].some(option => option.value === previous) ? previous : ''
      visible = 30
      renderCatalog()
    } catch (error) {
      catalog = undefined
      select('#catalog').replaceChildren()
      select('#catalog-more').hidden = true
      select('#catalog-source').textContent = ''
      catalogStatus.textContent = `${messages.catalogFailed} ${error instanceof Error ? error.message : String(error)}`
    } finally { catalogLoading = false; reload.disabled = busy; select('#market').setAttribute('aria-busy', 'false') }
  }

  async function load(statusMessage, success) {
    setBusy(true, statusMessage)
    try {
      await render()
      setStatus(success, success ? 'success' : 'info')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const spec = input.value.trim()
    if (spec === '') return
    void review(spec)
  })
  confirm.addEventListener('click', () => {
    if (!eligible() || busy) return
    const plan = activePlan
    activePlan = undefined
    selectedPackage = undefined
    planSection.hidden = true
    void run(async () => { await api.plugins.add(plan.id); input.value = '' }, message('installing', { spec: `${plan.name}@${plan.version}` }))
  })
  select('#cancel-install').addEventListener('click', () => {
    activePlan = undefined
    planSection.hidden = true
    selectedPackage = undefined
    renderCatalog()
    setStatus(messages.installCancelled)
    if (reviewOrigin?.isConnected) reviewOrigin.focus()
    else query.focus()
  })
  select('#catalog-search').addEventListener('submit', event => { event.preventDefault(); visible = 30; renderCatalog() })
  const resetResults = () => { visible = 30; renderCatalog(); select('#catalog').scrollTop = 0 }
  query.addEventListener('input', resetResults)
  libraryQuery.addEventListener('input', renderInstalled)
  for (const button of selectAll('[data-catalog-filter]')) button.addEventListener('click', () => { catalogFilter = button.dataset.catalogFilter; resetResults() })
  select('#search-clear').addEventListener('click', () => { query.value = ''; category.value = ''; catalogFilter = 'all'; resetResults(); query.focus() })
  root.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && library.active) { event.preventDefault(); query.focus(); query.select() }
  })
  category.addEventListener('change', resetResults)
  target.addEventListener('change', () => { setBusy(busy, status.textContent) })
  select('#catalog-refresh').addEventListener('click', () => void loadCatalog())
  select('#catalog-more').addEventListener('click', () => { visible += 30; renderCatalog() })
  select('#retry').addEventListener('click', () => void run(() => api.backend.retry(), messages.retry))
  select('#disable-all').addEventListener('click', () => void run(() => api.plugins.disableAll(), messages.changingActivation))
  refresh.addEventListener('click', () => void load(messages.refreshing, messages.refreshed))

  await load(messages.loadingPlugins, '')
  if (library.active) void loadCatalog()
  return { refresh: () => busy ? Promise.resolve() : load(messages.refreshing, messages.refreshed) }
}

const pluginWindowRoot = document.querySelector('[data-plugin-window]')
if (pluginWindowRoot) void window.mountPluginManager(pluginWindowRoot, window.dshDesktop)
