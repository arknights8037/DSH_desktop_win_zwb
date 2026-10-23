const api = window.dshDesktop

async function main() {
  const locale = await api.locale()
  const messages = locale.messages
  let library = await api.plugins.library()
  const target = document.querySelector('#target-instance')
  const message = (key, values = {}) => messages[key].replaceAll(/\{([^{}]+)\}/gu, (placeholder, name) => values[name] ?? placeholder)
  document.documentElement.lang = locale.id
  document.querySelector('#page-title').textContent = messages.pluginManagerTitle
  document.querySelector('#title').textContent = messages.pluginManagerTitle
  document.querySelector('#description').textContent = messages.pluginManagerDescription
  document.querySelector('#refresh').textContent = messages.refresh
  document.querySelector('#package-label').textContent = messages.npmPackage
  document.querySelector('#install').textContent = messages.reviewInstall
  document.querySelector('#installed-heading').textContent = messages.installed
  document.querySelector('#empty').textContent = messages.noPlugins
  if (library.active) {
    document.querySelector('#title').textContent = messages.libraryTitle
    document.querySelector('#page-title').textContent = messages.libraryTitle
    document.querySelector('#description').textContent = messages.libraryDescription
    document.querySelector('#installed-heading').textContent = messages.libraryVersions
    document.querySelector('#empty').textContent = messages.libraryEmpty
    document.querySelector('#confirm-install').textContent = messages.installInLibrary
    document.querySelector('#library-target').hidden = false
    document.querySelector('#target-label').textContent = messages.targetInstance
    document.querySelector('#target-hint').textContent = messages.targetHint
  } else {
    document.querySelector('#install-form').hidden = true
    document.querySelector('#market').hidden = true
  }

  document.querySelector('#recovery-description').textContent = messages.recoveryDescription
  document.querySelector('#retry').textContent = messages.retry
  document.querySelector('#disable-all').textContent = messages.disableAll

  const list = document.querySelector('#plugins')
  const empty = document.querySelector('#empty')
  const status = document.querySelector('#status')
  const form = document.querySelector('#install-form')
  const input = document.querySelector('#package-spec')
  const refresh = document.querySelector('#refresh')
  let activePlan
  let busy = false
  let catalog
  let catalogLoading = false
  let visible = 30
  let catalogEntry
  const confirm = document.querySelector('#confirm-install')
  const planSection = document.querySelector('#install-plan')
  const catalogStatus = document.querySelector('#catalog-status')
  const query = document.querySelector('#search-query')
  const category = document.querySelector('#search-category')
  for (const [id, text] of [
    ['catalog-heading', messages.catalogTitle], ['catalog-refresh', messages.refreshCatalog], ['search-label', messages.searchPlugins],
    ['category-label', messages.category], ['search-submit', messages.search], ['catalog-more', messages.showMore],
    ['confirm-install', messages.confirmInstall], ['cancel-install', messages.cancel], ['permission-notice', messages.permissionNotice],
    ['backup-notice', messages.backupNotice], ['market-integration', messages.marketIntegration],
  ]) document.getElementById(id).textContent = text
  if (library.active) {
    confirm.textContent = messages.installInLibrary
    document.querySelector('#backup-notice').textContent = messages.libraryBackupNotice
  }

  function eligible() {
    return activePlan && (library.active || activePlan.compatibility !== 'incompatible') && activePlan.blockers.length === 0
  }

  function setBusy(value, statusMessage = '') {
    busy = value
    for (const control of document.querySelectorAll('button, input, select')) control.disabled = busy
    for (const control of document.querySelectorAll('[data-unsupported="true"]')) control.disabled = true
    document.querySelector('#catalog-refresh').disabled = busy || catalogLoading
    confirm.disabled = busy || !eligible()
    for (const control of document.querySelectorAll('[data-inject]')) control.disabled = busy || !target.value
    status.textContent = statusMessage
  }

  async function render() {
    library = await api.plugins.library()
    const previous = target.value
    target.replaceChildren(...library.targets.map(instance => {
      const option = document.createElement('option')
      option.value = instance.id
      option.disabled = !instance.available
      option.textContent = `${instance.name} · ${messages[instance.kind === 'local' ? 'localInstance' : 'sshInstance']}${instance.available ? '' : ` · ${messages.connectFirst}`}`
      return option
    }))
    target.value = library.targets.some(instance => instance.id === previous && instance.available)
      ? previous : library.targets.find(instance => instance.available)?.id ?? ''
    const backend = await api.backend.status()
    document.querySelector('#recovery').hidden = backend.phase !== 'error'
    document.querySelector('#startup-error').textContent = backend.phase === 'error' ? backend.message : ''
    const plugins = await api.plugins.list()
    list.replaceChildren(...plugins.map(plugin => {
      const item = document.createElement('li')
      const identity = document.createElement('span')
      const version = document.createElement('span')
      version.className = 'package-version'
      version.textContent = plugin.enabled ? plugin.version : `${plugin.version} · ${messages.disabled}`
      identity.append(document.createTextNode(plugin.name), version)
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.textContent = messages.remove
      remove.addEventListener('click', () => void run(
        () => api.plugins.remove(plugin.name, ...(library.active ? [plugin.version] : [])),
        message('removing', { name: plugin.name }),
      ))
      const actions = document.createElement('span')
      actions.className = 'package-actions'
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.textContent = plugin.enabled ? messages.disable : messages.enable
      toggle.addEventListener('click', () => void run(
        () => api.plugins.toggle(plugin.name, !plugin.enabled), messages.changingActivation,
      ))
      if (library.active) {
        const inject = document.createElement('button')
        inject.type = 'button'
        inject.textContent = messages.injectPlugin
        inject.dataset.inject = 'true'
        inject.disabled = !target.value
        inject.addEventListener('click', () => {
          const instance = library.targets.find(instance => instance.id === target.value && instance.available)
          if (!instance || !window.confirm(message('injectConfirm', { name: plugin.name, version: plugin.version, target: instance.name }))) return
          void run(() => api.plugins.inject(plugin.name, plugin.version, instance.id), messages.injectingPlugin)
        })
        actions.append(inject, remove)
      } else actions.append(toggle, remove)
      item.append(identity, actions)
      return item
    }))
    empty.hidden = plugins.length !== 0
  }

  async function run(operation, statusMessage) {
    setBusy(true, statusMessage)
    try {
      await operation()
      await render()
      status.textContent = library.active ? messages.libraryOperationComplete : messages.operationComplete
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error)
    } finally {
      setBusy(false, status.textContent)
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
    document.querySelector('#plan-fields').append(term, definition)
  }

  async function review(spec, entry) {
    activePlan = undefined
    catalogEntry = entry
    planSection.hidden = true
    setBusy(true, messages.loadingPlan)
    try {
      const plan = await api.plugins.plan(spec)
      activePlan = plan
      document.querySelector('#plan-heading').textContent = `${messages.reviewInstall} · ${plan.name}@${plan.version}`
      document.querySelector('#plan-description').textContent = plan.description ?? ''
      document.querySelector('#plan-fields').replaceChildren()
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
      document.querySelector('#plan-blockers').textContent = plan.blockers.map(key => messages[{
        'missing-bundle': 'missingBundle', 'host-owned': 'hostOwned', 'web-server-required': 'webServerRequired',
      }[key]]).join(' ')
      planSection.hidden = false
      status.textContent = messages.reviewBeforeInstall
      document.querySelector('#plan-heading').focus()
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error)
    } finally { setBusy(false, status.textContent) }
  }

  function renderCatalog() {
    if (!catalog) return
    const needle = query.value.trim().toLocaleLowerCase()
    const matches = catalog.plugins.filter(entry => (!category.value || entry.categories.includes(category.value))
      && [entry.name, entry.npm ?? '', entry.owner, ...Object.values(entry.description), ...entry.categories].join(' ').toLocaleLowerCase().includes(needle))
    catalogStatus.textContent = message('catalogCount', { count: matches.length, total: catalog.plugins.length })
    document.querySelector('#catalog').replaceChildren(...matches.slice(0, visible).map(entry => {
      const item = document.createElement('li')
      const text = document.createElement('div')
      const name = document.createElement('strong')
      name.textContent = entry.name
      const description = document.createElement('p')
      description.textContent = (locale.id === 'zh-CN' ? entry.description.zh ?? entry.description['zh-CN'] : entry.description.en) ?? Object.values(entry.description)[0] ?? ''
      const meta = document.createElement('small')
      meta.textContent = `${entry.owner} · ${entry.categories.join(', ')} · ${entry.npm ?? messages.gitOnly}`
      const source = document.createElement('a')
      source.href = entry.repository
      source.target = '_blank'
      source.rel = 'noreferrer'
      source.textContent = messages.repository
      text.append(name, description, meta, document.createTextNode(' · '), source)
      const action = document.createElement('button')
      action.type = 'button'
      action.textContent = entry.npm ? messages.reviewInstall : messages.gitOnly
      action.disabled = busy || !entry.npm
      action.dataset.unsupported = String(!entry.npm)
      action.addEventListener('click', () => void review(entry.npm, entry))
      item.append(text, action)
      return item
    }))
    document.querySelector('#catalog-more').hidden = matches.length <= visible
  }

  async function loadCatalog() {
    if (catalogLoading) return
    catalogLoading = true
    const reload = document.querySelector('#catalog-refresh')
    reload.disabled = true
    catalogStatus.textContent = messages.loadingCatalog
    try {
      catalog = await api.plugins.catalog()
      document.querySelector('#catalog-source').textContent = message('catalogSource', { source: catalog.source, updated: catalog.updated ?? messages.notAvailable })
      const previous = category.value
      category.replaceChildren(...['', ...new Set(catalog.plugins.flatMap(entry => entry.categories))].sort().map(value => {
        const option = document.createElement('option')
        option.value = value
        option.textContent = value ? (catalog.categories?.[value]?.[locale.id === 'zh-CN' ? 'zh' : 'en'] ?? value) : messages.allCategories
        return option
      }))
      category.value = previous
      visible = 30
      renderCatalog()
    } catch (error) {
      catalog = undefined
      document.querySelector('#catalog').replaceChildren()
      document.querySelector('#catalog-more').hidden = true
      catalogStatus.textContent = `${messages.catalogFailed} ${error instanceof Error ? error.message : String(error)}`
    } finally { catalogLoading = false; reload.disabled = busy }
  }

  async function load(statusMessage, success) {
    setBusy(true, statusMessage)
    try {
      await render()
      status.textContent = success
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error)
    } finally {
      setBusy(false, status.textContent)
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
    planSection.hidden = true
    void run(async () => { await api.plugins.add(plan.id); input.value = '' }, message('installing', { spec: `${plan.name}@${plan.version}` }))
  })
  document.querySelector('#cancel-install').addEventListener('click', () => {
    activePlan = undefined
    planSection.hidden = true
    status.textContent = messages.installCancelled
    input.focus()
  })
  document.querySelector('#catalog-search').addEventListener('submit', event => { event.preventDefault(); visible = 30; renderCatalog() })
  query.addEventListener('input', () => { visible = 30; renderCatalog() })
  category.addEventListener('change', () => { visible = 30; renderCatalog() })
  target.addEventListener('change', () => { setBusy(busy, status.textContent) })
  document.querySelector('#catalog-refresh').addEventListener('click', () => void loadCatalog())
  document.querySelector('#catalog-more').addEventListener('click', () => { visible += 30; renderCatalog() })
  document.querySelector('#retry').addEventListener('click', () => void run(() => api.backend.retry(), messages.retry))
  document.querySelector('#disable-all').addEventListener('click', () => void run(() => api.plugins.disableAll(), messages.changingActivation))
  refresh.addEventListener('click', () => void load(messages.refreshing, messages.refreshed))

  await load(messages.loadingPlugins, '')
  if (library.active) void loadCatalog()
}

void main()
