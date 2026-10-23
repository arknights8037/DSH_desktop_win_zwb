/* The manager bridge is available only in this local, sandboxed document. */
const api = window.dshManager
const $ = id => document.getElementById(id)
let state
let editing
let credentialTarget
let credentialOperation = 'open'
let managerVisible = true
let shellPage = 'welcome'
let settingsOpen = false
let renaming
let renameDraft = ''
document.documentElement.dataset.theme = 'system'
$('theme').value = document.documentElement.dataset.theme
let refreshing = false
let refreshAgain = false
let noticeTimer
const t = key => state.messages[key]
function button(key, callback, className = '') {
  const node = document.createElement('button')
  node.textContent = t(key)
  node.className = className
  node.onclick = () => { void perform(callback) }
  return node
}
async function perform(callback) {
  try { await callback() }
  catch (error) {
    await api.invoke('overlay', { visible: true })
    $('notice').textContent = String(error.message || error)
    $('notice').hidden = false
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => { $('notice').hidden = true }, 12000)
  } finally { await refresh() }
}
async function refresh() {
  if (refreshing) { refreshAgain = true; return }
  refreshing = true
  try {
    do {
      refreshAgain = false
      state = await api.invoke('snapshot')
      render()
      document.dispatchEvent(new Event('manager-rendered'))
    } while (refreshAgain)
  } finally { refreshing = false }
}
function active() { return state.instances.find(row => row.id === state.tabs.active) }
function hideInstanceMenu() {
  $('instance-menu').hidden = true
  $('add-tab').setAttribute('aria-expanded', 'false')
  $('menu-new-sub').hidden = true
  $('menu-new').setAttribute('aria-expanded', 'false')
}
async function showManager() {
  await showSettings('instances')
}
async function closeSettings() {
  settingsOpen = false
  shellPage = 'welcome'
  managerVisible = !active()
  await restoreOverlay()
  render()
}
async function closeInstance(id) {
  await api.invoke('close', { id })
  await refresh()
  if (state.tabs.active) return
  if (settingsOpen) await showSettings()
  else {
    managerVisible = true
    shellPage = 'welcome'
    await restoreOverlay()
    render()
  }
}
async function open(config, operation = 'open') {
  if (config.kind === 'ssh' && state.statuses[config.id].connection !== 'connected') {
    credentialTarget = config
    credentialOperation = operation
    $('credential-title').textContent = config.name
    $('credential-label').textContent = t(config.auth === 'password' ? 'password' : 'passphrase')
    $('secret').value = ''
    $('secret').required = config.auth === 'password'
    await api.invoke('overlay', { visible: true })
    $('credentials').showModal()
    return
  }
  managerVisible = false
  await api.invoke(operation, { id: config.id })
}
function beginRename(config) {
  renaming = config.id
  renameDraft = config.name
  render()
  document.querySelector('.tab-rename').focus()
  document.querySelector('.tab-rename').select()
}
async function showTabMenu(event, config) {
  event.preventDefault()
  hideInstanceMenu()
  const menu = $('tab-menu')
  menu.replaceChildren()
  const action = (key, callback) => {
    const item = button(key, async () => {
      menu.hidden = true
      await restoreOverlay()
      await callback()
    }, 'menu-item')
    item.setAttribute('role', 'menuitem')
    menu.append(item)
  }
  action('rename', () => beginRename(config))
  action('reconnect', async () => {
    await api.invoke('disconnect', { id: config.id })
    await refresh()
    await open(config)
  })
  action('logs', async () => {
    const logs = await api.invoke('logs', { id: config.id })
    $('log-content').textContent = logs.length ? logs.join('\n') : t('noLogs')
    await api.invoke('overlay', { visible: true })
    $('log-dialog').showModal()
  })
  action('close', () => closeInstance(config.id))
  menu.hidden = false
  menu.style.left = `${Math.max(0, Math.min(event.clientX, window.innerWidth - 190))}px`
  menu.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - 150))}px`
  await api.invoke('overlay', { visible: true })
  menu.querySelector('button').focus()
}
function renderInstanceManager() {
  $('instances-empty').hidden = state.instances.length !== 0
  const list = $('instance-list')
  list.replaceChildren()
  for (const instance of state.instances) {
    const status = state.statuses[instance.id]
    const row = document.createElement('article')
    row.className = 'instance-row'
    const summary = document.createElement('div')
    summary.className = 'instance-summary'
    const nameLine = document.createElement('div')
    nameLine.className = 'instance-name-line'
    const dot = document.createElement('span')
    dot.className = `dot ${status.connection}`
    const name = document.createElement('strong')
    name.textContent = instance.name
    nameLine.append(dot, name)
    const details = document.createElement('span')
    details.className = 'instance-details'
    details.textContent = instance.kind === 'ssh' ? `${t('ssh')} · ${instance.username}@${instance.host}:${instance.port}` : t('local')
    const stateText = document.createElement('span')
    stateText.className = 'instance-status'
    stateText.textContent = t(status.connection)
    summary.append(nameLine, details, stateText)
    const actions = document.createElement('div')
    actions.className = 'instance-actions'
    const connect = button('open', () => open(instance), 'primary')
    connect.classList.add('instance-connect')
    const editButton = button('edit', () => edit(instance))
    const removeButton = button('remove', async () => {
      if (!window.confirm(t('removeConfirm'))) return
      await api.invoke('remove', { id: instance.id })
    })
    actions.append(connect, editButton, removeButton)
    row.append(summary, actions)
    list.append(row)
  }
}
function render() {
  document.title = t('title')
  document.querySelectorAll('[data-copy]').forEach(node => { node.textContent = t(node.dataset.copy) })
  $('add-tab').title = t('add')
  $('add-tab').setAttribute('aria-label', t('add'))
  const renameFocused = document.activeElement?.classList.contains('tab-rename')
  const renameSelection = renameFocused ? document.activeElement.selectionStart : null
  $('tabs').replaceChildren()
  for (const id of state.tabs.ids) {
    const config = state.instances.find(row => row.id === id)
    const tab = document.createElement('div')
    tab.className = `tab${id === state.tabs.active ? ' active' : ''}`
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', String(id === state.tabs.active))
    tab.tabIndex = 0
    const dot = document.createElement('span')
    dot.className = `dot ${state.statuses[id].connection}`
    const name = document.createElement('span')
    name.className = 'tab-name'
    name.textContent = config.name
    const kind = document.createElement('small')
    kind.textContent = t(config.kind)
    const close = button('close', () => closeInstance(id))
    close.textContent = '×'
    close.title = t('close')
    close.setAttribute('aria-label', t('close'))
    close.onclick = event => { event.stopPropagation(); void perform(() => closeInstance(id)) }
    if (renaming === id) {
      const input = document.createElement('input')
      input.className = 'tab-rename'
      input.setAttribute('aria-label', t('rename'))
      input.maxLength = 100
      input.value = renameDraft
      input.onclick = event => event.stopPropagation()
      input.oninput = () => { renameDraft = input.value }
      input.onkeydown = event => {
        event.stopPropagation()
        if (event.key === 'Enter' && input.value.trim()) {
          const value = input.value.trim()
          renaming = undefined
          void perform(() => api.invoke('rename', { id, name: value }))
        } else if (event.key === 'Escape') {
          renaming = undefined
          render()
        }
      }
      tab.append(dot, input, close)
    } else tab.append(dot, name, kind, close)
    tab.oncontextmenu = event => { void perform(() => showTabMenu(event, config)) }
    tab.onkeydown = event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        const rect = tab.getBoundingClientRect()
        event.preventDefault()
        void perform(() => showTabMenu({ preventDefault() {}, clientX: rect.left, clientY: rect.bottom }, config))
      } else if (event.key === 'Enter') tab.click()
    }
    tab.onclick = () => { void perform(() => open(config)) }
    $('tabs').append(tab)
  }
  if (renameFocused && document.querySelector('.tab-rename')) {
    const input = document.querySelector('.tab-rename')
    input.focus()
    input.setSelectionRange(renameSelection, renameSelection)
  }
  if (settingsOpen) {
    const tab = document.createElement('div')
    const selected = managerVisible && shellPage === 'settings'
    tab.id = 'settings-tab'
    tab.className = `tab settings-tab${selected ? ' active' : ''}`
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', String(selected))
    tab.tabIndex = 0
    tab.append($('settings').querySelector('svg').cloneNode(true))
    const name = document.createElement('span')
    name.className = 'tab-name'
    name.textContent = t('settings')
    const close = button('closeSettings', closeSettings)
    close.textContent = '×'
    close.title = t('closeSettings')
    close.setAttribute('aria-label', t('closeSettings'))
    close.onclick = event => { event.stopPropagation(); void perform(closeSettings) }
    tab.append(name, close)
    tab.onclick = () => { void perform(() => showSettings()) }
    tab.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); tab.click() } }
    $('tabs').append(tab)
  }
  if (managerVisible && shellPage === 'settings') {
    $('tabs').querySelectorAll('.tab:not(.settings-tab)').forEach(tab => {
      tab.classList.remove('active')
      tab.setAttribute('aria-selected', 'false')
    })
  }
  $('menu-instances').replaceChildren()
  for (const instance of state.instances) {
    const item = document.createElement('button')
    item.className = 'menu-item instance-menu-item'
    item.setAttribute('role', 'menuitem')
    item.textContent = `${instance.name} · ${t(instance.kind)}`
    item.onclick = () => { hideInstanceMenu(); void perform(() => open(instance)) }
    $('menu-instances').append(item)
  }
  renderInstanceManager()
  const config = active()
  const status = config ? state.statuses[config.id] : undefined
  const firstRun = managerVisible && shellPage === 'welcome'
  $('settings-page').hidden = !managerVisible || shellPage !== 'settings'
  $('panel').dataset.page = shellPage
  $('settings').setAttribute('aria-pressed', String(managerVisible && shellPage === 'settings'))
  for (const [id, key] of Object.entries({ 'window-minimize': 'minimizeWindow', 'window-maximize': state.maximized ? 'restoreWindow' : 'maximizeWindow', 'window-close': 'closeWindow' })) {
    $(id).title = t(key)
    $(id).setAttribute('aria-label', t(key))
  }
  $('window-maximize').setAttribute('aria-pressed', String(state.maximized))
  $('first-run').hidden = !firstRun
  $('panel').hidden = !managerVisible
  $('instance-state').hidden = managerVisible || !config || status.connection === 'connected'
  if (config) {
    $('state-title').textContent = `${config.name} — ${t(status.connection)}`
    $('state-message').textContent = status.message || t(status.process)
  }
}
function sshFields() {
  const form = $('edit-form').elements
  $('ssh-fields').hidden = form.kind.value !== 'ssh'
  $('key-field').hidden = form.auth.value !== 'key'
  form.host.required = form.username.required = form.kind.value === 'ssh'
  form.privateKeyPath.required = form.kind.value === 'ssh' && form.auth.value === 'key'
}
async function edit(config, initialKind) {
  editing = config
  await api.invoke('overlay', { visible: true })
  $('edit-form').reset()
  const form = $('edit-form').elements
  form.kind.disabled = Boolean(config)
  if (config) for (const [key, value] of Object.entries(config)) if (form.namedItem(key)) form.namedItem(key).value = value
  if (!config && initialKind) form.kind.value = initialKind
  $('edit-title').textContent = t(config ? 'edit' : 'add')
  sshFields()
  $('editor').showModal()
}
async function restoreOverlay() { await api.invoke('overlay', { visible: managerVisible }) }
$('edit-form').elements.kind.onchange = sshFields
$('edit-form').elements.auth.onchange = sshFields
$('edit-form').onsubmit = event => {
  event.preventDefault()
  void perform(async () => {
    const form = $('edit-form').elements
    const config = Object.fromEntries(['name', 'kind', 'host', 'username', 'auth', 'privateKeyPath', 'executable', 'home'].map(key => [key, form[key].value]))
    config.port = Number(form.port.value)
    await api.invoke('save', { ...(editing ? { id: editing.id } : {}), config })
    $('editor').close()
    await showManager()
  })
}
$('credential-form').onsubmit = event => {
  event.preventDefault()
  const config = credentialTarget
  const credentials = { [config.auth === 'password' ? 'password' : 'passphrase']: $('secret').value }
  $('secret').value = ''
  $('credentials').close()
  managerVisible = false
  void perform(async () => {
    await api.invoke(credentialOperation, { id: config.id, credentials })

  })
}
$('edit-cancel').onclick = () => $('editor').close()
$('credential-cancel').onclick = () => $('credentials').close()
$('log-close').onclick = () => $('log-dialog').close()
for (const id of ['editor', 'credentials', 'log-dialog']) $(id).addEventListener('close', () => {
  $('secret').value = ''
  void perform(restoreOverlay)
})
async function showSettings(tab) {
  hideInstanceMenu()
  $('tab-menu').hidden = true
  managerVisible = true
  shellPage = 'settings'
  settingsOpen = true
  await api.invoke('overlay', { visible: true })
  render()
  document.dispatchEvent(new CustomEvent('manager-settings-open', { detail: { tab } }))
}
$('settings').onclick = () => { void perform(() => showSettings()) }
for (const action of ['minimize', 'maximize', 'close']) {
  $(`window-${action}`).onclick = () => {
    void api.invoke('window', { action }).catch(error => { $('notice').textContent = String(error.message || error); $('notice').hidden = false })
  }
}
$('instance-add').onclick = () => { void perform(toggleInstanceMenu) }
function setShellTheme(value) {
  document.documentElement.dataset.theme = value
}
async function toggleInstanceMenu() {
  $('tab-menu').hidden = true
  const menu = $('instance-menu')
  if (menu.hidden) {
    menu.hidden = false
    $('add-tab').setAttribute('aria-expanded', 'true')
    menu.style.left = '0px'
    menu.style.left = `${Math.min(0, window.innerWidth - menu.getBoundingClientRect().right - 8)}px`
    $('menu-new-sub').classList.toggle('opens-left', menu.getBoundingClientRect().right + 156 > window.innerWidth)
    await api.invoke('overlay', { visible: true })
    return
  }
  hideInstanceMenu()
  await api.invoke('overlay', { visible: managerVisible })
}
$('add-tab').onclick = () => { void perform(toggleInstanceMenu) }
document.addEventListener('click', event => {
  const target = event.target
  if (target instanceof Node && !$('tab-menu').hidden && !$('tab-menu').contains(target)) {
    $('tab-menu').hidden = true
    void restoreOverlay()
  }
  if (target instanceof Node && !$('instance-menu').contains(target) && !$('add-tab').contains(target)) {
    if ($('instance-menu').hidden) return
    hideInstanceMenu()
    void api.invoke('overlay', { visible: managerVisible })
  }
})
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return
  if (!$('tab-menu').hidden || !$('instance-menu').hidden) {
    $('tab-menu').hidden = true
    hideInstanceMenu()
    void restoreOverlay()
  }
})
$('menu-new').onclick = () => {
  $('menu-new-sub').hidden = !$('menu-new-sub').hidden
  $('menu-new').setAttribute('aria-expanded', String(!$('menu-new-sub').hidden))
}
document.querySelectorAll('#menu-new-sub .menu-item').forEach(card => {
  card.onclick = () => {
    hideInstanceMenu()
    void perform(async () => {
      if (card.dataset.kind !== 'local') {
        await edit(undefined, card.dataset.kind)
        return
      }
      const saved = await api.invoke('save', { config: { name: t('localDefaultName'), kind: 'local' } })
      if (typeof saved !== 'object' || saved === null || !('id' in saved)) throw new Error('Local instance was not created')
      await open(saved)
    })
  }
})
document.querySelectorAll('.choice-card').forEach(card => {
  card.onclick = () => {
    void perform(async () => {
      if (card.dataset.kind !== 'local') {
        await edit(undefined, card.dataset.kind)
        return
      }
      const saved = await api.invoke('save', { config: { name: t('localDefaultName'), kind: 'local' } })
      if (typeof saved !== 'object' || saved === null || !('id' in saved)) throw new Error('Local instance was not created')
      await open(saved)
    })
  }
})
$('recover').onclick = () => { if (active()) void perform(() => open(active())) }
api.subscribe(() => { void refresh() })
void refresh().then(() => {
  const config = active()
  if (config) void perform(() => open(config))
  else if (state.instances.length) void perform(showManager)
})
