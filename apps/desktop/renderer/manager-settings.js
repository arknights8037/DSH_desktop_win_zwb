/* Software preferences are authoritative and applied through the DSH Host APIs. */
let softwareDocument
let softwareSaving = false
let credentialState
let settingsTab = 'general'
let dshDirty = false
let shortcutBindings
let keyGeneration = 0
const settingsFields = {
  theme: 'theme', 'font-size': 'fontSize', language: 'language', 'busy-enter': 'busyEnter',
}
const settingsTitles = {
  general: 'applicationSettings', instances: 'manageTitle', appearance: 'appearance', shortcuts: 'keyboardShortcuts', keys: 'modelCredentials', advanced: 'instanceSettings', plugins: 'plugins',
}
const shortcutLabels = {
  settings: 'shortcutSettings', instances: 'shortcutInstances', add: 'shortcutAdd',
  close: 'shortcutClose', next: 'shortcutNext', previous: 'shortcutPrevious',
}
async function settingsCall(action, input = {}) {
  return api.invoke('softwareSettings', { action, input })
}
function renderSettings() {
  if (!state) return
  const errors = Object.entries(softwareDocument?.syncErrors || {})
  $('dsh-sync-status').textContent = errors.map(([id, message]) => `${state.instances.find(item => item.id === id)?.name || id}: ${message}`).join('\n')
  $('dsh-sync-status').hidden = !errors.length
  $('sources-sync-status').textContent = $('dsh-sync-status').textContent
  $('sources-sync-status').hidden = !errors.length
  $('software-status').textContent = errors.length ? t('settingsPartial') : t('softwareSettingsHint')
  $('software-status').hidden = settingsTab !== 'general' && !errors.length
  $('settings-product').hidden = settingsTab !== 'general'
  $('settings-title').textContent = t(settingsTitles[settingsTab])
  for (const [id, field] of Object.entries(settingsFields)) {
    $(id).disabled = !softwareDocument || softwareSaving
    if (softwareDocument) $(id).value = String(softwareDocument.appearance[field])
  }
  document.querySelectorAll('#api-key-form button, #api-key-form input').forEach(node => { node.disabled = !softwareDocument?.credentialWritable || softwareSaving })
  if (credentialState) {
    $('api-key-form').querySelector('[type="submit"]').disabled = !credentialState.writable || softwareSaving
    $('key-remove').disabled = !credentialState.writable || !credentialState.configured || softwareSaving
  }
  document.querySelectorAll('#dsh-settings-form input, #dsh-settings-form select, #dsh-settings-form button').forEach(node => {
    node.disabled = !softwareDocument || softwareSaving
  })
  if (softwareDocument && !dshDirty) {
    for (const input of document.querySelectorAll('[data-dsh-field]')) {
      const value = softwareDocument.dsh[input.dataset.dshField]
      if (input.type === 'checkbox') input.checked = value
      else input.value = String(value)
    }
  }
  if (shortcutBindings) renderShortcuts()
  renderSources()
  renderPluginSettings()
  renderPersonalAppearance()
}
function renderPluginSettings() {
  $('open-plugin-library').disabled = !state.packaged
  $('plugin-development-hint').hidden = state.packaged
  $('plugin-no-instances').hidden = state.instances.length !== 0
  $('plugin-instances').replaceChildren(...state.instances.map(instance => {
    const row = document.createElement('article')
    row.className = 'instance-row'
    const summary = document.createElement('div')
    summary.className = 'instance-summary'
    const name = document.createElement('strong')
    name.textContent = instance.name
    const hint = document.createElement('span')
    hint.className = 'plugin-instance-hint'
    hint.textContent = `${t(instance.kind)} · ${t(state.statuses[instance.id].connection)}`
    summary.append(name, hint)
    const actions = document.createElement('div')
    actions.className = 'instance-actions'
    actions.append(button('open', () => open(instance)))
    if (instance.kind === 'local') {
      const manage = button('instancePlugins', () => api.invoke('plugins', { id: instance.id }))
      manage.disabled = !state.packaged || !['connected', 'error'].includes(state.statuses[instance.id].connection)
      actions.append(manage)
    }
    row.append(summary, actions)
    return row
  }))
}
$('open-plugin-library').onclick = () => { void perform(() => api.invoke('pluginLibrary')) }
$('plugin-add-instance').onclick = () => { void perform(showManager) }
async function loadSoftwareSettings() {
  softwareDocument = await settingsCall('read')
  setShellTheme(softwareDocument.appearance.theme)
  setShellPersonalAppearance(personalDirty ? personalDraft : softwareDocument.personalization)
  const refs = new Set(['DEEPSEEK_API_KEY', ...softwareDocument.credentials])
  $('credential-refs').replaceChildren(...[...refs].map(ref => { const option = document.createElement('option'); option.value = ref; return option }))
  renderSettings()
  if (settingsTab === 'keys') await loadCredentialInfo()
}
function selectSettingsTab(tab) {
  if (settingsTab !== tab) document.querySelector('.settings-content').scrollTop = 0
  settingsTab = tab
  document.querySelectorAll('[data-settings-tab]').forEach(node => {
    const selected = node.dataset.settingsTab === tab
    node.setAttribute('aria-selected', String(selected))
    node.tabIndex = selected ? 0 : -1
  })
  document.querySelectorAll('[data-settings-pane]').forEach(node => { node.hidden = node.dataset.settingsPane !== tab })
  $('api-key-value').value = ''
  $('source-key').value = ''
  $('api-key-value').type = 'password'
  $('key-reveal').textContent = t('showSecret')
  renderSettings()
  if (tab === 'keys') void perform(loadCredentialInfo)
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
document.addEventListener('manager-settings-open', event => {
  selectSettingsTab(event.detail.tab || settingsTab)
  void perform(loadSoftwareSettings)
})
for (const [id, field] of Object.entries(settingsFields)) {
  $(id).onchange = () => {
    const value = id === 'font-size' ? Number($(id).value) : $(id).value
    void perform(async () => {
      softwareSaving = true
      renderSettings()
      try { softwareDocument = await settingsCall('update', { field, value }); setShellTheme(softwareDocument.appearance.theme) }
      finally { softwareSaving = false; await loadSoftwareSettings() }
    })
  }
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
  $('api-key-form').querySelector('[type="submit"]').disabled = !info.writable
  $('key-remove').disabled = !info.writable || !info.configured
  renderSettings()
}
$('api-key-ref').onchange = () => { credentialState = undefined; $('api-key-value').value = ''; void perform(loadCredentialInfo) }
$('key-refresh').onclick = () => { void perform(loadCredentialInfo) }
$('key-reveal').onclick = () => {
  const input = $('api-key-value')
  input.type = input.type === 'password' ? 'text' : 'password'
  $('key-reveal').textContent = t(input.type === 'password' ? 'showSecret' : 'hideSecret')
}
$('api-key-form').onsubmit = event => {
  event.preventDefault()
  const ref = $('api-key-ref').value
  const value = $('api-key-value').value
  $('api-key-value').value = ''
  $('api-key-value').type = 'password'
  $('key-reveal').textContent = t('showSecret')
  void perform(async () => {
    if (!value) throw new Error(t('keyRequired'))
    softwareSaving = true
    renderSettings()
    try { await settingsCall('credentialSet', { ref, value }) }
    finally { softwareSaving = false; await loadSoftwareSettings() }
  })
}
$('key-remove').onclick = () => {
  if (!window.confirm(t('keyRemoveConfirm'))) return
  const ref = $('api-key-ref').value
  void perform(async () => {
    softwareSaving = true
    renderSettings()
    try { await settingsCall('credentialRemove', { ref }) }
    finally { softwareSaving = false; await loadSoftwareSettings() }
  })
}
$('dsh-settings-form').oninput = () => { dshDirty = true; $('dsh-save-status').textContent = t('unsavedSettings') }
$('dsh-settings-form').onsubmit = event => {
  event.preventDefault()
  const value = Object.fromEntries([...document.querySelectorAll('[data-dsh-field]')].map(input => [
    input.dataset.dshField, input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value.trim(),
  ]))
  void perform(async () => {
    softwareSaving = true
    renderSettings()
    try {
      softwareDocument = await settingsCall('dshUpdate', { value })
      dshDirty = false
      $('dsh-save-status').textContent = t('dshSaved')
    } finally { softwareSaving = false; await loadSoftwareSettings() }
  })
}
function renderShortcuts() {
  const signature = JSON.stringify(Object.values(shortcutLabels).map(key => t(key)))
  if ($('shortcut-list').dataset.signature === signature && $('shortcut-list').childElementCount) return
  $('shortcut-list').replaceChildren()
  $('shortcut-list').dataset.signature = signature
  for (const [action, key] of Object.entries(shortcutLabels)) {
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
    $('shortcut-list').append(row)
  }
}
$('shortcut-reset').onclick = () => {
  void perform(async () => {
    shortcutBindings = await api.invoke('shortcuts', { action: 'reset' })
    $('shortcut-list').replaceChildren()
    renderShortcuts()
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
