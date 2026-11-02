/* Software preferences are authoritative and applied through the DSH Host APIs. */
let softwareDocument
let systemFonts = []
let softwareSaving = false
let credentialState
let credentialEditing = false
let credentialDraftDirty = false
let settingsTab = 'general'
let dshDirty = false
let shortcutBindings
let keyGeneration = 0
let kernelDocument
let kernelBusy = false
let pluginUpdateDocument
let pluginUpdateLoading
let pluginUpdateSaving = false
$('diagnostics-open').onclick = () => { void perform(() => api.invoke('diagnostics', { action: 'open' })) }
let storageDocument
let storageLoading = false
const storageLabels = { manager: 'storageManager', instances: 'storageInstances', cache: 'storageCache', plugins: 'storagePlugins' }
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Number.isFinite(bytes) ? Math.max(0, Math.trunc(bytes)) : 0} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  do { value /= 1024; unit++ } while (value >= 1024 && unit < units.length - 1)
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}
async function loadKernel() {
  if (!state.pluginManagement) return
  kernelDocument = await api.invoke('kernel', { action: 'read' })
  renderKernel()
}
async function loadPluginUpdates() {
  if (!state.pluginManagement || pluginUpdateSaving) return
  if (pluginUpdateLoading) return pluginUpdateLoading
  pluginUpdateLoading = (async () => {
    pluginUpdateDocument = await api.invoke('pluginUpdates', { action: 'read' })
    renderPluginUpdates()
  })()
  try { await pluginUpdateLoading } finally { pluginUpdateLoading = undefined }
}
function renderPluginUpdates() {
  $('plugin-update-automatic').disabled = !state.pluginManagement || pluginUpdateSaving || !pluginUpdateDocument
  if (!pluginUpdateSaving && pluginUpdateDocument) $('plugin-update-automatic').checked = pluginUpdateDocument.automatic
  const target = $('plugin-update-reports')
  target.replaceChildren()
  const reports = (pluginUpdateDocument?.reports || []).filter(report => state.instances.some(item => item.id === report.id))
  if (!reports.length) { target.textContent = t(state.pluginManagement ? 'pluginUpdateIdle' : 'pluginPackagedOnly'); return }
  for (const report of reports) {
    const row = document.createElement('div')
    const title = document.createElement('p')
    const key = { checking: 'pluginUpdateChecking', ready: report.changes.length ? 'pluginUpdateReady' : 'pluginUpdateUnchanged', warning: 'pluginUpdateWarning', error: 'pluginUpdateError' }[report.phase]
    title.textContent = `${state.instances.find(item => item.id === report.id).name}: ${t(key)}`
    row.append(title)
    if (report.phase === 'checking' && report.progress) {
      const message = document.createElement('p')
      message.textContent = installationText(report.progress)
      row.append(message)
    }
    if (report.changes.length || report.diagnostics.length || report.error) {
      const details = document.createElement('details')
      const summary = document.createElement('summary')
      summary.textContent = t('pluginUpdateDetails')
      details.append(summary)
      const lines = [
        ...report.changes.map(change => `${change.name}: ${change.from} → ${change.to}`),
        ...report.diagnostics.map(item => `${item.name}: ${t(item.reason === 'skipped' ? 'pluginUpdateSkipped' : 'pluginUpdateUnavailable')} · ${item.detail}`),
        ...(report.error ? [report.error] : []),
      ]
      for (const line of lines) {
        const text = document.createElement('p')
        text.className = 'settings-hint'
        text.textContent = line
        details.append(text)
      }
      row.append(details)
    }
    target.append(row)
  }
}
$('plugin-update-automatic').onchange = () => {
  const enabled = $('plugin-update-automatic').checked
  void perform(async () => {
    pluginUpdateSaving = true
    renderPluginUpdates()
    try { pluginUpdateDocument = await api.invoke('pluginUpdates', { action: 'automatic', visible: enabled }) }
    finally { pluginUpdateSaving = false; await loadPluginUpdates() }
  })
}
function renderKernel() {
  const busy = kernelBusy || ['checking', 'installing'].includes(kernelDocument?.phase)
  $('kernel-check').disabled = !state.pluginManagement || busy
  $('kernel-install').disabled = !state.pluginManagement || busy || !kernelDocument?.available || kernelDocument?.restartRequired
  $('kernel-automatic').disabled = !state.pluginManagement || busy
  if (!kernelDocument) { $('kernel-status').textContent = t('pluginPackagedOnly'); return }
  $('kernel-automatic').checked = kernelDocument.automatic
  const phase = { idle: 'kernelIdle', checking: 'kernelChecking', installing: 'kernelInstalling', ready: 'kernelRestart', error: 'kernelError' }
  const versions = document.createElement('div')
  versions.className = 'kernel-versions'
  for (const [label, value] of [['kernelCurrent', kernelDocument.current], ['kernelAvailable', kernelDocument.available]]) {
    if (!value) continue
    const item = document.createElement('span')
    item.className = 'kernel-version'
    const tag = document.createElement('span')
    tag.className = 'version-tag'
    tag.textContent = value
    item.append(`${t(label)}: `, tag)
    versions.append(item)
  }
  const message = document.createElement('p')
  message.className = 'kernel-message'
  message.textContent = `${t(phase[kernelDocument.phase])}${kernelDocument.message ? `: ${kernelDocument.message}` : ''}`
  if (busy && kernelDocument.progress) message.textContent += `\n${installationText(kernelDocument.progress)}`
  $('kernel-status').replaceChildren(versions, '\n', message)
}
async function kernelAction(action) {
  const automatic = $('kernel-automatic').checked
  kernelBusy = true
  renderKernel()
  try { kernelDocument = await api.invoke('kernel', { action, visible: automatic }) }
  finally { kernelBusy = false; await loadKernel() }
}
$('kernel-check').onclick = () => { void perform(() => kernelAction('check')) }
$('kernel-install').onclick = () => { void perform(() => kernelAction('install')) }
$('kernel-automatic').onchange = () => { void perform(() => kernelAction('automatic')) }
const settingsFields = {
  theme: 'theme', 'font-size': 'fontSize', language: 'language', 'busy-enter': 'busyEnter',
  'motion-enabled': 'motionEnabled',
}
const settingsTitles = {
  storage: 'storageTitle',
  general: 'applicationSettings', instances: 'manageTitle', appearance: 'appearance', shortcuts: 'keyboardShortcuts', keys: 'modelCredentials', advanced: 'instanceSettings', plugins: 'plugins',
}
const shortcutLabels = {
  settings: 'shortcutSettings', instances: 'shortcutInstances', add: 'shortcutAdd',
  close: 'shortcutClose', next: 'shortcutNext', previous: 'shortcutPrevious',
}
const shortcutGroups = [
  { title: 'shellNavigationShortcuts', actions: ['settings', 'instances', 'previous', 'next'] },
  { title: 'shellTabShortcuts', actions: ['add', 'close'] },
]
async function settingsCall(action, input = {}) {
  return api.invoke('softwareSettings', { action, input })
}
function renderSettings() {
  if (!state) return
  if (softwareDocument) document.documentElement.dataset.dshMotion = softwareDocument.appearance.motionEnabled ? 'on' : 'off'
  const errors = Object.entries(softwareDocument?.syncErrors || {})
  $('dsh-sync-status').textContent = errors.map(([id, message]) => `${state.instances.find(item => item.id === id)?.name || id}: ${message}`).join('\n')
  $('dsh-sync-status').hidden = !errors.length
  $('software-status').textContent = errors.length ? t('settingsPartial') : ''
  $('software-status').hidden = !errors.length
  $('settings-product').hidden = settingsTab !== 'general'
  $('app-version').hidden = settingsTab !== 'general'
  $('app-version').textContent = t('appVersion').replace('{version}', state.version)
  $('debug-mode').disabled = !softwareDocument || softwareSaving
  $('debug-mode').checked = softwareDocument?.debugMode === true
  $('settings-title').textContent = t(settingsTitles[settingsTab])
  for (const [id, field] of Object.entries(settingsFields)) {
    renderSettingSupport($(id), field, true)
    if (softwareDocument) {
      if ($(id).type === 'checkbox') $(id).checked = softwareDocument.appearance[field]
      else $(id).value = String(softwareDocument.appearance[field])
    }
  }
  document.querySelectorAll('#api-key-form button, #api-key-form input').forEach(node => { node.disabled = !softwareDocument?.credentialWritable || softwareSaving })
  if (credentialState) {
    $('api-key-field').hidden = credentialState.configured && !credentialEditing
    $('key-replace').hidden = !credentialState.configured || credentialEditing
    $('key-remove').hidden = !credentialState.configured
    $('key-remove').disabled = !credentialState.writable || !credentialState.configured || softwareSaving
    $('api-key-status').dataset.configured = String(credentialState.configured)
    $('api-key-status').dataset.writable = String(credentialState.writable)
  } else {
    $('api-key-field').hidden = false
    $('key-replace').hidden = true
    $('key-remove').hidden = true
    $('key-remove').disabled = true
    delete $('api-key-status').dataset.configured
    delete $('api-key-status').dataset.writable
  }
  document.querySelectorAll('[data-dsh-field], #dsh-settings-form button').forEach(node => {
    if (node.dataset.dshField) renderSettingSupport(node, node.dataset.dshField)
    else node.disabled = !softwareDocument || softwareSaving
  })
  if (softwareDocument && !dshDirty) {
    for (const input of document.querySelectorAll('[data-dsh-field]')) {
      const value = softwareDocument.dsh[input.dataset.dshField]
      if (input.type === 'checkbox') input.checked = value
      else {
        if (['textFontFamily', 'codeFontFamily', 'terminalFontFamily'].includes(input.dataset.dshField)) {
          const saved = String(value)
          for (const option of [...input.options].slice(1)) option.remove()
          for (const family of systemFonts) {
            const option = document.createElement('option')
            option.value = option.textContent = family
            input.append(option)
          }
          if (saved && !systemFonts.includes(saved)) {
            const option = document.createElement('option')
            option.value = option.textContent = saved
            input.append(option)
          }
        }
        input.value = String(value)
      }
    }
    $('api-key-ref').value = String(softwareDocument.dsh.deepseekKeyRef)
  }
  if (shortcutBindings) renderShortcuts()
  renderKernelShortcutScope()
  renderSources()
  renderPluginSettings()
  renderPersonalAppearance()
  renderKernel()
  renderPluginUpdates()
  renderStorage()
}

