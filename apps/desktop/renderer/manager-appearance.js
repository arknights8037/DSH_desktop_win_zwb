/* Appearance drafts preview across the shell and instances; Save persists the complete document. */
const personalDefaults = () => ({ backgroundImage: '', backgroundEnabled: true, maskEnabled: true,
  maskColor: '#000000', maskOpacity: 35, surfaceOpacity: 80,
  colors: { canvas: '', tabs: '', sidebar: '', content: '', input: '', accent: '', text: '', muted: '' } })
const personalLabels = { canvas: 'colorCanvas', tabs: 'colorTabs', sidebar: 'colorSidebar', content: 'colorContent',
  input: 'colorInput', accent: 'colorAccent', text: 'colorText', muted: 'colorMuted' }
const personalPresets = {
  ocean: { canvas: '#edf4fa', tabs: '#dce9f5', sidebar: '#e0edf7', content: '#f5f9fd', input: '#ffffff', accent: '#236baf', text: '#142e45', muted: '#526d83' },
  forest: { canvas: '#eef4ed', tabs: '#dfeadd', sidebar: '#e3eddf', content: '#f6f9f3', input: '#ffffff', accent: '#42744a', text: '#203623', muted: '#60765f' },
  plum: { canvas: '#241f2d', tabs: '#30283c', sidebar: '#2b2535', content: '#292332', input: '#362d42', accent: '#ba9ae3', text: '#f2eafc', muted: '#bdb0ce' },
}
let personalDraft
let personalDirty = false
let personalReading = false
const personalVariables = ['--bg', '--panel', '--panel-hover', '--line', '--tab-strip', '--brand', '--brand-strong', '--brand-foreground', '--text', '--muted',
  '--personal-wallpaper', '--personal-sidebar', '--personal-content', '--personal-input', '--personal-card', '--personal-active-tab']

function setShellPersonalAppearance(value) {
  const root = document.documentElement
  for (const name of personalVariables) root.style.removeProperty(name)
  if (!value) return
  const base = getComputedStyle(root)
  const colors = value.colors
  const image = value.backgroundEnabled && value.backgroundImage
  const surface = color => image ? `color-mix(in srgb, ${color} ${value.surfaceOpacity}%, transparent)` : color
  const put = (name, color) => { if (color) root.style.setProperty(name, color) }
  const panel = base.getPropertyValue('--panel').trim()
  const tabs = base.getPropertyValue('--tab-strip').trim()
  put('--bg', colors.canvas)
  put('--panel', colors.content)
  put('--tab-strip', surface(colors.tabs || tabs))
  put('--personal-sidebar', surface(colors.sidebar || panel))
  put('--personal-content', surface(colors.content || panel))
  put('--personal-input', surface(colors.input || panel))
  put('--personal-card', image ? 'transparent' : colors.content || panel)
  put('--personal-active-tab', image ? 'transparent' : colors.tabs || colors.content || panel)
  put('--brand', colors.accent)
  put('--brand-strong', colors.accent)
  if (colors.accent) {
    const rgb = colors.accent.slice(1).match(/../g).map(part => parseInt(part, 16))
    put('--brand-foreground', rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 150 ? '#101218' : '#ffffff')
  }
  put('--text', colors.text)
  put('--muted', colors.muted)
  if (image || colors.content || colors.canvas) {
    const fill = colors.content || colors.canvas
    const text = colors.text || base.getPropertyValue('--text').trim()
    put('--panel-hover', `color-mix(in srgb, ${text} 8%, ${image ? 'transparent' : fill})`)
    put('--line', `color-mix(in srgb, ${text} 18%, transparent)`)
  }
  if (image) {
    const mask = value.maskEnabled ? `color-mix(in srgb, ${value.maskColor} ${value.maskOpacity}%, transparent)` : 'transparent'
    put('--personal-wallpaper', `linear-gradient(${mask}, ${mask}), url("${image}")`)
  }
}