function renderSettingSupport(input, field, shellOwned = false) {
  const instances = Object.entries(softwareDocument?.settingsSupport || {})
  const targets = instances.filter(([, support]) => support.fields[field]?.namespace)
  input.disabled = !softwareDocument || softwareSaving || !shellOwned && instances.length > 0
    && !targets.some(([, support]) => support.writable)
  const enums = targets.map(([, support]) => support.fields[field].options).filter(Boolean)
  const options = enums.length ? enums[0].filter(value => enums.every(values => values.includes(value))) : undefined
  const choices = input.tagName === 'SELECT' ? input : input.list
  if (choices) {
    for (const option of choices.querySelectorAll('[data-schema-option]')) option.remove()
    for (const option of choices.options) option.hidden = option.disabled = Boolean(options && !options.includes(option.value))
    for (const value of options || []) {
      if ([...choices.options].some(option => option.value === value)) continue
      const option = document.createElement('option')
      option.value = option.textContent = value
      option.dataset.schemaOption = ''
      choices.append(option)
    }
  }
  if (input.list) {
    if (options) input.pattern = options.length ? options.map(value => RegExp.escape(value)).join('|') : '(?!)'
    else input.removeAttribute('pattern')
  }
  if (input.type === 'number') {
    for (const property of ['min', 'max', 'step']) {
      if (!input.dataset[`base${property}`]) input.dataset[`base${property}`] = input[property]
      const values = targets.map(([, support]) => support.fields[field][property]).filter(value => typeof value === 'number')
      input[property] = values.length ? String(property === 'max' ? Math.min(...values) : Math.max(...values)) : input.dataset[`base${property}`]
    }
  }
}
function renderStorage() {
  const ready = storageDocument !== undefined && !storageLoading
  $('storage-total').textContent = ''
  $('storage-list').replaceChildren()
  $('storage-instances').replaceChildren()
  $('storage-empty').hidden = !ready || storageDocument.instances.length !== 0
  if (!ready) {
    $('storage-total').textContent = storageLoading ? t('storageLoading') : t('storageUnavailable')
    return
  }
  const chart = document.createElement('div')
  chart.className = 'storage-donut'
  chart.setAttribute('aria-hidden', 'true')
  const colors = ['var(--brand)', '#9c83df', '#54aca6', '#dbac65']
  let start = 0
  const segments = Object.keys(storageLabels).map((category, index) => {
    const end = start + (storageDocument.totals.total ? storageDocument.totals[category] / storageDocument.totals.total * 100 : 0)
    const segment = `${colors[index]} ${start}% ${end}%`
    start = end
    return segment
  })
  chart.style.background = storageDocument.totals.total ? `conic-gradient(${segments.join(',')})` : 'var(--line)'
  const overview = document.createElement('div')
  overview.className = 'storage-overview-copy'
  const total = document.createElement('strong')
  total.textContent = formatBytes(storageDocument.totals.total)
  const path = document.createElement('span')
  path.textContent = storageDocument.dataHome
  overview.append(total, path)
  $('storage-total').append(chart, overview)
  for (const [category, bytes] of Object.entries(storageDocument.totals)) {
    if (category === 'total') continue
    const row = document.createElement('article')
    row.className = 'storage-row'
    row.style.setProperty('--storage-color', colors[Object.keys(storageLabels).indexOf(category)])
    const copy = document.createElement('div')
    const name = document.createElement('strong')
    name.textContent = t(storageLabels[category])
    const size = document.createElement('small')
    const percent = storageDocument.totals.total ? bytes / storageDocument.totals.total * 100 : 0
    size.textContent = `${formatBytes(bytes)} · ${percent.toFixed(1)}%`
    const path = document.createElement('small')
    path.className = 'storage-path'
    path.textContent = storageDocument.paths?.[category] || ''
    copy.append(name, size, path)
    const action = document.createElement('button')
    action.textContent = t('storageOpen')
    action.onclick = () => { void perform(() => api.invoke('storage', { action: 'open', input: category })) }
    const actions = document.createElement('div')
    actions.className = 'storage-actions'
    const migrate = document.createElement('button')
    migrate.textContent = t('storageMigrateCategory')
    migrate.onclick = () => { void perform(() => api.invoke('storage', { action: 'migrate', input: category })) }
    actions.append(action, migrate)
    row.append(copy, actions)
    $('storage-list').append(row)
  }
  for (const instance of storageDocument.instances) {
    const row = document.createElement('article')
    row.className = 'instance-row'
    const summary = document.createElement('div')
    summary.className = 'instance-summary'
    const name = document.createElement('strong')
    name.textContent = instance.name
    const details = document.createElement('span')
    details.className = 'instance-details'
    details.textContent = `${formatBytes(instance.bytes)} · ${instance.path}`
    summary.append(name, details)
    const action = button('storageOpen', () => api.invoke('storage', { action: 'open', input: 'instances' }))
    row.append(summary, action)
    $('storage-instances').append(row)
  }
}
async function loadStorage() {
  storageLoading = true
  renderStorage()
  try { storageDocument = await api.invoke('storage', { action: 'read' }) }
  finally { storageLoading = false; renderStorage() }
}
function renderPluginSettings() {
  const nativeSelect = $('native-plugin-instance')
  const selected = nativeSelect.value
  const locals = state.instances
  const nativeOptions = locals.map(instance => `${instance.id}:${instance.name}`).join('|')
  if (nativeSelect.dataset.options !== nativeOptions) {
    nativeSelect.replaceChildren(...locals.map(instance => {
      const option = document.createElement('option')
      option.value = instance.id; option.textContent = instance.name; return option
    }))
    nativeSelect.value = locals.some(instance => instance.id === selected) ? selected
      : locals.some(instance => instance.id === state.tabs.active) ? state.tabs.active : locals[0]?.id || ''
    nativeSelect.dataset.options = nativeOptions
  }
  const instance = state.instances.find(instance => instance.id === nativeSelect.value)
  const connection = state.statuses[nativeSelect.value]?.connection
  $('plugin-instance-state').textContent = instance ? t(connection || 'disconnected') : ''
  $('plugin-instance-state').dataset.connected = String(connection === 'connected')
  $('native-plugin-open').hidden = connection === 'connected'
  $('native-plugin-open').disabled = !instance || connection === 'connecting'
  $('plugin-empty-open').hidden = !instance || connection === 'connected'
  $('plugin-empty-open').disabled = connection === 'connecting'
  $('native-plugin-empty-copy').textContent = !instance ? t('pluginNoInstance')
    : instance.kind !== 'local' ? t('pluginRemoteSettings') : t('nativePluginUnavailable')
  if (pluginPanel) pluginPanel.setTarget(nativeSelect.value)
  if (nativePluginMode) scheduleNativePanel()
  $('plugin-development-hint').hidden = state.pluginManagement
}
let pluginPanel
let pluginPanelLoading
let nativePluginMode = true
let pluginMode = 'native'
let nativePanelTimer
let nativePluginTarget
let nativePluginDocument
let nativePluginDocumentId
let nativePluginFilter = 'all'
let nativePluginQuery = ''
let nativePluginLoading = false
let nativePluginBusy = false
let nativeConfigurationDirty = false
let nativeConfigurationGeneration = 0
let nativePluginGeneration = 0
const corePluginBundles = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless', '@deepseek-ai/dsh-sdk-app', '@deepseek-ai/dsh-acp-app', '@deepseek-ai/dsh-sdk-minimal'])
function pluginElement(tag, text = '', className = '') {
  const node = document.createElement(tag)
  node.textContent = text
  node.className = className
  return node
}
async function instancePluginCall(action, input = {}, id = $('native-plugin-instance').value) {
  return api.invoke('plugins', { id, action, input })
}
function discardPluginDraft() {
  if (nativeConfigurationDirty && !window.confirm(t('discardSettingsConfirm'))) return false
  nativeConfigurationGeneration++
  nativeConfigurationDirty = false
  reportDirty()
  return true
}
async function loadNativePlugins(force = false) {
  const id = $('native-plugin-instance').value
  if (nativePluginLoading || !force && nativePluginDocumentId === id && nativePluginDocument) return
  const generation = ++nativePluginGeneration
  nativePluginLoading = true
  $('native-plugin-status').textContent = t('pluginLoading')
  try {
    const value = await instancePluginCall('read', {}, id)
    if (generation !== nativePluginGeneration || id !== $('native-plugin-instance').value) return
    nativePluginDocument = value
    nativePluginDocumentId = id
    renderNativePlugins()
    $('native-plugin-status').textContent = ''
  } catch (error) {
    if (generation === nativePluginGeneration) $('native-plugin-status').textContent = String(error.message || error)
  } finally {
    nativePluginLoading = false
    if (generation !== nativePluginGeneration) scheduleNativePanel()
  }
}
async function changeNativePlugin(kind, target, enabled) {
  if (nativePluginBusy || !discardPluginDraft()) return
  const id = $('native-plugin-instance').value
  nativePluginBusy = true
  renderNativePlugins()
  try {
    const result = await instancePluginCall('toggle', { kind, target, enabled }, id)
    if (id !== $('native-plugin-instance').value) return
    await loadNativePlugins(true)
    if (result.restartRequired) {
      $('native-plugin-status').replaceChildren(pluginElement('span', t('pluginRestartRequired')), button('pluginRestart', async () => {
        await api.invoke('restart', { id })
        if (id !== $('native-plugin-instance').value) return
        nativePluginDocumentId = undefined
        await refresh()
        await loadNativePlugins(true)
      }))
    }
  } catch (error) { if (id === $('native-plugin-instance').value) $('native-plugin-status').textContent = String(error.message || error) }
  finally { nativePluginBusy = false; renderNativePlugins() }
}
function pluginSwitch(kind, target, enabled, label, readOnly) {
  const control = pluginElement('input')
  control.type = 'checkbox'
  control.setAttribute('role', 'switch')
  control.setAttribute('aria-label', label)
  control.checked = enabled
  control.disabled = nativePluginBusy || !!readOnly
  if (typeof readOnly === 'string') control.title = readOnly
  control.onchange = () => { void changeNativePlugin(kind, target, control.checked) }
  return control
}
function renderNativePlugins() {
  if (!nativePluginDocument || nativePluginDocumentId !== $('native-plugin-instance').value) return
  const surface = $('native-plugin-surface')
  let toolbar = surface.querySelector('.installed-plugin-toolbar')
  if (!toolbar) {
    toolbar = pluginElement('div', '', 'installed-plugin-toolbar')
    const search = pluginElement('input')
    search.type = 'search'; search.value = nativePluginQuery
    search.placeholder = t('pluginSearchInstance'); search.setAttribute('aria-label', search.placeholder)
    search.oninput = () => { nativePluginQuery = search.value; renderNativePlugins() }
    const filters = pluginElement('div', '', 'installed-plugin-filters')
    filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', t('pluginNativeTab'))
    for (const [id, key] of [['all', 'pluginAll'], ['installed', 'pluginInstalled'], ['configuration', 'pluginBuiltIn'], ['experimental', 'pluginExperimental']]) {
      const action = button(key, async () => {
        if (!discardPluginDraft()) return
        nativePluginFilter = id; nativePluginTarget = undefined; renderNativePlugins()
      })
      action.dataset.filter = id
      filters.append(action)
    }
    toolbar.append(search, button('pluginRefresh', async () => {
      if (discardPluginDraft()) { nativePluginTarget = undefined; await loadNativePlugins(true) }
    }), filters)
    surface.replaceChildren(toolbar, pluginElement('div', '', 'installed-plugin-content'))
  }
  for (const item of toolbar.querySelectorAll('[data-filter]')) item.setAttribute('aria-pressed', String(item.dataset.filter === nativePluginFilter))
  const content = surface.querySelector('.installed-plugin-content')
  if (nativePluginTarget?.kind === 'configuration') return
  content.replaceChildren()
  const needle = nativePluginQuery.trim().toLocaleLowerCase()
  const bundles = nativePluginDocument.bundles.filter(pkg => !corePluginBundles.has(pkg.name))
  const groups = [
    ['installed', 'pluginInstalled', bundles.filter(pkg => pkg.installed || pkg.enabled)],
    ['configuration', 'pluginBuiltIn', nativePluginDocument.configurations],
    ['experimental', 'pluginExperimental', bundles.filter(pkg => pkg.official && !pkg.installed && !pkg.enabled)],
  ]
  let count = 0
  for (const [group, title, values] of groups) {
    if (nativePluginFilter !== 'all' && nativePluginFilter !== group) continue
    const list = pluginElement('div', '', 'installed-plugin-list')
    for (const pkg of values) {
      const name = pkg.title || pkg.ns || pkg.name
      if (needle && ![name, pkg.name, pkg.description].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle)) continue
      count++
      const card = pluginElement('article', '', 'installed-plugin-card')
      const heading = pluginElement('div', '', 'installed-plugin-heading')
      const copy = pluginElement('div', '', 'installed-plugin-copy')
      copy.append(pluginElement('strong', name), pluginElement('small', pkg.version ? pkg.name + ' · ' + pkg.version : pkg.name || pkg.ns))
      if (pkg.description) copy.append(pluginElement('p', pkg.description))
      heading.append(copy)
      if (group === 'configuration') heading.append(button('pluginConfigure', () => openPluginConfiguration(pkg.ns)))
      else {
        if (pkg.availability !== 'missing') heading.append(pluginSwitch('bundle', pkg.name, pkg.enabled, name, pkg.readOnlyReason))
        else heading.append(button('pluginLibraryTab', async () => { setPluginMode('library') }))
        const details = button('pluginDetails', async () => {
          if (!discardPluginDraft()) return
          nativePluginTarget = nativePluginTarget?.name === pkg.name ? undefined : { kind: 'bundle', name: pkg.name }
          renderNativePlugins()
        })
        details.setAttribute('aria-expanded', String(nativePluginTarget?.name === pkg.name))
        heading.append(details)
      }
      card.append(heading)
      if (pkg.error) card.append(pluginElement('p', pkg.error.diagnostic || pkg.error.code, 'settings-hint'))
      if (nativePluginTarget?.name === pkg.name && group !== 'configuration') {
        const rows = pluginElement('div', '', 'installed-plugin-rows')
        for (const row of pkg.rows) {
          const live = nativePluginDocument.entries.find(entry => entry.entryId === row.entryId)
          const line = pluginElement('div', '', 'installed-plugin-row')
          const label = row.title || row.moduleName
          const copy = pluginElement('div', '', 'installed-plugin-copy')
          copy.append(pluginElement('strong', label), pluginElement('small', (live?.fiberPhase || t('pluginDisabled')) + ' · ' + row.moduleName))
          if (row.description) copy.append(pluginElement('p', row.description))
          line.append(copy)
          const namespace = nativePluginDocument.configurations.find(section => section.ns === row.entryId || section.ns === row.rowId)
          if (namespace) line.append(button('pluginConfigure', () => openPluginConfiguration(namespace.ns)))
          line.append(pluginSwitch('row', row.entryId, live?.enabled === true, label, !row.entryId || live?.readOnlyReason))
          rows.append(line)
        }
        if (pkg.installed && pkg.removable) rows.append(button('pluginRemove', async () => {
          if (!window.confirm(t('pluginRemoveConfirm').replace('{name}', name))) return
          await instancePluginCall('remove', { target: pkg.name })
          nativePluginTarget = undefined
          await refresh(); await loadNativePlugins(true)
        }, 'installed-plugin-remove'))
        card.append(rows)
      }
      list.append(card)
    }
    if (list.childElementCount) {
      const section = pluginElement('section', '', 'installed-plugin-group')
      section.append(pluginElement('h3', t(title) + ' · ' + list.childElementCount), list)
      content.append(section)
    }
  }
  if (!count) content.append(pluginElement('p', t('pluginNoMatch'), 'plugin-empty-state'))
}
async function openPluginConfiguration(target) {
  if (!discardPluginDraft()) return
  const generation = nativeConfigurationGeneration
  const id = $('native-plugin-instance').value
  const section = await instancePluginCall('configuration', { target }, id)
  if (generation !== nativeConfigurationGeneration || id !== $('native-plugin-instance').value) return
  nativePluginTarget = { kind: 'configuration', name: target }
  const content = $('native-plugin-surface').querySelector('.installed-plugin-content')
  const form = pluginElement('form', '', 'installed-plugin-configuration')
  const edits = new Map()
  const collectFields = schema => schema?.type === 'intersect' ? Object.assign({}, ...schema.list.map(collectFields)) : schema?.dict || {}
  const change = (field, op) => { edits.set(field, op); nativeConfigurationDirty = true; reportDirty() }
  form.append(pluginElement('h3', target))
  for (const [field, schema] of Object.entries(collectFields(section.schema))) {
    if (schema.type === 'const' || JSON.stringify(schema).includes('"role":"secret"') || schema.meta?.hidden) continue
    const row = pluginElement('div', '', 'installed-plugin-field')
    const label = pluginElement('label', field)
    let input
    let read
    const options = schema.type === 'union' && schema.list.every(item => item.type === 'const') ? schema.list : undefined
    const value = section.value[field] ?? schema.meta?.default
    if (options) {
      input = pluginElement('select')
      for (const [index, option] of options.entries()) {
        const item = pluginElement('option', String(option.value)); item.value = String(index)
        item.selected = JSON.stringify(option.value) === JSON.stringify(value)
        input.append(item)
      }
      read = () => options[Number(input.value)].value
    } else if (schema.type === 'boolean') {
      input = pluginElement('input'); input.type = 'checkbox'; input.checked = value === true
      input.setAttribute('role', 'switch'); read = () => input.checked
    } else if (schema.type === 'string' || schema.type === 'number') {
      input = pluginElement('input'); input.type = schema.type === 'number' ? 'number' : 'text'; input.value = value ?? ''
      if (schema.type === 'number') for (const attribute of ['min', 'max', 'step']) input[attribute] = schema.meta?.[attribute] ?? (attribute === 'step' ? 'any' : '')
      read = () => schema.type === 'number' ? input.valueAsNumber : input.value
    } else {
      input = pluginElement('textarea'); input.value = JSON.stringify(value ?? null, null, 2)
      input.rows = 5; input.spellcheck = false; input.title = t('pluginComplexValue')
      read = () => JSON.parse(input.value)
    }
    input.id = 'plugin-config-' + field
    label.htmlFor = input.id
    input.disabled = !section.writable
    input.oninput = () => change(field, { op: 'set', path: [field], read })
    const reset = button('pluginResetField', async () => {
      input.disabled = true; change(field, { op: 'unset', path: [field] })
    })
    reset.type = 'button'; reset.disabled = !section.writable
    row.append(label, input, reset)
    if (typeof schema.meta?.description === 'string') row.append(pluginElement('small', schema.meta.description))
    form.append(row)
  }
  if (!form.querySelector('input, select, textarea')) form.append(pluginElement('p', t('pluginNoConfiguration'), 'settings-hint'))
  const status = pluginElement('p', '', 'settings-hint'); status.setAttribute('role', 'status')
  const save = pluginElement('button', t('saveAndApply'), 'primary'); save.type = 'submit'; save.disabled = !section.writable
  const back = button('pluginBack', async () => { if (discardPluginDraft()) { nativePluginTarget = undefined; renderNativePlugins() } })
  back.type = 'button'
  const actions = pluginElement('div', '', 'installed-plugin-actions'); actions.append(back, save)
  form.append(status, actions)
  form.onsubmit = async event => {
    event.preventDefault()
    if (!edits.size) return
    save.disabled = true
    try {
      const ops = [...edits.values()].map(op => op.op === 'unset' ? op : { op: 'set', path: op.path, value: op.read() })
      await instancePluginCall('configure', { target, revision: section.revision, ops }, id)
      if (generation !== nativeConfigurationGeneration || !form.isConnected) return
      nativeConfigurationDirty = false; reportDirty()
      await openPluginConfiguration(target)
    } catch (error) { status.textContent = String(error.message || error); save.disabled = false }
  }
  content.replaceChildren(form)
}
function scheduleNativePanel() {
  clearTimeout(nativePanelTimer)
  nativePanelTimer = setTimeout(() => {
    const id = $('native-plugin-instance').value
    const visible = nativePluginMode && settingsTab === 'plugins' && settingsOpen && managerVisible
    const connected = state.statuses[id]?.connection === 'connected' && state.instances.some(instance => instance.id === id && instance.kind === 'local')
    $('native-plugin-empty').hidden = !!connected
    $('native-plugin-surface').hidden = !connected
    if (!connected) { nativePluginDocumentId = undefined; return }
    if (visible) void loadNativePlugins()
  }, 30)
}
function setPluginMode(mode) {
  pluginMode = mode
  nativePluginMode = mode === 'native'
  for (const name of ['native', 'library', 'advanced']) {
    $('plugin-mode-' + name).setAttribute('aria-selected', String(mode === name))
    $('plugin-mode-' + name).tabIndex = mode === name ? 0 : -1
  }
  $('plugin-workspace').hidden = mode === 'native'
  $('plugin-library-options').hidden = mode !== 'advanced'
  $('native-plugin-settings').hidden = mode !== 'native'
  pluginPanel?.show(mode === 'advanced' ? 'library' : 'discover')
  document.querySelector('.settings-content').scrollTop = 0
  scheduleNativePanel()
}
async function showNativePlugins(id, packageName) {
  if (!discardPluginDraft()) return
  await showSettings('plugins')
  if (id !== $('native-plugin-instance').value) {
    nativePluginGeneration++
    nativePluginDocument = undefined
    $('native-plugin-surface').replaceChildren()
  }
  $('native-plugin-instance').value = id
  nativePluginTarget = packageName ? { kind: 'bundle', name: packageName } : undefined
  renderPluginSettings()
  setPluginMode('native')
  renderNativePlugins()
}
$('plugin-mode-library').onclick = () => setPluginMode('library')
$('plugin-mode-native').onclick = () => setPluginMode('native')
$('plugin-mode-advanced').onclick = () => setPluginMode('advanced')
document.querySelector('.plugin-mode-switch').onkeydown = event => {
  const tabs = [...document.querySelectorAll('.plugin-mode-switch [role=tab]')]
  const index = tabs.indexOf(event.target)
  const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : undefined
  if (next) { event.preventDefault(); next.click(); next.focus() }
}
$('native-plugin-instance').onchange = () => {
  if (!discardPluginDraft()) { $('native-plugin-instance').value = nativePluginDocumentId || ''; return }
  nativePluginGeneration++
  nativePluginDocument = undefined
  nativePluginTarget = undefined
  $('native-plugin-surface').replaceChildren()
  renderPluginSettings()
  scheduleNativePanel()
}
$('native-plugin-open').onclick = () => { void perform(async () => {
  const id = $('native-plugin-instance').value
  const instance = state.instances.find(instance => instance.id === id)
  if (instance) { await open(instance); await showNativePlugins(id) }
}) }
$('plugin-empty-open').onclick = () => $('native-plugin-open').click()
$('plugin-empty-discover').onclick = () => setPluginMode('library')
document.addEventListener('manager-rendered', () => { if (nativePluginMode) scheduleNativePanel() })
async function loadPluginPanel() {
  if (!state.pluginManagement) return
  if (pluginPanelLoading) return pluginPanelLoading
  pluginPanelLoading = (async () => {
    if (pluginPanel) return pluginPanel.refresh()
    pluginPanel = await window.mountPluginManager($('plugin-workspace'), api.pluginLibrary, 'library-', {
      target: () => $('native-plugin-instance').value,
      installed: async id => { await refresh(); await showNativePlugins(id) },
    })
    pluginPanel.show(pluginMode === 'advanced' ? 'library' : 'discover')
  })().finally(() => { pluginPanelLoading = undefined })
  return pluginPanelLoading
}
async function loadSoftwareSettings() {
  softwareDocument = await settingsCall('read')
  systemFonts = await settingsCall('fontRoster').catch(() => [])
  await loadKernel()
  setShellTheme(softwareDocument.appearance.theme)
  setShellPersonalAppearance(personalDirty ? personalDraft : softwareDocument.personalization)
  renderSettings()
  if (settingsTab === 'keys') await loadCredentialInfo()
}
function selectSettingsTab(tab) {
  if (nativePluginMode) scheduleNativePanel()
  if (settingsTab !== tab) document.querySelector('.settings-content').scrollTop = 0
  settingsTab = tab
  document.querySelector('.settings-body').classList.toggle('settings-body-plugins', tab === 'plugins')
  document.querySelectorAll('[data-settings-tab]').forEach(node => {
    const selected = node.dataset.settingsTab === tab
    node.setAttribute('aria-selected', String(selected))
    node.tabIndex = selected ? 0 : -1
  })
  document.querySelectorAll('[data-settings-pane]').forEach(node => { node.hidden = node.dataset.settingsPane !== tab })
  renderSettings()
  if (tab === 'keys') void perform(loadCredentialInfo)
  if (tab === 'plugins') void perform(loadPluginPanel)
  if (tab === 'storage') void perform(loadStorage)
}
document.querySelectorAll('[data-settings-tab]').forEach(node => {
  node.onclick = () => selectSettingsTab(node.dataset.settingsTab)
  node.onkeydown = event => {
    const tabs = [...document.querySelectorAll('[data-settings-tab]')]
    const index = tabs.indexOf(node)
    let target
    if (event.key === 'ArrowDown') target = tabs[(index + 1) % tabs.length]
    else if (event.key === 'ArrowUp') target = tabs[(index + tabs.length - 1) % tabs.length]
    else if (event.key === 'Home') target = tabs[0]
    else if (event.key === 'End') target = tabs.at(-1)
    if (!target) return
    event.preventDefault()
    selectSettingsTab(target.dataset.settingsTab)
    target.focus()
  }
})
document.addEventListener('manager-rendered', renderSettings)
document.addEventListener('manager-rendered', () => { if (state.pluginManagement) void loadKernel().catch(error => { $('kernel-status').textContent = String(error) }) })
document.addEventListener('manager-rendered', () => { void loadPluginUpdates().catch(error => { $('plugin-update-reports').textContent = String(error) }) })
document.addEventListener('manager-settings-open', event => {
  selectSettingsTab(event.detail.tab || settingsTab)
  void perform(loadSoftwareSettings)
})
for (const [id, field] of Object.entries(settingsFields)) {
  $(id).onchange = () => {
    const value = $(id).type === 'checkbox' ? $(id).checked : id === 'font-size' ? Number($(id).value) : $(id).value
    void perform(async () => {
      softwareSaving = true
      renderSettings()
      try { softwareDocument = await settingsCall('update', { field, value }); setShellTheme(softwareDocument.appearance.theme) }
      finally { softwareSaving = false; await loadSoftwareSettings() }
    })
  }
}
$('debug-mode').onchange = () => {
  const value = $('debug-mode').checked
  void perform(async () => {
    softwareSaving = true
    renderSettings()
    try { softwareDocument = await settingsCall('debugMode', { value }) }
    finally { softwareSaving = false; await loadSoftwareSettings() }
  })
}
async function loadCredentialInfo() {
  const generation = ++keyGeneration
  if (!softwareDocument) return
  const ref = $('api-key-ref').value
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) return
  const infos = await settingsCall('credentialInfo', { ref })
  if (generation !== keyGeneration) return
  const info = infos[ref]
  credentialState = info
  $('api-key-status').textContent = `${t(info.configured ? 'keyConfigured' : 'keyMissing')} · ${t(info.writable ? 'keyWritable' : 'keyReadOnly')}`
  $('key-remove').disabled = !info.writable || !info.configured
  renderSettings()
}
$('dsh-deepseekKeyRef').onchange = () => {
  $('api-key-ref').value = $('dsh-deepseekKeyRef').value.trim()
  credentialState = undefined
  credentialEditing = false
  $('api-key-value').value = ''
  if ($('api-key-ref').value) void perform(loadCredentialInfo)
  else { $('api-key-status').textContent = t('credentialChecking'); renderSettings() }
}
$('key-replace').onclick = () => { credentialEditing = true; renderSettings(); $('api-key-value').focus() }
$('key-reveal').onclick = () => {
  const input = $('api-key-value')
  input.type = input.type === 'password' ? 'text' : 'password'
  $('key-reveal').textContent = t(input.type === 'password' ? 'showSecret' : 'hideSecret')
}
$('key-remove').onclick = () => {
  if (!window.confirm(t('keyRemoveConfirm'))) return
  const ref = $('api-key-ref').value
  void perform(async () => {
    softwareSaving = true
    renderSettings()
    try {
      await settingsCall('credentialRemove', { ref })
      credentialDraftDirty = false
      $('api-key-value').value = ''
      reportDirty()
    }
    finally { softwareSaving = false; await loadSoftwareSettings() }
  })
}
$('api-key-value').oninput = () => {
  credentialDraftDirty = $('api-key-value').value.length > 0
  renderSettings()
  reportDirty()
}
function setDshSaveStatus(message) {
  document.querySelectorAll('[data-dsh-save-status]').forEach(node => { node.textContent = message })
}
document.querySelectorAll('[data-dsh-field]').forEach(input => {
  input.addEventListener('input', () => { dshDirty = true; setDshSaveStatus(t('unsavedSettings')); reportDirty() })
})
$('dsh-settings-form').onsubmit = event => {
  event.preventDefault()
  const keyRef = $('dsh-deepseekKeyRef').value.trim()
  const keyValue = $('api-key-value').value
  const value = { ...softwareDocument.dsh, ...Object.fromEntries([...document.querySelectorAll('[data-dsh-field]')].map(input => [
    input.dataset.dshField, input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value.trim(),
  ])) }
  void perform(async () => {
    softwareSaving = true
    renderSettings()
    try {
      if (keyValue) await settingsCall('credentialSet', { ref: keyRef, value: keyValue })
      credentialEditing = false
      credentialDraftDirty = false
      $('api-key-value').value = ''
      $('api-key-value').type = 'password'
      $('key-reveal').textContent = t('showSecret')
      softwareDocument = await settingsCall('dshUpdate', { value })
      dshDirty = false
      setDshSaveStatus(t(Object.keys(softwareDocument.syncErrors || {}).length ? 'dshSavedPartial' : 'dshSaved'))
      reportDirty()
    } finally { softwareSaving = false; await loadSoftwareSettings() }
  })
}