function renderPersonalAppearance() {
  if (!personalDirty) personalDraft = structuredClone(softwareDocument?.personalization || personalDefaults())
  const value = personalDraft
  $('wallpaper-enabled').checked = value.backgroundEnabled
  $('wallpaper-mask').checked = value.maskEnabled
  $('wallpaper-mask-color').value = value.maskColor
  $('wallpaper-mask-opacity').value = String(value.maskOpacity)
  $('wallpaper-surface-opacity').value = String(value.surfaceOpacity)
  $('wallpaper-mask-value').textContent = `${value.maskOpacity}%`
  $('wallpaper-surface-value').textContent = `${value.surfaceOpacity}%`
  $('wallpaper-status').textContent = t(personalReading ? 'readingWallpaper' : value.backgroundImage ? 'wallpaperReady' : 'wallpaperEmpty')
  $('personal-colors').replaceChildren(...Object.entries(personalLabels).map(([key, copy]) => {
    const row = document.createElement('div')
    row.className = 'color-row'
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'color'
    input.id = `personal-color-${key}`
    input.value = value.colors[key] || (key === 'text' ? '#202124' : '#ffffff')
    const name = document.createElement('span')
    name.textContent = t(copy)
    label.append(input, name)
    const reset = document.createElement('button')
    reset.type = 'button'
    reset.dataset.colorReset = key
    reset.textContent = t(value.colors[key] ? 'followTheme' : 'followingTheme')
    reset.disabled = !value.colors[key]
    reset.setAttribute('aria-label', `${t(copy)} · ${t('followTheme')}`)
    input.onchange = () => { value.colors[key] = input.value; previewPersonalAppearance() }
    reset.onclick = () => { value.colors[key] = ''; previewPersonalAppearance() }
    row.append(label, reset)
    return row
  }))
  for (const node of document.querySelectorAll('#personal-appearance-form input, #personal-appearance-form select, #personal-appearance-form button')) {
    node.disabled = !softwareDocument || softwareSaving || personalReading || Boolean(node.dataset.colorReset && !value.colors[node.dataset.colorReset])
  }
  $('wallpaper-remove').disabled = !value.backgroundImage || softwareSaving || personalReading
  $('appearance-revert').disabled = !personalDirty || softwareSaving || personalReading
  $('appearance-save-status').textContent = t(personalDirty ? 'unsavedSettings' : 'appearanceSaved')
}

function previewPersonalAppearance() {
  personalDirty = true
  setShellPersonalAppearance(personalDraft)
  renderPersonalAppearance()
  void perform(() => settingsCall('previewPersonalization', { value: personalDraft }))
}

for (const [id, field] of Object.entries({ 'wallpaper-enabled': 'backgroundEnabled', 'wallpaper-mask': 'maskEnabled',
  'wallpaper-mask-color': 'maskColor', 'wallpaper-mask-opacity': 'maskOpacity', 'wallpaper-surface-opacity': 'surfaceOpacity' })) {
  $(id).oninput = () => {
    personalDraft[field] = $(id).type === 'checkbox' ? $(id).checked : $(id).type === 'range' ? Number($(id).value) : $(id).value
    previewPersonalAppearance()
  }
}
$('wallpaper-remove').onclick = () => { personalDraft.backgroundImage = ''; previewPersonalAppearance() }
$('appearance-preset').onchange = () => {
  const preset = personalPresets[$('appearance-preset').value]
  if (preset) { personalDraft.colors = { ...preset }; previewPersonalAppearance() }
  $('appearance-preset').value = ''
}
$('appearance-defaults').onclick = () => { personalDraft = personalDefaults(); previewPersonalAppearance() }
$('appearance-revert').onclick = () => {
  personalDirty = false
  setShellPersonalAppearance(softwareDocument.personalization)
  renderPersonalAppearance()
  void perform(() => settingsCall('previewPersonalization', { value: null }))
}
$('personal-appearance-form').onsubmit = event => {
  event.preventDefault()
  const value = structuredClone(personalDraft)
  void perform(async () => {
    softwareSaving = true
    renderSettings()
    try {
      softwareDocument = await settingsCall('personalize', { value })
      personalDirty = false
      setShellPersonalAppearance(softwareDocument.personalization)
    } finally { softwareSaving = false; renderSettings() }
  })
}

async function wallpaperData(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error(t('wallpaperInvalid'))
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.85, 0.7, 0.5, 0.3]) {
      const data = canvas.toDataURL('image/webp', quality)
      if (data.length <= 524288) return data
    }
    throw new Error(t('wallpaperInvalid'))
  } finally { bitmap.close() }
}
$('wallpaper-file').onchange = () => {
  const file = $('wallpaper-file').files[0]
  $('wallpaper-file').value = ''
  if (!file) return
  void perform(async () => {
    personalReading = true
    renderPersonalAppearance()
    try { personalDraft.backgroundImage = await wallpaperData(file); personalDraft.backgroundEnabled = true; previewPersonalAppearance() }
    finally { personalReading = false; renderSettings() }
  })
}
$('colors-export').onclick = () => {
  const colors = { ...personalDraft.colors }
  void perform(() => settingsCall('exportColors', { colors }))
}
$('colors-import').onchange = () => {
  const file = $('colors-import').files[0]
  $('colors-import').value = ''
  if (!file) return
  void perform(async () => {
    if (file.size > 16384) throw new Error(t('colorsInvalid'))
    const source = await file.text()
    let scheme
    try { scheme = JSON.parse(source) }
    catch (error) { throw new Error(t('colorsInvalid'), { cause: error }) }
    const keys = Object.keys(personalLabels)
    if (scheme?.version !== 1 || !scheme.colors || typeof scheme.colors !== 'object' || Array.isArray(scheme.colors)
      || Object.keys(scheme.colors).length !== keys.length || keys.some(key => typeof scheme.colors[key] !== 'string'
        || !/^(?:#[\da-fA-F]{6})?$/.test(scheme.colors[key]))) throw new Error(t('colorsInvalid'))
    personalDraft.colors = { ...scheme.colors }
    previewPersonalAppearance()
  })
}
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
  setShellPersonalAppearance(personalDirty ? personalDraft : softwareDocument?.personalization)
})