function hasUnsavedSettings() {
  return dshDirty || credentialDraftDirty || nativeConfigurationDirty || (typeof personalDirty !== 'undefined' && personalDirty)
    || !$('source-form').hidden
}

async function discardUnsavedSettings() {
  nativeConfigurationGeneration++
  nativeConfigurationDirty = false
  nativePluginTarget = undefined
  renderNativePlugins()
  dshDirty = false
  credentialDraftDirty = false
  credentialEditing = false
  $('api-key-value').value = ''
  $('api-key-value').type = 'password'
  $('key-reveal').textContent = t('showSecret')
  if (typeof cancelPersonalPreview === 'function') cancelPersonalPreview()
  if (typeof discardPersonalDraft === 'function') await discardPersonalDraft()
  if (!$('source-form').hidden) closeSourceForm()
  if (softwareDocument) {
    for (const input of document.querySelectorAll('[data-dsh-field]')) {
      const value = softwareDocument.dsh[input.dataset.dshField]
      if (input.type === 'checkbox') input.checked = value
      else input.value = String(value)
    }
  }
  setDshSaveStatus('')
  reportDirty()
}
function renderShortcuts() {
  const signature = JSON.stringify([Object.values(shortcutLabels).map(key => t(key)),
    Object.values(shortcutGroups).map(group => t(group.title)), state.tabs.active])
  if ($('shortcut-list').dataset.signature === signature && $('shortcut-list').childElementCount) return
  $('shortcut-list').replaceChildren()
  $('shortcut-list').dataset.signature = signature
  for (const group of shortcutGroups) {
    const section = document.createElement('section')
    section.className = 'shortcut-group'
    const heading = document.createElement('h4')
    heading.textContent = t(group.title)
    section.append(heading)
    for (const action of group.actions) {
      const key = shortcutLabels[action]
      const row = document.createElement('label')
      row.className = 'shortcut-row'
      const label = document.createElement('span')
      label.textContent = t(key)
      const input = document.createElement('input')
      input.readOnly = true
      input.value = shortcutBindings[action]
      input.placeholder = t('shortcutDisabled')
      input.setAttribute('aria-label', t(key))
      input.onkeydown = event => {
        event.preventDefault()
        event.stopPropagation()
        if (event.isComposing || event.key === 'Escape' || ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
        let binding = ''
        if (event.key !== 'Backspace' && event.key !== 'Delete') {
          if (!event.ctrlKey && !event.altKey && !event.metaKey) return
          const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
          binding = [event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.metaKey ? 'Meta' : '', key].filter(Boolean).join('+')
        }
        if (binding && Object.entries(shortcutBindings).some(([other, value]) => other !== action && value === binding)) {
          void perform(() => { throw new Error(t('shortcutConflict')) })
          return
        }
        void perform(async () => {
          shortcutBindings = await api.invoke('shortcuts', { bindings: { ...shortcutBindings, [action]: binding } })
          input.value = shortcutBindings[action]
        })
      }
      input.onfocus = () => { input.select(); void api.invoke('shortcutCapture', { visible: true }) }
      input.onblur = () => { void api.invoke('shortcutCapture', { visible: false }) }
      row.append(label, input)
      section.append(row)
    }
    $('shortcut-list').append(section)
  }
}
function renderKernelShortcutScope() {
  const config = active()
  const connected = config && state.statuses[config.id]?.connection === 'connected'
  $('kernel-shortcuts-context').textContent = config
    ? t(connected ? 'kernelShortcutsContext' : 'kernelShortcutsDisconnected').replace('{instance}', config.name)
    : t('kernelShortcutsNoInstance')
  $('kernel-shortcuts-open').disabled = !connected
}
$('shortcut-reset').onclick = () => {
  void perform(async () => {
    shortcutBindings = await api.invoke('shortcuts', { action: 'reset' })
    $('shortcut-list').replaceChildren()
    renderShortcuts()
  })
}
$('kernel-shortcuts-open').onclick = () => {
  const config = active()
  if (!config) return
  void perform(async () => {
    await open(config)
    await api.invoke('kernelShortcuts', { id: config.id, action: 'open' })
  })
}
async function initializeShortcuts() {
  shortcutBindings = await api.invoke('shortcuts')
  await loadSoftwareSettings()
  if (state && shortcutBindings) renderShortcuts()
}
void perform(initializeShortcuts)
api.onShortcut(action => {
  if (document.activeElement?.closest('.shortcut-row')) return
  if (document.querySelector('dialog[open]') || document.activeElement?.classList.contains('tab-rename')) return
  void perform(async () => {
    if (action === 'settings') await showSettings()
    else if (action.startsWith('plugins:')) {
      const [id, encodedPackage] = action.slice('plugins:'.length).split(':', 2)
      if (id) await showNativePlugins(id, encodedPackage ? decodeURIComponent(encodedPackage) : undefined)
    }
    else if (action.startsWith('discover-plugins:')) { await showNativePlugins(action.slice('discover-plugins:'.length)); setPluginMode('library') }
    else if (action === 'instances') await showManager()
    else if (action === 'add') await toggleInstanceMenu()
    else if (action === 'close' && managerVisible && shellPage === 'settings') await closeSettings()
    else if (action === 'close' && state.tabs.active) await closeInstance(state.tabs.active)
    else if (action === 'next' || action === 'previous') {
      const ids = [...state.tabs.ids, ...(settingsOpen ? ['settings'] : [])]
      if (!ids.length) return
      const current = managerVisible && shellPage === 'settings' ? 'settings' : state.tabs.active
      const index = (ids.indexOf(current) + (action === 'next' ? 1 : ids.length - 1)) % ids.length
      if (ids[index] === 'settings') await showSettings()
      else await open(state.instances.find(item => item.id === ids[index]))
    }
  })
})
window.addEventListener('focus', () => {
  if (managerVisible && shellPage === 'settings') void perform(loadSoftwareSettings)
})
void perform(loadSoftwareSettings)
